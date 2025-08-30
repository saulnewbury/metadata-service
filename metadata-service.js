// metadata-service.js - Main Express server
require('dotenv').config()
const express = require('express')
const { setupMiddleware } = require('./lib/middleware')
const { setupRoutes } = require('./lib/routes')

const app = express()
const PORT = process.env.PORT || 3001

// Setup middleware and routes
setupMiddleware(app)
setupRoutes(app)

// Health check endpoint
app.get('/health', (req, res) => {
  const { metadataCache, faviconCache } = require('./lib/cache')
  res.json({
    status: 'ok',
    cacheSize: metadataCache.getStats(),
    faviconCacheSize: faviconCache.getStats()
  })
})

app.listen(PORT, () => {
  console.log(`Metadata service running on port ${PORT}`)
})
