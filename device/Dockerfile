# syntax=docker/dockerfile:1.7

FROM --platform=$BUILDPLATFORM golang:1.21-alpine AS builder

ARG TARGETARCH

ARG CMD_PATH
ARG BINARY_NAME
ARG GO_LDFLAGS=""

WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY cmd ./cmd
COPY internal ./internal
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH:-arm64} \
    go build -trimpath -ldflags="${GO_LDFLAGS} -s -w" -o /out/${BINARY_NAME} ${CMD_PATH}

FROM scratch AS export
ARG BINARY_NAME
COPY --from=builder /out/${BINARY_NAME} /${BINARY_NAME}
