# ---- Build stage: install all deps, build web + server, prune to prod deps ----
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Toolchain for native modules (better-sqlite3) when no prebuilt binary is available.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Install dependencies first so this layer is cached until a manifest changes.
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY web/package.json ./web/package.json
RUN npm ci

# Build both workspaces (web -> web/dist, server -> server/dist), then drop dev deps.
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- Runtime stage: minimal image with built artifacts + production deps ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=4000
ENV DATA_DIR=/data

WORKDIR /app/server

# Production dependencies are hoisted to the repo root by npm workspaces.
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/package.json /app/package.json
COPY --from=build /app/server/package.json ./package.json
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/web/dist /app/web/dist

# SQLite DB + local-backend blobs live here (mounted as a volume by compose).
RUN mkdir -p /data && chown -R node:node /data
USER node

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
