#include <NvInfer.h>
#include <cuda_fp16.h>
#include <cuda_runtime_api.h>
#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>

#include <algorithm>
#include <cmath>
#include <chrono>
#include <cstring>
#include <cstdint>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace {

class TRTLogger final : public nvinfer1::ILogger {
public:
    void log(Severity severity, const char* message) noexcept override {
        if (severity > Severity::kWARNING) {
            return;
        }
        std::cerr << "[TensorRT] " << message << std::endl;
    }
};

struct Settings {
    std::string engine_path;
    std::string labels_path;
    int input_width = 640;
    int input_height = 640;
    float confidence_threshold = 0.35F;
    float iou_threshold = 0.45F;
    int jpeg_quality = 85;
};

struct Detection {
    int class_id = -1;
    float score = 0.0F;
    float left = 0.0F;
    float top = 0.0F;
    float right = 0.0F;
    float bottom = 0.0F;
};

struct LetterboxInfo {
    float scale = 1.0F;
    float pad_x = 0.0F;
    float pad_y = 0.0F;
};

template <typename T>
struct TRTDestroy {
    void operator()(T* ptr) const {
        if (ptr != nullptr) {
            ptr->destroy();
        }
    }
};

using RuntimePtr = std::unique_ptr<nvinfer1::IRuntime, TRTDestroy<nvinfer1::IRuntime>>;
using EnginePtr = std::unique_ptr<nvinfer1::ICudaEngine, TRTDestroy<nvinfer1::ICudaEngine>>;
using ContextPtr = std::unique_ptr<nvinfer1::IExecutionContext, TRTDestroy<nvinfer1::IExecutionContext>>;

inline void checkCuda(cudaError_t status, const std::string& step) {
    if (status != cudaSuccess) {
        throw std::runtime_error(step + ": " + cudaGetErrorString(status));
    }
}

std::vector<std::string> split(const std::string& value, char delimiter) {
    std::vector<std::string> parts;
    std::string current;
    std::stringstream stream(value);
    while (std::getline(stream, current, delimiter)) {
        parts.push_back(current);
    }
    return parts;
}

std::vector<char> readBinaryFile(const std::string& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) {
        throw std::runtime_error("failed to open engine file: " + path);
    }
    input.seekg(0, std::ios::end);
    const auto size = static_cast<std::size_t>(input.tellg());
    input.seekg(0, std::ios::beg);
    std::vector<char> data(size);
    input.read(data.data(), static_cast<std::streamsize>(size));
    if (!input) {
        throw std::runtime_error("failed to read engine file: " + path);
    }
    return data;
}

std::size_t bytesPerElement(nvinfer1::DataType data_type) {
    switch (data_type) {
        case nvinfer1::DataType::kFLOAT:
            return sizeof(float);
        case nvinfer1::DataType::kHALF:
            return sizeof(__half);
        default:
            throw std::runtime_error("unsupported TensorRT binding data type");
    }
}

std::vector<std::string> readLines(const std::string& path) {
    if (path.empty()) {
        return {};
    }
    std::ifstream input(path);
    if (!input) {
        throw std::runtime_error("failed to open labels file: " + path);
    }
    std::vector<std::string> lines;
    std::string line;
    while (std::getline(input, line)) {
        if (!line.empty()) {
            lines.push_back(line);
        }
    }
    return lines;
}

std::size_t volume(const nvinfer1::Dims& dims) {
    std::size_t value = 1;
    for (int index = 0; index < dims.nbDims; ++index) {
        value *= static_cast<std::size_t>(dims.d[index]);
    }
    return value;
}

float intersectionOverUnion(const Detection& left, const Detection& right) {
    const float inter_left = std::max(left.left, right.left);
    const float inter_top = std::max(left.top, right.top);
    const float inter_right = std::min(left.right, right.right);
    const float inter_bottom = std::min(left.bottom, right.bottom);
    const float inter_width = std::max(0.0F, inter_right - inter_left);
    const float inter_height = std::max(0.0F, inter_bottom - inter_top);
    const float inter_area = inter_width * inter_height;
    const float left_area = std::max(0.0F, left.right - left.left) * std::max(0.0F, left.bottom - left.top);
    const float right_area = std::max(0.0F, right.right - right.left) * std::max(0.0F, right.bottom - right.top);
    const float union_area = left_area + right_area - inter_area;
    if (union_area <= 0.0F) {
        return 0.0F;
    }
    return inter_area / union_area;
}

