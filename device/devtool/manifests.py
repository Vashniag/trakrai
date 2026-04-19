from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

from . import paths


@dataclass(frozen=True)
class BuildSpec:
    context: str
    dockerfile: str
    platform_strategy: str
    artifact_key: str = ""
    binary_name: str = ""
    build_wheelhouse: bool = False
    wheelhouse_abi: str = ""
    wheelhouse_implementation: str = ""
    wheelhouse_platform: str = ""
    wheelhouse_python_version: str = ""
    requirements_file: str = ""
    cmd_path: str = ""
    module_name: str = ""
    package_dir: str = ""
    workspace_filter: str = ""

    @property
    def context_path(self) -> Path:
        return paths.REPO_ROOT / self.context


@dataclass(frozen=True)
class RuntimeSpec:
    allow_control: bool
    allow_update: bool
    core: bool
    exec_start: tuple[str, ...] = ()
    environment: dict[str, str] = field(default_factory=dict)
    run_as: str = ""
    setup_command: tuple[str, ...] = ()
    version_command: tuple[str, ...] = ()


@dataclass(frozen=True)
class LocalSpec:
    camera_aware: bool
    default_enabled: bool
    requires_components: tuple[str, ...] = ()


@dataclass(frozen=True)
class ServiceManifest:
    name: str
    package_name: str
    display_name: str
    description: str
    kind: str
    config_languages: tuple[str, ...]
    config_name: str | None
    schema_path: str | None
    sample_config_path: str | None
    build: BuildSpec
    runtime: RuntimeSpec
    local: LocalSpec

    @property
    def schema_file(self) -> Path | None:
        return paths.REPO_ROOT / self.schema_path if self.schema_path else None

    @property
    def sample_config_file(self) -> Path | None:
        return paths.REPO_ROOT / self.sample_config_path if self.sample_config_path else None

    @property
    def is_ui_bundle(self) -> bool:
        return self.kind == "ui-bundle"

    @property
    def is_python(self) -> bool:
        return self.kind == "python-wheel"

    @property
    def is_go_binary(self) -> bool:
        return self.kind == "go-binary"

    @property
    def generated_go_config_file(self) -> Path | None:
        if "go" not in self.config_languages:
            return None
        return paths.GO_GENERATED_CONFIG_ROOT / f"{self.name.replace('-', '_')}.go"

    @property
    def generated_python_config_file(self) -> Path | None:
        if "python" not in self.config_languages:
            return None
        return paths.PYTHON_GENERATED_CONFIG_ROOT / f"{self.name.replace('-', '_')}.py"


@dataclass(frozen=True)
class ComponentManifest:
    name: str
    display_name: str
    description: str
    kind: str
    compose_file: str = ""
    compose_service: str = ""
    command: tuple[str, ...] = ()
    env_file: str = ""
    requires: tuple[str, ...] = ()


@dataclass(frozen=True)
class ProfileManifest:
    name: str
    display_name: str
    description: str
    target: str
    base_config_dir: str
    overlays: tuple[str, ...]
    services: tuple[str, ...]
    components: tuple[str, ...]

    @property
    def base_config_path(self) -> Path:
        return paths.REPO_ROOT / self.base_config_dir

    @property
    def overlay_paths(self) -> tuple[Path, ...]:
        return tuple(paths.REPO_ROOT / item for item in self.overlays)


