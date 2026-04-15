#include <algorithm>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <map>
#include <numeric>
#include <vector>

#include <cuda_fp16.h>

#include "nvdsinfer_custom_impl.h"

namespace {

constexpr float kDefaultNMSThreshold = 0.45f;

float clampf(float value, float minValue, float maxValue) {
    return std::max(minValue, std::min(value, maxValue));
}

float readTensorValue(const NvDsInferLayerInfo& layer, std::size_t index) {
    switch (layer.dataType) {
        case NvDsInferDataType::FLOAT:
            return static_cast<const float*>(layer.buffer)[index];
        case NvDsInferDataType::HALF:
            return __half2float(static_cast<const __half*>(layer.buffer)[index]);
        case NvDsInferDataType::INT8:
            return static_cast<float>(static_cast<const int8_t*>(layer.buffer)[index]);
        case NvDsInferDataType::INT32:
            return static_cast<float>(static_cast<const int32_t*>(layer.buffer)[index]);
        default:
            return 0.0f;
    }
}

std::size_t tensorRows(const NvDsInferDims& dims) {
    if (dims.numDims <= 0) {
        return 0;
    }
    std::size_t rows = 1;
    for (int index = 0; index < dims.numDims - 1; ++index) {
        rows *= static_cast<std::size_t>(dims.d[index]);
    }
    return rows;
}

std::size_t tensorColumns(const NvDsInferDims& dims) {
    if (dims.numDims <= 0) {
        return 0;
    }
    return static_cast<std::size_t>(dims.d[dims.numDims - 1]);
}

float thresholdForClass(const NvDsInferParseDetectionParams& params, int classId) {
    if (classId >= 0 && classId < static_cast<int>(params.perClassPreclusterThreshold.size())) {
        return params.perClassPreclusterThreshold[classId];
    }
    return 0.25f;
}

float iou(const NvDsInferParseObjectInfo& left, const NvDsInferParseObjectInfo& right) {
    const float x1 = std::max(left.left, right.left);
    const float y1 = std::max(left.top, right.top);
    const float x2 = std::min(left.left + left.width, right.left + right.width);
    const float y2 = std::min(left.top + left.height, right.top + right.height);

    const float intersectionWidth = std::max(0.0f, x2 - x1);
    const float intersectionHeight = std::max(0.0f, y2 - y1);
    const float intersectionArea = intersectionWidth * intersectionHeight;
    const float unionArea = left.width * left.height + right.width * right.height - intersectionArea;
    if (unionArea <= 0.0f) {
        return 0.0f;
    }
    return intersectionArea / unionArea;
}

void nonMaximumSuppress(
    const std::vector<NvDsInferParseObjectInfo>& candidates,
    float threshold,
    std::vector<NvDsInferParseObjectInfo>& output
) {
    std::vector<NvDsInferParseObjectInfo> sorted = candidates;
    std::sort(sorted.begin(), sorted.end(), [](const auto& left, const auto& right) {
        return left.detectionConfidence > right.detectionConfidence;
    });

    std::vector<bool> removed(sorted.size(), false);
    for (std::size_t index = 0; index < sorted.size(); ++index) {
        if (removed[index]) {
            continue;
        }
        output.push_back(sorted[index]);
        for (std::size_t inner = index + 1; inner < sorted.size(); ++inner) {
            if (removed[inner]) {
                continue;
            }
            if (iou(sorted[index], sorted[inner]) > threshold) {
                removed[inner] = true;
            }
        }
    }
}

}  // namespace

extern "C" bool NvDsInferParseCustomYoloV5(
    std::vector<NvDsInferLayerInfo> const& outputLayersInfo,
    NvDsInferNetworkInfo const& networkInfo,
    NvDsInferParseDetectionParams const& detectionParams,
    std::vector<NvDsInferParseObjectInfo>& objectList
) {
    if (outputLayersInfo.empty()) {
        std::cerr << "YOLOv5 parser: no output layers" << std::endl;
        return false;
    }

    const NvDsInferLayerInfo* detectionLayer = nullptr;
    std::size_t bestColumns = 0;
    for (const auto& layer : outputLayersInfo) {
        const auto columns = tensorColumns(layer.inferDims);
        if (columns > bestColumns) {
            bestColumns = columns;
            detectionLayer = &layer;
        }
    }
    if (detectionLayer == nullptr) {
        std::cerr << "YOLOv5 parser: detection layer not found" << std::endl;
        return false;
    }

    const std::size_t rows = tensorRows(detectionLayer->inferDims);
    const std::size_t columns = tensorColumns(detectionLayer->inferDims);
    if (rows == 0 || columns < 6) {
        std::cerr << "YOLOv5 parser: unexpected tensor dims rows=" << rows << " columns=" << columns << std::endl;
        return false;
    }

    std::map<int, std::vector<NvDsInferParseObjectInfo>> perClass;
    for (std::size_t row = 0; row < rows; ++row) {
        const std::size_t rowOffset = row * columns;
        const float objectness = readTensorValue(*detectionLayer, rowOffset + 4);
        if (objectness <= 0.0f) {
            continue;
        }

        int bestClass = -1;
        float bestClassScore = 0.0f;
        for (std::size_t classOffset = 5; classOffset < columns; ++classOffset) {
            const int classId = static_cast<int>(classOffset - 5);
            if (classId >= static_cast<int>(detectionParams.numClassesConfigured)) {
                break;
            }
            const float classScore = readTensorValue(*detectionLayer, rowOffset + classOffset);
            if (classScore > bestClassScore) {
                bestClassScore = classScore;
                bestClass = classId;
            }
        }
        if (bestClass < 0) {
            continue;
        }

        const float confidence = objectness * bestClassScore;
        if (confidence < thresholdForClass(detectionParams, bestClass)) {
            continue;
        }

        const float xCenter = readTensorValue(*detectionLayer, rowOffset + 0);
        const float yCenter = readTensorValue(*detectionLayer, rowOffset + 1);
        const float width = readTensorValue(*detectionLayer, rowOffset + 2);
        const float height = readTensorValue(*detectionLayer, rowOffset + 3);

        NvDsInferParseObjectInfo object{};
        object.left = clampf(xCenter - (width * 0.5f), 0.0f, static_cast<float>(networkInfo.width - 1));
        object.top = clampf(yCenter - (height * 0.5f), 0.0f, static_cast<float>(networkInfo.height - 1));
        object.width = clampf(width, 0.0f, static_cast<float>(networkInfo.width) - object.left);
        object.height = clampf(height, 0.0f, static_cast<float>(networkInfo.height) - object.top);
        object.classId = bestClass;
        object.detectionConfidence = confidence;

        if (object.width < 1.0f || object.height < 1.0f) {
            continue;
        }

        perClass[bestClass].push_back(object);
    }

    for (auto& entry : perClass) {
        nonMaximumSuppress(entry.second, kDefaultNMSThreshold, objectList);
    }
    return true;
}

CHECK_CUSTOM_PARSE_FUNC_PROTOTYPE(NvDsInferParseCustomYoloV5);
