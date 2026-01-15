# RPG-MCP Server Dockerfile
FROM node:20-slim

WORKDIR /app

# Install build dependencies for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build
RUN npm prune --omit=dev

# Create data directory
RUN mkdir -p /app/data

# Expose ports for TCP and WebSocket transports
EXPOSE 3000 3001

# Default command (can be overridden)
CMD ["node", "dist/server/index.js"]
