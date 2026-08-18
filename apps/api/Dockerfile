# syntax=docker/dockerfile:1

# Dependencies are installed from the workspace lockfile so the image resolves
# exactly the same tree as local development. Build context is the repository
# root, which is why the workspace manifests are copied explicitly.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
RUN npm ci --include-workspace-root --workspace @sales-lakehouse/api

# Development target: runs TypeScript directly through tsx, no build step.
# Image hardening and a compiled production target are finished in Phase 6.
FROM deps AS dev
WORKDIR /app
COPY apps/api apps/api
ENV NODE_ENV=development
EXPOSE 4000
WORKDIR /app/apps/api

# tsx is exec'd directly rather than via `npm run dev`, for two reasons:
#
#   1. `tsx watch` supervises a child process, so PID 1 survives a crashed
#      server. The container would sit "Up (unhealthy)" forever and Docker's
#      restart policy would never fire. Exec'ing tsx means a fatal error exits
#      the container and Compose restarts it. Watch mode also has nothing to
#      watch here: no source is bind-mounted (that arrives with the Phase 6
#      development override).
#   2. Skipping the npm wrapper puts tsx at PID 1, so SIGTERM from
#      `docker compose stop` reaches the server's graceful-shutdown handler.
CMD ["/app/node_modules/.bin/tsx", "src/server.ts"]