std::vector<Detection> nonMaximumSuppression(std::vector<Detection> detections, float iou_threshold) {
    std::sort(detections.begin(), detections.end(), [](const Detection& a, const Detection& b) {
        return a.score > b.score;
    });

    std::vector<Detection> kept;
    for (const auto& candidate : detections) {
        bool suppressed = false;
        for (const auto& existing : kept) {
            if (candidate.class_id != existing.class_id) {
                continue;
            }
            if (intersectionOverUnion(candidate, existing) > iou_threshold) {
                suppressed = true;
                break;
            }
        }
        if (!suppressed) {
            kept.push_back(candidate);
        }
    }
    return kept;
}

std::string defaultLabel(int class_id, const std::vector<std::string>& labels) {
    if (class_id >= 0 && class_id < static_cast<int>(labels.size())) {
        return labels[static_cast<std::size_t>(class_id)];
    }
    return "class-" + std::to_string(class_id);
}

std::string formatDetections(const std::vector<Detection>& detections, const std::vector<std::string>& labels) {
    std::ostringstream stream;
    stream << std::fixed << std::setprecision(4);
    for (std::size_t index = 0; index < detections.size(); ++index) {
        const auto& detection = detections[index];
        if (index > 0) {
            stream << ';';
        }
        stream << defaultLabel(detection.class_id, labels) << ',' << detection.score << ',' << detection.left << ','
               << detection.top << ',' << detection.right << ',' << detection.bottom;
    }
    return stream.str();
}

std::vector<std::string> parseCommandLine(int argc, char** argv) {
    std::vector<std::string> args;
    for (int index = 1; index < argc; ++index) {
        args.emplace_back(argv[index]);
    }
    return args;
}

Settings parseSettings(int argc, char** argv) {
    const auto args = parseCommandLine(argc, argv);
    Settings settings;
    for (std::size_t index = 0; index < args.size(); ++index) {
        const auto& arg = args[index];
        const auto require_value = [&](const std::string& name) -> const std::string& {
            if (index + 1 >= args.size()) {
                throw std::runtime_error("missing value for " + name);
            }
            return args[index + 1];
        };

        if (arg == "--engine") {
            settings.engine_path = require_value(arg);
            ++index;
        } else if (arg == "--labels") {
            settings.labels_path = require_value(arg);
            ++index;
        } else if (arg == "--input-width") {
            settings.input_width = std::stoi(require_value(arg));
            ++index;
        } else if (arg == "--input-height") {
            settings.input_height = std::stoi(require_value(arg));
            ++index;
        } else if (arg == "--confidence") {
            settings.confidence_threshold = std::stof(require_value(arg));
            ++index;
        } else if (arg == "--iou") {
            settings.iou_threshold = std::stof(require_value(arg));
            ++index;
        } else if (arg == "--jpeg-quality") {
            settings.jpeg_quality = std::stoi(require_value(arg));
            ++index;
        } else if (arg == "--help") {
            throw std::runtime_error("usage: trakrai-trt-yolo-server --engine <path> [--labels <path>] [--input-width 640] [--input-height 640] [--confidence 0.35] [--iou 0.45] [--jpeg-quality 85]");
        }
    }

    if (settings.engine_path.empty()) {
        throw std::runtime_error("--engine is required");
    }
    if (settings.input_width <= 0 || settings.input_height <= 0) {
        throw std::runtime_error("input dimensions must be greater than 0");
    }
    return settings;
}

class TensorRTYoloRunner {
public:
    explicit TensorRTYoloRunner(Settings settings)
        : settings_(std::move(settings)), labels_(readLines(settings_.labels_path)) {
        loadEngine();
        allocateBuffers();
    }

    ~TensorRTYoloRunner() {
        if (input_device_ != nullptr) {
            cudaFree(input_device_);
        }
        if (output_device_ != nullptr) {
            cudaFree(output_device_);
        }
        if (stream_ != nullptr) {
            cudaStreamDestroy(stream_);
        }
    }

    std::pair<std::vector<Detection>, double> infer(const std::string& input_path, const std::string& annotated_path) {
        const auto started = std::chrono::steady_clock::now();

        cv::Mat image = cv::imread(input_path, cv::IMREAD_COLOR);
        if (image.empty()) {
            throw std::runtime_error("failed to read input image: " + input_path);
        }

        cv::Mat input_tensor;
        const LetterboxInfo info = preprocess(image, input_tensor);
        runNetwork(input_tensor);
        auto detections = postprocess(image, info);
        drawDetections(image, detections);

        std::vector<int> params = {cv::IMWRITE_JPEG_QUALITY, settings_.jpeg_quality};
        if (!cv::imwrite(annotated_path, image, params)) {
            throw std::runtime_error("failed to write annotated image: " + annotated_path);
        }

        const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - started);
        return {detections, static_cast<double>(elapsed.count())};
    }

    const std::vector<std::string>& labels() const { return labels_; }

