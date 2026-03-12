FROM node:24-alpine AS base
WORKDIR /app

# Install production dependencies
COPY package.json package-lock.json ./
RUN npm ci --only=production

# Copy source code
COPY src/ ./src/

# Cloud Run uses PORT env variable
ENV PORT=8080
ENV HOST=0.0.0.0
ENV NODE_ENV=production

EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

CMD ["node", "src/index.js"]
