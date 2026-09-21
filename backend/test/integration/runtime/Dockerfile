# Disposable acceptance runtime. No host Docker socket or production data mounts.
FROM docker:29-dind
RUN apk add --no-cache bash nodejs npm python3 make g++ tar coreutils util-linux
WORKDIR /workspace/backend
COPY backend/package*.json ./
RUN npm ci
WORKDIR /workspace
COPY backend ./backend
COPY examples ./examples
COPY runtime ./runtime
COPY .dockerignore ./.dockerignore
ENV DOCKER_HOST=unix:///var/run/docker.sock DOCKER_TLS_CERTDIR=""
