from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class IPCConfig:
    socket_path: str


@dataclass(frozen=True)
class QueueConfig:
    max_pending: int
    status_report_interval_sec: int


@dataclass(frozen=True)
class WorkflowConfig:
    file_path: str
    max_workers: int
    reload_poll_interval_ms: int
    result_history_size: int


@dataclass(frozen=True)
class ServiceConfig:
    device_id: str
    ipc: IPCConfig
    log_level: str
    queue: QueueConfig
    workflow: WorkflowConfig


def load_config(path: str | Path) -> ServiceConfig:
    config_path = Path(path).expanduser().resolve()
    raw = json.loads(config_path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError("workflow engine config must be an object")

    config_dir = config_path.parent
    ipc_raw = _as_dict(raw.get("ipc", {}), "ipc")
    queue_raw = _as_dict(raw.get("queue", {}), "queue")
    workflow_raw = _as_dict(raw.get("workflow", {}), "workflow")

    workflow_path = _resolve_path(config_dir, _string_value(workflow_raw.get("file_path")))
    if not workflow_path:
        raise ValueError("workflow.file_path is required")

    return ServiceConfig(
        device_id=_string_value(raw.get("device_id")) or "default",
        ipc=IPCConfig(socket_path=_string_value(ipc_raw.get("socket_path")) or "/tmp/trakrai-cloud-comm.sock"),
        log_level=_string_value(raw.get("log_level")) or "info",
        queue=QueueConfig(
            max_pending=max(1, _int_value(queue_raw.get("max_pending"), 256, "queue.max_pending")),
            status_report_interval_sec=max(
                1,
                _int_value(queue_raw.get("status_report_interval_sec"), 15, "queue.status_report_interval_sec"),
            ),
        ),
        workflow=WorkflowConfig(
            file_path=str(workflow_path),
            max_workers=max(1, _int_value(workflow_raw.get("max_workers"), 4, "workflow.max_workers")),
            reload_poll_interval_ms=max(
                100,
                _int_value(
                    workflow_raw.get("reload_poll_interval_ms"),
                    1000,
                    "workflow.reload_poll_interval_ms",
                ),
            ),
            result_history_size=max(
                1,
                _int_value(
                    workflow_raw.get("result_history_size"),
                    20,
                    "workflow.result_history_size",
                ),
            ),
        ),
    )


def _as_dict(value: Any, path: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{path} must be an object")
    return value


def _string_value(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _int_value(value: Any, default: int, path: str) -> int:
    if value is None or value == "":
        return default
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{path} must be an integer") from exc


def _resolve_path(base_dir: Path, raw_path: str) -> Path | None:
    if not raw_path:
        return None
    path = Path(raw_path).expanduser()
    if path.is_absolute():
        return path
    return (base_dir / path).resolve()
