# =============================================================================
# Stage 1: Build - Compile TypeScript
# =============================================================================
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
# Install ALL dependencies (including devDependencies) required for building
RUN npm ci
COPY . .
RUN npm run build

# =============================================================================
# Stage 2: Dependencies - Install ONLY production modules
# =============================================================================
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./

ENV NODE_ENV=production

# --omit=optional drops heavy multi-OS native bindings
RUN npm ci --omit=dev --omit=optional --ignore-scripts && \
    npm cache clean --force && \
    # Strip text bloat
    find ./node_modules -type f -name "*.md" -delete && \
    find ./node_modules -type f -name "*.ts" -delete && \
    find ./node_modules -type f -name "*.map" -delete && \
    find ./node_modules -type d -name "test" -prune -exec rm -rf '{}' + && \
    find ./node_modules -type d -name "tests" -prune -exec rm -rf '{}' + && \
    # Nuke foreign OS binaries (@datadog, @img, etc.) not needed on Alpine Linux
    find ./node_modules -type d -name "darwin*" -prune -exec rm -rf '{}' + && \
    find ./node_modules -type d -name "win32*" -prune -exec rm -rf '{}' + && \
    find ./node_modules -type d -name "windows*" -prune -exec rm -rf '{}' + && \
    find ./node_modules -type d -name "arm64" -prune -exec rm -rf '{}' + && \
    # Drop GeoIP IPv6 databases (~60MB) to secure the <200MB target
    rm -f ./node_modules/geoip-lite/data/*v6.dat

# =============================================================================
# Stage 3: Production Runtime - Minimal final image
# =============================================================================
FROM node:20-alpine AS production
ENV NODE_ENV=production

# Upgrade base OS packages to patch vulnerabilities caught by Trivy
RUN apk upgrade --no-cache

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

# Copy ONLY what is strictly necessary from the previous stages
COPY --from=deps --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/package.json ./

# Manually remove npm and yarn binaries
RUN rm -rf /usr/local/lib/node_modules/npm \
    && rm -rf /usr/local/bin/npm \
    && rm -rf /usr/local/bin/npx \
    && rm -rf /opt/yarn-* \
    && rm -rf /usr/local/bin/yarn \
    && rm -rf /usr/local/bin/yarnpkg

# Switch to non-root user
USER nodejs

EXPOSE 3000

# Direct node execution (no npm start wrapper)
CMD ["node", "dist/index.js"]