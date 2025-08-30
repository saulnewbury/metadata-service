// lib/routes.js - API routes configuration
const fetch = require('node-fetch')

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

  // Add this to your existing routes
  // Add this to your existing routes in routes.js
  app.post('/api/ai-summarize', async (req, res) => {
    try {
      const { url } = req.body

      if (!url) {
        return res.status(400).json({ error: 'URL is required' })
      }

      // Clean the URL - remove timestamp parameters
      const cleanUrl = url.split('&t=')[0].split('#t=')[0]
      console.log('Processing URL:', cleanUrl)

      // Step 1: Get transcript from your FastAPI service
      const transcriptServiceUrl =
        process.env.FASTAPI_SERVICE_URL || 'http://localhost:8001'

      const transcriptResponse = await fetch(
        `${transcriptServiceUrl}/transcript`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: cleanUrl,
            include_timestamps: false,
            grouping_strategy: 'smart'
          })
        }
      )

      if (!transcriptResponse.ok) {
        throw new Error('Failed to fetch transcript')
      }

      const transcriptData = await transcriptResponse.json()

      // Step 2: Summarize using OpenAI
      const summaryResponse = await fetch(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'user',
                content: `Summarize this YouTube video transcript in 2-3 concise paragraphs:\n\n${transcriptData.text}`
              }
            ],
            max_tokens: 500,
            temperature: 0.7
          })
        }
      )

      const summaryData = await summaryResponse.json()
      const summary = summaryData.choices[0].message.content

      res.json({
        summary,
        videoTitle: transcriptData.video_title,
        videoId: transcriptData.video_id,
        transcript: transcriptData.text,
        duration: transcriptData.total_duration
      })
    } catch (error) {
      console.error('AI summarization error:', error)
      res.status(500).json({ error: 'Failed to generate summary' })
    }
  })
}

module.exports = { setupRoutes }
