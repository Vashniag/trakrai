FROM ubuntu:18.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    apt-transport-https \
    bash \
    ca-certificates \
    curl \
    espeak \
    file \
    gpg-agent \
    iproute2 \
    procps \
    redis-tools \
    software-properties-common \
    wget \
    && add-apt-repository -y ppa:deadsnakes/ppa \
    && apt-get update && apt-get install -y --no-install-recommends \
    python3.8 \
    python3.8-dev \
    python3.8-distutils \
    gstreamer1.0-libav \
    gstreamer1.0-plugins-bad \
    gstreamer1.0-plugins-base \
    gstreamer1.0-plugins-good \
    gstreamer1.0-plugins-ugly \
    gstreamer1.0-tools \
    libgstreamer-plugins-base1.0-0 \
    libgstreamer1.0-0 \
    && rm -rf /var/lib/apt/lists/*

RUN wget -q https://bootstrap.pypa.io/pip/3.8/get-pip.py -O /tmp/get-pip.py \
    && python3.8 /tmp/get-pip.py \
    && rm -f /tmp/get-pip.py \
    && update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.8 10

RUN groupadd --system hacklab \
    && useradd --system --gid hacklab --create-home --home-dir /home/hacklab hacklab

COPY fake_systemctl.py /usr/local/bin/systemctl
COPY entrypoint.sh /usr/local/bin/trakrai-local-device-entrypoint.sh

RUN sed -i 's/\r$//' /usr/local/bin/systemctl /usr/local/bin/trakrai-local-device-entrypoint.sh \
    && chmod +x /usr/local/bin/systemctl /usr/local/bin/trakrai-local-device-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/trakrai-local-device-entrypoint.sh"]
