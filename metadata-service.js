// metadata-service.js - Express.js backend for reliable link metadata scraping
const express = require('express')
const cors = require('cors')
const { JSDOM } = require('jsdom')
const fetch = require('node-fetch')
const sharp = require('sharp') // For image processing and favicon validation
const NodeCache = require('node-cache')
const rateLimit = require('express-rate-limit')

const app = express()
const PORT = process.env.PORT || 3001

// Cache with 1 hour TTL for metadata, 24 hours for favicons
const metadataCache = new NodeCache({ stdTTL: 3600 })
const faviconCache = new NodeCache({ stdTTL: 86400 })

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP'
})

app.use(limiter)
app.use(cors())
app.use(express.json())

// User agent to mimic a real browser
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'

// Timeout for fetch requests
const FETCH_TIMEOUT = 10000

// YouTube oEmbed endpoint
const YOUTUBE_OEMBED = 'https://www.youtube.com/oembed'

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

async function scrapeYouTubeMetadata(url) {
  try {
    // Try YouTube oEmbed API first
    const videoId = extractYouTubeVideoId(url)
    if (!videoId) {
      throw new Error('Could not extract video ID')
    }

    const oembedUrl = `${YOUTUBE_OEMBED}?format=json&url=${encodeURIComponent(
      url
    )}`

    const response = await fetch(oembedUrl, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: FETCH_TIMEOUT
    })

    if (response.ok) {
      const data = await response.json()

      return {
        title: data.title || `YouTube Video: ${videoId}`,
        domain: 'youtube.com',
        image:
          data.thumbnail_url ||
          `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
        imageAspectRatio: url.includes('/shorts/') ? 9 / 16 : 16 / 9,
        type: url.includes('/shorts/') ? 'youtube-short' : 'youtube',
        author: data.author_name || 'YouTube',
        contentType: 'video',
        favicon:
          'https://www.youtube.com/s/desktop/12d6b690/img/favicon_144x144.png',
        description: `Video by ${data.author_name || 'Unknown'}`
      }
    }

    // Fallback for YouTube
    return {
      title: `YouTube Video: ${videoId}`,
      domain: 'youtube.com',
      image: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
      imageAspectRatio: url.includes('/shorts/') ? 9 / 16 : 16 / 9,
      type: url.includes('/shorts/') ? 'youtube-short' : 'youtube',
      contentType: 'video',
      favicon:
        'https://www.youtube.com/s/desktop/12d6b690/img/favicon_144x144.png'
    }
  } catch (error) {
    console.error('YouTube metadata scraping failed:', error)
    throw error
  }
}

async function scrapeWebsiteMetadata(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        Connection: 'keep-alive'
      },
      timeout: FETCH_TIMEOUT,
      follow: 3, // Follow up to 3 redirects
      size: 1048576 // 1MB limit
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const html = await response.text()
    const dom = new JSDOM(html)
    const document = dom.window.document

    // Extract metadata using multiple strategies
    const metadata = {
      title: extractTitle(document, url),
      domain: extractDomain(url),
      image: extractImage(document, url),
      description: extractDescription(document),
      excerpt: extractArticleText(document),
      author: extractAuthors(document), // Add this line
      imageAspectRatio: 16 / 9,
      type: detectContentType(document, url),
      contentType:
        extractArticleText(document).length > 100 ? 'article' : 'website',
      favicon: await findBestFavicon(url, document)
    }

    // Determine if we should show article content or image
    if (metadata.excerpt && metadata.excerpt.length > 200) {
      metadata.contentType = 'article'
    }

    return metadata
  } catch (error) {
    console.error('Website metadata scraping failed:', error)
    throw error
  }
}

function extractTitle(document, url) {
  const selectors = [
    'meta[property="og:title"]',
    'meta[name="twitter:title"]',
    'meta[name="title"]',
    'title',
    'h1'
  ]

  for (const selector of selectors) {
    const element = document.querySelector(selector)
    if (element) {
      const title = element.getAttribute('content') || element.textContent
      if (title && title.trim()) {
        return title.trim()
      }
    }
  }

  return generateTitleFromUrl(url)
}

function extractDescription(document) {
  const selectors = [
    'meta[property="og:description"]',
    'meta[name="twitter:description"]',
    'meta[name="description"]',
    'meta[name="author"]',
    'meta[property="article:author"]'
  ]

  for (const selector of selectors) {
    const element = document.querySelector(selector)
    if (element) {
      const description = element.getAttribute('content')
      if (description && description.trim()) {
        return description.trim()
      }
    }
  }

  return null
}

function extractAuthors(document) {
  const authors = new Set()

  // Try article-specific selectors first
  const articleAuthorSelectors = [
    '.author-name',
    '.byline-author',
    '.article-author',
    '.post-author',
    '.writer-name',
    '[data-author]',
    '.byline .author',
    '.article-byline .author'
  ]

  for (const selector of articleAuthorSelectors) {
    const elements = document.querySelectorAll(selector)
    for (const element of elements) {
      const author = element.textContent || element.getAttribute('data-author')
      if (author && author.trim() && !author.includes('facebook.com')) {
        const cleanAuthor = cleanAuthorName(author.trim()) // Remove 'this.'
        if (cleanAuthor && cleanAuthor.length > 2 && cleanAuthor.length < 50) {
          authors.add(cleanAuthor)
        }
      }
    }
  }

  // Meta tags as fallback
  if (authors.size === 0) {
    const metaSelectors = [
      'meta[name="author"]',
      'meta[property="article:author"]'
    ]

    for (const selector of metaSelectors) {
      const element = document.querySelector(selector)
      if (element) {
        const author = element.getAttribute('content')
        if (author && !author.includes('http') && !author.startsWith('@')) {
          const cleanAuthor = cleanAuthorName(author.trim()) // Remove 'this.'
          if (cleanAuthor && cleanAuthor.length < 50) {
            authors.add(cleanAuthor)
          }
        }
      }
    }
  }

  return Array.from(authors).slice(0, 3)
}

function cleanAuthorName(rawAuthor) {
  // Remove common prefixes
  let cleaned = rawAuthor.replace(/^By\s+/i, '')

  // Extract just the name part (before job titles, descriptions, etc.)
  const namePart = cleaned.split(
    /\s+is\s+|\s+works\s+|\s+writes\s+|\s+-\s+|\s+,\s+/i
  )[0]

  // Remove trailing punctuation and extra whitespace
  return namePart.replace(/[.,;:]+$/, '').trim()
}

function extractImage(document, url) {
  const selectors = [
    'meta[property="og:image"]',
    'meta[name="twitter:image"]',
    'meta[name="twitter:image:src"]'
  ]

  for (const selector of selectors) {
    const element = document.querySelector(selector)
    if (element) {
      let imageUrl = element.getAttribute('content')
      if (imageUrl) {
        return makeAbsoluteUrl(imageUrl, url)
      }
    }
  }

  return null
}

function extractArticleText(document) {
  // Skip elements that contain author information, dates, and metadata
  const skipSelectors = [
    '.author',
    '.byline',
    '.post-author',
    '.writer',
    '.article-meta',
    '.post-meta',
    '.entry-meta',
    '.date',
    '.published',
    '.timestamp',
    '.publish-date',
    '.post-date',
    '.article-date',
    '.time',
    '.datetime',
    '[datetime]',
    'time',
    '.updated',
    '.modified'
  ]

  const contentSelectors = [
    'article',
    'main',
    '[role="main"]',
    '.post-content',
    '.entry-content',
    '.article-content',
    '.content'
  ]

  let bestText = ''

  for (const selector of contentSelectors) {
    const elements = document.querySelectorAll(selector)
    for (const element of elements) {
      if (shouldSkipElement(element)) continue

      // Remove author/meta/date elements from content extraction
      const clonedElement = element.cloneNode(true)
      skipSelectors.forEach((skipSelector) => {
        const elementsToRemove = clonedElement.querySelectorAll(skipSelector)
        elementsToRemove.forEach((el) => el.remove())
      })

      const text = extractTextFromElement(clonedElement)

      // Clean dates but preserve paragraph breaks
      const cleanedText = text
        .replace(/\d{1,2}\.\d{1,2}\.\d{4}/g, '') // Remove dates like "4.18.2024"
        .replace(/\|\s*\d{1,2}\.\d{1,2}\.\d{4}/g, '') // Remove "| 4.18.2024"
        .replace(/\d{1,2}\/\d{1,2}\/\d{4}/g, '') // Remove dates like "04/18/2024"
        .replace(/\s+\n/g, '\n') // Clean up spaces before line breaks
        .replace(/\n\s+/g, '\n') // Clean up spaces after line breaks
        .replace(/[ \t]+/g, ' ') // Normalize only horizontal whitespace, keep line breaks
        .replace(/\n{3,}/g, '\n\n') // Limit to double line breaks max
        .trim()

      if (cleanedText.length > bestText.length) {
        bestText = cleanedText
      }
    }
  }

  return bestText.substring(0, 924).trim()
}

function extractTextFromElement(element) {
  const paragraphs = element.querySelectorAll('p')
  let text = ''

  paragraphs.forEach((p) => {
    const pText = p.textContent || ''
    if (pText.trim().length > 20) {
      text += pText.trim() + '\n\n'
    }
  })

  if (text.length < 100) {
    text = element.textContent || ''
  }

  return text.trim()
}

function shouldSkipElement(element) {
  if (!element) return true

  const skipClasses = [
    'nav',
    'navigation',
    'sidebar',
    'footer',
    'header',
    'menu',
    'ads',
    'advertisement'
  ]
  const skipTags = ['NAV', 'FOOTER', 'HEADER', 'ASIDE', 'SCRIPT', 'STYLE']

  if (skipTags.includes(element.tagName)) return true

  const className = element.className || ''
  const id = element.id || ''

  return skipClasses.some(
    (skipClass) =>
      className.toLowerCase().includes(skipClass) ||
      id.toLowerCase().includes(skipClass)
  )
}

async function findBestFavicon(url, document = null) {
  const baseUrl = getBaseUrl(url)

  // If we have the document, try to extract favicon from HTML
  if (document) {
    const faviconSelectors = [
      'link[rel="apple-touch-icon"][sizes*="180"]',
      'link[rel="apple-touch-icon"][sizes*="152"]',
      'link[rel="apple-touch-icon"]',
      'link[rel="icon"][sizes*="192"][type="image/png"]',
      'link[rel="icon"][sizes*="96"][type="image/png"]',
      'link[rel="icon"][sizes*="32"][type="image/png"]',
      'link[rel="icon"][type="image/png"]',
      'link[rel="icon"][type="image/svg+xml"]',
      'link[rel="icon"]',
      'link[rel="shortcut icon"]'
    ]

    for (const selector of faviconSelectors) {
      const element = document.querySelector(selector)
      if (element) {
        let faviconUrl = element.getAttribute('href')
        if (faviconUrl) {
          faviconUrl = makeAbsoluteUrl(faviconUrl, url)
          if (await validateFavicon(faviconUrl)) {
            return faviconUrl
          }
        }
      }
    }
  }

  // Try common favicon paths
  const faviconPaths = [
    '/apple-touch-icon-180x180.png',
    '/apple-touch-icon-152x152.png',
    '/apple-touch-icon.png',
    '/android-chrome-192x192.png',
    '/favicon-96x96.png',
    '/favicon-32x32.png',
    '/favicon.png',
    '/favicon.ico'
  ]

  for (const path of faviconPaths) {
    const faviconUrl = baseUrl + path
    if (await validateFavicon(faviconUrl)) {
      return faviconUrl
    }
  }

  return null
}

async function validateFavicon(faviconUrl) {
  try {
    const response = await fetch(faviconUrl, {
      method: 'HEAD',
      headers: { 'User-Agent': USER_AGENT },
      timeout: 3000
    })

    return (
      response.ok && response.headers.get('content-type')?.startsWith('image/')
    )
  } catch {
    return false
  }
}

function detectContentType(document, url) {
  const urlLower = url.toLowerCase()

  if (urlLower.includes('github.com')) return 'github'
  if (urlLower.includes('docs.') || urlLower.includes('documentation'))
    return 'docs'
  if (document.querySelector('article')) return 'article'

  return 'website'
}

function isValidUrl(string) {
  try {
    const url = new URL(
      string.startsWith('http') ? string : `https://${string}`
    )
    return ['http:', 'https:'].includes(url.protocol)
  } catch {
    return false
  }
}

