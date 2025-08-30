// lib/scrapers/websiteScraper.js - Generic website scraping functionality
const fetch = require('node-fetch')
const { JSDOM } = require('jsdom')
const {
  extractDomain,
  getBaseUrl,
  generateTitleFromUrl
} = require('../utils/urlUtils')
const { findBestFavicon } = require('../utils/faviconUtils')
const {
  extractTitle,
  extractDescription,
  extractAuthors,
  extractImage,
  extractArticleText,
  extractMainLogo,
  detectContentType
} = require('./metadataExtractors')

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
const FETCH_TIMEOUT = 10000

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

    // Extract basic metadata using multiple strategies
    const metadata = {
      title: extractTitle(document, url),
      domain: extractDomain(url),
      image: extractImage(document, url),
      description: extractDescription(document),
      excerpt: extractArticleText(document),
      author: extractAuthors(document),
      imageAspectRatio: 16 / 9,
      type: detectContentType(document, url),
      contentType:
        extractArticleText(document).length > 100 ? 'article' : 'website',
      favicon: await findBestFavicon(url, document)
    }

    // Extract logo only for articles
    if (metadata.contentType === 'article') {
      metadata.logo = extractMainLogo(document, url)
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

module.exports = {
  scrapeWebsiteMetadata,
  generateFallbackMetadata
}
