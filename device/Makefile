.PHONY: build build-cloud-comm build-live-feed build-ptz-control build-rtsp-feeder build-workflow-comm clean

build: build-cloud-comm build-live-feed build-ptz-control build-rtsp-feeder build-workflow-comm

build-cloud-comm:
	docker buildx build --output type=local,dest=./out/cloud-comm -f Dockerfile --build-arg CMD_PATH=./cmd/cloud-comm --build-arg BINARY_NAME=cloud-comm .
	@echo "Binary: out/cloud-comm/cloud-comm"

build-live-feed:
	docker buildx build --output type=local,dest=./out/live-feed -f Dockerfile.gstreamer --build-arg CMD_PATH=./cmd/live-feed --build-arg BINARY_NAME=live-feed .
	@echo "Binary: out/live-feed/live-feed"

build-ptz-control:
	docker buildx build --output type=local,dest=./out/ptz-control -f Dockerfile --build-arg CMD_PATH=./cmd/ptz-control --build-arg BINARY_NAME=ptz-control .
	@echo "Binary: out/ptz-control/ptz-control"

build-rtsp-feeder:
	docker buildx build --output type=local,dest=./out/rtsp-feeder -f Dockerfile.gstreamer --build-arg CMD_PATH=./cmd/rtsp-feeder --build-arg BINARY_NAME=rtsp-feeder .
	@echo "Binary: out/rtsp-feeder/rtsp-feeder"

build-workflow-comm:
	docker buildx build --output type=local,dest=./out/workflow-comm -f Dockerfile --build-arg CMD_PATH=./cmd/workflow-comm --build-arg BINARY_NAME=workflow-comm .
	@echo "Binary: out/workflow-comm/workflow-comm"

clean:
	rm -rf out/
