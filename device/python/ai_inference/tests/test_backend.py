from __future__ import annotations

import logging

from ai_inference.backend import RuntimeBindings, build_inference_server
from ai_inference.config import InferenceConfig, ModelConfig


class _FakeServerBatch:
    def __init__(self, weights, redis_connection=None, device=None, common_config=None, **kwargs) -> None:  # type: ignore[no-untyped-def]
        self.weights = weights
        self.redis_connection = redis_connection
        self.device = device
        self.common_config = common_config
        self.kwargs = kwargs
        self.set_device_calls: list[str] = []
        self.names = {0: "person"}
        self.stride = 32
        self.pt = False

    def set_device(self, value: str) -> None:
        self.set_device_calls.append(value)

    def warmup(self, imgsz=None) -> None:  # type: ignore[no-untyped-def]
        self.warmup_imgsz = imgsz


class _FakeCuda:
    @staticmethod
    def is_available() -> bool:
        return False

    @staticmethod
    def empty_cache() -> None:
        return None


class _FakeTorch:
    cuda = _FakeCuda()

    @staticmethod
    def cat(parts, dim):  # type: ignore[no-untyped-def]
        return ("cat", parts, dim)

    @staticmethod
    def stack(parts):  # type: ignore[no-untyped-def]
        return ("stack", parts)


def test_build_inference_server_wires_models() -> None:
    bindings = RuntimeBindings(
        torch=_FakeTorch(),
        DetectMultiBackend=_FakeServerBatch,
        letterbox=lambda image, imgsz, stride, auto=True: (image, None, None),
        check_img_size=lambda imgsz, s=32: list(imgsz),
        non_max_suppression=lambda *args, **kwargs: [],
        scale_coords=lambda *args, **kwargs: args[1],
        select_device=lambda value: value,
    )
    config = InferenceConfig(
        device="0",
        poll_interval_ms=5,
        idle_sleep_ms=40,
        min_brightness=25.0,
        processed_images_maxlen=10,
        inference_image_size=(512, 512),
        confidence_threshold=0.5,
        iou_threshold=0.75,
        fp16_inference=True,
        models=(
            ModelConfig(weights_path="/models/primary.engine", allowed_detections="*"),
            ModelConfig(weights_path="/models/ppe.pt", allowed_detections=["helmet", "vest"]),
        ),
    )

    server = build_inference_server(config, logging.getLogger("test"), bindings=bindings)

    assert server.device == "cuda:0"
    assert set(server.models.keys()) == {"primary.engine", "ppe.pt"}
    assert list(server.allowed_detections_per_model.items()) == [
        ("primary.engine", "*"),
        ("ppe.pt", ["helmet", "vest"]),
    ]
    assert server._resolved_imgsz == (512, 512)
