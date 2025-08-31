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

  // In lib/routes.js, replace the entire /api/ai-summarize endpoint:

  app.post('/api/ai-summarize', async (req, res) => {
    console.log('AI summarize endpoint hit')
    try {
      const { url } = req.body
      if (!url) {
        return res.status(400).json({ error: 'URL is required' })
      }

      // Set SSE headers FIRST
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      res.setHeader('X-Accel-Buffering', 'no')

      console.log('SSE headers set')

      // Clean the URL - remove timestamp parameters
      const cleanUrl = url.split('&t=')[0].split('#t=')[0]
      console.log('Processing URL:', cleanUrl)

      // Step 1: Get transcript from your FastAPI service
      const transcriptServiceUrl =
        process.env.FASTAPI_SERVICE_URL || 'http://localhost:8001'

      console.log('Calling transcript service at:', transcriptServiceUrl)

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
        throw new Error(
          `Transcript service failed: ${transcriptResponse.status}`
        )
      }

      const transcriptData = await transcriptResponse.json()

      if (!transcriptData.text) {
        throw new Error('No transcript text received')
      }

      console.log('Transcript received, length:', transcriptData.text.length)

      // Set up SSE headers
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      res.flushHeaders() // Important: flush headers immediately

      // Stream from OpenAI
      const streamResponse = await fetch(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY.trim()}`,
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
            temperature: 0.7,
            stream: true
          })
        }
      )

      if (!streamResponse.ok) {
        const errorData = await streamResponse.json()
        throw new Error(
          `OpenAI API failed: ${errorData.error?.message || 'Unknown error'}`
        )
      }

      // Process the stream
      const reader = streamResponse.body.getReader()
      const decoder = new TextDecoder()

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            res.write(`data: [DONE]\n\n`)
            res.end()
            break
          }

          const chunk = decoder.decode(value, { stream: true })
          const lines = chunk.split('\n')

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6)
              if (data === '[DONE]') {
                res.write(`data: [DONE]\n\n`)
                res.end()
                return
              }

              try {
                const parsed = JSON.parse(data)
                const content = parsed.choices[0]?.delta?.content
                if (content) {
                  res.write(`data: ${JSON.stringify({ content })}\n\n`)
                  res.flushHeaders() // Force flush each chunk
                }
              } catch (e) {
                // Skip parse errors
              }
            }
          }
        }
      } finally {
        reader.releaseLock()
      }
    } catch (error) {
      console.error('AI summarization error:', error.message)

      // Send error as SSE
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`)
      res.end()
    }
  })

  app.get('/api/health/services', async (req, res) => {
    try {
      const transcriptServiceUrl =
        process.env.FASTAPI_SERVICE_URL || 'http://localhost:8001'
      const openaiConfigured = !!process.env.OPENAI_API_KEY

      // Test transcript service
      let transcriptHealthy = false
      try {
        const response = await fetch(`${transcriptServiceUrl}/`, {
          timeout: 5000
        })
        transcriptHealthy = response.ok
      } catch (error) {
        console.error('Transcript service health check failed:', error)
      }

      res.json({
        healthy: transcriptHealthy && openaiConfigured,
        services: {
          transcript: {
            url: transcriptServiceUrl,
            healthy: transcriptHealthy
          },
          openai: {
            configured: openaiConfigured
          }
        }
      })
    } catch (error) {
      res
        .status(500)
        .json({ error: 'Health check failed', details: error.message })
    }
  })

  app.get('/api/test-sse', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('Access-Control-Allow-Origin', '*')

    let counter = 0
    const interval = setInterval(() => {
      res.write(`data: ${JSON.stringify({ count: counter++ })}\n\n`)

      if (counter > 5) {
        clearInterval(interval)
        res.write('data: [DONE]\n\n')
        res.end()
      }
    }, 1000)

    req.on('close', () => {
      clearInterval(interval)
    })
  })
}

module.exports = { setupRoutes }
