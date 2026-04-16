from __future__ import annotations

from trakrai_workflow_engine.engine import WorkflowEngine
from trakrai_workflow_engine import nodes  # noqa: F401
from trakrai_workflow_engine.payloads import normalize_detection_request


class _FakeServiceBridge:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def request(
        self,
        *,
        target_service: str,
        message_type: str,
        payload: dict[str, object],
        expected_types: set[str],
        timeout_sec: float,
    ) -> dict[str, object]:
        self.calls.append(
            {
                "expectedTypes": expected_types,
                "messageType": message_type,
                "payload": payload,
                "targetService": target_service,
                "timeoutSec": timeout_sec,
            }
        )
        return {
            "sourceService": "audio-manager",
            "type": "audio-manager-job",
            "payload": {
                "requestId": "audio-1",
                "job": {
                    "id": "job-1",
                    "state": "queued",
                },
            },
        }


def test_engine_executes_minimal_detection_workflow() -> None:
    workflow = {
        "metadata": {"name": "Minimal detection workflow"},
        "nodes": [
            {
                "id": "camera",
                "type": "get-camera-id",
                "position": {"x": 0, "y": 0},
                "data": {"label": "Camera", "configuration": {}},
            },
            {
                "id": "detections",
                "type": "get-detections",
                "position": {"x": 0, "y": 100},
                "data": {"label": "Detections", "configuration": {}},
            },
        ],
        "edges": [],
    }
    payload = normalize_detection_request(
        {
            "cameraId": "1",
            "cameraName": "Camera-1",
            "frameId": "frame-1",
            "detections": [
                {"label": "person", "confidence": 0.92, "bbox": [10, 20, 30, 40]},
                {"label": "helmet", "confidence": 0.81, "bbox": [11, 21, 31, 41]},
            ],
        }
    ).payload

    engine = WorkflowEngine(max_workers=2)
    engine.load_workflow(workflow)
    result = engine.execute(detection_data=payload)

    assert result.success is True
    assert result.outputs["camera"]["cameraId"] == "1"
    assert result.outputs["camera"]["cameraName"] == "Camera-1"
    assert result.outputs["detections"]["count"] == 2
    assert result.outputs["detections"]["classCount"] == {"person": 1, "helmet": 1}


def test_engine_surfaces_bad_detection_payload_errors() -> None:
    workflow = {
        "nodes": [
            {
                "id": "source",
                "type": "get-detections",
                "position": {"x": 0, "y": 0},
                "data": {"label": "Detections", "configuration": {}},
            }
        ],
        "edges": [],
    }

    engine = WorkflowEngine()
    engine.load_workflow(workflow)
    result = engine.execute(detection_data={"bbox": "bad"})

    assert result.success is False
    assert result.node_results["source"].status.value == "failed"
    assert "bbox" in (result.node_results["source"].error or "")


def test_engine_executes_audio_action_node_through_service_bridge() -> None:
    workflow = {
        "metadata": {"name": "Audio workflow"},
        "nodes": [
            {
                "id": "audio",
                "type": "play-audio-message",
                "position": {"x": 0, "y": 0},
                "data": {
                    "label": "Audio",
                    "configuration": {
                        "message": "Person detected",
                        "playLocal": True,
                        "playSpeaker": True,
                        "speakerCode": "901",
                    },
                },
            },
        ],
        "edges": [],
    }
    payload = normalize_detection_request(
        {
            "cameraId": "1",
            "cameraName": "Camera-1",
            "frameId": "frame-1",
            "detections": [{"label": "person", "confidence": 0.92, "bbox": [10, 20, 30, 40]}],
        }
    ).payload
    bridge = _FakeServiceBridge()

    engine = WorkflowEngine(max_workers=2)
    engine.load_workflow(workflow)
    result = engine.execute(detection_data=payload, context_overrides={"service_bridge": bridge})

    assert result.success is True
    assert result.outputs["audio"]["queued"] is True
    assert result.outputs["audio"]["jobId"] == "job-1"
    assert bridge.calls[0]["targetService"] == "audio-manager"
    assert bridge.calls[0]["payload"]["cameraId"] == "1"
    assert bridge.calls[0]["payload"]["cameraName"] == "Camera-1"
