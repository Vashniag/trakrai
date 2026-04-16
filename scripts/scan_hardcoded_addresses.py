#!/usr/bin/env python3
"""Scan the repo for hardcoded addresses, URLs, and port-like literals."""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable, Sequence


DEFAULT_EXCLUDED_DIRS = {
    ".git",
    ".localdev",
    ".next",
    ".turbo",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "out",
    "tmp",
    "__pycache__",
}

DEFAULT_EXCLUDED_FILES = {
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
}

DEFAULT_INCLUDED_SUFFIXES = {
    ".bash",
    ".cjs",
    ".conf",
    ".cts",
    ".env",
    ".go",
    ".ini",
    ".js",
    ".json",
    ".jsx",
    ".mjs",
    ".mts",
    ".py",
    ".sh",
    ".toml",
    ".ts",
    ".tsx",
    ".yaml",
    ".yml",
}

DEFAULT_INCLUDED_FILENAMES = {
    "Dockerfile",
    "Dockerfile.gstreamer",
    "Makefile",
}

IGNORED_EXACT_MATCHES = {
    "http://www.w3.org/2000/svg",
    "https://json.schemastore.org/tsconfig",
    "https://turbo.build/schema.json",
    "https://ui.shadcn.com/schema.json",
}

URL_PATTERN = re.compile(r"\b(?:https?|wss?|mqtt|tcp|rtsp|turn|stun):(?://)?[^\s'\"`<>)\]]+")
HOST_LITERAL_PATTERN = re.compile(
    r"\b(?:localhost|host\.docker\.internal|127\.0\.0\.1|0\.0\.0\.0|::1)\b"
)
IPV4_PATTERN = re.compile(r"(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])")
BARE_LISTEN_PORT_PATTERN = re.compile(r"(?P<quote>['\"]):(?P<port>\d{2,5})(?P=quote)")
PORT_MAPPING_PATTERN = re.compile(r"(?<![\w.])\d{2,5}:\d{2,5}(?:/(?:tcp|udp))?(?![\w.])")


@dataclass(frozen=True)
class Finding:
    category: str
    file: str
    line: int
    match: str
    text: str


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Scan the repo for hardcoded URLs, IP addresses, and port-like literals."
    )
    parser.add_argument(
        "paths",
        nargs="*",
        default=[str(Path(__file__).resolve().parent.parent)],
        help="Paths to scan. Defaults to the repo root.",
    )
    parser.add_argument(
        "--include-docs",
        action="store_true",
        help="Include markdown and docs files in the scan.",
    )
    parser.add_argument(
        "--include-generated",
        action="store_true",
        help="Include generated/build output directories such as dist and .next.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit findings as JSON instead of human-readable text.",
    )
    return parser.parse_args(argv)


def is_probable_text_file(path: Path, include_docs: bool) -> bool:
    if path.name in DEFAULT_INCLUDED_FILENAMES:
        return True

    suffix = path.suffix.lower()
    if suffix in DEFAULT_INCLUDED_SUFFIXES:
        return True

    if include_docs and suffix in {".md", ".mdx"}:
        return True

    return False


def iter_files(paths: Sequence[str], include_docs: bool, include_generated: bool) -> Iterable[Path]:
    excluded_dirs = set() if include_generated else DEFAULT_EXCLUDED_DIRS

    for raw_path in paths:
        base_path = Path(raw_path).resolve()
        if base_path.is_file():
            if base_path.name not in DEFAULT_EXCLUDED_FILES and is_probable_text_file(
                base_path, include_docs
            ):
                yield base_path
            continue

        for path in base_path.rglob("*"):
            if not path.is_file():
                continue
            if path.name in DEFAULT_EXCLUDED_FILES:
                continue

            relative_parts = set(path.relative_to(base_path).parts)
            if relative_parts & excluded_dirs:
                continue

            if is_probable_text_file(path, include_docs):
                yield path


def is_valid_ipv4(value: str) -> bool:
    try:
        octets = [int(part) for part in value.split(".")]
    except ValueError:
        return False

    return len(octets) == 4 and all(0 <= octet <= 255 for octet in octets)


def normalize_match(raw_match: str) -> str:
    return raw_match.rstrip(".,;")


def should_ignore_match(match: str) -> bool:
    return match in IGNORED_EXACT_MATCHES


def collect_findings(path: Path, repo_root: Path) -> list[Finding]:
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return []

    findings: list[Finding] = []
    relative_path = str(path.relative_to(repo_root))

    for line_number, line in enumerate(text.splitlines(), start=1):
        seen_on_line: set[tuple[str, str]] = set()
        url_spans: list[tuple[int, int]] = [match.span() for match in URL_PATTERN.finditer(line)]

        for category, pattern in (
            ("url", URL_PATTERN),
            ("host_literal", HOST_LITERAL_PATTERN),
            ("ipv4", IPV4_PATTERN),
            ("listen_port", BARE_LISTEN_PORT_PATTERN),
            ("port_mapping", PORT_MAPPING_PATTERN),
        ):
            for match in pattern.finditer(line):
                if category != "url" and any(
                    start <= match.start() and match.end() <= end for start, end in url_spans
                ):
                    continue

                matched_text = normalize_match(match.group(0))
                if category == "ipv4" and not is_valid_ipv4(matched_text):
                    continue
                if should_ignore_match(matched_text):
                    continue

                key = (category, matched_text)
                if key in seen_on_line:
                    continue
                seen_on_line.add(key)

                findings.append(
                    Finding(
                        category=category,
                        file=relative_path,
                        line=line_number,
                        match=matched_text,
                        text=line.strip(),
                    )
                )

    return findings


def render_text(findings: Sequence[Finding]) -> str:
    if not findings:
        return "No hardcoded address-like literals found."

    counts: dict[str, int] = {}
    for finding in findings:
        counts[finding.category] = counts.get(finding.category, 0) + 1

    lines = [
        f"Found {len(findings)} address-like literal(s) across {len({finding.file for finding in findings})} file(s).",
        "",
        "Counts by category:",
    ]
    for category in sorted(counts):
        lines.append(f"- {category}: {counts[category]}")

    lines.append("")
    lines.append("Findings:")
    for finding in findings:
        lines.append(
            f"- [{finding.category}] {finding.file}:{finding.line} -> {finding.match}\n  {finding.text}"
        )

    return "\n".join(lines)


def main(argv: Sequence[str]) -> int:
    args = parse_args(argv)
    repo_root = Path(__file__).resolve().parent.parent
    files = sorted(
        {
            path
            for path in iter_files(
                args.paths,
                include_docs=args.include_docs,
                include_generated=args.include_generated,
            )
        }
    )

    findings: list[Finding] = []
    for path in files:
        findings.extend(collect_findings(path, repo_root))

    findings.sort(key=lambda finding: (finding.file, finding.line, finding.category, finding.match))

    if args.json:
        json.dump([asdict(finding) for finding in findings], sys.stdout, indent=2)
        sys.stdout.write("\n")
        return 0

    print(render_text(findings))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
