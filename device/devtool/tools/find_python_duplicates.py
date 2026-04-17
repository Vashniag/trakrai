#!/usr/bin/env python3
from __future__ import annotations

import argparse
import ast
import json
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from device.devtool import paths

REPO_ROOT = paths.REPO_ROOT
DEFAULT_ROOT = paths.DEVICE_PYTHON_ROOT
IGNORED_DIRS = {"__pycache__", ".pytest_cache"}


@dataclass(frozen=True)
class FunctionMatch:
    path: str
    name: str
    line: int


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Find duplicate Python function bodies by normalized AST shape.")
    parser.add_argument("--root", default=str(DEFAULT_ROOT), help="directory to scan")
    parser.add_argument("--min-occurrences", type=int, default=2)
    parser.add_argument("--json", action="store_true", help="emit JSON instead of plain text")
    parser.add_argument(
        "--include-dunder",
        action="store_true",
        help="include dunder methods such as __init__ in the duplicate report",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    duplicates = find_duplicates(
        Path(args.root).expanduser().resolve(),
        min_occurrences=max(2, args.min_occurrences),
        include_dunder=args.include_dunder,
    )
    if args.json:
        print(
            json.dumps(
                [
                    {
                        "count": len(group),
                        "functions": [match.__dict__ for match in group],
                    }
                    for group in duplicates
                ],
                indent=2,
            )
        )
    else:
        if not duplicates:
            print("No duplicate functions found.")
            return 0
        for group in duplicates:
            print(f"duplicate count={len(group)}")
            for match in group:
                print(f"  {match.path}:{match.line}:{match.name}")
    return 0


def find_duplicates(root: Path, *, min_occurrences: int, include_dunder: bool) -> list[list[FunctionMatch]]:
    groups: dict[str, list[FunctionMatch]] = defaultdict(list)
    for path in iter_python_files(root):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            if not include_dunder and node.name.startswith("__") and node.name.endswith("__"):
                continue
            groups[normalize_function(node)].append(
                FunctionMatch(
                    path=str(path.relative_to(REPO_ROOT)),
                    name=node.name,
                    line=node.lineno,
                )
            )
    return [
        matches
        for matches in sorted(groups.values(), key=lambda value: (-len(value), value[0].path, value[0].name))
        if len(matches) >= min_occurrences
    ]


def iter_python_files(root: Path) -> Iterable[Path]:
    for path in sorted(root.rglob("*.py")):
        if any(part in IGNORED_DIRS for part in path.parts):
            continue
        yield path


def normalize_function(node: ast.FunctionDef | ast.AsyncFunctionDef) -> str:
    normalized = ast.fix_missing_locations(ast.parse(ast.unparse(node)).body[0])
    assert isinstance(normalized, (ast.FunctionDef, ast.AsyncFunctionDef))
    normalized.name = "__normalized__"
    for child in ast.walk(normalized):
        for attr in ("lineno", "col_offset", "end_lineno", "end_col_offset"):
            if hasattr(child, attr):
                setattr(child, attr, None)
    return ast.dump(normalized, include_attributes=False)


if __name__ == "__main__":
    raise SystemExit(main())
