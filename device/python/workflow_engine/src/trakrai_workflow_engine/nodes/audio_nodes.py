from __future__ import annotations

from typing import Any

from ..models import NodeCategory, PortDefinition, t_boolean, t_number, t_string
from ..registry import register_node
from ..types import (
    NodeInputs,
    NodeOutputs,
    get_detection_metadata_from_inputs,
    get_service_bridge_from_inputs,
)


@register_node(
    node_type_id="play-audio-message",
    display_name="Play Audio Message",
    category=NodeCategory.ACTION,
    inputs=[
        PortDefinition(name="message", type_schema=t_string(), required=False, port_type="both"),
        PortDefinition(name="language", type_schema=t_string(), default="en", required=False, port_type="config"),
        PortDefinition(name="playLocal", type_schema=t_boolean(), default=True, required=False, port_type="config"),
        PortDefinition(name="playSpeaker", type_schema=t_boolean(), default=False, required=False, port_type="config"),
        PortDefinition(name="speakerAddress", type_schema=t_string(), default="", required=False, port_type="both"),
        PortDefinition(name="speakerMessageId", type_schema=t_string(), default="", required=False, port_type="both"),
        PortDefinition(name="speakerCode", type_schema=t_string(), default="", required=False, port_type="both"),
        PortDefinition(name="cameraId", type_schema=t_string(), default="", required=False, port_type="both"),
        PortDefinition(name="dedupeKey", type_schema=t_string(), default="", required=False, port_type="config"),
        PortDefinition(name="waitTimeoutSec", type_schema=t_number(), default=5, required=False, port_type="config"),
    ],
    outputs=[
        PortDefinition(name="queued", type_schema=t_boolean()),
        PortDefinition(name="state", type_schema=t_string()),
        PortDefinition(name="jobId", type_schema=t_string()),
    ],
    description="Queue an audio playback request. Camera metadata is inferred from the workflow context unless cameraId is overridden.",
)
def play_audio_message(inputs: NodeInputs) -> NodeOutputs:
    service_bridge = get_service_bridge_from_inputs(inputs)
    if service_bridge is None:
        raise RuntimeError("workflow execution context does not include a service bridge")

    detection_metadata = get_detection_metadata_from_inputs(inputs)
    request_payload = {
        "cameraId": _string(inputs.get("cameraId")) or detection_metadata["cameraId"],
        "cameraName": detection_metadata["cameraName"],
        "dedupeKey": _string(inputs.get("dedupeKey")),
        "language": _string(inputs.get("language")) or "en",
        "message": _string(inputs.get("message")),
        "text": _string(inputs.get("message")),
        "playLocal": _bool(inputs.get("playLocal"), default=True),
        "playSpeaker": _bool(inputs.get("playSpeaker"), default=False),
        "speakerAddress": _string(inputs.get("speakerAddress")),
        "speakerCode": _string(inputs.get("speakerCode")),
        "speakerMessageId": _string(inputs.get("speakerMessageId")),
    }
    timeout_sec = _float(inputs.get("waitTimeoutSec"), default=5.0)
    response = service_bridge.request(
        target_service="audio-manager",
        message_type="play-audio",
        payload=request_payload,
        expected_types={"audio-manager-job", "audio-manager-error"},
        timeout_sec=max(1.0, timeout_sec),
    )

    if response["type"] == "audio-manager-error":
        raise RuntimeError(str(response["payload"].get("error", "audio-manager request failed")))

    job = response["payload"].get("job")
    if not isinstance(job, dict):
        raise RuntimeError("audio-manager response did not include a job payload")

    state = str(job.get("state", "")).strip()
    return {
        "queued": state in {"queued", "processing", "completed", "deduped"},
        "state": state,
        "jobId": str(job.get("id", "")).strip(),
    }


def _string(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="ignore").strip()
    if isinstance(value, (str, int, float)):
        return str(value).strip()
    raise TypeError(f"play-audio-message expected a string-like value, got {type(value).__name__}")


def _bool(value: Any, *, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "on"}:
            return True
        if normalized in {"0", "false", "no", "off"}:
            return False
    raise TypeError(f"play-audio-message expected a boolean-like value, got {type(value).__name__}")


def _float(value: Any, *, default: float) -> float:
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str) and value.strip():
        return float(value.strip())
    raise TypeError(f"play-audio-message expected a number-like value, got {type(value).__name__}")
