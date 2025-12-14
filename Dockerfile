FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build frontend (creates dist/)
RUN npm run build

# Cloud Run settings
ENV PORT=8080
EXPOSE 8080

# Start server
CMD ["node", "server.js"]
