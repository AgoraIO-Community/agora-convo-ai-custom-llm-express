import { Router, Request, Response, RequestHandler } from 'express'
import { processChatCompletion } from '../services/openaiCompletionsService'
import { processResponses } from '../services/openaiResponsesService'
import { validateRequest } from '../middleware/auth'
import { config } from '../libs/utils'

const router = Router()

// Middleware to validate API token
router.use(validateRequest as RequestHandler)

// Chat completion endpoint
router.post('/completion', (async (req: Request, res: Response) => {
  try {
    const {
      messages,
      model = 'gpt-4o-mini',
      stream = false,
      channel = 'ccc',
      userId = '111',
      appId = '20b7c51ff4c644ab80cf5a4e646b0537',
    } = req.body

    if (!messages) {
      return res.status(400).json({ error: 'Missing "messages" in request body' })
    }

    if (!appId) {
      return res.status(400).json({ error: 'Missing "appId" in request body' })
    }

    // This server supports both the Chat Completions API and the Responses API
    // Use either processChatCompletion or processResponses based on config
    const processHandler = config.llm.useResponsesApi ? processResponses : processChatCompletion

    console.log(
      `Using ${config.llm.useResponsesApi ? 'OpenAI Responses API' : 'OpenAI Chat Completions API'} for request`,
    )

    const result = await processHandler(messages, {
      model,
      stream,
      channel,
      userId,
      appId,
    })

    if (stream) {
      // Set SSE headers
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')

      if (result instanceof ReadableStream) {
        // Handle Web ReadableStream
        const reader = result.getReader()

        // Process stream chunks
        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            break
          }

          // Write chunks to response
          res.write(value)
        }

        // End the response
        res.end()
      } else {
        // Fallback for non-streaming response
        res.json(result)
      }
    } else {
      res.json(result)
    }
  } catch (err: any) {
    console.error('Chat Completions Error:', err)
    res.status(500).json({ error: err.message })
  }
}) as RequestHandler)

export const chatCompletionRouter = router
