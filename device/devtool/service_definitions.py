from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from . import manifests


@dataclass(frozen=True)
class RuntimeLayout:
    runtime_root: str
    binary_dir: str
    config_dir: str
    download_dir: str
    log_dir: str
    script_dir: str
    shared_dir: str
    version_dir: str
    default_user: str
    default_group: str


def envelope_payload(message: dict[str, Any]) -> dict[str, Any]:
    envelope = message.get("envelope")
    if not isinstance(envelope, dict):
        raise SystemExit("runtime response is missing envelope")
    payload = envelope.get("payload")
    if not isinstance(payload, dict):
        raise SystemExit("runtime response is missing envelope.payload")
    return payload


def service_snapshots_by_name(status_message: dict[str, Any]) -> dict[str, dict[str, Any]]:
    payload = envelope_payload(status_message)
    services = payload.get("services")
    if not isinstance(services, list):
        return {}
    snapshots: dict[str, dict[str, Any]] = {}
    for item in services:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name", "")).strip()
        if not name:
            continue
        snapshots[name] = item
    return snapshots


def definition_from_message(definition_message: dict[str, Any]) -> dict[str, Any]:
    payload = envelope_payload(definition_message)
    definition = payload.get("definition")
    if not isinstance(definition, dict):
        raise SystemExit("runtime response is missing payload.definition")
    return definition


def runtime_layout_from_messages(
    status_message: dict[str, Any],
    *,
    cloud_comm_definition: dict[str, Any],
) -> RuntimeLayout:
    payload = envelope_payload(status_message)
    return RuntimeLayout(
        runtime_root=str(payload.get("runtimeRoot") or payload.get("binaryDir", "")).rsplit("/bin", 1)[0]
        if str(payload.get("runtimeRoot", "")).strip() == ""
        else str(payload.get("runtimeRoot", "")).strip(),
        binary_dir=str(payload.get("binaryDir", "")).strip(),
        config_dir=str(payload.get("configDir", "")).strip(),
        download_dir=str(payload.get("downloadDir", "")).strip(),
        log_dir=str(payload.get("logDir", "")).strip(),
        script_dir=str(payload.get("scriptDir", "")).strip(),
        shared_dir=str(payload.get("sharedDir", "")).strip(),
        version_dir=str(payload.get("versionDir", "")).strip(),
        default_user=str(cloud_comm_definition.get("user", "")).strip() or "hacklab",
        default_group=str(cloud_comm_definition.get("group", "")).strip() or "hacklab",
    )


def runtime_kind(service: manifests.ServiceManifest) -> str:
    if service.is_go_binary:
        return "binary"
    if service.is_python:
        return "wheel"
    if service.is_ui_bundle:
        return "zip"
    raise SystemExit(f"unsupported service kind for runtime definition: {service.kind}")


def _replace_runtime_tokens(
    values: tuple[str, ...],
    *,
    layout: RuntimeLayout,
    config_name: str | None,
    runtime_user: str,
    runtime_group: str,
) -> list[str]:
    resolved: list[str] = []
    for value in values:
        resolved.append(
            value.replace("{{installPath}}", "{{install_path}}")
            .replace("{{artifactPath}}", "{{artifact_path}}")
            .replace("{{configDir}}", layout.config_dir)
            .replace("{{runtimeRoot}}", layout.runtime_root)
            .replace("{{runtimeUser}}", runtime_user)
            .replace("{{runtimeGroup}}", runtime_group)
            .replace("{{configName}}", config_name or "")
        )
    return resolved


def _replace_environment_tokens(
    values: dict[str, str],
    *,
    layout: RuntimeLayout,
    runtime_user: str,
    runtime_group: str,
) -> dict[str, str]:
    return {
        key: value.replace("{{runtimeRoot}}", layout.runtime_root)
        .replace("{{runtimeUser}}", runtime_user)
        .replace("{{runtimeGroup}}", runtime_group)
        for key, value in values.items()
    }


def install_path_for_service(service: manifests.ServiceManifest, layout: RuntimeLayout) -> str:
    if service.is_go_binary:
        return f"{layout.binary_dir}/{service.name}"
    if service.is_python:
        return f"{layout.runtime_root}/wheels/{service.name}"
    if service.is_ui_bundle:
        return f"{layout.runtime_root}/ui"
    raise SystemExit(f"unsupported service kind: {service.kind}")


def desired_enabled(
    service: manifests.ServiceManifest,
    *,
    existing_definition: dict[str, Any] | None,
    force_enable: bool,
    force_disable: bool,
) -> bool:
    if force_enable and force_disable:
        raise SystemExit("cannot pass both --enable and --disable")
    if force_enable:
        return True
    if force_disable:
        return False
    if existing_definition is not None:
        return bool(existing_definition.get("enabled", False))
    if service.is_ui_bundle:
        return False
    return True


def build_service_definition(
    service_name: str,
    layout: RuntimeLayout,
    *,
    enabled: bool,
) -> dict[str, Any]:
    service = manifests.require_service(service_name)
    runtime_user = "root" if service.runtime.run_as == "root" else layout.default_user
    runtime_group = "root" if service.runtime.run_as == "root" else layout.default_group
    definition: dict[str, Any] = {
        "allowControl": service.runtime.allow_control,
        "allowUpdate": service.runtime.allow_update,
        "core": service.runtime.core,
        "description": service.description,
        "displayName": service.display_name,
        "enabled": enabled,
        "installPath": install_path_for_service(service, layout),
        "kind": runtime_kind(service),
        "name": service.name,
    }
    if service.runtime.environment:
        definition["environment"] = _replace_environment_tokens(
            service.runtime.environment,
            layout=layout,
            runtime_user=runtime_user,
            runtime_group=runtime_group,
        )
    if service.runtime.exec_start:
        definition["execStart"] = _replace_runtime_tokens(
            service.runtime.exec_start,
            layout=layout,
            config_name=service.config_name,
            runtime_user=runtime_user,
            runtime_group=runtime_group,
        )
        definition["user"] = runtime_user
        definition["group"] = runtime_group
    if service.runtime.setup_command:
        definition["setupCommand"] = _replace_runtime_tokens(
            service.runtime.setup_command,
            layout=layout,
            config_name=service.config_name,
            runtime_user=runtime_user,
            runtime_group=runtime_group,
        )
    if service.runtime.version_command:
        definition["versionCommand"] = _replace_runtime_tokens(
            service.runtime.version_command,
            layout=layout,
            config_name=service.config_name,
            runtime_user=runtime_user,
            runtime_group=runtime_group,
        )
    return definition
