from __future__ import annotations

import json
import logging
import queue
import threading
import time
from collections import deque
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from typing import Any

from trakrai_service_runtime import (
    IPCClient,
    ServiceRequestBridge,
    publish_error,
    publish_reply,
    report_status,
    run_command_loop,
    run_periodic_loop,
)

from .config import ServiceConfig
from .engine import WorkflowEngine, WorkflowExecutionResult
from .payloads import NormalizedDetectionRequest, normalize_detection_request
from . import nodes  # noqa: F401

SERVICE_NAME = "workflow-engine"
WORKFLOW_ENGINE_ERROR_TYPE = "workflow-engine-error"
WORKFLOW_ENGINE_RESULT_TYPE = "workflow-engine-result"
WORKFLOW_ENGINE_STATUS_TYPE = "workflow-engine-status"


@dataclass(frozen=True)
class QueuedDetection:
    payload: dict[str, Any]
    request_id: str
    source_service: str
    generation: int
    enqueued_at: float


class WorkflowService:
    def __init__(self, config: ServiceConfig, logger: logging.Logger) -> None:
        self._config = config
        self._logger = logger
        self._ipc = IPCClient(config.ipc.socket_path, SERVICE_NAME, logger)
        self._service_bridge = ServiceRequestBridge(self._ipc)
        self._queue: "queue.Queue[QueuedDetection]" = queue.Queue(maxsize=config.queue.max_pending)
        self._results = deque(maxlen=config.workflow.result_history_size)
        self._stop_event = threading.Event()
        self._state_lock = threading.RLock()
        self._engine: WorkflowEngine | None = None
        self._workflow_generation = 0
        self._workflow_hash = ""
        self._workflow_name = ""
        self._workflow_loaded = False
        self._workflow_loaded_at = 0.0
        self._workflow_error = ""
        self._active_request_id = ""
        self._active_generation = 0
        self._processed_runs = 0
        self._failed_runs = 0
        self._dropped_runs = 0
        self._reload_count = 0

    def run_forever(self) -> None:
        self._ipc.connect()
        self._reload_workflow(force=True)
        self._report_status()

        threads = [
            threading.Thread(target=self._worker_loop, name="workflow-worker", daemon=True),
            threading.Thread(target=self._watcher_loop, name="workflow-watcher", daemon=True),
            threading.Thread(
                target=run_periodic_loop,
                args=(
                    self._stop_event,
                    float(self._config.queue.status_report_interval_sec),
                    self._report_status,
                ),
                name="workflow-status",
                daemon=True,
            ),
        ]
        for thread in threads:
            thread.start()

        try:
            self._handle_notifications()
        finally:
            self._stop_event.set()
            for thread in threads:
                thread.join(timeout=2.0)
            self._report_status(status_override="stopped")
            self._ipc.close()

    def _handle_notifications(self) -> None:
        run_command_loop(
            self._ipc,
            self._stop_event,
            self._handle_command,
            notification_interceptor=self._service_bridge.handle_notification,
            closed_error_message="workflow-engine IPC connection closed",
        )

    def _handle_command(self, source_service: str, envelope: dict[str, Any]) -> None:
        message_type = str(envelope.get("type", "")).strip()
        payload = envelope.get("payload", {})
        if not isinstance(payload, dict):
            payload = {}

        if message_type == "enqueue-detection":
            self._handle_enqueue_detection(source_service, payload)
            return
        if message_type == "get-status":
            self._publish_reply(
                source_service,
                WORKFLOW_ENGINE_STATUS_TYPE,
                self._build_status_payload(request_id=str(payload.get("requestId", "")).strip()),
            )
            return

        self._publish_error(
            source_service,
            request_id=str(payload.get("requestId", "")).strip(),
            request_type=message_type,
            error=f"unsupported workflow-engine command {message_type!r}",
        )

    def _handle_enqueue_detection(self, source_service: str, payload: dict[str, Any]) -> None:
        try:
            normalized = normalize_detection_request(payload)
        except ValueError as exc:
            self._publish_error(
                source_service,
                request_id=str(payload.get("requestId", "")).strip(),
                request_type="enqueue-detection",
                error=str(exc),
            )
            return

        with self._state_lock:
            loaded = self._workflow_loaded and self._engine is not None
            generation = self._workflow_generation

        if not loaded:
            self._publish_error(
                source_service,
                request_id=normalized.request_id,
                request_type="enqueue-detection",
                error=self._workflow_error or "workflow is not currently loaded",
            )
            return

        try:
            self._queue.put_nowait(
                QueuedDetection(
                    payload=dict(normalized.payload),
                    request_id=normalized.request_id,
                    source_service=source_service,
                    generation=generation,
                    enqueued_at=time.time(),
                )
            )
        except queue.Full:
            self._publish_error(
                source_service,
                request_id=normalized.request_id,
                request_type="enqueue-detection",
                error="workflow queue is full",
            )

    def _worker_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                job = self._queue.get(timeout=0.5)
            except queue.Empty:
                continue

            with self._state_lock:
                engine = self._engine
                self._active_request_id = job.request_id
                self._active_generation = job.generation

            if engine is None:
                self._publish_error(
                    job.source_service,
                    request_id=job.request_id,
                    request_type="enqueue-detection",
                    error="workflow is not currently loaded",
                )
                with self._state_lock:
                    self._failed_runs += 1
                    self._active_request_id = ""
                continue

            try:
                result = engine.execute(
                    detection_data=job.payload,
                    context_overrides={"service_bridge": self._service_bridge},
                )
            except Exception as exc:
                with self._state_lock:
                    self._failed_runs += 1
                    stale = job.generation != self._workflow_generation
                    self._active_request_id = ""
                if stale:
                    self._publish_error(
                        job.source_service,
                        request_id=job.request_id,
                        request_type="enqueue-detection",
                        error="workflow changed while this run was executing; result was discarded",
                    )
                else:
                    self._publish_error(
                        job.source_service,
                        request_id=job.request_id,
                        request_type="enqueue-detection",
                        error=str(exc),
                    )
                continue

            with self._state_lock:
                stale = job.generation != self._workflow_generation
                self._active_request_id = ""
                if stale:
                    self._dropped_runs += 1
                elif result.success:
                    self._processed_runs += 1
                else:
                    self._failed_runs += 1

            if stale:
                self._publish_error(
                    job.source_service,
                    request_id=job.request_id,
                    request_type="enqueue-detection",
                    error="workflow changed while this run was executing; result was discarded",
                )
                continue

            result_payload = self._serialize_result(job.request_id, job.payload, result, job.generation)
            with self._state_lock:
                self._results.appendleft(result_payload["run"])
            self._publish_reply(job.source_service, WORKFLOW_ENGINE_RESULT_TYPE, result_payload)

    def _watcher_loop(self) -> None:
        interval_sec = self._config.workflow.reload_poll_interval_ms / 1000.0
        while not self._stop_event.wait(interval_sec):
            self._reload_workflow(force=False)

    def _reload_workflow(self, force: bool) -> None:
        workflow_path = Path(self._config.workflow.file_path)
        try:
            raw_bytes = workflow_path.read_bytes()
        except OSError as exc:
            self._set_workflow_error(f"failed to read workflow file {workflow_path}: {exc}")
            return

        digest = sha256(raw_bytes).hexdigest()
        with self._state_lock:
            if not force and digest == self._workflow_hash:
                return
            self._workflow_generation += 1
            generation = self._workflow_generation

        self._discard_pending_runs("workflow reloaded")

        try:
            workflow_json = json.loads(raw_bytes.decode("utf-8"))
            if not isinstance(workflow_json, dict):
                raise ValueError("workflow file must decode to a JSON object")
            engine = WorkflowEngine(max_workers=self._config.workflow.max_workers, validate=True)
            engine.load_workflow(workflow_json)
            workflow_name = ""
            metadata = workflow_json.get("metadata", {})
            if isinstance(metadata, dict):
                workflow_name = str(metadata.get("name", "")).strip()
        except Exception as exc:
            self._set_workflow_error(f"failed to load workflow file {workflow_path}: {exc}", workflow_hash=digest)
            return

        with self._state_lock:
            self._engine = engine
            self._workflow_hash = digest
            self._workflow_name = workflow_name
            self._workflow_loaded = True
            self._workflow_loaded_at = time.time()
            self._workflow_error = ""
            self._reload_count += 1
        self._logger.info(
            "Loaded workflow %s generation=%s hash=%s",
            workflow_path,
            generation,
            digest[:12],
        )
        self._report_status()

    def _set_workflow_error(self, error: str, workflow_hash: str | None = None) -> None:
        with self._state_lock:
            self._engine = None
            self._workflow_loaded = False
            self._workflow_error = error
            self._workflow_name = ""
            if workflow_hash is not None:
                self._workflow_hash = workflow_hash
        self._logger.warning(error)
        self._report_status(status_override="degraded")

    def _discard_pending_runs(self, reason: str) -> None:
        while True:
            try:
                job = self._queue.get_nowait()
            except queue.Empty:
                return
            with self._state_lock:
                self._dropped_runs += 1
            self._publish_error(
                job.source_service,
                request_id=job.request_id,
                request_type="enqueue-detection",
                error=f"queued run was discarded because {reason}",
            )

    def _serialize_result(
        self,
        request_id: str,
        detection_payload: dict[str, Any],
        result: WorkflowExecutionResult,
        generation: int,
    ) -> dict[str, Any]:
        return {
            "requestId": request_id,
            "run": {
                "executionId": result.execution_id,
                "success": result.success,
                "durationMs": round(result.duration_ms, 3),
                "errors": list(result.errors),
                "outputs": _make_serializable(result.outputs),
                "nodeResults": {
                    node_id: {
                        "status": node_result.status.value,
                        "outputs": _make_serializable(node_result.outputs),
                        "error": node_result.error,
                        "durationMs": round(node_result.duration_ms, 3),
                    }
                    for node_id, node_result in result.node_results.items()
                },
                "cameraId": str(
                    detection_payload.get("cam_id")
                    or detection_payload.get("cameraId")
                    or ""
                ),
                "cameraName": str(
                    detection_payload.get("cam_name")
                    or detection_payload.get("cameraName")
                    or ""
                ),
                "frameId": str(
                    detection_payload.get("frame_id")
                    or detection_payload.get("imgID")
                    or detection_payload.get("imageId")
                    or ""
                ),
                "workflowGeneration": generation,
                "workflowHash": self._workflow_hash,
            },
        }

    def _build_status_payload(self, request_id: str = "") -> dict[str, Any]:
        with self._state_lock:
            queue_depth = self._queue.qsize()
            active_request_id = self._active_request_id
            payload = {
                "requestId": request_id,
                "deviceId": self._config.device_id,
                "service": SERVICE_NAME,
                "workflow": {
                    "filePath": self._config.workflow.file_path,
                    "generation": self._workflow_generation,
                    "hash": self._workflow_hash,
                    "loaded": self._workflow_loaded,
                    "loadedAt": _isoformat(self._workflow_loaded_at),
                    "name": self._workflow_name,
                    "error": self._workflow_error,
                },
                "queue": {
                    "maxPending": self._config.queue.max_pending,
                    "pending": queue_depth,
                    "activeRequestId": active_request_id,
                },
                "stats": {
                    "processedRuns": self._processed_runs,
                    "failedRuns": self._failed_runs,
                    "droppedRuns": self._dropped_runs,
                    "reloadCount": self._reload_count,
                },
                "recentRuns": list(self._results),
            }
        return payload

    def _publish_reply(self, target_service: str, message_type: str, payload: dict[str, Any]) -> None:
        publish_reply(
            self._ipc,
            self._logger,
            target_service,
            message_type,
            payload,
            warning_message="Failed to publish workflow response",
        )

    def _publish_error(self, target_service: str, request_id: str, request_type: str, error: str) -> None:
        publish_error(
            self._ipc,
            self._logger,
            target_service,
            WORKFLOW_ENGINE_ERROR_TYPE,
            request_id=request_id,
            request_type=request_type,
            error=error,
            warning_message="Failed to publish workflow response",
            debug_message="Failed to report workflow-engine error",
        )

    def _report_status(self, status_override: str | None = None) -> None:
        status = status_override or ("running" if self._workflow_loaded else "degraded")
        details = self._build_status_payload()
        details.pop("requestId", None)
        report_status(
            self._ipc,
            self._logger,
            status,
            details,
            debug_message="Failed to report workflow-engine status",
        )


def _make_serializable(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(key): _make_serializable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_make_serializable(item) for item in value]
    return str(value)


def _isoformat(timestamp: float) -> str:
    if timestamp <= 0:
        return ""
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(timestamp))
