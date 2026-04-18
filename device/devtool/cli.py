from __future__ import annotations

import argparse
import json
import sys

from . import assets, cameras, configs, deploy, local, manifests, packages, paths, runtime, testing
from .build import build_services
from .shell_completion import bash_completion, fish_completion, zsh_completion

DELEGATED_COMMANDS = {
    "assets": assets.main,
    "cameras": cameras.main,
    "config": configs.main,
    "deploy": deploy.main,
    "emulator": local.main,
    "package": packages.main,
    "runtime": runtime.main,
    "test": testing.main,
}


def cmd_manifest_list(args: argparse.Namespace) -> int:
    if args.kind == "services":
        payload = [
            {
                "name": service.name,
                "configName": service.config_name,
                "description": service.description,
                "kind": service.kind,
            }
            for service in manifests.load_services()
        ]
    elif args.kind == "components":
        payload = [
            {"name": component.name, "description": component.description, "kind": component.kind}
            for component in manifests.load_components()
        ]
    elif args.kind == "profiles":
        payload = [
            {"name": profile.name, "target": profile.target, "services": list(profile.services)}
            for profile in manifests.load_profiles()
        ]
    else:
        payload = [{"name": test.name, "profile": test.profile, "description": test.description} for test in manifests.load_tests()]
    print(json.dumps(payload, indent=2))
    return 0


def cmd_manifest_validate(args: argparse.Namespace) -> int:
    del args
    issues: list[str] = []
    for service in manifests.load_services():
        if service.schema_file and not service.schema_file.exists():
            issues.append(f"missing schema for {service.name}: {service.schema_file}")
        if service.sample_config_file and not service.sample_config_file.exists():
            issues.append(f"missing sample config for {service.name}: {service.sample_config_file}")
        if service.is_go_binary and service.config_languages != ("go",):
            issues.append(f"service {service.name} is a go-binary and must declare configLanguages ['go']")
        if service.is_python and service.config_languages != ("python",):
            issues.append(f"service {service.name} is a python-wheel and must declare configLanguages ['python']")
        if service.is_ui_bundle and service.config_languages:
            issues.append(f"service {service.name} is a ui-bundle and must not declare configLanguages")
    for profile in manifests.load_profiles():
        if not profile.base_config_path.exists():
            issues.append(f"profile {profile.name} missing base config dir {profile.base_config_path}")
        for service_name in profile.services:
            try:
                manifests.require_service(service_name)
            except SystemExit:
                issues.append(f"profile {profile.name} references unknown service {service_name}")
        for component_name in profile.components:
            if component_name not in manifests.components_by_name():
                issues.append(f"profile {profile.name} references unknown component {component_name}")
    for test in manifests.load_tests():
        if test.profile and test.profile not in manifests.profiles_by_name():
            issues.append(f"test {test.name} references unknown profile {test.profile}")
    print(json.dumps({"issues": issues}, indent=2))
    return 1 if issues else 0


def cmd_completion(args: argparse.Namespace) -> int:
    if args.shell == "bash":
        print(bash_completion())
    elif args.shell == "zsh":
        print(zsh_completion())
    else:
        print(fish_completion())
    return 0


def cmd_build(args: argparse.Namespace) -> int:
    if args.mode == "all":
        services = [service.name for service in manifests.load_services()]
    else:
        services = list(args.service or [])
        if not services:
            raise SystemExit("build service requires at least one --service")
    built = build_services(services, platform=args.platform)
    print(json.dumps({"built": {name: str(path) for name, path in built.items()}}, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="TrakrAI manifest-driven developer CLI.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    manifest_parser = subparsers.add_parser("manifest", help="inspect and validate central manifests")
    manifest_subparsers = manifest_parser.add_subparsers(dest="manifest_command", required=True)
    manifest_list = manifest_subparsers.add_parser("list", help="list manifest entries")
    manifest_list.add_argument("kind", choices=["services", "components", "profiles", "tests"])
    manifest_list.set_defaults(func=cmd_manifest_list)
    manifest_validate = manifest_subparsers.add_parser("validate", help="validate manifest references")
    manifest_validate.set_defaults(func=cmd_manifest_validate)

    build_parser = subparsers.add_parser("build", help="build device packages locally")
    build_subparsers = build_parser.add_subparsers(dest="build_command", required=True)
    build_all = build_subparsers.add_parser("all", help="build all services and bundles")
    build_all.add_argument("--platform", default=paths.DEFAULT_ARM64_PLATFORM)
    build_all.set_defaults(func=cmd_build, mode="all")
    build_service = build_subparsers.add_parser("service", help="build one or more services")
    build_service.add_argument("--platform", default=paths.DEFAULT_ARM64_PLATFORM)
    build_service.add_argument("--service", action="append")
    build_service.set_defaults(func=cmd_build, mode="service")

    completion_parser = subparsers.add_parser("completion", help="emit shell completion scripts")
    completion_parser.add_argument("shell", choices=["bash", "zsh", "fish"])
    completion_parser.set_defaults(func=cmd_completion)

    config_parser = subparsers.add_parser("config", help="generate, validate, and codegen config assets")
    config_parser.set_defaults(delegate="config")

    deploy_parser = subparsers.add_parser("deploy", help="deploy the staged runtime to remote targets")
    deploy_parser.set_defaults(delegate="deploy")

    emulator_parser = subparsers.add_parser("emulator", help="manage local emulator components and staged runtime")
    emulator_parser.set_defaults(delegate="emulator")

    assets_parser = subparsers.add_parser("assets", help="download sample video and YOLO model weights")
    assets_parser.set_defaults(delegate="assets")

    cameras_parser = subparsers.add_parser("cameras", help="probe and manage mock cameras served by fake-camera")
    cameras_parser.set_defaults(delegate="cameras")

    package_parser = subparsers.add_parser("package", help="plan, release, list, and pull packages")
    package_parser.set_defaults(delegate="package")

    runtime_parser = subparsers.add_parser("runtime", help="manage a running device runtime over websocket")
    runtime_parser.set_defaults(delegate="runtime")

    test_parser = subparsers.add_parser("test", help="run JSON-defined verification workflows")
    test_parser.set_defaults(delegate="test")
    return parser


def main(argv: list[str] | None = None) -> int:
    argv = list(argv or sys.argv[1:])
    if argv and argv[0] in DELEGATED_COMMANDS:
        return DELEGATED_COMMANDS[argv[0]](argv[1:])

    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
