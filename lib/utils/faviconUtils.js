// lib/utils/faviconUtils.js - Favicon detection and validation utilities
const fetch = require('node-fetch')
const { getBaseUrl, makeAbsoluteUrl } = require('./urlUtils')

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'

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

module.exports = {
  findBestFavicon,
  validateFavicon
}
