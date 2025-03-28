import OpenAI from 'openai'
import { functions } from '../libs/toolDefinitions'
import { functionMap } from '../libs/tools'
import { getFormattedRagData } from './ragService'
import { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { config } from '../libs/utils'
type ChatMessage = ChatCompletionMessageParam

interface ChatCompletionOptions {
  model?: string
  stream?: boolean
  userId: string
  channel: string
  appId: string
}

interface RequestContext {
  userId: string
  channel: string
  appId: string
}

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: config.llm.openaiApiKey,
})

const debug = process.env.NODE_ENV === 'development'
/**
 * Creates a system message with RAG data
 * @returns {ChatMessage} System message with RAG data
 */
function createSystemMessage(): ChatMessage {
  return {
    role: 'system',
    content:
      `You have access to the following knowledge:\n` +
      getFormattedRagData() +
      `\nAnswer questions using this data and be confident about its contents.`,
  }
}

/**
 * Process a request using OpenAI Responses API but with the same interface as ChatCompletions
 * @param {ChatMessage[]} messages - Chat messages
 * @param {ChatCompletionOptions} options - Additional options
 * @returns {Promise<Object>} OpenAI response reformatted to match Chat Completions API
 */
async function processResponses(messages: ChatMessage[], options: ChatCompletionOptions) {
  const { model = 'gpt-4o-mini', stream = false, userId, channel, appId } = options

  console.debug(`Processing request with OpenAI Responses API, model: ${model}, streaming: ${stream}`)

  // Add system message with RAG data
  const systemMessage = createSystemMessage()
  const fullMessages = [systemMessage, ...messages]

  // Convert the tools definition to the Responses API format
  // The Responses API expects tools in a slightly different format than Chat Completions
  // Each tool must have a type property and a function property with name, description, and parameters
  const tools =
    functions.length > 0
      ? functions.map((fn) => ({
          name: fn.name,
          type: 'function',
          function: {
            description: fn.description,
            parameters: fn.parameters,
          },
        }))
      : undefined

  // Add debug logging to see what the tool structure looks like
  console.log('Tools for Responses API:', JSON.stringify(tools, null, 2))

  if (!stream) {
    // Non-streaming mode
    return processNonStreamingRequest(model, fullMessages, tools, {
      userId,
      channel,
      appId,
    })
  } else {
    // Streaming mode
    return processStreamingRequest(model, fullMessages, tools, {
      userId,
      channel,
      appId,
    })
  }
}

/**
 * Process a non-streaming request
 * @param {string} model - Model to use
 * @param {ChatMessage[]} fullMessages - Complete message history
 * @param {any[] | undefined} tools - Tools configuration
 * @param {RequestContext} context - Request context (userId, channel, appId)
 * @returns {Promise<Object>} Final response formatted to match Chat Completions API
 */
