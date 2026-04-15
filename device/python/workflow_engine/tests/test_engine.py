from __future__ import annotations

from trakrai_workflow_engine.engine import WorkflowEngine
from trakrai_workflow_engine import nodes  # noqa: F401
from trakrai_workflow_engine.payloads import normalize_detection_request


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
