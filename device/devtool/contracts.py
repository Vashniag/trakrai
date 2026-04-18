from __future__ import annotations

import argparse
import json

from . import contract_tools, service_contracts
from .interactive import choose_many
from .request_files import apply_request_overrides, load_request_file


def cmd_validate(args: argparse.Namespace) -> int:
    del args
    issues = contract_tools.validate_service_contracts()
    print(
        json.dumps(
            {
                "issues": [{"path": issue.path, "message": issue.message} for issue in issues],
            },
            indent=2,
        )
    )
    return 1 if issues else 0


def cmd_codegen(args: argparse.Namespace) -> int:
    request = load_request_file(args.request)
    apply_request_overrides(args, request, ["service", "go", "python", "typescript"])
    selected = list(args.service or [])
    if args.interactive and not selected:
        selected = choose_many(
            "Select services to generate service contracts for",
            [service.name for service in service_contracts.load_service_contracts()],
        )
    if not selected:
        selected = [service.name for service in service_contracts.load_service_contracts()]

    explicit_targets = set()
    if args.go:
        explicit_targets.add("go")
    if args.python:
        explicit_targets.add("python")
    if args.typescript:
        explicit_targets.add("typescript")

    if explicit_targets:
        go_services = [name for name in selected if "go" in explicit_targets]
        python_services = [name for name in selected if "python" in explicit_targets]
        typescript_services = [name for name in selected if "typescript" in explicit_targets]
    else:
        go_services = list(selected)
        python_services = list(selected)
        typescript_services = list(selected)

    declared_services = [service.name for service in service_contracts.load_service_contracts()]
    written, deleted = contract_tools.write_codegen(
        go_services=go_services,
        python_services=python_services,
        typescript_services=typescript_services,
        declared_go_services=declared_services,
        declared_python_services=declared_services,
        declared_typescript_services=declared_services,
    )
    print(
        json.dumps(
            {
                "written": [str(path) for path in written],
                "deleted": [str(path) for path in deleted],
            },
            indent=2,
        )
    )
    return 0


def build_parser(prog: str | None = None) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog=prog,
        description="Validate and generate service contract bindings.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    validate_parser = subparsers.add_parser("validate", help="validate the service methods manifest")
    validate_parser.set_defaults(func=cmd_validate)

    codegen_parser = subparsers.add_parser(
        "codegen",
        help="generate Go/Python/TypeScript service contract bindings",
    )
    codegen_parser.add_argument("--request", default="")
    codegen_parser.add_argument("--service", action="append")
    codegen_parser.add_argument("--go", action="store_true")
    codegen_parser.add_argument("--python", action="store_true")
    codegen_parser.add_argument("--typescript", action="store_true")
    codegen_parser.add_argument("--interactive", action="store_true")
    codegen_parser.set_defaults(func=cmd_codegen)
    return parser


def main(argv: list[str] | None = None, prog: str | None = None) -> int:
    parser = build_parser(prog=prog)
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
