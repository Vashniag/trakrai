from __future__ import annotations
import json
from dataclasses import is_dataclass, fields
from functools import lru_cache
from pathlib import Path
from typing import Any, get_args, get_origin, get_type_hints

def _deep_merge(base: Any, override: Any) -> Any:
    if isinstance(base, dict) and isinstance(override, dict):
        merged = dict(base)
        for key, value in override.items():
            merged[key] = _deep_merge(merged.get(key), value)
        return merged
    return override if override is not None else base

@lru_cache(maxsize=None)
def _field_types(cls: Any) -> dict[str, Any]:
    return get_type_hints(cls)

def _convert(value: Any, annotation: Any) -> Any:
    origin = get_origin(annotation)
    if origin is list:
        (item_type,) = get_args(annotation) or (Any,)
        return [_convert(item, item_type) for item in (value or [])]
    if origin is dict:
        key_type, value_type = get_args(annotation) or (str, Any)
        return {key_type(key): _convert(item, value_type) for key, item in (value or {}).items()}
    if is_dataclass(annotation):
        raw = value or {}
        type_hints = _field_types(annotation)
        return annotation(**{field.name: _convert(raw.get(field.name), type_hints.get(field.name, field.type)) for field in fields(annotation) if field.name in raw})
    return value

def load_dataclass_from_json(path: str | Path, cls: Any, default_json: str = '') -> Any:
    raw = json.loads(Path(path).read_text(encoding='utf-8'))
    if default_json:
        raw = _deep_merge(json.loads(default_json), raw)
    return _convert(raw, cls)
