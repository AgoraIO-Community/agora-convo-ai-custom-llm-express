import { Router, Request, Response, RequestHandler } from 'express'
import { processChatCompletion } from '../services/openaiService'
import { validateRequest } from '../middleware/auth'
import { Readable } from 'stream'

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

    const result = await processChatCompletion(messages, {
      model,
      stream,
      channel,
      userId,
      appId,
    })

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      if (result instanceof Readable) {
        result.pipe(res)
      } else {
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
