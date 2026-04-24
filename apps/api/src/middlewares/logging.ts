/**
 * logging.ts - Request logging middleware
 */

import { Request, Response, NextFunction } from 'express'

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now()
  
  // Log on response finish
  res.on('finish', () => {
    const duration = Date.now() - start
    const { method, url } = req
    const { statusCode } = res
    
    console.log(`${method} ${url} - ${statusCode} - ${duration}ms`)
  })
  
  next()
}