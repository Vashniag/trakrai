FROM bluenviron/mediamtx:latest AS mediamtx

FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN set -eux; \
    apt_retry() { \
      attempt=1; \
      while [ "${attempt}" -le 5 ]; do \
        "$@" && return 0; \
        echo "apt command failed (attempt ${attempt}), retrying..." >&2; \
        attempt=$((attempt + 1)); \
        sleep 5; \
        apt-get clean; \
        rm -rf /var/lib/apt/lists/*; \
      done; \
      return 1; \
    }; \
    apt_retry apt-get -o Acquire::Retries=5 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 update; \
    apt_retry apt-get -o Acquire::Retries=5 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 install -y --no-install-recommends \
      bash \
      ca-certificates \
      curl \
      ffmpeg \
      netcat-openbsd \
      procps; \
    rm -rf /var/lib/apt/lists/*

COPY --from=mediamtx /mediamtx /usr/local/bin/mediamtx
COPY mediamtx.yml /mediamtx.yml
COPY entrypoint.sh /usr/local/bin/trakrai-fake-camera-entrypoint.sh

RUN sed -i 's/\r$//' /usr/local/bin/trakrai-fake-camera-entrypoint.sh \
    && chmod +x /usr/local/bin/mediamtx /usr/local/bin/trakrai-fake-camera-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/trakrai-fake-camera-entrypoint.sh"]
