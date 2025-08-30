// lib/scrapers/metadataExtractors.js - Metadata extraction utilities
const { generateTitleFromUrl } = require('../utils/urlUtils')

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

  // First try to find authors within the main article content only
  const mainContentSelectors = [
    'article',
    'main',
    '[role="main"]',
    '.post-content',
    '.entry-content',
    '.article-content',
    '.content'
  ]

  // Look for authors within main content areas first
  for (const contentSelector of mainContentSelectors) {
    const contentArea = document.querySelector(contentSelector)
    if (contentArea) {
      const articleAuthorSelectors = [
        '.author-name',
        '.byline-author',
        '.article-author',
        '.post-author',
        '.writer-name',
        '.byline .author',
        '.article-byline .author'
      ]

      for (const selector of articleAuthorSelectors) {
        const elements = contentArea.querySelectorAll(selector)
        for (const element of elements) {
          const author =
            element.textContent || element.getAttribute('data-author')
          if (author && author.trim()) {
            const cleanAuthor = cleanAuthorName(author.trim())
            if (
              cleanAuthor &&
              cleanAuthor.length > 2 &&
              cleanAuthor.length < 50
            ) {
              authors.add(cleanAuthor)
            }
          }
        }
      }

      // If we found authors in main content, return them
      if (authors.size > 0) {
        return Array.from(authors).slice(0, 3)
      }
    }
  }

  // Fallback to meta tags only if no authors found in content
  const metaSelectors = [
    'meta[name="author"]',
    'meta[property="article:author"]'
  ]

  for (const selector of metaSelectors) {
    const element = document.querySelector(selector)
    if (element) {
      const author = element.getAttribute('content')
      if (author && !author.includes('http') && !author.startsWith('@')) {
        const cleanAuthor = cleanAuthorName(author.trim())
        if (cleanAuthor && cleanAuthor.length < 50) {
          authors.add(cleanAuthor)
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
  const { makeAbsoluteUrl } = require('../utils/urlUtils')

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
    '.modified',
    // Image caption selectors
    'figcaption',
    '.caption',
    '.image-caption',
    '.photo-caption',
    '.img-caption',
    '.figure-caption',
    '.media-caption',
    '.wp-caption-text',
    '[data-caption]',
    '.getty-caption',
    '.image-credit',
    '.photo-credit'
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
        .replace(/\d{1,2}\.\d{1,2}\.\d{4}/g, '')
        .replace(/\|\s*\d{1,2}\.\d{1,2}\.\d{4}/g, '')
        .replace(/\d{1,2}\/\d{1,2}\/\d{4}/g, '')
        .replace(/\s+\n/g, '\n')
        .replace(/\n\s+/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        // Remove likely standalone captions (short lines that are just names/descriptions)
        .replace(/\n[A-Z][a-z]+ [A-Z][a-z]+\n/g, '\n') // Removes "Firstname Lastname" lines
        .replace(/\n.{1,30}\n(?=\n)/g, '\n') // Removes very short standalone lines
        .trim()

      if (cleanedText.length > bestText.length) {
        bestText = cleanedText
      }
    }
  }

  return bestText.substring(0, 924).trim()
}

function extractTextFromElement(element) {
  // Get all paragraph text, ensuring double line breaks between paragraphs
  const paragraphs = element.querySelectorAll('p')
  let text = ''

  paragraphs.forEach((p) => {
    const pText = p.textContent || ''
    if (pText.trim().length > 20) {
      // Add double line breaks between substantial paragraphs
      text += pText.trim() + '\n\n'
    }
  })

  // If no good paragraphs found, try other block elements
  if (text.length < 100) {
    const blockElements = element.querySelectorAll('div, section, article')
    blockElements.forEach((block) => {
      const blockText = block.textContent || ''
      if (blockText.trim().length > 50) {
        text += blockText.trim() + '\n\n'
      }
    })
  }

  // Final fallback to element text content
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

function detectContentType(document, url) {
  const urlLower = url.toLowerCase()

  if (urlLower.includes('github.com')) return 'github'
  if (urlLower.includes('docs.') || urlLower.includes('documentation'))
    return 'docs'
  if (document.querySelector('article')) return 'article'

  return 'website'
}

module.exports = {
  extractTitle,
  extractDescription,
  extractAuthors,
  extractImage,
  extractArticleText,
  detectContentType
}
