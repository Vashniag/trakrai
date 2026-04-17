from __future__ import annotations

from dataclasses import replace
from pathlib import Path

from generated_configs.trakrai_ai_inference import (
    TrakraiAiInferenceConfig as ServiceConfig,
    TrakraiAiInferenceConfigCamerasItem as CameraConfig,
    TrakraiAiInferenceConfigInference as InferenceConfig,
    TrakraiAiInferenceConfigInferenceModelsItem as ModelConfig,
    TrakraiAiInferenceConfigRedis as RedisConfig,
    load_trakrai_ai_inference_config,
)
from trakrai_service_runtime import resolve_path


def _normalize_allowed_detections(value: object, *, field: str) -> str | list[str]:
    if isinstance(value, list):
        normalized = [str(item).strip().lower() for item in value if str(item).strip()]
        return normalized or "*"
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized == "" or normalized == "*":
            return "*"
        return [normalized]
    raise ValueError(f"{field} must be a string or string array")


def load_config(path: str | Path) -> ServiceConfig:
    config_path = Path(path).expanduser().resolve()
    config = load_trakrai_ai_inference_config(config_path)

    image_size = list(config.inference.inference_image_size)
    if len(image_size) != 2:
        raise ValueError("inference.inference_image_size must be a 2-item array")
    if any(int(value) <= 0 for value in image_size):
        raise ValueError("inference.inference_image_size values must be greater than 0")

    models: list[ModelConfig] = []
    for index, model in enumerate(config.inference.models):
        weights_path = resolve_path(
            config_path.parent,
            model.weights_path,
            field=f"inference.models[{index}].weights_path",
            required=True,
        )
        assert weights_path is not None
        models.append(
            replace(
                model,
                weights_path=str(weights_path),
                allowed_detections=_normalize_allowed_detections(
                    model.allowed_detections,
                    field=f"inference.models[{index}].allowed_detections",
                ),
            )
        )

    cameras: list[CameraConfig] = []
    seen_ids: set[int] = set()
    seen_names: set[str] = set()
    for index, camera in enumerate(config.cameras):
        if not camera.name.strip():
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

    inference = replace(config.inference, inference_image_size=image_size, models=models)
    return replace(config, inference=inference, cameras=cameras)