private:
    void loadEngine() {
        const auto engine_data = readBinaryFile(settings_.engine_path);
        runtime_.reset(nvinfer1::createInferRuntime(logger_));
        if (!runtime_) {
            throw std::runtime_error("failed to create TensorRT runtime");
        }
        engine_.reset(runtime_->deserializeCudaEngine(engine_data.data(), engine_data.size()));
        if (!engine_) {
            throw std::runtime_error("failed to deserialize TensorRT engine");
        }
        context_.reset(engine_->createExecutionContext());
        if (!context_) {
            throw std::runtime_error("failed to create TensorRT context");
        }

        input_index_ = -1;
        output_index_ = -1;
        for (int index = 0; index < engine_->getNbBindings(); ++index) {
            if (engine_->bindingIsInput(index)) {
                input_index_ = index;
            } else {
                output_index_ = index;
            }
        }
        if (input_index_ < 0 || output_index_ < 0) {
            throw std::runtime_error("engine must expose one input and one output binding");
        }

        input_dtype_ = engine_->getBindingDataType(input_index_);
        output_dtype_ = engine_->getBindingDataType(output_index_);
        (void)bytesPerElement(input_dtype_);
        (void)bytesPerElement(output_dtype_);

        auto input_dims = engine_->getBindingDimensions(input_index_);
        if (input_dims.nbDims == 4 && input_dims.d[0] == -1) {
            const nvinfer1::Dims4 fixed_dims{1, 3, settings_.input_height, settings_.input_width};
            if (!context_->setBindingDimensions(input_index_, fixed_dims)) {
                throw std::runtime_error("failed to set input binding dimensions");
            }
            input_dims = context_->getBindingDimensions(input_index_);
        }
        if (input_dims.nbDims != 4) {
            throw std::runtime_error("expected NCHW input tensor");
        }
        if (input_dims.d[1] != 3) {
            throw std::runtime_error("expected 3-channel input tensor");
        }
        if (input_dims.d[0] != -1 &&
            (input_dims.d[2] != settings_.input_height || input_dims.d[3] != settings_.input_width)) {
            std::cerr << "[TensorRT] overriding configured input size " << settings_.input_width << "x"
                      << settings_.input_height << " with engine binding " << input_dims.d[3] << "x" << input_dims.d[2]
                      << std::endl;
            settings_.input_width = input_dims.d[3];
            settings_.input_height = input_dims.d[2];
        }
        input_shape_ = input_dims;
        output_shape_ = context_->getBindingDimensions(output_index_);
    }

    void allocateBuffers() {
        input_size_ = volume(input_shape_);
        output_size_ = volume(output_shape_);
        input_planar_.resize(input_size_);
        input_host_bytes_.resize(input_size_ * bytesPerElement(input_dtype_));
        output_host_bytes_.resize(output_size_ * bytesPerElement(output_dtype_));
        checkCuda(cudaMalloc(&input_device_, input_host_bytes_.size()), "allocate input buffer");
        checkCuda(cudaMalloc(&output_device_, output_host_bytes_.size()), "allocate output buffer");
        checkCuda(cudaStreamCreate(&stream_), "create CUDA stream");
    }

    LetterboxInfo preprocess(const cv::Mat& image, cv::Mat& chw_tensor) {
        const float scale = std::min(
            static_cast<float>(settings_.input_width) / static_cast<float>(image.cols),
            static_cast<float>(settings_.input_height) / static_cast<float>(image.rows));
        const int resized_width = static_cast<int>(std::round(static_cast<float>(image.cols) * scale));
        const int resized_height = static_cast<int>(std::round(static_cast<float>(image.rows) * scale));
        const int pad_x = (settings_.input_width - resized_width) / 2;
        const int pad_y = (settings_.input_height - resized_height) / 2;

        cv::Mat resized;
        cv::resize(image, resized, cv::Size(resized_width, resized_height));

        cv::Mat canvas(settings_.input_height, settings_.input_width, CV_8UC3, cv::Scalar(114, 114, 114));
        resized.copyTo(canvas(cv::Rect(pad_x, pad_y, resized_width, resized_height)));

        cv::Mat rgb;
        cv::cvtColor(canvas, rgb, cv::COLOR_BGR2RGB);
        rgb.convertTo(rgb, CV_32F, 1.0 / 255.0);

        std::vector<cv::Mat> channels(3);
        cv::split(rgb, channels);
        for (std::size_t channel = 0; channel < channels.size(); ++channel) {
            std::memcpy(
                input_planar_.data() + (channel * settings_.input_width * settings_.input_height),
                channels[channel].data,
                static_cast<std::size_t>(settings_.input_width * settings_.input_height) * sizeof(float));
        }
        packInputBuffer();

        chw_tensor = rgb;
        return LetterboxInfo{
            scale,
            static_cast<float>(pad_x),
            static_cast<float>(pad_y),
        };
    }

    void runNetwork(const cv::Mat&) {
        void* bindings[2];
        bindings[input_index_] = input_device_;
        bindings[output_index_] = output_device_;

        checkCuda(
            cudaMemcpyAsync(input_device_, input_host_bytes_.data(), input_host_bytes_.size(), cudaMemcpyHostToDevice, stream_),
            "copy input to device"
        );
        if (!context_->enqueueV2(bindings, stream_, nullptr)) {
            throw std::runtime_error("TensorRT enqueue failed");
        }
        checkCuda(
            cudaMemcpyAsync(output_host_bytes_.data(), output_device_, output_host_bytes_.size(), cudaMemcpyDeviceToHost, stream_),
            "copy output to host"
        );
        checkCuda(cudaStreamSynchronize(stream_), "synchronize CUDA stream");
    }

    void packInputBuffer() {
        switch (input_dtype_) {
            case nvinfer1::DataType::kFLOAT:
                std::memcpy(input_host_bytes_.data(), input_planar_.data(), input_size_ * sizeof(float));
                return;
            case nvinfer1::DataType::kHALF: {
                auto* output = reinterpret_cast<__half*>(input_host_bytes_.data());
                for (std::size_t index = 0; index < input_size_; ++index) {
                    output[index] = __float2half(input_planar_[index]);
                }
                return;
            }
            default:
                throw std::runtime_error("unsupported TensorRT input binding data type");
        }
    }

    float outputValue(std::size_t index) const {
        switch (output_dtype_) {
            case nvinfer1::DataType::kFLOAT:
                return reinterpret_cast<const float*>(output_host_bytes_.data())[index];
            case nvinfer1::DataType::kHALF:
                return __half2float(reinterpret_cast<const __half*>(output_host_bytes_.data())[index]);
            default:
                throw std::runtime_error("unsupported TensorRT output binding data type");
        }
    }

    std::vector<Detection> postprocess(const cv::Mat& image, const LetterboxInfo& info) const {
        std::vector<Detection> detections;

        int row_count = 0;
        int row_size = 0;
        if (output_shape_.nbDims == 3) {
            const int dim1 = output_shape_.d[1];
            const int dim2 = output_shape_.d[2];
            if (dim1 <= dim2) {
                row_size = dim1;
                row_count = dim2;
            } else {
                row_size = dim2;
                row_count = dim1;
            }
        } else if (output_shape_.nbDims == 2) {
            row_count = output_shape_.d[0];
            row_size = output_shape_.d[1];
        } else {
            throw std::runtime_error("unsupported output tensor rank");
        }
        if (row_count <= 0 || row_size < 6) {
            throw std::runtime_error("unexpected output tensor shape");
        }

        const bool shape_is_channel_major = output_shape_.nbDims == 3 && output_shape_.d[1] <= output_shape_.d[2];
        for (int row = 0; row < row_count; ++row) {
            std::vector<float> values(static_cast<std::size_t>(row_size));
            for (int column = 0; column < row_size; ++column) {
                const std::size_t index = shape_is_channel_major
                    ? static_cast<std::size_t>(column * row_count + row)
                    : static_cast<std::size_t>(row * row_size + column);
                values[static_cast<std::size_t>(column)] = outputValue(index);
            }

            Detection detection;
            if (row_size == 6) {
                detection.left = values[0];
                detection.top = values[1];
                detection.right = values[2];
                detection.bottom = values[3];
                detection.score = values[4];
                detection.class_id = static_cast<int>(values[5]);
            } else {
                const bool has_objectness = row_size >= 85;
                float objectness = has_objectness ? values[4] : 1.0F;
                int classes_offset = has_objectness ? 5 : 4;
                int best_class = -1;
                float best_score = 0.0F;
                for (int index = classes_offset; index < row_size; ++index) {
                    const float score = objectness * values[static_cast<std::size_t>(index)];
                    if (score > best_score) {
                        best_score = score;
                        best_class = index - classes_offset;
                    }
                }
                if (best_class < 0) {
                    continue;
                }
                const float center_x = values[0];
                const float center_y = values[1];
                const float width = values[2];
                const float height = values[3];
                detection.left = center_x - (width / 2.0F);
                detection.top = center_y - (height / 2.0F);
                detection.right = center_x + (width / 2.0F);
                detection.bottom = center_y + (height / 2.0F);
                detection.score = best_score;
                detection.class_id = best_class;
            }

            if (detection.score < settings_.confidence_threshold) {
                continue;
            }

            detection.left = std::max(0.0F, (detection.left - info.pad_x) / info.scale);
            detection.top = std::max(0.0F, (detection.top - info.pad_y) / info.scale);
            detection.right = std::min(static_cast<float>(image.cols), (detection.right - info.pad_x) / info.scale);
            detection.bottom = std::min(static_cast<float>(image.rows), (detection.bottom - info.pad_y) / info.scale);
            detections.push_back(detection);
        }

        return nonMaximumSuppression(std::move(detections), settings_.iou_threshold);
    }

    void drawDetections(cv::Mat& image, const std::vector<Detection>& detections) const {
        for (const auto& detection : detections) {
            cv::Scalar color(60, 180, 75);
            cv::rectangle(
                image,
                cv::Point(static_cast<int>(detection.left), static_cast<int>(detection.top)),
                cv::Point(static_cast<int>(detection.right), static_cast<int>(detection.bottom)),
                color,
                2
            );
            std::ostringstream label;
            label << defaultLabel(detection.class_id, labels_) << ' ' << std::fixed << std::setprecision(2) << detection.score;
            int baseline = 0;
            const auto text_size = cv::getTextSize(label.str(), cv::FONT_HERSHEY_SIMPLEX, 0.5, 1, &baseline);
            const int top = std::max(0, static_cast<int>(detection.top) - text_size.height - 8);
            cv::rectangle(
                image,
                cv::Point(static_cast<int>(detection.left), top),
                cv::Point(static_cast<int>(detection.left) + text_size.width + 8, top + text_size.height + baseline + 8),
                color,
                cv::FILLED
            );
            cv::putText(
                image,
                label.str(),
                cv::Point(static_cast<int>(detection.left) + 4, top + text_size.height + 2),
                cv::FONT_HERSHEY_SIMPLEX,
                0.5,
                cv::Scalar(255, 255, 255),
                1
            );
        }
    }

    Settings settings_;
    std::vector<std::string> labels_;
    TRTLogger logger_;
    RuntimePtr runtime_;
    EnginePtr engine_;
    ContextPtr context_;
    int input_index_ = -1;
    int output_index_ = -1;
    nvinfer1::Dims input_shape_{};
    nvinfer1::Dims output_shape_{};
    nvinfer1::DataType input_dtype_ = nvinfer1::DataType::kFLOAT;
    nvinfer1::DataType output_dtype_ = nvinfer1::DataType::kFLOAT;
    std::size_t input_size_ = 0;
    std::size_t output_size_ = 0;
    std::vector<float> input_planar_;
    std::vector<std::uint8_t> input_host_bytes_;
    std::vector<std::uint8_t> output_host_bytes_;
    void* input_device_ = nullptr;
    void* output_device_ = nullptr;
    cudaStream_t stream_ = nullptr;
};

void respondError(const std::string& request_id, const std::string& message) {
    std::cout << "ERR\t" << request_id << "\t" << message << std::endl;
}

}  // namespace

int main(int argc, char** argv) {
    try {
        const Settings settings = parseSettings(argc, argv);
        TensorRTYoloRunner runner(settings);

        std::string line;
        while (std::getline(std::cin, line)) {
            if (line.empty()) {
                continue;
            }
            const auto parts = split(line, '\t');
            if (parts.size() < 4 || parts[0] != "INFER") {
                respondError(parts.size() > 1 ? parts[1] : "unknown", "invalid request");
                continue;
            }
            const std::string& request_id = parts[1];
            const std::string& input_path = parts[2];
            const std::string& annotated_path = parts[3];
            try {
                const auto [detections, latency_ms] = runner.infer(input_path, annotated_path);
                std::cout << "OK\t" << request_id << "\t" << latency_ms << "\t"
                          << formatDetections(detections, runner.labels()) << std::endl;
            } catch (const std::exception& err) {
                respondError(request_id, err.what());
            }
        }
        return 0;
    } catch (const std::exception& err) {
        std::cerr << err.what() << std::endl;
        return 1;
    }
}
