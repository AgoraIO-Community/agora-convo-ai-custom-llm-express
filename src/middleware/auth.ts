import { Request, Response, NextFunction } from 'express'
import { config } from '../libs/utils'

export const validateRequest = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization || ''
  const token = authHeader.replace('Bearer ', '')

  if (process.env.NODE_ENV === 'development') {
    console.log('Received auth header:', authHeader)
    console.log('Received token:', token)
    console.log('Expected token:', config.llm.openaiApiKey)
    console.log('Token comparison:', token === config.llm.openaiApiKey)

    if (!token || token !== config.llm.openaiApiKey) {
      return res.status(403).json({ error: 'Invalid or missing token' })
    }

    next()
  }
}
