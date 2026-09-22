ARG NODE_IMAGE=node:24-alpine3.24
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.31-alpine3.24

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY frontend/package*.json frontend/
RUN cd frontend && npm ci
COPY frontend frontend
COPY docs/pro/RELEASE-2.0.59.md docs/pro/RELEASE-2.0.59.md
# Shared template contract and pure startup-command helpers used by the editor.
COPY backend/src/templates/types.ts backend/src/templates/startupCommand.ts backend/src/templates/gameIcons.ts backend/src/templates/gameConfig.ts backend/src/templates/rehldsStartup.ts backend/src/templates/
ARG VITE_DB_API_BASE_URL
ENV VITE_DB_API_BASE_URL=${VITE_DB_API_BASE_URL}
ARG NODE_BUILD_HEAP_MB=4096
RUN cd frontend && NODE_OPTIONS="--max-old-space-size=${NODE_BUILD_HEAP_MB}" npm run build

FROM ${NGINX_IMAGE}
COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
