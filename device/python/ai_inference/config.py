from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


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
    config_path = Path(path).expanduser().resolve()
    config_dir = config_path.parent
    raw = json.loads(config_path.read_text(encoding="utf-8"))

    log_level = str(raw.get("log_level", "info")).strip() or "info"

    redis_raw = _as_dict(raw.get("redis"), "redis")
    redis_cfg = RedisConfig(
        host=str(redis_raw.get("host", "localhost")).strip() or "localhost",
        port=_as_int(redis_raw.get("port", 6379), "redis.port", minimum=1),
        password=str(redis_raw.get("password", "")),
        db=_as_int(redis_raw.get("db", 0), "redis.db", minimum=0),
        key_prefix=str(redis_raw.get("key_prefix", "camera")).strip() or "camera",
    )

    inference_raw = _as_dict(raw.get("inference"), "inference")
    legacy_code_root = str(inference_raw.get("legacy_code_root", "")).strip()
    if not legacy_code_root:
        raise ValueError("inference.legacy_code_root is required")

    legacy_path = _resolve_path(config_dir, legacy_code_root)
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
        model_dict = _as_dict(model_raw, f"inference.models[{index}]")
        weights_path = str(model_dict.get("weights_path", "")).strip()
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
                weights_path=str(_resolve_path(config_dir, weights_path)),
                allowed_detections=allowed,
            )
        )

    image_size_raw = inference_raw.get("inference_image_size", [640, 640])
    if not isinstance(image_size_raw, list) or len(image_size_raw) != 2:
        raise ValueError("inference.inference_image_size must be a 2-item array")
    image_size = (
        _as_int(image_size_raw[0], "inference.inference_image_size[0]", minimum=1),
        _as_int(image_size_raw[1], "inference.inference_image_size[1]", minimum=1),
    )

    inference_cfg = InferenceConfig(
        legacy_code_root=str(legacy_path.resolve()),
        device=str(inference_raw.get("device", "0")).strip() or "0",
        poll_interval_ms=_as_int(inference_raw.get("poll_interval_ms", 35), "inference.poll_interval_ms", minimum=1),
        idle_sleep_ms=_as_int(inference_raw.get("idle_sleep_ms", 125), "inference.idle_sleep_ms", minimum=1),
        min_brightness=_as_float(inference_raw.get("min_brightness", 25.0), "inference.min_brightness", minimum=0.0),
        processed_images_maxlen=_as_int(
            inference_raw.get("processed_images_maxlen", 10),
            "inference.processed_images_maxlen",
            minimum=1,
        ),
        inference_image_size=image_size,
        confidence_threshold=_as_float(
            inference_raw.get("confidence_threshold", 0.5),
            "inference.confidence_threshold",
            minimum=0.0,
            maximum=1.0,
        ),
        iou_threshold=_as_float(
            inference_raw.get("iou_threshold", 0.75),
            "inference.iou_threshold",
            minimum=0.0,
            maximum=1.0,
        ),
        fp16_inference=bool(inference_raw.get("fp16_inference", False)),
        models=tuple(models),
    )

    cameras_raw = raw.get("cameras")
    if not isinstance(cameras_raw, list) or not cameras_raw:
        raise ValueError("cameras must contain at least one configured camera")

    cameras: list[CameraConfig] = []
    seen_ids: set[int] = set()
    seen_names: set[str] = set()
    for index, camera_raw in enumerate(cameras_raw):
        camera_dict = _as_dict(camera_raw, f"cameras[{index}]")
        camera = CameraConfig(
            id=_as_int(camera_dict.get("id"), f"cameras[{index}].id"),
            name=str(camera_dict.get("name", "")).strip(),
            enabled=bool(camera_dict.get("enabled", True)),
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


def _as_dict(value: Any, path: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{path} must be an object")
    return value


def _as_int(value: Any, path: str, minimum: int | None = None) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{path} must be an integer") from exc
    if minimum is not None and parsed < minimum:
        raise ValueError(f"{path} must be >= {minimum}")
    return parsed


def _as_float(value: Any, path: str, minimum: float | None = None, maximum: float | None = None) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{path} must be a number") from exc
    if minimum is not None and parsed < minimum:
        raise ValueError(f"{path} must be >= {minimum}")
    if maximum is not None and parsed > maximum:
        raise ValueError(f"{path} must be <= {maximum}")
    return parsed


def _resolve_path(base_dir: Path, raw_path: str) -> Path:
    path = Path(raw_path).expanduser()
    if path.is_absolute():
        return path
    return base_dir / path
