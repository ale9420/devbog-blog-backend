# syntax=docker/dockerfile:1

# --- Base ---
FROM node:22-alpine AS base
ENV NODE_ENV=production
WORKDIR /app

# --- Dependencies ---
FROM base AS deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

# --- Build ---
FROM base AS build
COPY package.json package-lock.json ./
# NODE_ENV=production makes `npm ci` skip devDependencies, and the build needs
# them (esbuild bundles the fediverse plugin, typescript compiles the server).
RUN --mount=type=cache,target=/root/.npm npm ci --include=dev
COPY . .
# Force clean rebuild of admin bundle when plugins change
RUN rm -rf dist .strapi
RUN npm run build

# --- Production ---
FROM base AS production
ENV NODE_ENV=production
ENV DATABASE_CLIENT=postgres

# tini runs as PID 1 so SIGTERM reaches node on redeploys; su-exec lets the
# entrypoint drop from root to the node user.
RUN apk add --no-cache tini su-exec

# Create required directories (Strapi's local upload provider refuses to start
# if /app/public/uploads is missing, and .dockerignore excludes it from COPY)
RUN mkdir -p /app/.tmp /app/public/uploads && chown node:node /app/.tmp /app/public/uploads

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist/config ./config
COPY --from=build /app/dist/src ./src
# Local plugins are excluded from the server tsc compile (tsconfig excludes
# src/plugins/**) and ship their own esbuild dist: only the bundle and the
# package.json that points at it are needed at runtime.
COPY --from=build /app/src/plugins/fediverse/package.json ./src/plugins/fediverse/package.json
COPY --from=build /app/src/plugins/fediverse/dist ./src/plugins/fediverse/dist
COPY --from=build /app/dist/build ./build
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/database ./database
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/server.js ./server.js
COPY --from=build /app/public ./public
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

EXPOSE 1337

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:1337/_health || exit 1

ENTRYPOINT ["/sbin/tini", "--", "docker-entrypoint.sh"]
CMD ["node", "server.js"]