function isYouTubeUrl(url) {
  const normalizedUrl = url.toLowerCase()
  return (
    normalizedUrl.includes('youtube.com/watch') ||
    normalizedUrl.includes('youtu.be/') ||
    normalizedUrl.includes('youtube.com/shorts/')
  )
}

function extractYouTubeVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([^&\n?#]+)/,
    /youtube\.com\/embed\/([^&\n?#]+)/,
    /youtube\.com\/v\/([^&\n?#]+)/
  ]

  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match && match[1]) {
      return match[1]
    }
  }
  return null
}

function extractDomain(url) {
  try {
    const urlWithProtocol = url.startsWith('http') ? url : `https://${url}`
    const domain = new URL(urlWithProtocol).hostname
    return domain.replace(/^www\./, '')
  } catch {
    return url.length > 25 ? url.substring(0, 22) + '...' : url
  }
}

function getBaseUrl(url) {
  try {
    const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`)
    return `${urlObj.protocol}//${urlObj.hostname}`
  } catch {
    return url
  }
}

function makeAbsoluteUrl(relativeUrl, baseUrl) {
  try {
    return new URL(relativeUrl, baseUrl).href
  } catch {
    return relativeUrl
  }
}

function normalizeUrl(url) {
  try {
    const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`)
    return urlObj.href.toLowerCase()
  } catch {
    return url.toLowerCase()
  }
}

function generateTitleFromUrl(url) {
  try {
    const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`)
    const domain = urlObj.hostname.replace(/^www\./, '')
    const pathname = urlObj.pathname

    if (pathname === '/' || pathname === '') {
      return formatDomainAsTitle(domain)
    }

    const pathParts = pathname.split('/').filter((part) => part.length > 0)
    const lastPart = pathParts[pathParts.length - 1]

    const cleanPart = lastPart
      .replace(/\.[^.]+$/, '')
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (l) => l.toUpperCase())

    return cleanPart || formatDomainAsTitle(domain)
  } catch {
    return extractDomain(url)
  }
}

function formatDomainAsTitle(domain) {
  return domain
    .replace(/^www\./, '')
    .split('.')[0]
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (l) => l.toUpperCase())
}

function generateFallbackMetadata(url) {
  const domain = extractDomain(url)
  return {
    title: generateTitleFromUrl(url),
    domain,
    image: null,
    imageAspectRatio: 1,
    type: 'website',
    contentType: 'website',
    favicon: `${getBaseUrl(url)}/favicon.ico`
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    cacheSize: metadataCache.getStats(),
    faviconCacheSize: faviconCache.getStats()
  })
})

// Cache management endpoints
app.post('/api/cache/clear', (req, res) => {
  metadataCache.flushAll()
  faviconCache.flushAll()
  res.json({ message: 'Cache cleared successfully' })
})

app.listen(PORT, () => {
  console.log(`Metadata service running on port ${PORT}`)
})
