from __future__ import annotations

import json
from pathlib import Path

from ai_inference.config import load_config


def test_load_config_accepts_self_contained_runtime_settings(tmp_path: Path) -> None:
    weights_path = tmp_path / "primary.engine"
    weights_path.write_bytes(b"engine")

    config_path = tmp_path / "ai-inference.json"
    config_path.write_text(
        json.dumps(
            {
                "log_level": "info",
                "redis": {
                    "host": "localhost",
                    "port": 6379,
                    "password": "",
                    "db": 0,
                    "key_prefix": "camera",
                },
                "inference": {
                    "device": "0",
                    "poll_interval_ms": 5,
                    "idle_sleep_ms": 40,
                    "min_brightness": 25,
                    "processed_images_maxlen": 10,
                    "inference_image_size": [512, 512],
                    "confidence_threshold": 0.5,
                    "iou_threshold": 0.75,
                    "fp16_inference": True,
                    "models": [
                        {
                            "weights_path": "primary.engine",
                            "allowed_detections": "*",
                        }
                    ],
                },
                "cameras": [
                    {"id": 1, "name": "Camera-1", "enabled": True},
                ],
            }
        ),
        encoding="utf-8",
    )

    config = load_config(config_path)

    assert config.inference.device == "0"
    assert config.inference.models[0].weights_path == str(weights_path.resolve())
    assert config.cameras[0].name == "Camera-1"


def test_load_config_normalizes_multi_model_allowed_detection_filters(tmp_path: Path) -> None:
    primary_weights = tmp_path / "primary.engine"
    ppe_weights = tmp_path / "ppe.pt"
    fire_weights = tmp_path / "fire.onnx"
    primary_weights.write_bytes(b"engine")
    ppe_weights.write_bytes(b"pt")
    fire_weights.write_bytes(b"onnx")

    config_path = tmp_path / "ai-inference.json"
    config_path.write_text(
        json.dumps(
            {
                "redis": {
                    "host": "localhost",
                    "port": 6379,
                    "password": "",
                    "db": 0,
                    "key_prefix": "camera",
                },
                "inference": {
                    "device": "0",
                    "models": [
                        {
                            "weights_path": "primary.engine",
                            "allowed_detections": ["Person", "Car", "Truck"],
                        },
                        {
                            "weights_path": "ppe.pt",
                            "allowed_detections": "Helmet",
                        },
                        {
                            "weights_path": "fire.onnx",
                            "allowed_detections": ["Fire", "Smoke"],
                        },
                    ],
                },
                "cameras": [
                    {"id": 1, "name": "Camera-1", "enabled": True},
                ],
            }
        ),
        encoding="utf-8",
    )

    config = load_config(config_path)

    assert config.inference.models[0].allowed_detections == ["person", "car", "truck"]
    assert config.inference.models[1].allowed_detections == ["helmet"]
    assert config.inference.models[2].allowed_detections == ["fire", "smoke"]