@dataclass(frozen=True)
class TestManifest:
    name: str
    display_name: str
    description: str
    profile: str
    timeout_sec: int
    cleanup_steps: tuple[dict[str, Any], ...]
    steps: tuple[dict[str, Any], ...]


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def load_services() -> tuple[ServiceManifest, ...]:
    payload = _read_json(paths.SERVICES_MANIFEST_PATH)
    services: list[ServiceManifest] = []
    for item in payload.get("services", []):
        build = item.get("build", {})
        runtime = item.get("runtime", {})
        local = item.get("local", {})
        services.append(
            ServiceManifest(
                name=str(item["name"]),
                package_name=str(item.get("packageName", item["name"])),
                display_name=str(item.get("displayName", item["name"])),
                description=str(item.get("description", "")),
                kind=str(item.get("kind", "")),
                config_languages=tuple(str(value) for value in item.get("configLanguages", [])),
                config_name=item.get("configName"),
                schema_path=item.get("schemaPath"),
                sample_config_path=item.get("sampleConfigPath"),
                build=BuildSpec(
                    artifact_key=str(build.get("artifactKey", "")),
                    binary_name=str(build.get("binaryName", "")),
                    build_wheelhouse=bool(build.get("buildWheelhouse", False)),
                    cmd_path=str(build.get("cmdPath", "")),
                    context=str(build.get("context", "")),
                    dockerfile=str(build.get("dockerfile", "")),
                    module_name=str(build.get("moduleName", "")),
                    package_dir=str(build.get("packageDir", "")),
                    platform_strategy=str(build.get("platformStrategy", "platform")),
                    requirements_file=str(build.get("requirementsFile", "")),
                    wheelhouse_abi=str(build.get("wheelhouseAbi", "")),
                    wheelhouse_implementation=str(build.get("wheelhouseImplementation", "")),
                    wheelhouse_platform=str(build.get("wheelhousePlatform", "")),
                    wheelhouse_python_version=str(build.get("wheelhousePythonVersion", "")),
                    workspace_filter=str(build.get("workspaceFilter", "")),
                ),
                runtime=RuntimeSpec(
                    allow_control=bool(runtime.get("allowControl", False)),
                    allow_update=bool(runtime.get("allowUpdate", False)),
                    core=bool(runtime.get("core", False)),
                    environment={str(key): str(value) for key, value in dict(runtime.get("environment", {})).items()},
                    exec_start=tuple(str(value) for value in runtime.get("execStart", [])),
                    run_as=str(runtime.get("runAs", "")),
                    setup_command=tuple(str(value) for value in runtime.get("setupCommand", [])),
                    version_command=tuple(str(value) for value in runtime.get("versionCommand", [])),
                ),
                local=LocalSpec(
                    camera_aware=bool(local.get("cameraAware", False)),
                    default_enabled=bool(local.get("defaultEnabled", False)),
                    requires_components=tuple(str(value) for value in local.get("requiresComponents", [])),
                ),
            )
        )
    return tuple(services)


@lru_cache(maxsize=1)
def services_by_name() -> dict[str, ServiceManifest]:
    return {service.name: service for service in load_services()}


@lru_cache(maxsize=1)
def services_by_config_name() -> dict[str, ServiceManifest]:
    mapping: dict[str, ServiceManifest] = {}
    for service in load_services():
        if service.config_name:
            mapping[service.config_name] = service
    return mapping


def require_service(name: str) -> ServiceManifest:
    try:
        return services_by_name()[name]
    except KeyError as exc:
        raise SystemExit(f"unknown service: {name}") from exc


def default_service_names() -> list[str]:
    return [service.name for service in load_services() if service.local.default_enabled]


def core_service_names() -> list[str]:
    return [service.name for service in load_services() if service.runtime.core]


def config_names() -> list[str]:
    return [service.config_name for service in load_services() if service.config_name]


def services_for_config_map(config_map: dict[str, Any]) -> list[ServiceManifest]:
    selected: list[ServiceManifest] = []
    for service in load_services():
        if service.is_ui_bundle:
            selected.append(service)
            continue
        if service.runtime.core:
            selected.append(service)
            continue
        if service.config_name and service.config_name in config_map:
            selected.append(service)
    return selected


