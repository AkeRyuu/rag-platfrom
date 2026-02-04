FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy built code
COPY dist ./dist

# Expose port
EXPOSE 3100

# Start server
CMD ["node", "dist/server.js"]
