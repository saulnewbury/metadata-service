// lib/utils/urlUtils.js - URL validation and manipulation utilities

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
    normalizedUrl.includes('youtube.com/shorts/') ||
    normalizedUrl.includes('youtube.com/channel/') ||
    normalizedUrl.includes('youtube.com/c/') ||
    normalizedUrl.includes('youtube.com/user/') ||
    normalizedUrl.includes('youtube.com/@')
  )
}

function isYouTubeChannelUrl(url) {
  const normalizedUrl = url.toLowerCase()
  return (
    normalizedUrl.includes('youtube.com/channel/') ||
    normalizedUrl.includes('youtube.com/c/') ||
    normalizedUrl.includes('youtube.com/user/') ||
    normalizedUrl.includes('youtube.com/@')
  )
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

module.exports = {
  isValidUrl,
  isYouTubeUrl,
  isYouTubeChannelUrl,
  extractDomain,
  getBaseUrl,
  makeAbsoluteUrl,
  normalizeUrl,
  generateTitleFromUrl,
  formatDomainAsTitle
}
