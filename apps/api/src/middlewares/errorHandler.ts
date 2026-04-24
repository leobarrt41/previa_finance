/**
 * errorHandler.ts - Global error handling middleware
 */

import { Request, Response, NextFunction } from 'express'

export interface AppError extends Error {
  statusCode?: number
  isOperational?: boolean
}

export function errorHandler(
  err: AppError,
  req: Request,
  res: Response,
  next: NextFunction
) {
  const statusCode = err.statusCode || 500
  const message = err.message || 'Internal server error'
  
  // Log error details
  console.error('API Error:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    timestamp: new Date().toISOString()
  })

  // Don't leak error details in production
  const isDevelopment = process.env.NODE_ENV === 'development'
  
  res.status(statusCode).json({
    error: {
      message,
      ...(isDevelopment && { 
        stack: err.stack,
        details: err 
      })
    }
  })
}

export function createError(message: string, statusCode = 500): AppError {
  const error = new Error(message) as AppError
  error.statusCode = statusCode
  error.isOperational = true
  return error
}