@lru_cache(maxsize=1)
def load_components() -> tuple[ComponentManifest, ...]:
    if not paths.COMPONENTS_MANIFEST_PATH.exists():
        return ()
    payload = _read_json(paths.COMPONENTS_MANIFEST_PATH)
    components: list[ComponentManifest] = []
    for item in payload.get("components", []):
        components.append(
            ComponentManifest(
                name=str(item["name"]),
                display_name=str(item.get("displayName", item["name"])),
                description=str(item.get("description", "")),
                kind=str(item.get("kind", "")),
                compose_file=str(item.get("composeFile", "")),
                compose_service=str(item.get("composeService", "")),
                command=tuple(str(value) for value in item.get("command", [])),
                env_file=str(item.get("envFile", "")),
                requires=tuple(str(value) for value in item.get("requires", [])),
            )
        )
    return tuple(components)


@lru_cache(maxsize=1)
def components_by_name() -> dict[str, ComponentManifest]:
    return {component.name: component for component in load_components()}


def resolve_component_closure(component_names: list[str]) -> list[str]:
    resolved: list[str] = []
    seen: set[str] = set()

    def visit(name: str) -> None:
        if name in seen:
            return
        seen.add(name)
        component = components_by_name().get(name)
        if component is None:
            raise SystemExit(f"unknown component: {name}")
        for dependency in component.requires:
            visit(dependency)
        resolved.append(name)

    for name in component_names:
        visit(name)
    return resolved


def required_components_for_services(service_names: list[str]) -> list[str]:
    raw: list[str] = []
    for name in service_names:
        service = require_service(name)
        raw.extend(service.local.requires_components)
    return resolve_component_closure(sorted(set(raw)))


def _load_profile(path: Path) -> ProfileManifest:
    payload = _read_json(path)
    return ProfileManifest(
        name=str(payload["name"]),
        display_name=str(payload.get("displayName", payload["name"])),
        description=str(payload.get("description", "")),
        target=str(payload.get("target", "local-emulator")),
        base_config_dir=str(payload["baseConfigDir"]),
        overlays=tuple(str(value) for value in payload.get("overlays", [])),
        services=tuple(str(value) for value in payload.get("services", [])),
        components=tuple(str(value) for value in payload.get("components", [])),
    )


@lru_cache(maxsize=1)
def load_profiles() -> tuple[ProfileManifest, ...]:
    profiles: list[ProfileManifest] = []
    if not paths.PROFILES_ROOT.exists():
        return ()
    for path in sorted(paths.PROFILES_ROOT.glob("*.json")):
        profiles.append(_load_profile(path))
    return tuple(profiles)


@lru_cache(maxsize=1)
def profiles_by_name() -> dict[str, ProfileManifest]:
    return {profile.name: profile for profile in load_profiles()}


def require_profile(name: str) -> ProfileManifest:
    try:
        return profiles_by_name()[name]
    except KeyError as exc:
        raise SystemExit(f"unknown profile: {name}") from exc


def _load_test(path: Path) -> TestManifest:
    payload = _read_json(path)
    return TestManifest(
        name=str(payload["name"]),
        display_name=str(payload.get("displayName", payload["name"])),
        description=str(payload.get("description", "")),
        profile=str(payload.get("profile", "")),
        timeout_sec=int(payload.get("timeoutSec", 120)),
        cleanup_steps=tuple(dict(step) for step in payload.get("cleanupSteps", [])),
        steps=tuple(dict(step) for step in payload.get("steps", [])),
    )


@lru_cache(maxsize=1)
def load_tests() -> tuple[TestManifest, ...]:
    tests: list[TestManifest] = []
    if not paths.TESTS_ROOT.exists():
        return ()
    for path in sorted(paths.TESTS_ROOT.glob("*.json")):
        tests.append(_load_test(path))
    return tuple(tests)


@lru_cache(maxsize=1)
def tests_by_name() -> dict[str, TestManifest]:
    return {test.name: test for test in load_tests()}


def require_test(name: str) -> TestManifest:
    try:
        return tests_by_name()[name]
    except KeyError as exc:
        raise SystemExit(f"unknown test workflow: {name}") from exc
