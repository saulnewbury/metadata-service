// lib/middleware.js - Express middleware configuration
const cors = require('cors')
const express = require('express')
const { limiter } = require('./rateLimiter')

function setupMiddleware(app) {
  app.use(limiter)
  app.use(cors())
  app.use(express.json())
}

module.exports = { setupMiddleware }
