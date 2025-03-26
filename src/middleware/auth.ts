import { Request, Response, NextFunction } from 'express'
import { config } from '@/libs/utils'

export const validateRequest = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization || ''
  const token = authHeader.replace('Bearer ', '')

  if (!token || token !== config.agora.authToken) {
    return res.status(403).json({ error: 'Invalid or missing token' })
  }

  next()
}
