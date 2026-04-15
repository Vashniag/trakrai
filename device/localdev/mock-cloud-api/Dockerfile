FROM --platform=$BUILDPLATFORM golang:1.21-alpine AS builder

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/mock-cloud-api ./main.go

FROM builder AS runtime
COPY --from=builder /out/mock-cloud-api /usr/local/bin/mock-cloud-api
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/mock-cloud-api"]
