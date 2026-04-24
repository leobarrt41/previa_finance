/**
 * index.ts - Previa Finance API Server Entry Point
 * 
 * Servidor HTTP que expõe as funcionalidades do @previa/core
 * para o frontend via REST API.
 */

import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { config } from './config/env.js'
import { setupDatabase } from './config/database.js'
import { setupRoutes } from './routes/index.js'
import { errorHandler } from './middlewares/errorHandler.js'
import { requestLogger } from './middlewares/logging.js'

const app = express()

// Middlewares básicos
app.use(helmet()) // Security headers
app.use(cors({
  origin: config.frontend.url,
  credentials: true
}))
app.use(express.json({ limit: '10mb' })) // Para uploads de PDF
app.use(requestLogger)

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  })
})

// API routes
app.use('/api', setupRoutes())

// Error handling
app.use(errorHandler)

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Endpoint not found',
    path: req.originalUrl 
  })
})

async function startServer() {
  try {
    // Conectar ao banco
    await setupDatabase()
    console.log('✅ Database connected')

    // Iniciar servidor
    const port = config.server.port
    app.listen(port, () => {
      console.log(`🚀 Previa Finance API running on port ${port}`)
      console.log(`📍 Health check: http://localhost:${port}/health`)
      console.log(`📖 API base: http://localhost:${port}/api`)
    })

  } catch (error) {
    console.error('❌ Failed to start server:', error)
    process.exit(1)
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down server...')
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log('\n👋 Shutting down server...')
  process.exit(0)
})

startServer()