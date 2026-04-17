from __future__ import annotations

from datetime import datetime
from typing import Any


def string_value(value: Any, *, default: str = "") -> str:
    if value is None:
        return default
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="ignore").strip()
    if isinstance(value, (str, int, float)):
        return str(value).strip()
    raise TypeError(f"expected a string-like value, got {type(value).__name__}")


def bool_value(value: Any, *, default: bool) -> bool:
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
    raise TypeError(f"expected a boolean-like value, got {type(value).__name__}")


def float_value(value: Any, *, default: float) -> float:
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str) and value.strip():
        return float(value.strip())
    raise TypeError(f"expected a number-like value, got {type(value).__name__}")


def int_value(value: Any, *, default: int) -> int:
    if value is None:
        return default
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str) and value.strip():
        return int(float(value.strip()))
    raise TypeError(f"expected an integer-like value, got {type(value).__name__}")


def sanitize_path_component(value: str, *, fallback: str) -> str:
    candidate = value.strip()
    if candidate == "":
        candidate = fallback
    sanitized = []
    for char in candidate:
        if char.isalnum() or char in {"-", "_"}:
            sanitized.append(char)
        else:
            sanitized.append("-")
    compact = "".join(sanitized).strip("-")
    return compact or fallback


def parse_frame_time(image_id: str) -> datetime | None:
    candidate = image_id.strip()
    if candidate == "":
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%dT%H:%M:%S%z"):
        try:
            return datetime.strptime(candidate, fmt)
        except ValueError:
            continue
    return None
