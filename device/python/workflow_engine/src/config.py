from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from trakrai_service_runtime import (
    int_value,
    load_json_object,
    optional_object,
    resolve_path,
    string_value,
)


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
    config_path, raw = load_json_object(path, label="workflow engine config")

    config_dir = config_path.parent
    ipc_raw = optional_object(raw.get("ipc"))
    queue_raw = optional_object(raw.get("queue"))
    workflow_raw = optional_object(raw.get("workflow"))

    workflow_path = resolve_path(
        config_dir,
        string_value(workflow_raw.get("file_path"), field="workflow.file_path"),
        field="workflow.file_path",
        required=True,
    )
    assert workflow_path is not None

    return ServiceConfig(
        device_id=string_value(raw.get("device_id"), default="default", field="device_id") or "default",
        ipc=IPCConfig(
            socket_path=string_value(
                ipc_raw.get("socket_path"),
                default="/tmp/trakrai-cloud-comm.sock",
                field="ipc.socket_path",
            )
            or "/tmp/trakrai-cloud-comm.sock"
        ),
        log_level=string_value(raw.get("log_level"), default="info", field="log_level") or "info",
        queue=QueueConfig(
            max_pending=int_value(queue_raw.get("max_pending"), default=256, field="queue.max_pending", minimum=1),
            status_report_interval_sec=int_value(
                queue_raw.get("status_report_interval_sec"),
                default=15,
                field="queue.status_report_interval_sec",
                minimum=1,
            ),
        ),
        workflow=WorkflowConfig(
            file_path=str(workflow_path),
            max_workers=int_value(workflow_raw.get("max_workers"), default=4, field="workflow.max_workers", minimum=1),
            reload_poll_interval_ms=int_value(
                workflow_raw.get("reload_poll_interval_ms"),
                default=1000,
                field="workflow.reload_poll_interval_ms",
                minimum=100,
            ),
            result_history_size=int_value(
                workflow_raw.get("result_history_size"),
                default=20,
                field="workflow.result_history_size",
                minimum=1,
            ),
        ),
    )
