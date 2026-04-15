FROM golang:1.21-alpine

ARG MINIO_RELEASE_URL=https://dl.min.io/server/minio/release/linux-amd64/minio

RUN wget -q "${MINIO_RELEASE_URL}" -O /usr/local/bin/minio \
    && chmod +x /usr/local/bin/minio

EXPOSE 9000 9001

ENTRYPOINT ["/usr/local/bin/minio"]
