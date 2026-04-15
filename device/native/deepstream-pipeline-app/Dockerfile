ARG BASE_IMAGE=nvcr.io/nvidia/deepstream-l4t:6.0.1-samples
FROM ${BASE_IMAGE}

RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y \
        build-essential \
        pkg-config \
        libglib2.0-dev \
        libgstreamer1.0-dev \
        libgstreamer-plugins-base1.0-dev && \
    rm -rf /var/lib/apt/lists/*
