from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def load_json_object(path: str | Path, *, label: str) -> tuple[Path, dict[str, Any]]:
    config_path = Path(path).expanduser().resolve()
    raw = json.loads(config_path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError(f"{label} must be a JSON object: {config_path}")
    return config_path, raw


def require_object(value: Any, field: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{field} must be an object")
    return value


def optional_object(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def string_value(value: Any, *, default: str = "", field: str | None = None) -> str:
    if value is None:
        return default
    if isinstance(value, (str, int, float)):
        return str(value).strip()
    if field is None:
        raise ValueError(f"expected a string-like value, got {type(value).__name__}")
    raise ValueError(f"{field} must be a string-like value")


def int_value(
    value: Any,
    *,
    default: int | None = None,
    field: str,
    minimum: int | None = None,
    maximum: int | None = None,
) -> int:
    if value is None or value == "":
        if default is None:
            raise ValueError(f"{field} is required")
        parsed = default
    else:
        if isinstance(value, bool):
            parsed = int(value)
        else:
            try:
                parsed = int(value)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"{field} must be an integer") from exc
    if minimum is not None and parsed < minimum:
        raise ValueError(f"{field} must be >= {minimum}")
    if maximum is not None and parsed > maximum:
        raise ValueError(f"{field} must be <= {maximum}")
    return parsed


def float_value(
    value: Any,
    *,
    default: float | None = None,
    field: str,
    minimum: float | None = None,
    maximum: float | None = None,
) -> float:
    if value is None or value == "":
        if default is None:
            raise ValueError(f"{field} is required")
        parsed = default
    else:
        try:
            parsed = float(value)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"{field} must be a number") from exc
    if minimum is not None and parsed < minimum:
        raise ValueError(f"{field} must be >= {minimum}")
    if maximum is not None and parsed > maximum:
        raise ValueError(f"{field} must be <= {maximum}")
    return parsed


def bool_value(value: Any, *, default: bool, field: str | None = None) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "on"}:
            return True
        if normalized in {"0", "false", "no", "off"}:
            return False
    if field is None:
        raise ValueError(f"expected a boolean-like value, got {type(value).__name__}")
    raise ValueError(f"{field} must be a boolean-like value")


def string_list(value: Any, *, field: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError(f"{field} must be a list of strings")
    return [string_value(item, field=field) for item in value]


def resolve_path(base_dir: Path, raw_path: str, *, field: str, required: bool = False) -> Path | None:
    normalized = string_value(raw_path, default="", field=field)
    if not normalized:
        if required:
            raise ValueError(f"{field} is required")
        return None
    path = Path(normalized).expanduser()
    if path.is_absolute():
        return path
    return (base_dir / path).resolve()
