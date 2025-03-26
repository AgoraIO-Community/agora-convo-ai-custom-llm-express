import express from 'express'
import type { Application, RequestHandler } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import { chatCompletionRouter } from '@/routes/chatCompletion'
import { config } from '@/libs/utils'

const app: Application = express()
const port = process.env.PORT || config.port

// Middleware
app.use(helmet() as RequestHandler)
app.use(cors() as RequestHandler)
app.use(morgan('dev') as RequestHandler)
app.use(express.json() as RequestHandler)

// Routes
app.use('/chat', chatCompletionRouter)

// Health check endpoint
app.get('/ping', (req, res) => {
  res.json({ message: 'pong' })
})

// Only start the server if this file is run directly
if (require.main === module) {
  app.listen(port, () => {
    console.log(`Server is running on port ${port}`)
  })
}

export default app
