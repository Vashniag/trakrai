from __future__ import annotations

from typing import Any, Callable, Dict, Mapping, Optional, Protocol, TypedDict, cast

NodeInputs = Dict[str, Any]
NodeOutputs = Dict[str, Any]
NodeFunction = Callable[[NodeInputs], NodeOutputs]


class ServiceBridgeProtocol(Protocol):
    def request(
        self,
        *,
        target_service: str,
        message_type: str,
        payload: dict[str, Any],
        expected_types: set[str],
        timeout_sec: float,
    ) -> dict[str, Any]: ...

    def publish(
        self,
        *,
        subtopic: str,
        message_type: str,
        payload: dict[str, Any],
        timeout_sec: float,
    ) -> None: ...


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


class DetectionMetadata(TypedDict):
    cameraId: str
    cameraName: str
    imageId: str


class ExecutionContext(TypedDict, total=False):
    detection_data: WorkflowPayload
    service_bridge: ServiceBridgeProtocol


def get_detection_data_from_inputs(inputs: NodeInputs) -> WorkflowPayload:
    raw_ctx = _get_execution_context(inputs)
    raw_payload = raw_ctx.get("detection_data", {})
    if not isinstance(raw_payload, dict):
        return cast(WorkflowPayload, {})

    return cast(WorkflowPayload, raw_payload)


def get_service_bridge_from_inputs(inputs: NodeInputs) -> Optional[ServiceBridgeProtocol]:
    raw_ctx = _get_execution_context(inputs)
    raw_bridge = raw_ctx.get("service_bridge")
    return cast(Optional[ServiceBridgeProtocol], raw_bridge)


def get_detection_metadata_from_inputs(inputs: NodeInputs) -> DetectionMetadata:
    return get_detection_metadata(get_detection_data_from_inputs(inputs))


def get_detection_metadata(payload: Mapping[str, Any]) -> DetectionMetadata:
    return {
        "cameraId": _mapping_string(payload, "cam_id", "cameraId"),
        "cameraName": _mapping_string(payload, "cam_name", "cameraName"),
        "imageId": _mapping_string(payload, "imgID", "imageId", "frame_id"),
    }


def _get_execution_context(inputs: NodeInputs) -> ExecutionContext:
    raw_ctx = inputs.get("__context__", {})
    if not isinstance(raw_ctx, dict):
        return cast(ExecutionContext, {})
    return cast(ExecutionContext, raw_ctx)


def _mapping_string(payload: Mapping[str, Any], *keys: str) -> str:
    for key in keys:
        value = payload.get(key)
        if value is None:
            continue
        if isinstance(value, bytes):
            return value.decode("utf-8", errors="ignore").strip()
        if isinstance(value, (str, int, float)):
            return str(value).strip()
    return ""
