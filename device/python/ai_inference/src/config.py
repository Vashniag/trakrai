from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from trakrai_service_runtime import (
    bool_value,
    float_value,
    int_value,
    load_json_object,
    require_object,
    resolve_path,
    string_value,
)


@dataclass(frozen=True)
class RedisConfig:
    host: str
    port: int
    password: str
    db: int
    key_prefix: str


@dataclass(frozen=True)
class ModelConfig:
    weights_path: str
    allowed_detections: str | list[str]


@dataclass(frozen=True)
class InferenceConfig:
    legacy_code_root: str
    device: str
    poll_interval_ms: int
    idle_sleep_ms: int
    min_brightness: float
    processed_images_maxlen: int
    inference_image_size: tuple[int, int]
    confidence_threshold: float
    iou_threshold: float
    fp16_inference: bool
    models: tuple[ModelConfig, ...]


@dataclass(frozen=True)
class CameraConfig:
    id: int
    name: str
    enabled: bool


@dataclass(frozen=True)
class ServiceConfig:
    log_level: str
    redis: RedisConfig
    inference: InferenceConfig
    cameras: tuple[CameraConfig, ...]


def load_config(path: str | Path) -> ServiceConfig:
    config_path, raw = load_json_object(path, label="ai-inference config")
    config_dir = config_path.parent

    log_level = string_value(raw.get("log_level"), default="info", field="log_level") or "info"

    redis_raw = require_object(raw.get("redis"), "redis")
    redis_cfg = RedisConfig(
        host=string_value(redis_raw.get("host"), default="localhost", field="redis.host") or "localhost",
        port=int_value(redis_raw.get("port"), default=6379, field="redis.port", minimum=1),
        password=string_value(redis_raw.get("password"), default="", field="redis.password"),
        db=int_value(redis_raw.get("db"), default=0, field="redis.db", minimum=0),
        key_prefix=string_value(redis_raw.get("key_prefix"), default="camera", field="redis.key_prefix") or "camera",
    )

    inference_raw = require_object(raw.get("inference"), "inference")
    legacy_code_root = string_value(inference_raw.get("legacy_code_root"), field="inference.legacy_code_root")
    if not legacy_code_root:
        raise ValueError("inference.legacy_code_root is required")

    legacy_path = resolve_path(
        config_dir,
        legacy_code_root,
        field="inference.legacy_code_root",
        required=True,
    )
    assert legacy_path is not None
    if not legacy_path.exists():
        raise ValueError(f"inference.legacy_code_root does not exist: {legacy_path}")
    if not (legacy_path / "server_batch.py").exists():
        raise ValueError(f"inference.legacy_code_root is missing server_batch.py: {legacy_path}")

    models_raw = inference_raw.get("models")
    if not models_raw:
        single_weights = str(inference_raw.get("weights_path", "")).strip()
        if single_weights:
            models_raw = [{"weights_path": single_weights, "allowed_detections": inference_raw.get("allowed_detections", "*")}]
    if not isinstance(models_raw, list) or not models_raw:
        raise ValueError("inference.models must contain at least one model")

    models: list[ModelConfig] = []
    for index, model_raw in enumerate(models_raw):
        model_dict = require_object(model_raw, f"inference.models[{index}]")
        weights_path = string_value(model_dict.get("weights_path"), field=f"inference.models[{index}].weights_path")
        if not weights_path:
            raise ValueError(f"inference.models[{index}].weights_path is required")
        allowed = model_dict.get("allowed_detections", "*")
        if isinstance(allowed, list):
            allowed = [str(item).strip().lower() for item in allowed if str(item).strip()]
            if not allowed:
                allowed = "*"
        elif isinstance(allowed, str):
            allowed = allowed.strip().lower() or "*"
            if allowed != "*":
                allowed = [allowed]
        else:
            raise ValueError(f"inference.models[{index}].allowed_detections must be a string or string array")
        models.append(
            ModelConfig(
                weights_path=str(resolve_path(config_dir, weights_path, field=f"inference.models[{index}].weights_path", required=True)),
                allowed_detections=allowed,
            )
        )

    image_size_raw = inference_raw.get("inference_image_size", [640, 640])
    if not isinstance(image_size_raw, list) or len(image_size_raw) != 2:
        raise ValueError("inference.inference_image_size must be a 2-item array")
    image_size = (
        int_value(image_size_raw[0], field="inference.inference_image_size[0]", minimum=1),
        int_value(image_size_raw[1], field="inference.inference_image_size[1]", minimum=1),
    )

    inference_cfg = InferenceConfig(
        legacy_code_root=str(legacy_path.resolve()),
        device=string_value(inference_raw.get("device"), default="0", field="inference.device") or "0",
        poll_interval_ms=int_value(
            inference_raw.get("poll_interval_ms"),
            default=35,
            field="inference.poll_interval_ms",
            minimum=1,
        ),
        idle_sleep_ms=int_value(
            inference_raw.get("idle_sleep_ms"),
            default=125,
            field="inference.idle_sleep_ms",
            minimum=1,
        ),
        min_brightness=float_value(
            inference_raw.get("min_brightness"),
            default=25.0,
            field="inference.min_brightness",
            minimum=0.0,
        ),
        processed_images_maxlen=int_value(
            inference_raw.get("processed_images_maxlen"),
            default=10,
            field="inference.processed_images_maxlen",
            minimum=1,
        ),
        inference_image_size=image_size,
        confidence_threshold=float_value(
            inference_raw.get("confidence_threshold"),
            default=0.5,
            field="inference.confidence_threshold",
            minimum=0.0,
            maximum=1.0,
        ),
        iou_threshold=float_value(
            inference_raw.get("iou_threshold"),
            default=0.75,
            field="inference.iou_threshold",
            minimum=0.0,
            maximum=1.0,
        ),
        fp16_inference=bool_value(
            inference_raw.get("fp16_inference"),
            default=False,
            field="inference.fp16_inference",
        ),
        models=tuple(models),
    )

    cameras_raw = raw.get("cameras")
    if not isinstance(cameras_raw, list) or not cameras_raw:
        raise ValueError("cameras must contain at least one configured camera")

    cameras: list[CameraConfig] = []
    seen_ids: set[int] = set()
    seen_names: set[str] = set()
    for index, camera_raw in enumerate(cameras_raw):
        camera_dict = require_object(camera_raw, f"cameras[{index}]")
        camera = CameraConfig(
            id=int_value(camera_dict.get("id"), field=f"cameras[{index}].id"),
            name=string_value(camera_dict.get("name"), field=f"cameras[{index}].name"),
            enabled=bool_value(camera_dict.get("enabled"), default=True, field=f"cameras[{index}].enabled"),
        )
        if not camera.name:
            raise ValueError(f"cameras[{index}].name is required")
        if camera.id in seen_ids:
            raise ValueError(f"duplicate camera id: {camera.id}")
        if camera.name in seen_names:
            raise ValueError(f"duplicate camera name: {camera.name}")
        seen_ids.add(camera.id)
        seen_names.add(camera.name)
        if camera.enabled:
            cameras.append(camera)

    if not cameras:
        raise ValueError("no enabled cameras defined in config")

    return ServiceConfig(
        log_level=log_level,
        redis=redis_cfg,
        inference=inference_cfg,
        cameras=tuple(cameras),
    )
