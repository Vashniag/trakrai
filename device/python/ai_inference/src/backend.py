from __future__ import annotations

import logging
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from .config import InferenceConfig


@dataclass(frozen=True)
class RuntimeBindings:
    torch: Any
    DetectMultiBackend: type[Any]
    letterbox: Callable[..., Any]
    check_img_size: Callable[..., Any]
    non_max_suppression: Callable[..., Any]
    scale_coords: Callable[..., Any]
    select_device: Callable[[str], Any]


def load_runtime_bindings() -> RuntimeBindings:
    import numpy as np

    runtime_root = Path(__file__).resolve().parent / "yolo_runtime"
    runtime_root_str = str(runtime_root)
    if runtime_root_str not in sys.path:
        sys.path.insert(0, runtime_root_str)

    # TensorRT on Jetson still expects removed NumPy aliases.
    for attr in ("bool", "int", "float", "complex", "object", "str"):
        if not hasattr(np, attr):
            fallback = getattr(np, attr + "_", None) or getattr(__builtins__, attr, None)
            if fallback is not None:
                setattr(np, attr, fallback)

    try:
        import torch
        from models.common import DetectMultiBackend
        from utils.augmentations import letterbox
        from utils.general import check_img_size, non_max_suppression, scale_coords
        from utils.torch_utils import select_device
    except Exception as exc:  # pragma: no cover - exercised on device with runtime deps present
        raise RuntimeError("failed to import bundled ai_inference runtime") from exc

    return RuntimeBindings(
        torch=torch,
        DetectMultiBackend=DetectMultiBackend,
        letterbox=letterbox,
        check_img_size=check_img_size,
        non_max_suppression=non_max_suppression,
        scale_coords=scale_coords,
        select_device=select_device,
    )


def _normalize_device(device: str) -> str:
    value = str(device).strip()
    if value and value != "cpu" and not value.startswith("cuda"):
        return f"cuda:{value}"
    return value


_COCO_NAMES: dict[int, str] = {
    0: "person",
    1: "bicycle",
    2: "car",
    3: "motorcycle",
    4: "airplane",
    5: "bus",
    6: "train",
    7: "truck",
    8: "boat",
    9: "traffic light",
    10: "fire hydrant",
    11: "stop sign",
    12: "parking meter",
    13: "bench",
    14: "bird",
    15: "cat",
    16: "dog",
    17: "horse",
    18: "sheep",
    19: "cow",
    20: "elephant",
    21: "bear",
    22: "zebra",
    23: "giraffe",
    24: "backpack",
    25: "umbrella",
    26: "handbag",
    27: "tie",
    28: "suitcase",
    29: "frisbee",
    30: "skis",
    31: "snowboard",
    32: "sports ball",
    33: "kite",
    34: "baseball bat",
    35: "baseball glove",
    36: "skateboard",
    37: "surfboard",
    38: "tennis racket",
    39: "bottle",
    40: "wine glass",
    41: "cup",
    42: "fork",
    43: "knife",
    44: "spoon",
    45: "bowl",
    46: "banana",
    47: "apple",
    48: "sandwich",
    49: "orange",
    50: "broccoli",
    51: "carrot",
    52: "hot dog",
    53: "pizza",
    54: "donut",
    55: "cake",
    56: "chair",
    57: "couch",
    58: "potted plant",
    59: "bed",
    60: "dining table",
    61: "toilet",
    62: "tv",
    63: "laptop",
    64: "mouse",
    65: "remote",
    66: "keyboard",
    67: "cell phone",
    68: "microwave",
    69: "oven",
    70: "toaster",
    71: "sink",
    72: "refrigerator",
    73: "book",
    74: "clock",
    75: "vase",
    76: "scissors",
    77: "teddy bear",
    78: "hair drier",
    79: "toothbrush",
}


