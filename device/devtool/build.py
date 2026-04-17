from __future__ import annotations

import os
import shutil
from pathlib import Path

from . import manifests, paths
from .utils import create_zip_from_directory, ensure_clean_dir, find_single_file, latest_tree_mtime, run


GO_LDFLAGS = os.environ.get("GO_LDFLAGS", "")
DOCKER_CACHE_FROM = os.environ.get("TRAKRAI_DOCKER_CACHE_FROM", "").strip()
DOCKER_CACHE_TO = os.environ.get("TRAKRAI_DOCKER_CACHE_TO", "").strip()
DEVICE_UI_BUILD_INPUTS: tuple[Path, ...] = (
    paths.WEB_DEVICE_APP_ROOT / "src",
    paths.WEB_DEVICE_APP_ROOT / "package.json",
    paths.WEB_DEVICE_APP_ROOT / "next.config.ts",
    paths.WEB_DEVICE_APP_ROOT / "postcss.config.mjs",
    paths.WEB_DEVICE_APP_ROOT / "tsconfig.json",
    paths.WEB_DEVICE_APP_ROOT / "eslint.config.mjs",
    paths.WEB_ROOT / "package.json",
    paths.WEB_ROOT / "pnpm-lock.yaml",
    paths.WEB_ROOT / "pnpm-workspace.yaml",
    paths.WEB_ROOT / "turbo.json",
    paths.WEB_ROOT / "packages",
)


def docker_buildx(
    *,
    output_dir: Path,
    dockerfile: str,
    build_args: dict[str, str],
    context_dir: Path,
    platform: str,
) -> None:
    ensure_clean_dir(output_dir)
    command = [
        "docker",
        "buildx",
        "build",
        "--platform",
        platform,
        "--output",
        f"type=local,dest={output_dir}",
        "-f",
        dockerfile,
    ]
    if DOCKER_CACHE_FROM:
        command.extend(["--cache-from", DOCKER_CACHE_FROM])
    if DOCKER_CACHE_TO:
        command.extend(["--cache-to", DOCKER_CACHE_TO])
    for key, value in build_args.items():
        command.extend(["--build-arg", f"{key}={value}"])
    command.append(str(context_dir))
    run(command, cwd=context_dir)


def web_workspace_has_device_ui_tooling() -> bool:
    result = run(
        ["pnpm", "--filter", "trakrai-device", "exec", "next", "--version"],
        cwd=paths.WEB_ROOT,
        capture_output=True,
        check=False,
    )
    return result.returncode == 0


def ensure_web_workspace_install() -> None:
    if web_workspace_has_device_ui_tooling():
        return
    print(f"Web workspace dependencies are missing; installing them in {paths.WEB_ROOT}")
    run(["pnpm", "install"], cwd=paths.WEB_ROOT)
    if not web_workspace_has_device_ui_tooling():
        raise SystemExit("web workspace install completed, but `pnpm --filter trakrai-device exec next --version` still fails")


def build_service_artifact(service: manifests.ServiceManifest, *, platform: str) -> Path:
    output_dir = paths.DEVICE_ROOT / "out" / service.name
    if service.is_go_binary:
        docker_buildx(
            output_dir=output_dir,
            dockerfile=service.build.dockerfile,
            build_args={
                "CMD_PATH": service.build.cmd_path,
                "BINARY_NAME": service.build.binary_name or service.name,
                "GO_LDFLAGS": GO_LDFLAGS,
            },
            context_dir=service.build.context_path,
            platform=platform,
        )
        return output_dir / (service.build.binary_name or service.name)
    if service.is_python:
        docker_buildx(
            output_dir=output_dir,
            dockerfile=service.build.dockerfile,
            build_args={
                "PACKAGE_DIR": service.build.package_dir,
                "BUILD_WHEELHOUSE": "1" if service.build.build_wheelhouse else "0",
                "PACKAGE_VERSION": os.environ.get(f"{service.name.upper().replace('-', '_')}_VERSION", "0.1.0"),
            },
            context_dir=service.build.context_path,
            platform=platform,
        )
        wheel = find_single_file(output_dir, "*.whl")
        if wheel is None:
            raise SystemExit(f"wheel build did not produce an artifact for {service.name}")
        return wheel
    if service.is_ui_bundle:
        ensure_web_workspace_install()
        run(["pnpm", "--filter", service.build.workspace_filter, "build"], cwd=paths.WEB_ROOT)
        zip_path = output_dir / "trakrai-device-ui.zip"
        ensure_clean_dir(output_dir)
        create_zip_from_directory(paths.WEB_DEVICE_APP_ROOT / "out", zip_path)
        return zip_path
    raise SystemExit(f"unsupported service kind for builds: {service.kind}")


def build_services(service_names: list[str], *, platform: str) -> dict[str, Path]:
    built: dict[str, Path] = {}
    for name in service_names:
        service = manifests.require_service(name)
        built[name] = build_service_artifact(service, platform=platform)
    return built


def ensure_device_ui_export(*, build_if_missing: bool, require_ui: bool) -> None:
    if not require_ui:
        return
    static_out = paths.WEB_DEVICE_APP_ROOT / "out"
    export_missing = not static_out.exists()
    export_stale = not export_missing and device_ui_export_is_stale(static_out)
    if not export_missing and not export_stale:
        return
    if build_if_missing:
        ensure_web_workspace_install()
        reason = "missing" if export_missing else "stale"
        print(f"Device UI export is {reason}; rebuilding {static_out}")
        run(["pnpm", "--filter", "trakrai-device", "build"], cwd=paths.WEB_ROOT)
        if static_out.exists() and not device_ui_export_is_stale(static_out):
            return
    if export_missing:
        raise SystemExit(f"missing static device UI export at {static_out}")
    raise SystemExit(f"stale static device UI export at {static_out}")


def device_ui_export_is_stale(static_out: Path) -> bool:
    if not static_out.exists():
        return True
    output_mtime = latest_tree_mtime(static_out)
    input_mtime = max(latest_tree_mtime(path) for path in DEVICE_UI_BUILD_INPUTS)
    return input_mtime > output_mtime


def resolve_local_artifacts(
    *,
    service_names: list[str],
    skip_build: bool,
    platform: str,
    require_ui: bool = True,
    build_ui_if_missing: bool = True,
) -> dict[str, Path]:
    artifacts: dict[str, Path] = {}
    if not skip_build:
        artifacts.update(build_services(service_names, platform=platform))
    for name in service_names:
        service = manifests.require_service(name)
        if name in artifacts:
            continue
        if service.is_go_binary:
            artifacts[name] = paths.DEVICE_ROOT / "out" / name / (service.build.binary_name or service.name)
        elif service.is_python:
            wheel = find_single_file(paths.DEVICE_ROOT / "out" / name, "*.whl")
            if wheel is None:
                raise SystemExit(f"missing local wheel for {name} under device/out/{name}")
            artifacts[name] = wheel
        elif service.is_ui_bundle:
            ensure_device_ui_export(build_if_missing=build_ui_if_missing, require_ui=require_ui)
            zip_path = paths.DEVICE_ROOT / "out" / name / "trakrai-device-ui.zip"
            if not zip_path.exists():
                zip_path.parent.mkdir(parents=True, exist_ok=True)
                create_zip_from_directory(paths.WEB_DEVICE_APP_ROOT / "out", zip_path)
            artifacts[name] = zip_path
    missing = [name for name, path in artifacts.items() if not path.exists()]
    if missing:
        raise SystemExit(f"missing local artifacts for: {', '.join(sorted(missing))}")
    return artifacts
