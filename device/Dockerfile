FROM --platform=$BUILDPLATFORM golang:1.21-alpine AS builder

ARG TARGETARCH

ARG CMD_PATH
ARG BINARY_NAME
ARG GO_LDFLAGS=""

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH:-arm64} go build -trimpath -ldflags="${GO_LDFLAGS} -s -w" -o /out/${BINARY_NAME} ${CMD_PATH}

FROM scratch AS export
ARG BINARY_NAME
COPY --from=builder /out/${BINARY_NAME} /${BINARY_NAME}