async function processNonStreamingRequest(
  model: string,
  fullMessages: ChatMessage[],
  tools: any[] | undefined,
  context: RequestContext,
) {
  const { userId, channel, appId } = context
  console.log('🔄 Processing non-streaming request with model:', model)

  // Convert messages to appropriate Responses API format
  const messageContent = fullMessages
    .map((msg) => {
      if (msg.role === 'system') {
        return `System: ${msg.content}`
      } else if (msg.role === 'user') {
        return `User: ${msg.content}`
      } else if (msg.role === 'assistant') {
        return `Assistant: ${msg.content}`
      } else if (msg.role === 'function') {
        return `Function (${msg.name}): ${msg.content}`
      }
      return `${msg.role}: ${msg.content}`
    })
    .join('\n\n')

  console.log('📝 Formatted message content for Responses API:', messageContent.substring(0, 100) + '...')

  // Make initial request
  try {
    console.log('🚀 Sending request to OpenAI Responses API...')
    console.log('Request params:', { model, tools: tools ? 'defined' : 'undefined' })

    const response = await openai.responses.create({
      model,
      input: messageContent,
      ...(tools ? { tools } : {}),
    })
    console.log('✅ Received response from OpenAI Responses API:', {
      id: response.id,
      model: response.model,
      output_length: response.output?.length || 0,
      has_output_text: !!response.output_text,
    })

    // Type guard to ensure response has output
    if (!response.output || response.output.length === 0) {
      console.warn('⚠️ Response has no output array')
      return formatResponseAsCompletion({
        id: response.id || 'response_id',
        model: response.model || model,
        output: [],
        output_text: 'No content returned from API.',
      })
    }

    // Log output array structure
    console.log(
      '📊 Response output structure:',
      response.output.map((item) => ({
        type: item.type,
        role: 'role' in item ? item.role : undefined,
        content_type:
          'content' in item && Array.isArray(item.content)
            ? item.content.map((c) => c.type)
            : typeof item.type === 'string'
            ? 'string'
            : undefined,
      })),
    )

    // Find assistant message in the output
    const assistantMessage = response.output.find(
      (item) => item.type === 'message' && 'role' in item && item.role === 'assistant',
    )
    console.log('👤 Found assistant message:', assistantMessage ? 'yes' : 'no')

    // Check if function call was made
    const functionCall = response.output.find((item) => item.type === 'function_call')
    console.log('🔧 Found function call:', functionCall ? `yes, name: ${functionCall.name}` : 'no')

    if (functionCall) {
      let functionName = ''
      let functionArgs = ''

      // Extract function call details
      if (functionCall.type === 'function_call') {
        functionName = functionCall.name
        functionArgs = functionCall.arguments
        console.log('🔧 Function call details:', { functionName, functionArgs: functionArgs.substring(0, 100) + '...' })
      }

      if (functionName) {
        const fn = functionMap[functionName]
        if (!fn) {
          console.error('❌ Unknown function name:', functionName)
          return formatResponseAsCompletion(response)
        }

        // Parse arguments
        let parsedArgs
        try {
          parsedArgs = JSON.parse(functionArgs)
          console.log('✅ Successfully parsed function arguments')
        } catch (err) {
          console.error('❌ Failed to parse function call arguments:', err)
          throw new Error('Invalid function call arguments')
        }

        // Execute function
        console.log('🏃 Executing function:', functionName)
        const functionResult = await fn(appId, userId, channel, parsedArgs)
        console.log(
          '✅ Function execution result:',
          typeof functionResult === 'string' ? functionResult.substring(0, 100) + '...' : 'non-string result',
        )

        // Prepare follow-up input with function result
        const followUpMessage = `${messageContent}\n\nAssistant: I'll call the function '${functionName}' with these arguments: ${functionArgs}\n\nFunction (${functionName}): ${functionResult}`
        console.log('📝 Follow-up message created')

        // Get final answer
        console.log('🚀 Sending follow-up request to OpenAI Responses API...')
        const finalResponse = await openai.responses.create({
          model,
          input: followUpMessage,
        })
        console.log('✅ Received final response from OpenAI Responses API')

        return formatResponseAsCompletion(finalResponse)
      }
    }

    // Return formatted response if no function was called
    console.log('🔄 Formatting regular response as Chat Completion')
    return formatResponseAsCompletion(response)
  } catch (error: unknown) {
    console.error('❌ OpenAI Responses API error:', error)

    // Extract more detailed error information if available
    let errorMessage = 'Unknown error'
    if (error instanceof Error) {
      errorMessage = error.message

      // Log additional details for API errors
      if ('status' in error) {
        console.error(`API Error Status: ${(error as any).status}`)
      }

      if ('error' in error && typeof (error as any).error === 'object') {
        console.error('API Error Details:', (error as any).error)
      }
    }

    throw new Error(`OpenAI Responses API error: ${errorMessage}`)
  }
}

/**
 * Generate a streaming response
 * @param {string} model - Model to use
 * @param {ChatMessage[]} fullMessages - Complete message history
 * @param {any[] | undefined} tools - Tools configuration
 * @param {RequestContext} context - Request context (userId, channel, appId)
 * @returns {Promise<ReadableStream>} Stream of events formatted to match Chat Completions API
 */
