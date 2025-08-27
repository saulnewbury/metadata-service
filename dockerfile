# Dockerfile for metadata scraping service
FROM node:18-alpine

# Install dependencies for sharp and other native modules
RUN apk add --no-cache \
    libc6-compat \
    vips-dev \
    python3 \
    make \
    g++

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY metadata-service.js ./

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001
USER nodejs

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

# Start the service
CMD ["node", "metadata-service.js"]

# ===== docker-compose.yml =====
# version: '3.8'
# services:
#   metadata-service:
#     build: .
#     ports:
#       - "3001:3001"
#     environment:
#       - NODE_ENV=production
#       - PORT=3001
#       - CORS_ORIGIN=*
#     restart: unless-stopped
#     healthcheck:
#       test: ["CMD", "curl", "-f", "http://localhost:3001/health"]
#       interval: 30s
#       timeout: 10s
#       retries: 3
#     volumes:
#       - ./logs:/app/logs
#     networks:
#       - metadata-network
# 
# networks:
#   metadata-network:
#     driver: bridge

# ===== .env.example =====
# # Backend service configuration
# NODE_ENV=development
# PORT=3001
# 
# # CORS configuration
# CORS_ORIGIN=http://localhost:3000,http://localhost:19006
# 
# # Rate limiting
# RATE_LIMIT_WINDOW_MS=900000
# RATE_LIMIT_MAX=100
# 
# # Cache configuration  
# METADATA_CACHE_TTL=3600
# FAVICON_CACHE_TTL=86400
# 
# # Request timeouts
# FETCH_TIMEOUT=10000
# FAVICON_TIMEOUT=3000
# 
# # For production deployment
# # METADATA_SERVICE_URL=https://your-domain.com
# 
# ===== .gitignore =====
# node_modules/
# npm-debug.log*
# yarn-debug.log*
# yarn-error.log*
# .env
# .env.local
# .env.production
# logs/
# *.log
# .DS_Store
# Thumbs.db
# 
# # Docker
# .dockerignore
# 
# ===== Production deployment notes =====
# 
# 1. Railway.app deployment:
#    - Connect your GitHub repo
#    - Set environment variables in Railway dashboard
#    - Railway will auto-deploy on git push
# 
# 2. Heroku deployment:
#    heroku create your-metadata-service
#    heroku config:set NODE_ENV=production
#    git push heroku main
# 
# 3. DigitalOcean App Platform:
#    - Connect repo in DO dashboard
#    - Configure build/run commands
#    - Set environment variables
# 
# 4. AWS Lambda (serverless):
#    - Use serverless framework
#    - Convert Express app to Lambda handler
#    - Deploy with: serverless deploy
# 
# 5. Self-hosted with PM2:
#    npm install pm2 -g
#    pm2 start metadata-service.js --name metadata-service
#    pm2 startup
#    pm2 save