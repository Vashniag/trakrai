from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def load_request_file(path: str | None) -> dict[str, Any]:
    if not path:
        return {}
    request_path = Path(path).expanduser().resolve()
    payload = json.loads(request_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise SystemExit(f"request file must contain a JSON object: {request_path}")
    return payload


def apply_request_overrides(args: Any, request_payload: dict[str, Any], keys: list[str]) -> None:
    for key in keys:
        if key in request_payload:
            setattr(args, key, request_payload[key])


def require_argument_values(args: Any, required: dict[str, str]) -> None:
    missing: list[str] = []
    for key, flag in required.items():
        value = getattr(args, key, None)
        if value is None:
            missing.append(flag)
            continue
        if isinstance(value, str) and value.strip() == "":
            missing.append(flag)
            continue
        if isinstance(value, (list, tuple, set, dict)) and not value:
            missing.append(flag)
            continue
    if missing:
        raise SystemExit(f"missing required arguments after applying request file: {', '.join(missing)}")
