from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from ..models import NodeCategory, PortDefinition, t_any, t_boolean, t_number, t_string
from ..node_support import bool_value, float_value, int_value, parse_frame_time, sanitize_path_component, string_value
from ..registry import register_node
from ..types import (
    NodeInputs,
    NodeOutputs,
    get_detection_data_from_inputs,
    get_detection_metadata_from_inputs,
    get_service_bridge_from_inputs,
)


@register_node(
    node_type_id="send-violation-to-cloud",
    display_name="Send Violation To Cloud",
    category=NodeCategory.ACTION,
    inputs=[
        PortDefinition(name="detections", type_schema=t_any(), required=False, port_type="both"),
        PortDefinition(name="includeDetections", type_schema=t_boolean(), default=True, required=False, port_type="config"),
        PortDefinition(name="photoEnabled", type_schema=t_boolean(), default=True, required=False, port_type="config"),
        PortDefinition(name="videoEnabled", type_schema=t_boolean(), default=True, required=False, port_type="config"),
        PortDefinition(name="preSeconds", type_schema=t_number(), default=5, required=False, port_type="config"),
        PortDefinition(name="postSeconds", type_schema=t_number(), default=5, required=False, port_type="config"),
        PortDefinition(name="frameRate", type_schema=t_number(), default=10, required=False, port_type="config"),
        PortDefinition(name="remotePrefix", type_schema=t_string(), default="violations", required=False, port_type="config"),
        PortDefinition(name="localPrefix", type_schema=t_string(), default="violations", required=False, port_type="config"),
        PortDefinition(name="uploadTimeout", type_schema=t_string(), default="", required=False, port_type="config"),
        PortDefinition(name="violationType", type_schema=t_string(), default="workflow-violation", required=False, port_type="config"),
        PortDefinition(name="waitTimeoutSec", type_schema=t_number(), default=5, required=False, port_type="config"),
    ],
    outputs=[
        PortDefinition(name="eventPublished", type_schema=t_boolean()),
        PortDefinition(name="queued", type_schema=t_boolean()),
        PortDefinition(name="photoLocalPath", type_schema=t_string()),
        PortDefinition(name="photoRemotePath", type_schema=t_string()),
        PortDefinition(name="photoTransferId", type_schema=t_string()),
        PortDefinition(name="videoJobId", type_schema=t_string()),
        PortDefinition(name="videoLocalPath", type_schema=t_string()),
        PortDefinition(name="videoRemotePath", type_schema=t_string()),
        PortDefinition(name="violationId", type_schema=t_string()),
    ],
    description="Publish a cloud-facing violation event, upload a photo immediately, and queue buffered video recording/upload.",
)
def send_violation_to_cloud(inputs: NodeInputs) -> NodeOutputs:
    service_bridge = get_service_bridge_from_inputs(inputs)
    if service_bridge is None:
        raise RuntimeError("workflow execution context does not include a service bridge")

    detection_metadata = get_detection_metadata_from_inputs(inputs)
    detection_data = get_detection_data_from_inputs(inputs)
    detections = _coerce_detections(inputs.get("detections"), detection_data.get("bbox", []))

    include_detections = bool_value(inputs.get("includeDetections"), default=True)
    photo_enabled = bool_value(inputs.get("photoEnabled"), default=True)
    video_enabled = bool_value(inputs.get("videoEnabled"), default=True)
    pre_seconds = max(0.0, float_value(inputs.get("preSeconds"), default=5.0))
    post_seconds = max(0.0, float_value(inputs.get("postSeconds"), default=5.0))
    frame_rate = max(1, int_value(inputs.get("frameRate"), default=10))
    wait_timeout_sec = max(1.0, float_value(inputs.get("waitTimeoutSec"), default=5.0))
    upload_timeout = string_value(inputs.get("uploadTimeout"))
    violation_type = string_value(inputs.get("violationType")) or "workflow-violation"

    image_id = detection_metadata["imageId"] or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")
    event_time = parse_frame_time(image_id) or datetime.now(timezone.utc)
    date_prefix = event_time.strftime("%Y/%m/%d")
    camera_id = detection_metadata["cameraId"] or "unknown-camera"
    camera_name = detection_metadata["cameraName"] or camera_id
    camera_slug = sanitize_path_component(camera_name or camera_id, fallback="camera")
    violation_id = uuid4().hex

    remote_prefix = _normalize_prefix(string_value(inputs.get("remotePrefix"), default="violations"))
    local_prefix = _normalize_prefix(string_value(inputs.get("localPrefix"), default="violations"))
    asset_prefix = f"{camera_slug}/{date_prefix}/{violation_id}"

    photo_remote_path = f"{remote_prefix}/{asset_prefix}/photo.jpg" if photo_enabled else ""
    video_remote_path = f"{remote_prefix}/{asset_prefix}/clip.mp4" if video_enabled else ""
    photo_local_path = f"{local_prefix}/{asset_prefix}/photo.jpg" if photo_enabled else ""
    video_local_path = f"{local_prefix}/{asset_prefix}/clip.mp4" if video_enabled else ""

    event_payload = {
        "cameraId": camera_id,
        "cameraName": camera_name,
        "imageId": image_id,
        "photo": {"enabled": photo_enabled, "remotePath": photo_remote_path},
        "video": {
            "enabled": video_enabled,
            "frameRate": frame_rate,
            "postSeconds": post_seconds,
            "preSeconds": pre_seconds,
            "remotePath": video_remote_path,
        },
        "timestamp": event_time.isoformat(),
        "type": violation_type,
        "violationId": violation_id,
    }
    if include_detections:
        event_payload["detections"] = detections

    service_bridge.publish(
        subtopic="event",
        message_type="violation-created",
        payload=event_payload,
        timeout_sec=wait_timeout_sec,
    )

    metadata = {
        "cameraId": camera_id,
        "cameraName": camera_name,
        "imageId": image_id,
        "violationId": violation_id,
        "violationType": violation_type,
    }

    photo_transfer_id = ""
    if photo_enabled:
        photo_capture = service_bridge.request(
            target_service="video-recorder",
            message_type="capture-photo",
            payload={
                "cameraId": camera_id,
                "cameraName": camera_name,
                "imageId": image_id,
                "localPath": photo_local_path,
            },
            expected_types={"video-recorder-photo", "video-recorder-error"},
            timeout_sec=wait_timeout_sec,
        )
        if photo_capture["type"] == "video-recorder-error":
            raise RuntimeError(str(photo_capture["payload"].get("error", "video-recorder photo capture failed")))

        photo = photo_capture["payload"].get("photo")
        if not isinstance(photo, dict):
            raise RuntimeError("video-recorder photo response did not include a photo payload")

        photo_local_path = string_value(photo.get("localPath"))
        transfer = service_bridge.request(
            target_service="cloud-transfer",
            message_type="enqueue-upload",
            payload={
                "contentType": "image/jpeg",
                "localPath": photo_local_path,
                "metadata": {**metadata, "assetType": "photo"},
                "remotePath": photo_remote_path,
                "scope": "device",
                "timeout": upload_timeout,
            },
            expected_types={"cloud-transfer-transfer", "cloud-transfer-error"},
            timeout_sec=wait_timeout_sec,
        )
        if transfer["type"] == "cloud-transfer-error":
            raise RuntimeError(str(transfer["payload"].get("error", "photo upload enqueue failed")))
        transfer_payload = transfer["payload"].get("transfer")
        if not isinstance(transfer_payload, dict):
            raise RuntimeError("cloud-transfer response did not include a transfer payload")
        photo_transfer_id = string_value(transfer_payload.get("id"))

    video_job_id = ""
    if video_enabled:
        video_response = service_bridge.request(
            target_service="video-recorder",
            message_type="record-clip",
            payload={
                "cameraId": camera_id,
                "cameraName": camera_name,
                "contentType": "video/mp4",
                "frameRate": frame_rate,
                "imageId": image_id,
                "localPath": video_local_path,
                "metadata": {**metadata, "assetType": "video"},
                "postSeconds": post_seconds,
                "preSeconds": pre_seconds,
                "remotePath": video_remote_path,
                "scope": "device",
                "timeout": upload_timeout,
            },
            expected_types={"video-recorder-job", "video-recorder-error"},
            timeout_sec=wait_timeout_sec,
        )
        if video_response["type"] == "video-recorder-error":
            raise RuntimeError(str(video_response["payload"].get("error", "video-recorder clip enqueue failed")))
        job = video_response["payload"].get("job")
        if not isinstance(job, dict):
            raise RuntimeError("video-recorder response did not include a job payload")
        video_job_id = string_value(job.get("id"))
        video_local_path = string_value(job.get("localPath")) or video_local_path

    return {
        "eventPublished": True,
        "queued": photo_enabled or video_enabled,
        "photoLocalPath": photo_local_path,
        "photoRemotePath": photo_remote_path,
        "photoTransferId": photo_transfer_id,
        "videoJobId": video_job_id,
        "videoLocalPath": video_local_path,
        "videoRemotePath": video_remote_path,
        "violationId": violation_id,
    }


def _coerce_detections(value: Any, fallback: Any) -> list[dict[str, Any]]:
    source = value if value is not None else fallback
    if not isinstance(source, list):
        raise TypeError("send-violation-to-cloud expected detections to be a list")
    detections: list[dict[str, Any]] = []
    for item in source:
        if isinstance(item, dict):
            detections.append(dict(item))
    return detections


def _normalize_prefix(value: str) -> str:
    stripped = value.strip().replace("\\", "/").strip("/")
    if stripped == "":
        return "violations"
    parts = [sanitize_path_component(part, fallback="segment") for part in stripped.split("/") if part.strip()]
    return "/".join(parts) or "violations"
