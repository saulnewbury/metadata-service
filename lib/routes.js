// lib/routes.js - API routes configuration
const { metadataCache, faviconCache, clearAllCaches } = require('./cache')
const { isValidUrl, normalizeUrl, isYouTubeUrl } = require('./utils/urlUtils')
const { findBestFavicon } = require('./utils/faviconUtils')
const { scrapeYouTubeMetadata } = require('./scrapers/youtubeScraper')
const {
  scrapeWebsiteMetadata,
  generateFallbackMetadata
} = require('./scrapers/websiteScraper')

function setupRoutes(app) {
  // Main metadata scraping endpoint
  app.post('/api/metadata', async (req, res) => {
    try {
      const { url } = req.body

      if (!url) {
        return res.status(400).json({ error: 'URL is required' })
      }

      // Validate URL format
      if (!isValidUrl(url)) {
        return res.status(400).json({ error: 'Invalid URL format' })
      }

      // Check cache first
      const cacheKey = normalizeUrl(url)
      const cachedData = metadataCache.get(cacheKey)
      if (cachedData) {
        return res.json({ ...cachedData, cached: true })
      }

      let metadata

      // Handle YouTube URLs specially
      if (isYouTubeUrl(url)) {
        metadata = await scrapeYouTubeMetadata(url)
      } else {
        // Generic website scraping
        metadata = await scrapeWebsiteMetadata(url)
      }

      // Cache the result
      metadataCache.set(cacheKey, metadata)

      res.json(metadata)
    } catch (error) {
      console.error('Metadata scraping error:', error)
      res.status(500).json({
        error: 'Failed to scrape metadata',
        fallback: generateFallbackMetadata(req.body.url)
      })
    }
  })

  // Favicon endpoint
  app.get('/api/favicon/:encodedUrl', async (req, res) => {
    try {
      const url = decodeURIComponent(req.params.encodedUrl)

      if (!isValidUrl(url)) {
        return res.status(400).json({ error: 'Invalid URL format' })
      }

      const cacheKey = `favicon_${normalizeUrl(url)}`
      const cachedFavicon = faviconCache.get(cacheKey)

      if (cachedFavicon) {
        if (cachedFavicon === 'NOT_FOUND') {
          return res.status(404).json({ error: 'Favicon not found' })
        }
        return res.json({ faviconUrl: cachedFavicon })
      }

      const faviconUrl = await findBestFavicon(url)

      if (faviconUrl) {
        faviconCache.set(cacheKey, faviconUrl)
        res.json({ faviconUrl })
      } else {
        faviconCache.set(cacheKey, 'NOT_FOUND')
        res.status(404).json({ error: 'Favicon not found' })
      }
    } catch (error) {
      console.error('Favicon fetch error:', error)
      res.status(500).json({ error: 'Failed to fetch favicon' })
    }
  })

  // Cache management endpoint
  app.post('/api/cache/clear', (req, res) => {
    clearAllCaches()
    res.json({ message: 'Cache cleared successfully' })
  })
}

module.exports = { setupRoutes }
