// lib/cache.js - Cache configuration
const NodeCache = require('node-cache')

// Cache with 1 hour TTL for metadata, 24 hours for favicons
const metadataCache = new NodeCache({ stdTTL: 3600 })
const faviconCache = new NodeCache({ stdTTL: 86400 })

function clearAllCaches() {
  metadataCache.flushAll()
  faviconCache.flushAll()
}

module.exports = {
  metadataCache,
  faviconCache,
  clearAllCaches
}
