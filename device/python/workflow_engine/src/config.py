from __future__ import annotations

from dataclasses import replace
from pathlib import Path

from generated_configs.workflow_engine import (
    WorkflowEngineConfig as ServiceConfig,
    WorkflowEngineConfigIpc as IPCConfig,
    WorkflowEngineConfigQueue as QueueConfig,
    WorkflowEngineConfigWorkflow as WorkflowConfig,
    load_workflow_engine_config,
)
from trakrai_service_runtime import resolve_path


def load_config(path: str | Path) -> ServiceConfig:
    config_path = Path(path).expanduser().resolve()
    config = load_workflow_engine_config(config_path)
    workflow_path = resolve_path(
        config_path.parent,
        config.workflow.file_path,
        field="workflow.file_path",
        required=True,
    )
    assert workflow_path is not None
    return replace(config, workflow=replace(config.workflow, file_path=str(workflow_path)))
