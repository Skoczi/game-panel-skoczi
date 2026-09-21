ARG NODE_IMAGE=node:24-alpine3.24
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.31-alpine3.24

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY frontend/package*.json frontend/
RUN cd frontend && npm ci
COPY frontend frontend
COPY docs/pro/RELEASE-2.0.49.md docs/pro/RELEASE-2.0.49.md
# Data-only contract imported by the template editor during type checking.
COPY backend/src/templates/types.ts backend/src/templates/types.ts
ARG VITE_DB_API_BASE_URL
ENV VITE_DB_API_BASE_URL=${VITE_DB_API_BASE_URL}
RUN cd frontend && npm run build

FROM ${NGINX_IMAGE}
COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
