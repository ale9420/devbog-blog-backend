# --- Base ---
FROM node:20-alpine AS base
ENV NODE_ENV=production
WORKDIR /app

# --- Dependencies ---
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- Build ---
FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- Production ---
FROM base AS production
ENV NODE_ENV=production
ENV DATABASE_CLIENT=postgres

# Install curl for health checks
RUN apk add --no-cache curl

# Create required directories
RUN mkdir -p /app/public/uploads /app/.tmp

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist/config ./config
COPY --from=build /app/dist/src ./src
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/database ./database
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/server.js ./server.js

EXPOSE 1337

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:1337/_health || exit 1

CMD ["node", "server.js"]
