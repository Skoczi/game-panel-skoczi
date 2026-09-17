# Build this image on a trusted builder, then docker save/load it onto each node.
# Supply a reviewed base-image digest for a reproducible production build.
ARG BASE_IMAGE=debian:bookworm-slim
FROM ${BASE_IMAGE}
ARG STEAMCMD_SHA256
RUN dpkg --add-architecture i386 && apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates libc6:i386 libgcc-s1:i386 libstdc++6:i386 libcurl4:i386 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -g 1000 game && useradd -u 1000 -g 1000 -d /data game \
    && mkdir -p /opt/steamcmd /data
# This archive is supplied by the operator, not downloaded by a startup script.
COPY steamcmd_linux.tar.gz /tmp/steamcmd_linux.tar.gz
RUN test "${#STEAMCMD_SHA256}" = 64 \
    && echo "${STEAMCMD_SHA256}  /tmp/steamcmd_linux.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/steamcmd_linux.tar.gz -C /opt/steamcmd \
    && rm /tmp/steamcmd_linux.tar.gz \
    && chown -R 1000:1000 /opt/steamcmd /data
COPY cs16-install.sh /usr/local/lib/gamepanel/cs16-install
RUN chmod 0555 /usr/local/lib/gamepanel/cs16-install
ENV HOME=/data LD_LIBRARY_PATH=/data:/data/bin:/opt/steamcmd/linux32
USER 1000:1000
WORKDIR /data
ENTRYPOINT []
CMD ["/bin/false"]
