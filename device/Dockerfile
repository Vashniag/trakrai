FROM golang:1.21-alpine AS builder

ARG CMD_PATH
ARG BINARY_NAME

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -ldflags="-s -w" -o /out/${BINARY_NAME} ${CMD_PATH}

FROM scratch AS export
ARG BINARY_NAME
COPY --from=builder /out/${BINARY_NAME} /${BINARY_NAME}

