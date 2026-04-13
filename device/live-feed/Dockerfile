FROM ubuntu:18.04 AS builder

# ── arm64 multi-arch sources ──────────────────────────────────────────
# The default repos only carry amd64; arm64 lives on ports.ubuntu.com.
RUN dpkg --add-architecture arm64 && \
    echo 'deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports/ bionic main restricted universe multiverse'          >  /etc/apt/sources.list.d/arm64.list && \
    echo 'deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports/ bionic-updates main restricted universe multiverse'  >> /etc/apt/sources.list.d/arm64.list && \
    echo 'deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports/ bionic-security main restricted universe multiverse' >> /etc/apt/sources.list.d/arm64.list && \
    sed -i 's/^deb http/deb [arch=amd64] http/g' /etc/apt/sources.list

# ── cross-compiler + arm64 GStreamer dev libs ─────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc-aarch64-linux-gnu \
        pkg-config \
        wget \
        ca-certificates \
        libgstreamer1.0-dev:arm64 \
        libgstreamer-plugins-base1.0-dev:arm64 \
    && rm -rf /var/lib/apt/lists/*

# ── Go (amd64 — runs natively, cross-compiles to arm64) ──────────────
ARG GO_VERSION=1.21.13
RUN wget -q "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" -O /tmp/go.tar.gz && \
    tar -C /usr/local -xzf /tmp/go.tar.gz && rm /tmp/go.tar.gz

ENV PATH="/usr/local/go/bin:$PATH" \
    CGO_ENABLED=1 \
    GOOS=linux \
    GOARCH=arm64 \
    CC=aarch64-linux-gnu-gcc \
    PKG_CONFIG_LIBDIR=/usr/lib/aarch64-linux-gnu/pkgconfig:/usr/share/pkgconfig

# ── build ─────────────────────────────────────────────────────────────
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go build -ldflags="-s -w" -o /out/live-feed ./src/

# ── export stage (only the binary) ───────────────────────────────────
FROM scratch AS export
COPY --from=builder /out/live-feed /live-feed
