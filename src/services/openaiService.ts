import OpenAI from 'openai'
import { functions } from '../libs/toolDefinitions'
import { functionMap } from '../libs/tools'
import { getFormattedRagData } from './ragService'
import { ChatCompletionMessageParam, ChatCompletion } from 'openai/resources/chat/completions'
import { Stream } from 'openai/streaming'
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
 * Process a chat completion request with OpenAI
 * @param {ChatMessage[]} messages - Chat messages
 * @param {ChatCompletionOptions} options - Additional options
 * @returns {Promise<Object>} OpenAI response
 */
async function processChatCompletion(messages: ChatMessage[], options: ChatCompletionOptions) {
  const { model = 'gpt-4o-mini', stream = false, userId, channel, appId } = options

  // Add system message with RAG data
  const systemMessage = createSystemMessage()
  const fullMessages = [systemMessage, ...messages]

  // Build request options
  const requestOptions = {
    model,
    messages: fullMessages,
    functions,
    function_call: 'auto' as const,
  }

  if (!stream) {
    // Non-streaming mode
    return processNonStreamingRequest(requestOptions, fullMessages, {
      userId,
      channel,
      appId,
    })
  } else {
    // Streaming mode
    return processStreamingRequest(requestOptions, fullMessages, {
      userId,
      channel,
      appId,
    })
  }
}

/**
 * Process a non-streaming request
 * @param {Object} requestOptions - OpenAI request options
 * @param {ChatMessage[]} fullMessages - Complete message history
 * @param {RequestContext} context - Request context (userId, channel, appId)
 * @returns {Promise<Object>} Final response
 */
async function processNonStreamingRequest(requestOptions: any, fullMessages: ChatMessage[], context: RequestContext) {
  const { userId, channel, appId } = context

  // Make initial request
  const response = await openai.chat.completions.create({
    ...requestOptions,
    stream: false,
  })

  // Check if function call was made
  if (response.choices && response.choices[0]?.finish_reason === 'function_call') {
    const fc = response.choices[0].message?.function_call
    if (fc?.name && fc.arguments) {
      const fn = functionMap[fc.name]
      if (!fn) {
        console.error('Unknown function name:', fc.name)
        return response
      }

      // Parse arguments
      let parsedArgs
      try {
        parsedArgs = JSON.parse(fc.arguments)
      } catch (err) {
        console.error('Failed to parse function call arguments:', err)
        throw new Error('Invalid function call arguments')
      }

      // Execute function
      const functionResult = await fn(appId, userId, channel, parsedArgs)

      // Append function result to messages
      const updatedMessages = [
        ...fullMessages,
        {
          role: 'function' as const,
          name: fc.name,
          content: functionResult,
        },
      ]

      // Get final answer
      const finalResponse = await openai.chat.completions.create({
        model: requestOptions.model,
        messages: updatedMessages,
        stream: false,
      })

      return finalResponse
    }
  }

  // Return original response if no function was called
  return response
}

/**
 * Generate a streaming response
 * @param {Object} requestOptions - OpenAI request options
 * @param {ChatMessage[]} fullMessages - Complete message history
 * @param {RequestContext} context - Request context (userId, channel, appId)
 * @returns {Promise<ReadableStream>} Stream of events
 */
async function processStreamingRequest(requestOptions: any, fullMessages: ChatMessage[], context: RequestContext) {
  const { userId, channel, appId } = context

  // Make initial streaming request
  const initialResponse = (await openai.chat.completions.create({
    ...requestOptions,
    stream: true,
  })) as unknown as Stream<OpenAI.Chat.ChatCompletion>

  // Create encoder
  const encoder = new TextEncoder()

  // Create function call accumulators
  let functionCallName: string | undefined
  let functionCallArgs = ''

  // Create readable stream
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const part of initialResponse) {
          // Cast to any to access streaming delta property
          const choice = part.choices[0] as ChatCompletion.Choice
          const delta = choice?.finish_reason

          // If partial function call data
          if (delta === 'function_call') {
            const fc = choice.message.tool_calls
            fc?.forEach((toolCall) => {
              if (toolCall.function.name) {
                functionCallName = toolCall.function.name
              }
              if (toolCall.function.arguments) {
                functionCallArgs += toolCall.function.arguments
              }
            })
          }

          // Send chunk downstream as SSE
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(part)}\n\n`))

          // If finish_reason is encountered, attempt function call
          if (part.choices[0].finish_reason) {
            if (functionCallName && functionCallArgs) {
              const fn = functionMap[functionCallName]
              if (fn) {
                // Parse arguments
                let parsedArgs
                try {
                  parsedArgs = JSON.parse(functionCallArgs)
                } catch (err) {
                  console.error('Failed to parse function call arguments:', err)
                }

                if (parsedArgs) {
                  // Execute function
                  const functionResult = await fn(appId, userId, channel, parsedArgs)

                  // Append function message
                  const updatedMessages = [
                    ...fullMessages,
                    {
                      role: 'function' as const,
                      name: functionCallName,
                      content: functionResult,
                    },
                  ]

                  // Final streaming call
                  const finalResponse = await openai.chat.completions.create({
                    model: requestOptions.model,
                    messages: updatedMessages,
                    stream: true,
                  })

                  for await (const part2 of finalResponse) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(part2)}\n\n`))
                  }
                }
              } else {
                console.error('Unknown function name:', functionCallName)
              }
            }

            // End SSE stream
            controller.enqueue(encoder.encode(`data: [DONE]\n\n`))
            controller.close()
            return
          }
        }
      } catch (error) {
        console.error('OpenAI streaming error:', error)
        controller.error(error)
      }
    },
  })
}

export { processChatCompletion }
export type { ChatMessage, ChatCompletionOptions, RequestContext }
