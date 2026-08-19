# syntax=docker/dockerfile:1

# Dependencies are installed from the workspace lockfile so the image resolves
# exactly the same tree as local development. Build context is the repository
# root, which is why the workspace manifests are copied explicitly — mirrors
# apps/api/Dockerfile's pattern.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm ci --include-workspace-root --workspace @sales-lakehouse/web

# Build the static bundle. VITE_API_FIXTURES is not set here, so the container
# build gets the same real-backend default as `npm run build` anywhere else —
# fixtures are a dev-only escape hatch, never a container concern.
FROM deps AS build
WORKDIR /app
COPY apps/web apps/web
RUN npm run build --workspace @sales-lakehouse/web

# nginx serves the built assets and reverse-proxies /api and /health to the api
# service, so the browser sees one origin — exactly what the Vite dev proxy does,
# and exactly why the bundle has no backend URL compiled into it.
FROM nginx:1.27-alpine AS dev
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
