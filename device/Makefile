.PHONY: build build-ai-inference-wheel build-cloud-comm build-live-feed build-ptz-control build-rtsp-feeder build-runtime-manager clean

GO_LDFLAGS ?=
AI_INFERENCE_VERSION ?= 0.1.0

build: build-cloud-comm build-live-feed build-ptz-control build-rtsp-feeder build-runtime-manager build-ai-inference-wheel

build-cloud-comm:
	docker buildx build --output type=local,dest=./out/cloud-comm -f Dockerfile --build-arg CMD_PATH=./cmd/cloud-comm --build-arg BINARY_NAME=cloud-comm --build-arg GO_LDFLAGS="$(GO_LDFLAGS)" .
	@echo "Binary: out/cloud-comm/cloud-comm"

build-live-feed:
	docker buildx build --output type=local,dest=./out/live-feed -f Dockerfile.gstreamer --build-arg CMD_PATH=./cmd/live-feed --build-arg BINARY_NAME=live-feed --build-arg GO_LDFLAGS="$(GO_LDFLAGS)" .
	@echo "Binary: out/live-feed/live-feed"

build-ptz-control:
	docker buildx build --output type=local,dest=./out/ptz-control -f Dockerfile --build-arg CMD_PATH=./cmd/ptz-control --build-arg BINARY_NAME=ptz-control --build-arg GO_LDFLAGS="$(GO_LDFLAGS)" .
	@echo "Binary: out/ptz-control/ptz-control"

build-rtsp-feeder:
	docker buildx build --output type=local,dest=./out/rtsp-feeder -f Dockerfile.gstreamer --build-arg CMD_PATH=./cmd/rtsp-feeder --build-arg BINARY_NAME=rtsp-feeder --build-arg GO_LDFLAGS="$(GO_LDFLAGS)" .
	@echo "Binary: out/rtsp-feeder/rtsp-feeder"

build-runtime-manager:
	docker buildx build --output type=local,dest=./out/runtime-manager -f Dockerfile --build-arg CMD_PATH=./cmd/runtime-manager --build-arg BINARY_NAME=runtime-manager --build-arg GO_LDFLAGS="$(GO_LDFLAGS)" .
	@echo "Binary: out/runtime-manager/runtime-manager"

build-ai-inference-wheel:
	docker buildx build --output type=local,dest=./out/ai-inference-wheel -f python/ai_inference/Dockerfile.wheel --build-arg PACKAGE_VERSION="$(AI_INFERENCE_VERSION)" ./python/ai_inference
	@echo "Wheel: out/ai-inference-wheel/"

clean:
	rm -rf out/
