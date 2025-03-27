import express from 'express'
import type { Application, RequestHandler } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import { chatCompletionRouter } from './routes/chatCompletion'
import { config } from './libs/utils'

const app: Application = express()
const port = process.env.PORT || config.port

// Middleware
app.use(helmet() as RequestHandler)
app.use(cors() as RequestHandler)
app.use(morgan('dev') as RequestHandler)
app.use(express.json() as RequestHandler)

// Routes
const v1Router = express.Router()
v1Router.use('/chat', chatCompletionRouter)
app.use('/v1', v1Router)

app.get('/', (req, res) => {
  res.json({
    message:
      'Welcome to a custom LLM using OpenAI API and built for Agora Convo AI Engine! Documentation is available at https://github.com/AgoraIO-Community/agora-convo-ai-custom-llm-express',
  })
})

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
