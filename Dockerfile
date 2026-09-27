# Minor pinned: League-ELO v2 replays must compute the same numbers locally
# (dry run) and on Cloud Run.
FROM node:24.21-alpine AS base
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

# Run unprivileged: the service only reads its code and listens on 8080.
USER node

CMD ["node", "src/index.js"]
