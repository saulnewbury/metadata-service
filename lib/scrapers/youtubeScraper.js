// lib/scrapers/youtubeScraper.js - YouTube-specific scraping functionality
const fetch = require('node-fetch')
const { JSDOM } = require('jsdom')
const { isYouTubeChannelUrl } = require('../utils/urlUtils')

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
const FETCH_TIMEOUT = 10000
const YOUTUBE_OEMBED = 'https://www.youtube.com/oembed'

async function scrapeYouTubeMetadata(url) {
  try {
    // Check if it's a channel URL
    if (isYouTubeChannelUrl(url)) {
      return await scrapeYouTubeChannelMetadata(url)
    }

    // Otherwise handle as video
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

    // Fallback for YouTube videos
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

async function scrapeYouTubeChannelMetadata(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT
      },
      timeout: FETCH_TIMEOUT
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const html = await response.text()
    const dom = new JSDOM(html)
    const document = dom.window.document

    const channelName = extractChannelName(document)
    const channelAvatar = extractChannelAvatar(document)

    return {
      title: channelName || 'YouTube Channel',
      domain: 'youtube.com',
      image: channelAvatar,
      imageAspectRatio: 1, // Channel avatars are square
      type: 'youtube-channel',
      contentType: 'channel',
      favicon:
        'https://www.youtube.com/s/desktop/12d6b690/img/favicon_144x144.png',
      description: 'YouTube Channel'
    }
  } catch (error) {
    console.error('YouTube channel metadata scraping failed:', error)
    throw error
  }
}

function extractChannelName(document) {
  const selectors = [
    'meta[property="og:title"]',
    'meta[name="title"]',
    '.ytd-channel-name',
    '#channel-name'
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
  return null
}

function extractChannelAvatar(document) {
  const selectors = ['meta[property="og:image"]', 'link[rel="image_src"]']

  for (const selector of selectors) {
    const element = document.querySelector(selector)
    if (element) {
      const imageUrl =
        element.getAttribute('content') || element.getAttribute('href')
      if (imageUrl) {
        return imageUrl
      }
    }
  }
  return null
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

module.exports = {
  scrapeYouTubeMetadata
}
