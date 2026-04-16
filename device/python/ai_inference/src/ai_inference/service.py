from __future__ import annotations

import importlib
import json
import logging
import sys
import time
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import redis

from .config import CameraConfig, ServiceConfig

PROCESSED_SUFFIX = "processed"
PROCESSED_TIME_SUFFIX = "processed_time"
PROCESSED_IMAGES_SUFFIX = "processed_images"
DETECTIONS_SUFFIX = "detections"
DETECTIONS_TIME_SUFFIX = "detections_time"
RAW_INPUT_SUFFIX = "latest"

_BOX_COLORS: tuple[tuple[int, int, int], ...] = (
    (56, 56, 255),
    (151, 157, 255),
    (31, 112, 255),
    (29, 178, 255),
    (49, 210, 207),
    (10, 249, 72),
    (23, 204, 146),
    (134, 219, 61),
    (52, 147, 26),
    (187, 212, 0),
)


@dataclass(frozen=True)
class FrameEnvelope:
    camera_id: int
    camera_name: str
    img_id: str
    image: np.ndarray
    source_cam_id: str


class InferenceRedisService:
    def __init__(self, config: ServiceConfig, logger: logging.Logger) -> None:
        self._config = config
        self._logger = logger
        self._redis = redis.Redis(
            host=config.redis.host,
            port=config.redis.port,
            password=config.redis.password,
            db=config.redis.db,
            decode_responses=False,
        )
        self._last_img_ids: dict[str, str] = {}
        self._mismatch_warnings: set[str] = set()
        self._camera_lookup = {camera.id: {"cam_name": camera.name} for camera in config.cameras}
        self._perf_window_started = time.time()
        self._perf_counters = {
            "frames": 0,
            "fetch_ms": 0.0,
            "decode_ms": 0.0,
            "inference_ms": 0.0,
            "annotate_ms": 0.0,
            "redis_write_ms": 0.0,
        }
        self._server = self._build_legacy_server()

    def warmup(self) -> None:
        self._logger.info("Connecting to Redis at %s:%s", self._config.redis.host, self._config.redis.port)
        self._redis.ping()
        self._server.load_model()
        self._logger.info("Inference service is ready with %d model(s)", len(self._config.inference.models))

    def run_forever(self) -> None:
        self.warmup()
        self._logger.info("Watching %d camera(s) for new frames", len(self._config.cameras))
        while True:
            processed_any = False
            poll_started = time.perf_counter()
            pending_frames = self._read_latest_frames()
            fetch_ms = (time.perf_counter() - poll_started) * 1000.0
            for camera in self._config.cameras:
                try:
                    frame = pending_frames.get(camera.name)
                    processed_any = self._process_camera(camera, frame, fetch_ms if frame is not None else 0.0) or processed_any
                except Exception:
                    self._logger.exception("Camera loop failed for %s", camera.name)
            delay_ms = self._config.inference.poll_interval_ms if processed_any else self._config.inference.idle_sleep_ms
            self._maybe_log_perf()
            time.sleep(delay_ms / 1000.0)

    def _process_camera(self, camera: CameraConfig, frame: FrameEnvelope | None, fetch_ms: float) -> bool:
        if frame is None:
            return False

        decode_started = time.perf_counter()
        brightness = float(np.mean(cv2.cvtColor(frame.image, cv2.COLOR_BGR2GRAY)))
        decode_ms = (time.perf_counter() - decode_started) * 1000.0

        inference_started = time.perf_counter()
        if brightness < self._config.inference.min_brightness:
            result = self._make_empty_result(frame)
            self._logger.debug(
                "Skipping dark frame for %s (imgID=%s brightness=%.1f)",
                frame.camera_name,
                frame.img_id,
                brightness,
            )
        else:
            result, _status = self._server.process(
                {"batch": {frame.camera_id: {"raw_image": frame.image, "imgID": frame.img_id, "cam_id": frame.camera_id}}},
                self._camera_lookup,
            )
            result = result[frame.camera_id]
        inference_ms = (time.perf_counter() - inference_started) * 1000.0

        annotate_started = time.perf_counter()
        annotated_image = self._annotate_image(frame.image, result.get("bbox", []))
        annotate_ms = (time.perf_counter() - annotate_started) * 1000.0
        result["outimage"] = annotated_image
        result["img0"] = frame.image

        write_started = time.perf_counter()
        self._store_outputs(frame, result, annotated_image)
        redis_write_ms = (time.perf_counter() - write_started) * 1000.0
        self._last_img_ids[frame.camera_name] = frame.img_id

        self._record_perf(fetch_ms, decode_ms, inference_ms, annotate_ms, redis_write_ms)
        detection_count = len(result.get("bbox", []))
        self._logger.debug(
            "Processed %s imgID=%s detections=%d inf=%.1fms annotate=%.1fms write=%.1fms",
            frame.camera_name,
            frame.img_id,
            detection_count,
            inference_ms,
            annotate_ms,
            redis_write_ms,
        )
        return True

    def _read_latest_frames(self) -> dict[str, FrameEnvelope]:
        fields = ("raw", "imgID", "cam_id")
        pipe = self._redis.pipeline()
        for camera in self._config.cameras:
            pipe.hmget(self._camera_key(camera.name, RAW_INPUT_SUFFIX), *fields)
        raw_results = pipe.execute()

        frames: dict[str, FrameEnvelope] = {}
        for camera, values in zip(self._config.cameras, raw_results):
            if not isinstance(values, list) or len(values) < 2:
                continue

            raw_bytes, raw_img_id, raw_cam_id = values[0], values[1], values[2] if len(values) > 2 else None
            if not raw_bytes:
                continue

            img_id = self._decode_text(raw_img_id) or ""
            if not img_id or img_id == self._last_img_ids.get(camera.name):
                continue

            nparr = np.frombuffer(raw_bytes, np.uint8)
            image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if image is None:
                self._logger.warning("Failed to decode JPEG for %s (imgID=%s)", camera.name, img_id)
                continue

            source_cam_id = self._decode_text(raw_cam_id) or ""
            if source_cam_id and source_cam_id != str(camera.id):
                mismatch_key = f"{camera.name}:{source_cam_id}"
                if mismatch_key not in self._mismatch_warnings:
                    self._logger.warning(
                        "Camera config id (%s) does not match feeder cam_id (%s) for %s",
                        camera.id,
                        source_cam_id,
                        camera.name,
                    )
                    self._mismatch_warnings.add(mismatch_key)

            frames[camera.name] = FrameEnvelope(
                camera_id=camera.id,
                camera_name=camera.name,
                img_id=img_id,
                image=image,
                source_cam_id=source_cam_id,
            )

        return frames

    def _store_outputs(self, frame: FrameEnvelope, result: dict[str, Any], annotated_image: np.ndarray) -> None:
        ok, buffer = cv2.imencode(".jpg", annotated_image)
        if not ok:
            raise RuntimeError(f"failed to encode processed image for {frame.camera_name}")
        image_bytes = buffer.tobytes()

        clean_bbox = self._serialise_detections(result.get("bbox", []))
        payload = {
            "cam_id": str(frame.camera_id),
            "cam_name": frame.camera_name,
            "frame_id": frame.img_id,
            "imgID": frame.img_id,
            "system_detection_time": float(result.get("system_detection_time", time.time())),
            "totalDetection": int(result.get("totalDetection", len(clean_bbox)) or 0),
            "DetectionPerClass": self._normalise_counts(result.get("DetectionPerClass")),
            "bbox": clean_bbox,
        }

        pipe = self._redis.pipeline()
        pipe.set(self._camera_key(frame.camera_name, PROCESSED_SUFFIX), image_bytes)
        pipe.set(self._camera_key(frame.camera_name, PROCESSED_TIME_SUFFIX), frame.img_id)
        pipe.lpush(self._camera_key(frame.camera_name, PROCESSED_IMAGES_SUFFIX), image_bytes)
        pipe.ltrim(self._camera_key(frame.camera_name, PROCESSED_IMAGES_SUFFIX), 0, self._config.inference.processed_images_maxlen - 1)
        pipe.set(self._camera_key(frame.camera_name, DETECTIONS_SUFFIX), json.dumps(payload, separators=(",", ":")))
        pipe.set(self._camera_key(frame.camera_name, DETECTIONS_TIME_SUFFIX), frame.img_id)
        if self._config.workflow_queue.enabled:
            workflow_envelope = {
                "camera_id": frame.camera_id,
                "camera_name": frame.camera_name,
                "frame_id": frame.img_id,
                "source_cam_id": frame.source_cam_id,
                "raw_frame_key": self._camera_key(frame.camera_name, RAW_INPUT_SUFFIX),
                "processed_frame_key": self._camera_key(frame.camera_name, PROCESSED_SUFFIX),
                "detections_key": self._camera_key(frame.camera_name, DETECTIONS_SUFFIX),
                "enqueued_at": time.time(),
            }
            pipe.lpush(
                self._config.workflow_queue.key,
                json.dumps(workflow_envelope, separators=(",", ":")),
            )
            pipe.ltrim(self._config.workflow_queue.key, 0, self._config.workflow_queue.max_length - 1)
        pipe.execute()

    def _make_empty_result(self, frame: FrameEnvelope) -> dict[str, Any]:
        return {
            "cam_name": frame.camera_name,
            "cam_id": frame.camera_id,
            "imgID": frame.img_id,
            "DetectionPerClass": {},
            "img0": frame.image,
            "outimage": frame.image.copy(),
            "system_detection_time": time.time(),
            "totalDetection": 0,
            "bbox": [],
        }

    def _build_legacy_server(self) -> Any:
        legacy_root = Path(self._config.inference.legacy_code_root)
        legacy_path = str(legacy_root)
        if legacy_path not in sys.path:
            sys.path.insert(0, legacy_path)

        module = importlib.import_module("server_batch")
        server_batch_class = getattr(module, "ServerBatch")
        common_config = {
            "inference_image_size": list(self._config.inference.inference_image_size),
            "confidence_threshold": self._config.inference.confidence_threshold,
            "iou_threshold": self._config.inference.iou_threshold,
            "fp16_inference": self._config.inference.fp16_inference,
        }
        server = server_batch_class(
            None,
            redis_connection=None,
            device=self._config.inference.device,
            common_config=common_config,
        )
        server.set_device(self._config.inference.device)
        for model in self._config.inference.models:
            server.add_new_model(model.weights_path, model.allowed_detections)
        return server

    def _annotate_image(self, image: np.ndarray, detections: list[dict[str, Any]]) -> np.ndarray:
        annotated = np.ascontiguousarray(image.copy())
        for detection in detections:
            raw_box = detection.get("raw_bboxes") or []
            if not isinstance(raw_box, (list, tuple)) or len(raw_box) != 4:
                continue

            x1, y1, x2, y2 = [int(float(value)) for value in raw_box]
            label = str(detection.get("label", "object"))
            confidence = detection.get("conf")
            text = label
            if isinstance(confidence, (float, int)):
                text = f"{label} {float(confidence):.2f}"

            color = _BOX_COLORS[zlib.crc32(label.encode("utf-8")) % len(_BOX_COLORS)]
            cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2, cv2.LINE_AA)

            (text_width, text_height), baseline = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
            label_top = max(y1 - text_height - baseline - 6, 0)
            label_bottom = label_top + text_height + baseline + 6
            cv2.rectangle(
                annotated,
                (x1, label_top),
                (x1 + text_width + 8, label_bottom),
                color,
                -1,
                cv2.LINE_AA,
            )
            cv2.putText(
                annotated,
                text,
                (x1 + 4, label_bottom - baseline - 3),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.5,
                (255, 255, 255),
                1,
                cv2.LINE_AA,
            )

        return annotated

    def _camera_key(self, camera_name: str, suffix: str) -> str:
        return f"{self._config.redis.key_prefix}:{camera_name}:{suffix}"

    @staticmethod
    def _decode_key(value: bytes | str) -> str:
        if isinstance(value, bytes):
            return value.decode("utf-8", errors="replace")
        return str(value)

    @staticmethod
    def _decode_text(value: Any) -> str:
        if value is None:
            return ""
        if isinstance(value, bytes):
            return value.decode("utf-8", errors="replace")
        return str(value)

    @staticmethod
    def _normalise_counts(value: Any) -> dict[str, int]:
        if not isinstance(value, dict):
            return {}
        counts: dict[str, int] = {}
        for key, raw_count in value.items():
            try:
                counts[str(key)] = int(raw_count)
            except (TypeError, ValueError):
                continue
        return counts

    def _serialise_detections(self, detections: Any) -> list[dict[str, Any]]:
        if not isinstance(detections, list):
            return []

        clean: list[dict[str, Any]] = []
        for detection in detections:
            if not isinstance(detection, dict):
                continue

            item: dict[str, Any] = {}
            for key, value in detection.items():
                if key == "detections":
                    item[key] = self._serialise_detections(value)
                    continue
                if isinstance(value, (str, bool, int, float)) or value is None:
                    item[key] = value
                    continue
                if isinstance(value, tuple):
                    item[key] = [self._scalar_or_string(entry) for entry in value]
                    continue
                if isinstance(value, list):
                    item[key] = [self._scalar_or_string(entry) for entry in value]
            clean.append(item)

        return clean

    @staticmethod
    def _scalar_or_string(value: Any) -> Any:
        if isinstance(value, (bool, int, float)) or value is None:
            return value
        return str(value)

    def _record_perf(
        self,
        fetch_ms: float,
        decode_ms: float,
        inference_ms: float,
        annotate_ms: float,
        redis_write_ms: float,
    ) -> None:
        self._perf_counters["frames"] += 1
        self._perf_counters["fetch_ms"] += fetch_ms
        self._perf_counters["decode_ms"] += decode_ms
        self._perf_counters["inference_ms"] += inference_ms
        self._perf_counters["annotate_ms"] += annotate_ms
        self._perf_counters["redis_write_ms"] += redis_write_ms

    def _maybe_log_perf(self) -> None:
        elapsed = time.time() - self._perf_window_started
        frames = int(self._perf_counters["frames"])
        if elapsed < 5.0 or frames == 0:
            return

        self._logger.info(
            "[PERF] frames=%d avg_fetch=%.1fms avg_decode=%.1fms avg_infer=%.1fms avg_annotate=%.1fms avg_write=%.1fms",
            frames,
            self._perf_counters["fetch_ms"] / frames,
            self._perf_counters["decode_ms"] / frames,
            self._perf_counters["inference_ms"] / frames,
            self._perf_counters["annotate_ms"] / frames,
            self._perf_counters["redis_write_ms"] / frames,
        )
        self._perf_window_started = time.time()
        for key in self._perf_counters:
            self._perf_counters[key] = 0 if key == "frames" else 0.0
