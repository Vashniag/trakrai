FROM bluenviron/mediamtx:latest AS mediamtx

FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    ffmpeg \
    netcat-openbsd \
    procps \
    && rm -rf /var/lib/apt/lists/*

COPY --from=mediamtx /mediamtx /usr/local/bin/mediamtx
COPY mediamtx.yml /mediamtx.yml
COPY entrypoint.sh /usr/local/bin/trakrai-fake-camera-entrypoint.sh

RUN sed -i 's/\r$//' /usr/local/bin/trakrai-fake-camera-entrypoint.sh \
    && chmod +x /usr/local/bin/mediamtx /usr/local/bin/trakrai-fake-camera-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/trakrai-fake-camera-entrypoint.sh"]
