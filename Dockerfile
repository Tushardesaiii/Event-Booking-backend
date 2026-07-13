# ==============================================================================
# STAGE 1: Base image
# ==============================================================================
FROM node:22-alpine AS base
WORKDIR /app
# Install minimal system tools.
# postgresql-client provides pg_dump, required by the scheduled `db_backup` job.
RUN apk add --no-cache tzdata postgresql-client && \
    cp /usr/share/zoneinfo/Asia/Kolkata /etc/localtime && \
    echo "Asia/Kolkata" > /etc/timezone

# ==============================================================================
# STAGE 2: Build dependencies (development + production)
# ==============================================================================
FROM base AS dependencies
COPY package*.json ./
RUN npm ci

# ==============================================================================
# STAGE 3: Build application
# ==============================================================================
FROM dependencies AS builder
COPY . .
RUN npm run build

# ==============================================================================
# STAGE 4: Production dependencies only
# ==============================================================================
FROM base AS production-deps
COPY package*.json ./
RUN npm ci --omit=dev

# ==============================================================================
# STAGE 5: Production runner
# ==============================================================================
FROM base AS runner

# Declare ARGs for build-time OCI metadata
ARG BUILD_DATE="2026-06-23T11:00:00Z"
ARG GIT_COMMIT="unknown"
ARG VERSION="1.0.0"

# Hardening: Run as non-root user
USER node

# Set secure environment variables
ENV NODE_ENV=production \
    PORT=3000

# Copy application files with proper ownership
COPY --chown=node:node package.json ./
COPY --chown=node:node --from=production-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node drizzle ./drizzle
COPY --chown=node:node checkout.html ./
COPY --chown=node:node scripts/docker-healthcheck.js ./scripts/docker-healthcheck.js
COPY --chown=node:node docker-entrypoint.sh ./docker-entrypoint.sh

# HARDENING: Ensure the entrypoint has execute permission
USER root
RUN chmod +x /app/docker-entrypoint.sh
USER node

# Expose service port
EXPOSE 3000

# Configure healthcheck using native Node script
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "scripts/docker-healthcheck.js"]

# Setup OCI annotations & metadata labels according to spec
LABEL org.opencontainers.image.title="revelis-backend" \
      org.opencontainers.image.description="Enterprise-grade SaaS Event Booking Platform Backend" \
      org.opencontainers.image.vendor="Revelis" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${GIT_COMMIT}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.source="https://github.com/speedmvps/event-booking-backend" \
      org.opencontainers.image.licenses="Proprietary" \
      org.opencontainers.image.documentation="https://github.com/speedmvps/event-booking-backend/blob/main/README.md"

# Entrypoint script configures checks, runs migrations and runs main CMD
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
