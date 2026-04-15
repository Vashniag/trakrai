cmake_minimum_required(VERSION 3.16)
project(trakrai_trt_yolo_server LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(OpenCV REQUIRED)
find_package(CUDAToolkit REQUIRED)

find_path(TENSORRT_INCLUDE_DIR NvInfer.h
    HINTS
        /usr/include/x86_64-linux-gnu
        /usr/include/aarch64-linux-gnu
        /usr/include
)
find_library(TENSORRT_LIBRARY nvinfer HINTS /usr/lib/x86_64-linux-gnu /usr/lib/aarch64-linux-gnu /usr/lib)

if (NOT TENSORRT_INCLUDE_DIR OR NOT TENSORRT_LIBRARY)
    message(FATAL_ERROR "TensorRT headers or libraries were not found")
endif()

add_executable(trakrai-trt-yolo-server src/main.cpp)
target_include_directories(trakrai-trt-yolo-server PRIVATE ${TENSORRT_INCLUDE_DIR} ${OpenCV_INCLUDE_DIRS})
target_link_libraries(trakrai-trt-yolo-server PRIVATE ${OpenCV_LIBS} CUDA::cudart ${TENSORRT_LIBRARY})
