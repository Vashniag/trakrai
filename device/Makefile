.PHONY: build build-cloud-comm build-live-feed build-rtsp-feeder clean

build: build-cloud-comm build-live-feed build-rtsp-feeder

build-cloud-comm:
	docker buildx build --output type=local,dest=./out/cloud-comm -f Dockerfile --build-arg CMD_PATH=./cmd/cloud-comm --build-arg BINARY_NAME=cloud-comm .
	@echo "Binary: out/cloud-comm/cloud-comm"

build-live-feed:
	docker buildx build --output type=local,dest=./out/live-feed -f Dockerfile.gstreamer --build-arg CMD_PATH=./cmd/live-feed --build-arg BINARY_NAME=live-feed .
	@echo "Binary: out/live-feed/live-feed"

build-rtsp-feeder:
	docker buildx build --output type=local,dest=./out/rtsp-feeder -f Dockerfile.gstreamer --build-arg CMD_PATH=./cmd/rtsp-feeder --build-arg BINARY_NAME=rtsp-feeder .
	@echo "Binary: out/rtsp-feeder/rtsp-feeder"

clean:
	rm -rf out/
