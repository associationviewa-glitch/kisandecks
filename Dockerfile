# Google Cloud Run Deployment for KisanDecks
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install all dependencies (including dev for build)
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Remove dev dependencies to reduce image size
RUN npm prune --production

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8080

# Expose the port (Google Cloud Run uses 8080)
EXPOSE 8080

# Health check for Google Cloud Run
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/ || exit 1

# Start the production server
CMD ["node", "server.js"]
