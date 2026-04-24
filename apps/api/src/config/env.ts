/**
 * env.ts - Configuration from environment variables
 */

export const config = {
  server: {
    port: parseInt(process.env.PORT || '3001', 10),
    environment: process.env.NODE_ENV || 'development'
  },
  
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    username: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'previa_finance'
  },
  
  auth: {
    clerkJwtKey: process.env.CLERK_JWT_KEY || '',
    clerkSecretKey: process.env.CLERK_SECRET_KEY || '',
    clerkAuthorizedParties: (process.env.CLERK_AUTHORIZED_PARTIES || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  },
  
  frontend: {
    url: process.env.FRONTEND_URL || 'http://localhost:5173'
  }
}
