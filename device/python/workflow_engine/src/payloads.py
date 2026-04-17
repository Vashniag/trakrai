from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Mapping

from .types import Detection, WorkflowPayload


@dataclass(frozen=True)
class NormalizedDetectionRequest:
    request_id: str
    payload: WorkflowPayload


def normalize_detection_request(raw_payload: Mapping[str, Any]) -> NormalizedDetectionRequest:
    request_id = _string_value(raw_payload.get("requestId")) or f"wf-{int(time.time() * 1000)}"

    detection_data = raw_payload.get("detectionData")
    if isinstance(detection_data, Mapping):
        payload = dict(detection_data)
        bbox = payload.get("bbox", [])
        if not isinstance(bbox, list):
            raise ValueError("detectionData.bbox must be an array")
        payload["bbox"] = [_normalize_detection(item) for item in bbox]
        if "DetectionPerClass" not in payload or not isinstance(payload.get("DetectionPerClass"), dict):
            payload["DetectionPerClass"] = _count_by_label(payload["bbox"])
        return NormalizedDetectionRequest(request_id=request_id, payload=payload)

    camera_id = _string_value(raw_payload.get("cameraId")) or _string_value(raw_payload.get("cam_id"))
    camera_name = _string_value(raw_payload.get("cameraName")) or _string_value(raw_payload.get("cam_name"))
    frame_id = (
        _string_value(raw_payload.get("frameId"))
        or _string_value(raw_payload.get("imageId"))
        or _string_value(raw_payload.get("imgID"))
    )

    detections_raw = raw_payload.get("detections", raw_payload.get("bbox", []))
    if not isinstance(detections_raw, list):
        raise ValueError("detections must be an array")
    detections = [_normalize_detection(item) for item in detections_raw]

    class_counts = raw_payload.get("DetectionPerClass")
    if not isinstance(class_counts, dict):
        class_counts = _count_by_label(detections)

    payload: WorkflowPayload = {
        "bbox": detections,
        "DetectionPerClass": class_counts,
        "cam_id": camera_id,
        "cameraId": camera_id,
        "cam_name": camera_name,
        "cameraName": camera_name,
        "frame_id": frame_id,
        "imgID": frame_id,
        "imageId": frame_id,
    }
    return NormalizedDetectionRequest(request_id=request_id, payload=payload)


def _normalize_detection(value: Any) -> Detection:
    if not isinstance(value, Mapping):
        raise ValueError("each detection must be an object")

    label = _string_value(value.get("label")) or _string_value(value.get("class_name")) or "object"
    confidence = _float_value(value.get("conf"), fallback=None)
    if confidence is None:
        confidence = _float_value(value.get("confidence"), fallback=0.0)

    bbox = value.get("raw_bboxes")
    if bbox is None:
        bbox = value.get("bbox")
    if bbox is None:
        bbox = value.get("xyxy")
    if bbox is None:
        x1 = _float_value(value.get("x1"), fallback=None)
        y1 = _float_value(value.get("y1"), fallback=None)
        x2 = _float_value(value.get("x2"), fallback=None)
        y2 = _float_value(value.get("y2"), fallback=None)
        if None not in (x1, y1, x2, y2):
            bbox = [x1, y1, x2, y2]

    if not isinstance(bbox, list):
        bbox = []
    clean_bbox = _coerce_bbox(bbox)

    nested_raw = value.get("detections", [])
    nested: list[Detection] = []
    if isinstance(nested_raw, list):
        nested = [_normalize_detection(item) for item in nested_raw]

    detection: Detection = {
        "label": label,
        "class_name": label,
        "conf": float(confidence),
        "confidence": float(confidence),
        "raw_bboxes": clean_bbox,
        "bbox": clean_bbox,
        "xyxy": clean_bbox,
    }
    if len(clean_bbox) == 4:
        detection["x1"], detection["y1"], detection["x2"], detection["y2"] = clean_bbox
    if nested:
        detection["detections"] = nested
    return detection


def _count_by_label(detections: list[Detection]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for detection in detections:
        label = _string_value(detection.get("label")) or "object"
        counts[label] = counts.get(label, 0) + 1
    return counts


def _string_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace").strip()
    if isinstance(value, (str, int, float)):
        return str(value).strip()
    return ""


def _float_value(value: Any, *, fallback: float | None) -> float | None:
    if value is None or value == "":
        return fallback
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _coerce_bbox(value: Any) -> list[float]:
    if not isinstance(value, list):
        return []
    bbox: list[float] = []
    for item in value[:4]:
        parsed = _float_value(item, fallback=None)
        if parsed is None:
            continue
        bbox.append(parsed)
    return bbox
