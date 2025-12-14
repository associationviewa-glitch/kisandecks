FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Cloud Run uses PORT 8080
ENV PORT=8080
EXPOSE 8080

# Start app
CMD ["node", "server.js"]
