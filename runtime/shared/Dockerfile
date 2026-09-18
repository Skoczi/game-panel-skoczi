# Generic environments, not per-game images. Build both targets once and load on each node.
# Pin BASE_IMAGE to a reviewed Debian digest when producing release artifacts.
ARG BASE_IMAGE=debian:bookworm-slim
FROM ${BASE_IMAGE} AS runtime
RUN dpkg --add-architecture i386 && apt-get update && apt-get install -y --no-install-recommends \
    bash ca-certificates libc6:i386 libgcc-s1:i386 libstdc++6:i386 libcurl4:i386 \
    libgcc-s1 libstdc++6 libcurl4 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -g 1000 game && useradd -u 1000 -g 1000 -d /data game \
    && mkdir -p /data && chown 1000:1000 /data
ENV HOME=/data LD_LIBRARY_PATH=/data:/data/bin:/data/linux64
USER 1000:1000
WORKDIR /data
ENTRYPOINT []
CMD ["/bin/false"]

FROM runtime AS installer
USER root
ARG STEAMCMD_SHA256
RUN apt-get update && apt-get install -y --no-install-recommends curl jq unzip tar gzip xz-utils \
    && rm -rf /var/lib/apt/lists/* && mkdir -p /opt/steamcmd
# Operator-reviewed official Valve archive, not a game-specific installer.
COPY steamcmd_linux.tar.gz /tmp/steamcmd_linux.tar.gz
RUN test "${#STEAMCMD_SHA256}" = 64 \
    && echo "${STEAMCMD_SHA256}  /tmp/steamcmd_linux.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/steamcmd_linux.tar.gz -C /opt/steamcmd \
    && rm /tmp/steamcmd_linux.tar.gz && chown -R 1000:1000 /opt/steamcmd
USER 1000:1000