class InferenceBackend:
    def __init__(
        self,
        config: InferenceConfig,
        logger: logging.Logger | None = None,
        *,
        bindings: RuntimeBindings | None = None,
    ) -> None:
        self._config = config
        self._logger = logger or logging.getLogger("ai_inference.backend")
        self._bindings = bindings or load_runtime_bindings()
        self._torch = self._bindings.torch

        self.imgsz = tuple(config.inference_image_size)
        self.conf_thres = config.confidence_threshold
        self.iou_thres = config.iou_threshold
        self.max_det = 1000
        self.device = _normalize_device(config.device)
        self.classes = None
        self.agnostic_nms = False
        self.augment = False
        self.half = config.fp16_inference
        self.dnn = False
        self.data = None
        self.models: dict[str, Any] = {}
        self.allowed_detections_per_model: dict[str, str | list[str]] = {}
        self._letterbox_auto = True
        self._resolved_imgsz = self.imgsz

    def set_device(self, device: str) -> None:
        self.device = _normalize_device(device)

    def add_new_model(self, weights_path: str, allowed_detections: str | list[str] = "*") -> None:
        original_pt_path: str | None = None
        resolved_weights_path = weights_path
        if weights_path.endswith(".pt"):
            engine_path = weights_path[:-3] + ".engine"
            if Path(engine_path).is_file():
                self._logger.info("TensorRT engine found, using %s instead of %s", engine_path, weights_path)
                original_pt_path = weights_path
                resolved_weights_path = engine_path

        device = self._bindings.select_device(str(self.device))
        model = self._bindings.DetectMultiBackend(
            resolved_weights_path,
            device=device,
            dnn=self.dnn,
            data=self.data,
            fp16=self.half,
        )

        first_name = ""
        if model.names:
            if isinstance(model.names, dict):
                first_name = str(model.names.get(0, ""))
            else:
                first_name = str(model.names[0]) if model.names else ""
        if original_pt_path and first_name.startswith("class"):
            model.names = _COCO_NAMES

        stride_val = int(model.stride) if isinstance(model.stride, (int, float)) else 32
        imgsz_result = self._bindings.check_img_size(self.imgsz, s=stride_val)
        self._resolved_imgsz = tuple(imgsz_result if isinstance(imgsz_result, list) else [imgsz_result, imgsz_result])
        self._letterbox_auto = bool(getattr(model, "pt", False))

        if getattr(model, "pt", False):
            dummy = self._torch.zeros(1, 3, self._resolved_imgsz[0], self._resolved_imgsz[1], device=device)
            model(dummy, augment=self.augment)
            del dummy
        else:
            if self._torch.cuda.is_available():
                self._torch.cuda.empty_cache()
            model.warmup(imgsz=(1, 3, self._resolved_imgsz[0], self._resolved_imgsz[1]))
            if self._torch.cuda.is_available():
                self._torch.cuda.empty_cache()

        model_key = Path(resolved_weights_path).name
        self.models[model_key] = model
        self.allowed_detections_per_model[model_key] = allowed_detections

    def load_model(self) -> None:
        device = self._bindings.select_device(str(self.device))
        self.device = device
        if self.models:
            model_key = next(iter(self.models))
            self._logger.info("Model ready (reusing existing): %s", model_key)

    def process(
        self,
        request: dict[str, Any],
        camera_configs: dict[int, dict[str, Any]],
    ) -> tuple[dict[int, dict[str, Any]], dict[int, bool]]:
        batch = request["batch"]
        normalized_images = []
        original_images = []
        cam_ids = []
        img_ids = []
        outdata: dict[int, dict[str, Any]] = {}
        status: dict[int, bool] = {}

        for cam_id, data in batch.items():
            image = data["raw_image"]
            img_id = data["imgID"]
            normalized_img, original_img = self.prepare_image(image)
            normalized_images.append(normalized_img)
            original_images.append(original_img)
            cam_ids.append(cam_id)
            img_ids.append(img_id)

        in_time = time.time()
        results = self._run_inference(normalized_images, original_images, cam_ids, img_ids, in_time, camera_configs)
        for index, cam_id in enumerate(cam_ids):
            result = results[index]
            outdata[cam_id] = result
            status[cam_id] = bool(result["bbox"])
        return outdata, status

    def prepare_image(self, image: np.ndarray) -> tuple[Any, np.ndarray]:
        import numpy as np

        original_img = image
        img = self._bindings.letterbox(original_img, self._resolved_imgsz, 32, auto=self._letterbox_auto)[0]
        img = img[:, :, ::-1].transpose(2, 0, 1)
        img = np.ascontiguousarray(img)
        img = self._torch.from_numpy(img).to(self.device)
        img = img.half() if self.half else img.float()
        img = img / 255.0

        if img.ndim != 3 or img.shape[0] != 3:
            raise ValueError(f"Expected image shape [3, height, width], got {tuple(img.shape)}")
        return img, original_img

    def _run_inference(
        self,
        normalized_images: list[Any],
        original_images: list[np.ndarray],
        cam_ids: list[int],
        img_ids: list[str],
        in_time: float,
        camera_configs: dict[int, dict[str, Any]],
    ) -> list[dict[str, Any]]:
        batch = self._torch.stack(normalized_images)
        all_preds = []

        with self._torch.inference_mode():
            for model in self.models.values():
                preds = model(batch, augment=self.augment)
                preds = self._bindings.non_max_suppression(
                    preds,
                    self.conf_thres,
                    self.iou_thres,
                    self.classes,
                    self.agnostic_nms,
                    max_det=self.max_det,
                )
                all_preds.append(preds)

        merged_preds = self.merge_predictions(all_preds)
        results = []
        for index, det in enumerate(merged_preds):
            cam_id = int(cam_ids[index])
            results.append(
                self.process_detections(det, batch[index], original_images[index], in_time, cam_id, img_ids[index], camera_configs[cam_id])
            )
        return results

    def merge_predictions(self, all_preds: list[list[Any]]) -> list[Any]:
        if not all_preds:
            return []

        num_images = len(all_preds[0])
        merged_preds: list[Any] = [[] for _ in range(num_images)]
        for model_index, model_preds in enumerate(all_preds):
            for img_index, img_preds in enumerate(model_preds):
                if img_preds is not None and len(img_preds):
                    img_preds[:, 5] += model_index * 1000
                    if isinstance(merged_preds[img_index], list) and not merged_preds[img_index]:
                        merged_preds[img_index] = img_preds
                    else:
                        merged_preds[img_index] = self._torch.cat((merged_preds[img_index], img_preds), 0)
        return [self._torch.stack(preds) if isinstance(preds, list) and preds else preds for preds in merged_preds]

    def process_detections(
        self,
        det: Any,
        img_tensor: Any,
        original_image: np.ndarray,
        _in_time: float,
        cam_id: int,
        img_id: str,
        cam_config: dict[str, Any],
    ) -> dict[str, Any]:
        if img_tensor.ndim != 3 or img_tensor.shape[0] != 3:
            raise ValueError(f"Expected image shape [3, height, width], got {tuple(img_tensor.shape)}")

        detection_counts: dict[str, int] = {}
        bbox: list[dict[str, Any]] = []
        if det is not None and len(det):
            det[:, :4] = self._bindings.scale_coords(img_tensor.shape[1:], det[:, :4], original_image.shape).round()
            for *xyxy, conf, cls_conf in reversed(det):
                xyxy = [int(value) for value in xyxy]
                adjusted_class_id = int(cls_conf)
                model_index = adjusted_class_id // 1000
                class_id = adjusted_class_id % 1000
                model_key = list(self.models.keys())[model_index]
                label = str(self.models[model_key].names[class_id]).lower()
                allowed = self.allowed_detections_per_model[model_key]
                if allowed != "*" and label not in allowed:
                    continue

                detection_counts[label] = detection_counts.get(label, 0) + 1
                image_size = original_image.shape
                bbox.append(
                    {
                        "label": label,
                        "conf": float(f"{conf:.2f}"),
                        "raw_bboxes": xyxy,
                        "xyxy": (
                            round(xyxy[0] / image_size[1], 4),
                            round(xyxy[1] / image_size[0], 4),
                            round(xyxy[2] / image_size[1], 4),
                            round(xyxy[3] / image_size[0], 4),
                        ),
                    }
                )

        return {
            "cam_name": cam_config["cam_name"],
            "cam_id": cam_id,
            "imgID": img_id,
            "DetectionPerClass": detection_counts,
            "img0": original_image,
            "outimage": original_image.copy(),
            "system_detection_time": time.time(),
            "totalDetection": str(sum(detection_counts.values())),
            "bbox": bbox,
        }


def build_inference_server(
    config: InferenceConfig,
    logger: logging.Logger | None = None,
    *,
    bindings: RuntimeBindings | None = None,
) -> InferenceBackend:
    server = InferenceBackend(config, logger, bindings=bindings)
    server.set_device(config.device)
    for model in config.models:
        server.add_new_model(model.weights_path, model.allowed_detections)
    return server
