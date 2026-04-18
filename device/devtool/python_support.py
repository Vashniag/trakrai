from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from . import manifests, paths
from .service_definitions import RuntimeLayout


@dataclass(frozen=True)
class RuntimeSupportFile:
    source_path: Path
    target_path: str
    mode: int = 0o644


def _runtime_python_root(layout: RuntimeLayout) -> str:
    return f"{layout.runtime_root}/python"


def iter_python_runtime_support_files(
    service: manifests.ServiceManifest,
    layout: RuntimeLayout,
) -> list[RuntimeSupportFile]:
    if not service.is_python:
        return []

    python_root = _runtime_python_root(layout)
    support_files: list[RuntimeSupportFile] = []

    runtime_support_root = paths.DEVICE_PYTHON_ROOT / "trakrai_service_runtime"
    for source_path in sorted(runtime_support_root.rglob("*.py")):
        relative_path = source_path.relative_to(paths.DEVICE_PYTHON_ROOT).as_posix()
        support_files.append(
            RuntimeSupportFile(
                source_path=source_path,
                target_path=f"{python_root}/{relative_path}",
            )
        )

    generated_root = paths.PYTHON_GENERATED_CONFIG_ROOT
    for support_name in ("__init__.py", "_runtime.py"):
        source_path = generated_root / support_name
        if not source_path.exists():
            raise SystemExit(f"missing generated config runtime support file: {source_path}")
        support_files.append(
            RuntimeSupportFile(
                source_path=source_path,
                target_path=f"{python_root}/generated_configs/{support_name}",
            )
        )

    generated_path = service.generated_python_config_file
    if generated_path is None or not generated_path.exists():
        raise SystemExit(f"missing generated python config module for {service.name}: {generated_path}")
    support_files.append(
        RuntimeSupportFile(
            source_path=generated_path,
            target_path=f"{python_root}/generated_configs/{generated_path.name}",
        )
    )

    return support_files
