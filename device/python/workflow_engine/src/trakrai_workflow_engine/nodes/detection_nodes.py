from __future__ import annotations

from typing import Any

from ..models import NodeCategory, PortDefinition, t_array, t_boolean, t_number, t_object, t_record, t_string
from ..registry import register_node
from ..types import Detection, NodeInputs, NodeOutputs, WorkflowPayload, get_detection_data_from_inputs

_DETECTION_BBOX = t_object(
    {
        "label": t_string(),
        "conf": t_number(),
        "raw_bboxes": t_array(t_number(), description="[x1, y1, x2, y2]"),
    },
    required=["label", "conf"],
)


@register_node(
    node_type_id="detection-input",
    display_name="Detection Input",
    category=NodeCategory.TRIGGER,
    outputs=[
        PortDefinition(name="detections", type_schema=t_array(_DETECTION_BBOX)),
        PortDefinition(name="classCount", type_schema=t_record(t_number())),
        PortDefinition(name="cameraId", type_schema=t_string()),
        PortDefinition(name="imageId", type_schema=t_string()),
        PortDefinition(name="hasDetections", type_schema=t_boolean()),
    ],
    description="Entry point that extracts detection data from the workflow submission context.",
)
def detection_input(inputs: NodeInputs) -> NodeOutputs:
    data = get_detection_data_from_inputs(inputs)

    detections_raw = data.get("bbox", [])
    if not isinstance(detections_raw, list):
        raise TypeError("detection-input: '__context__.detection_data.bbox' must be a list.")
    detections = detections_raw

    class_count_raw = data.get("DetectionPerClass", {}) or {}
    if not isinstance(class_count_raw, dict):
        raise TypeError("detection-input: '__context__.detection_data.DetectionPerClass' must be an object.")

    return {
        "detections": detections,
        "classCount": class_count_raw,
        "cameraId": _payload_str(data, "cam_id", "cameraId"),
        "imageId": _payload_str(data, "imgID", "imageId", "frame_id"),
        "hasDetections": len(detections) > 0,
    }


@register_node(
    node_type_id="get-detections",
    display_name="Get Detections",
    category=NodeCategory.DATA_SOURCE,
    outputs=[
        PortDefinition(name="detections", type_schema=t_array(_DETECTION_BBOX)),
        PortDefinition(name="count", type_schema=t_number()),
        PortDefinition(name="classCount", type_schema=t_record(t_number())),
        PortDefinition(name="hasDetections", type_schema=t_boolean()),
    ],
    description="Returns the raw detection list for the current frame payload.",
)
def get_detections(inputs: NodeInputs) -> NodeOutputs:
    result = detection_input(inputs)
    detections = result["detections"]
    return {
        "detections": detections,
        "count": len(detections),
        "classCount": result["classCount"],
        "hasDetections": result["hasDetections"],
    }


@register_node(
    node_type_id="get-camera-id",
    display_name="Get Camera ID",
    category=NodeCategory.DATA_SOURCE,
    outputs=[
        PortDefinition(name="cameraId", type_schema=t_string()),
        PortDefinition(name="cameraName", type_schema=t_string()),
        PortDefinition(name="imageId", type_schema=t_string()),
    ],
    description="Returns camera metadata from the current workflow submission.",
)
def get_camera_id(inputs: NodeInputs) -> NodeOutputs:
    result = detection_input(inputs)
    detection_data = get_detection_data_from_inputs(inputs)
    return {
        "cameraId": result["cameraId"],
        "cameraName": _payload_str(detection_data, "cam_name", "cameraName"),
        "imageId": result["imageId"],
    }


def _payload_str(data: WorkflowPayload | dict[str, Any], *keys: str) -> str:
    for key in keys:
        raw = data.get(key)
        if raw is None:
            continue
        if isinstance(raw, bytes):
            return raw.decode("utf-8", errors="ignore")
        if isinstance(raw, (str, int, float)):
            return str(raw)
        raise TypeError(f"detection-input: '__context__.detection_data.{key}' must be string-like.")
    return ""