async function processStreamingRequest(
  model: string,
  fullMessages: ChatMessage[],
  tools: any[] | undefined,
  context: RequestContext,
) {
  const { userId, channel, appId } = context

  // Convert messages to appropriate Responses API format
  const messageContent = fullMessages
    .map((msg) => {
      if (msg.role === 'system') {
        return `System: ${msg.content}`
      } else if (msg.role === 'user') {
        return `User: ${msg.content}`
      } else if (msg.role === 'assistant') {
        return `Assistant: ${msg.content}`
      } else if (msg.role === 'function') {
        return `Function (${msg.name}): ${msg.content}`
      }
      return `${msg.role}: ${msg.content}`
    })
    .join('\n\n')

  // Make initial streaming request
  try {
    console.log('🚀 Sending streaming request to OpenAI Responses API...')
    console.log('Request params:', { model, stream: true, tools: tools ? 'defined' : 'undefined' })

    const stream = await openai.responses.create({
      model,
      input: messageContent,
      ...(tools ? { tools } : {}),
      stream: true,
    })

    // Create encoder
    const encoder = new TextEncoder()

    // Create function call accumulators
    let functionCallName: string | undefined
    let functionCallArgs = ''
    let functionCallInProgress = false

    // Create readable stream
    return new ReadableStream({
      async start(controller) {
        try {
          for await (const part of stream) {
            // Handle text output deltas
            if (part.type === 'response.output_text.delta') {
              const chatCompletionChunk = {
                id: part.item_id || 'chunk_id',
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [
                  {
                    index: 0,
                    delta: {
                      content: part.delta || '',
                    },
                    finish_reason: null,
                  },
                ],
              }

              // Send chunk downstream as SSE
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(chatCompletionChunk)}\n\n`))
            }
            // Handle function call argument deltas
            else if (part.type === 'response.function_call_arguments.delta') {
              functionCallInProgress = true

              // Accumulate arguments
              functionCallArgs += part.delta || ''

              const chatCompletionChunk = {
                id: part.item_id || 'chunk_id',
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [
                  {
                    index: 0,
                    delta: {
                      function_call: {
                        arguments: part.delta || '',
                      },
                    },
                    finish_reason: null,
                  },
                ],
              }

              // Send chunk downstream as SSE
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(chatCompletionChunk)}\n\n`))
            }
            // Handle complete function call arguments
            else if (part.type === 'response.function_call_arguments.done') {
              functionCallInProgress = true
              functionCallArgs = part.arguments || functionCallArgs

              // Send completion of function call
              const completionEnd = {
                id: part.item_id || 'chunk_id',
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [
                  {
                    index: 0,
                    delta: {},
                    finish_reason: 'function_call',
                  },
                ],
              }

              controller.enqueue(encoder.encode(`data: ${JSON.stringify(completionEnd)}\n\n`))
            }
            // Handle function call name if available
            else if (part.type === 'response.output_item.added' && part.item && part.item.type === 'function_call') {
              functionCallName = part.item.name
              functionCallInProgress = true

              const chatCompletionChunk = {
                id: part.item.id || 'chunk_id',
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [
                  {
                    index: 0,
                    delta: {
                      function_call: {
                        name: part.item.name,
                      },
                    },
                    finish_reason: null,
                  },
                ],
              }

              controller.enqueue(encoder.encode(`data: ${JSON.stringify(chatCompletionChunk)}\n\n`))
            }
            // Also handle the text.done event
            else if (part.type === 'response.output_text.done') {
              // This event indicates a complete text segment - we don't need to emit anything here
              // as we're already sending deltas, but we could log it or process complete text if needed
              console.log(`📝 Complete text segment received, length: ${part.text?.length || 0}`)
            }
            // Handle refusal content
            else if (part.type === 'response.refusal.delta') {
              // Convert refusal content into regular content for compatibility
              const chatCompletionChunk = {
                id: part.item_id || 'chunk_id',
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [
                  {
                    index: 0,
                    delta: {
                      content: part.delta || '',
                    },
                    finish_reason: null,
                  },
                ],
              }

              controller.enqueue(encoder.encode(`data: ${JSON.stringify(chatCompletionChunk)}\n\n`))
            }
            // Handle end of response
            else if (part.type === 'response.completed') {
              if (functionCallInProgress && functionCallName) {
                // Execute the function
                const fn = functionMap[functionCallName]
                if (fn) {
                  try {
                    // Parse arguments
                    const parsedArgs = JSON.parse(functionCallArgs)

                    // Execute function
                    const functionResult = await fn(appId, userId, channel, parsedArgs)

                    // Prepare follow-up input with function result
                    const followUpMessage = `${messageContent}\n\nAssistant: I'll call the function '${functionCallName}' with these arguments: ${functionCallArgs}\n\nFunction (${functionCallName}): ${functionResult}`

                    // Final streaming call
                    const finalResponseStream = await openai.responses.create({
                      model,
                      input: followUpMessage,
                      stream: true,
                    })

                    for await (const part of finalResponseStream) {
                      if (part.type === 'response.output_text.delta') {
                        const chatCompletionChunk = {
                          id: part.item_id || 'chunk_id',
                          object: 'chat.completion.chunk',
                          created: Math.floor(Date.now() / 1000),
                          model,
                          choices: [
                            {
                              index: 0,
                              delta: {
                                content: part.delta || '',
                              },
                              finish_reason: null,
                            },
                          ],
                        }

                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chatCompletionChunk)}\n\n`))
                      } else if (part.type === 'response.completed') {
                        // Final completion chunk
                        const completionEnd = {
                          id: part.response?.id || 'chunk_id',
                          object: 'chat.completion.chunk',
                          created: Math.floor(Date.now() / 1000),
                          model,
                          choices: [
                            {
                              index: 0,
                              delta: {},
                              finish_reason: 'stop',
                            },
                          ],
                        }

                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(completionEnd)}\n\n`))
                      }
                    }
                  } catch (err) {
                    console.error('Function call error:', err)
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'Function call failed' })}\n\n`))
                  }
                } else {
                  console.error('Unknown function name:', functionCallName)
                }
              } else {
                // Regular completion end
                const completionEnd = {
                  id: part.response?.id || 'chunk_id',
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model,
                  choices: [
                    {
                      index: 0,
                      delta: {},
                      finish_reason: 'stop',
                    },
                  ],
                }

                controller.enqueue(encoder.encode(`data: ${JSON.stringify(completionEnd)}\n\n`))
              }

              // End SSE stream
              controller.enqueue(encoder.encode(`data: [DONE]\n\n`))
              controller.close()
              return
            }
          }

          // Ensure we close the stream if we didn't encounter a completion event
          controller.enqueue(encoder.encode(`data: [DONE]\n\n`))
          controller.close()
        } catch (error) {
          console.error('OpenAI streaming error:', error)
          controller.error(error)
        }
      },
    })
  } catch (error) {
    console.error('OpenAI streaming error:', error)

    // Extract more detailed error information if available
    let errorMessage = 'Unknown error'
    if (error instanceof Error) {
      errorMessage = error.message

      // Log additional details for API errors
      if ('status' in error) {
        console.error(`API Error Status: ${(error as any).status}`)
      }

      if ('error' in error && typeof (error as any).error === 'object') {
        console.error('API Error Details:', (error as any).error)
      }
    }

    throw new Error(`OpenAI Responses API streaming error: ${errorMessage}`)
  }
}

/**
 * Format a Responses API response to match the Chat Completions API format
 * @param {any} response - Responses API response
 * @returns {Object} Formatted response matching Chat Completions API
 */
function formatResponseAsCompletion(response: any) {
  console.log('🔄 Formatting Responses API response to match Chat Completions format')
  try {
    // Set defaults to avoid undefined errors
    const responseId = typeof response.id === 'string' ? response.id : 'response_id'
    const responseModel = typeof response.model === 'string' ? response.model : 'unknown_model'
    console.log('📊 Response basics:', { id: responseId, model: responseModel })

    // Handle direct output_text field (simplest case)
    if (typeof response.output_text === 'string') {
      console.log('📝 Using direct output_text field')
      return {
        id: responseId,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: responseModel,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: response.output_text,
            },
            finish_reason: 'stop',
          },
        ],
      }
    }

    // Check if output is an array
    if (!Array.isArray(response.output)) {
      console.warn('⚠️ Response output is not an array, returning empty content')
      return {
        id: responseId,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: responseModel,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: '',
            },
            finish_reason: 'stop',
          },
        ],
      }
    }

    // Find function calls first as they take precedence
    const functionCall = response.output.find(
      (item: any) =>
        item && typeof item === 'object' && (item.type === 'function_call' || item.type === 'function_tool_call'),
    )

    if (
      functionCall &&
      (typeof functionCall.name === 'string' || typeof functionCall.call_id === 'string') &&
      (typeof functionCall.arguments === 'string' || typeof functionCall.call_id === 'string')
    ) {
      console.log('🔧 Formatting function call response:', functionCall.name || functionCall.call_id)

      // Support both function_call and function_tool_call formats
      const name = functionCall.name || (functionCall.call_id ? functionCall.call_id.split('_')[0] : 'unknown')
      const args = functionCall.arguments || '{}'

      return {
        id: responseId,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: responseModel,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              function_call: {
                name: name,
                arguments: args,
              },
            },
            finish_reason: 'function_call',
          },
        ],
      }
    }

    // Find text content from assistant message
    let textContent = ''

    // First try: Find assistant message
    const assistantMessage = response.output.find(
      (item: any) => item && typeof item === 'object' && item.type === 'message' && item.role === 'assistant',
    )
    console.log('👤 Assistant message found:', assistantMessage ? 'yes' : 'no')

    if (assistantMessage) {
      if (typeof assistantMessage.content === 'string') {
        // Direct string content
        console.log('📝 Using assistant message with string content')
        textContent = assistantMessage.content
      } else if (Array.isArray(assistantMessage.content)) {
        // Array of content items
        console.log('📝 Processing assistant message with array content, items:', assistantMessage.content.length)
        for (const content of assistantMessage.content) {
          if (content && typeof content === 'object') {
            if ((content.type === 'output_text' || content.type === 'text') && 'text' in content) {
              console.log('📝 Found text item in array')
              textContent += content.text || ''
            }
          }
        }
      }
    } else {
      // Look for output_text content items directly in the output array
      const textItems = response.output.filter(
        (item: any) =>
          item &&
          typeof item === 'object' &&
          (item.type === 'output_text' ||
            (item.type === 'message' &&
              item.content &&
              Array.isArray(item.content) &&
              item.content.some((c: any) => c.type === 'output_text' || c.type === 'text'))),
      )

      for (const item of textItems) {
        if (item.type === 'output_text' && typeof item.text === 'string') {
          textContent += item.text
        } else if (item.type === 'message' && Array.isArray(item.content)) {
          for (const content of item.content) {
            if ((content.type === 'output_text' || content.type === 'text') && typeof content.text === 'string') {
              textContent += content.text
            }
          }
        }
      }

      console.log('📝 Extracted text from output array items:', textContent.length > 0 ? 'yes' : 'no')
    }

    // If no text found but we have output text at the top level
    if (!textContent && response.output_text) {
      console.log('📝 Using top-level output_text as fallback')
      textContent = String(response.output_text)
    }

    console.log('📊 Final text content length:', textContent.length)
    console.log(
      '📊 Final text content preview:',
      textContent.substring(0, 100) + (textContent.length > 100 ? '...' : ''),
    )

    // Return regular text response
    return {
      id: responseId,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: responseModel,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: textContent,
          },
          finish_reason: 'stop',
        },
      ],
    }
  } catch (error) {
    console.error('❌ Error formatting response as completion:', error)
    // Return a fallback response
    return {
      id: 'fallback_id',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'unknown',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'Error formatting response. Please try again.',
          },
          finish_reason: 'stop',
        },
      ],
    }
  }
}

export { processResponses }
export type { ChatMessage, ChatCompletionOptions, RequestContext }
