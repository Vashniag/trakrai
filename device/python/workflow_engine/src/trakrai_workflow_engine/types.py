from __future__ import annotations

from typing import Any, Callable, Dict, TypedDict, cast

NodeInputs = Dict[str, Any]
NodeOutputs = Dict[str, Any]
NodeFunction = Callable[[NodeInputs], NodeOutputs]


class Detection(TypedDict, total=False):
    label: str
    class_name: str
    conf: float
    confidence: float
    raw_bboxes: list[float]
    bbox: list[float]
    xyxy: list[float]
    x1: float
    y1: float
    x2: float
    y2: float
    detections: list["Detection"]


class WorkflowPayload(TypedDict, total=False):
    bbox: list[Detection]
    DetectionPerClass: dict[str, int]
    cam_id: str
    cameraId: str
    cam_name: str
    cameraName: str
    frame_id: str
    imgID: str
    imageId: str


class ExecutionContext(TypedDict, total=False):
    detection_data: WorkflowPayload


def get_detection_data_from_inputs(inputs: NodeInputs) -> WorkflowPayload:
    raw_ctx = inputs.get("__context__", {})
    if not isinstance(raw_ctx, dict):
        return cast(WorkflowPayload, {})

    raw_payload = raw_ctx.get("detection_data", {})
    if not isinstance(raw_payload, dict):
        return cast(WorkflowPayload, {})

    return cast(WorkflowPayload, raw_payload)
