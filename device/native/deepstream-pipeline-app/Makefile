CUDA_VER ?= 10.2
APP := trakrai-deepstream-app
PARSER_SO := libnvdsinfer_custom_yolov5.so
DS_VERSION := 6.0
DS_ROOT := /opt/nvidia/deepstream/deepstream-$(DS_VERSION)
DS_INC := $(DS_ROOT)/sources/includes
DS_LIB := $(DS_ROOT)/lib
CUDA_INC := /usr/local/cuda/include

CXXFLAGS += -std=c++17 -O2 -Wall -Wextra -I$(DS_INC) -I$(CUDA_INC) $(shell pkg-config --cflags gstreamer-1.0)
LDFLAGS += $(shell pkg-config --libs gstreamer-1.0) \
	-L$(DS_LIB) -Wl,-rpath,$(DS_LIB) \
	-lnvdsgst_meta -lnvds_meta -lstdc++fs

all: $(APP) $(PARSER_SO)

$(APP): main.cpp
	$(CXX) $(CXXFLAGS) -o $@ $< $(LDFLAGS)

$(PARSER_SO): nvdsinfer_yolov5_parser.cpp
	$(CXX) $(CXXFLAGS) -shared -fPIC -o $@ $<

clean:
	rm -f $(APP) $(PARSER_SO)
