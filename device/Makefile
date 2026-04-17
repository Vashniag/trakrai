.PHONY: build clean

PYTHON ?= python3
DEVTOOL = $(PYTHON) -m device.devtool

build:
	$(DEVTOOL) build all --platform $${PLATFORM:-linux/arm64}

build-%:
	$(DEVTOOL) build service --platform $${PLATFORM:-linux/arm64} --service $*

clean:
	rm -rf out/
