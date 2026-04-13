BINARY := live-feed

.PHONY: build clean

# Build arm64 binary via Docker cross-compilation (no QEMU, runs natively on x86)
build:
	docker buildx build --output type=local,dest=./out -f Dockerfile .
	@echo "Binary: out/$(BINARY)"

clean:
	rm -rf out/
