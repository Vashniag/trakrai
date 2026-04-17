from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from . import manifests, paths


SCHEMA_VERSION = "https://json-schema.org/draft/2020-12/schema"
KNOWN_DYNAMIC_MAPS = {
    ("audio-manager", "tts", "voice_map"): {"type": "string"},
    ("runtime-manager", "services", "item", "environment"): {"type": "string"},
}


@dataclass(frozen=True)
class ValidationIssue:
    path: str
    message: str


def pascal_case(value: str) -> str:
    chunks = re.split(r"[^a-zA-Z0-9]+", value)
    return "".join(chunk[:1].upper() + chunk[1:] for chunk in chunks if chunk)


def snake_case(value: str) -> str:
    value = re.sub(r"[^a-zA-Z0-9]+", "_", value)
    value = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", value)
    return value.strip("_").lower()


def _clone_json(value: Any) -> Any:
    return json.loads(json.dumps(value))


def infer_schema_from_value(value: Any, *, path_segments: tuple[str, ...] = (), title: str | None = None) -> dict[str, Any]:
    return infer_schema_from_examples([value], path_segments=path_segments, title=title)


def infer_schema_from_examples(
    values: list[Any],
    *,
    path_segments: tuple[str, ...] = (),
    title: str | None = None,
) -> dict[str, Any]:
    if not values:
        return {}

    default_value = _clone_json(values[0])
    non_null_values = [value for value in values if value is not None]
    if not non_null_values:
        return {"type": "null", "default": None}

    if all(isinstance(value, dict) for value in non_null_values):
        dynamic_override = KNOWN_DYNAMIC_MAPS.get(path_segments)
        if dynamic_override is not None:
            return {
                "type": "object",
                "default": default_value,
                "additionalProperties": dynamic_override,
            }
        properties: dict[str, Any] = {}
        all_keys = sorted({key for value in non_null_values for key in value})
        required = [key for key in all_keys if all(key in value for value in non_null_values)]
        for key in all_keys:
            child_values = [value[key] for value in non_null_values if key in value]
            properties[key] = infer_schema_from_examples(
                child_values,
                path_segments=(*path_segments, key),
                title=pascal_case(key),
            )
        schema: dict[str, Any] = {
            "type": "object",
            "default": default_value,
            "properties": properties,
            "required": required,
            "additionalProperties": False,
        }
        if title:
            schema["title"] = title
        return schema

    if all(isinstance(value, list) for value in non_null_values):
        item_values = [item for value in non_null_values for item in value]
        item_schema = (
            infer_schema_from_examples(item_values, path_segments=(*path_segments, "item"))
            if item_values
            else {}
        )
        return {
            "type": "array",
            "default": default_value,
            "items": item_schema,
        }

    if all(isinstance(value, bool) for value in non_null_values):
        return {"type": "boolean", "default": default_value}
    if all(isinstance(value, int) and not isinstance(value, bool) for value in non_null_values):
        return {"type": "integer", "default": default_value}
    if all(isinstance(value, (int, float)) and not isinstance(value, bool) for value in non_null_values):
        return {"type": "number", "default": default_value}
    if all(isinstance(value, str) for value in non_null_values):
        return {"type": "string", "default": default_value}

    return infer_schema_from_value(non_null_values[0], path_segments=path_segments, title=title)


def service_example_files(service: manifests.ServiceManifest) -> list[Path]:
    if not service.config_name:
        return [service.sample_config_file] if service.sample_config_file else []

    discovered: list[Path] = []
    seen: set[Path] = set()

    def add(path: Path | None) -> None:
        if path is None or not path.exists():
            return
        resolved = path.resolve()
        if resolved in seen:
            return
        seen.add(resolved)
        discovered.append(path)

    add(service.sample_config_file)
    for profile in manifests.load_profiles():
        add(profile.base_config_path / service.config_name)
        for overlay_path in profile.overlay_paths:
            add(overlay_path / service.config_name)
    return discovered


def scaffold_service_schema(service: manifests.ServiceManifest) -> dict[str, Any]:
    example_files = service_example_files(service)
    if not example_files:
        raise SystemExit(f"service {service.name} does not declare any schema examples")
    payloads = [json.loads(path.read_text(encoding="utf-8")) for path in example_files]
    schema = infer_schema_from_examples(payloads, path_segments=(service.name,), title=pascal_case(service.name))
    schema["$schema"] = SCHEMA_VERSION
    schema["title"] = f"{service.display_name} config"
    schema["description"] = service.description
    return schema


def scaffold_all_schemas(*, services: list[str] | None = None, force: bool = False) -> list[Path]:
    written: list[Path] = []
    selected = services or [service.name for service in manifests.load_services() if service.schema_file]
    for name in selected:
        service = manifests.require_service(name)
        schema_path = service.schema_file
        if schema_path is None:
            continue
        if schema_path.exists() and not force:
            continue
        schema_path.parent.mkdir(parents=True, exist_ok=True)
        schema = scaffold_service_schema(service)
        schema_path.write_text(json.dumps(schema, indent=2) + "\n", encoding="utf-8")
        written.append(schema_path)
    return written


def load_schema(service_name: str) -> dict[str, Any]:
    service = manifests.require_service(service_name)
    if service.schema_file is None:
        raise SystemExit(f"service {service_name} does not declare a schema")
    if not service.schema_file.exists():
        raise SystemExit(f"schema does not exist for {service_name}: {service.schema_file}")
    return json.loads(service.schema_file.read_text(encoding="utf-8"))


def generate_defaults(schema: dict[str, Any]) -> Any:
    schema_type = schema.get("type")
    if schema_type == "object":
        properties = schema.get("properties", {})
        result: dict[str, Any] = {}
        default = schema.get("default")
        if isinstance(default, dict):
            result = json.loads(json.dumps(default))
        for key, child in properties.items():
            child_default = generate_defaults(child)
            if child_default is None:
                continue
            if key not in result:
                result[key] = child_default
                continue
            if isinstance(result[key], dict) and isinstance(child_default, dict):
                merged = json.loads(json.dumps(result[key]))
                for child_key, child_value in child_default.items():
                    if child_key not in merged:
                        merged[child_key] = child_value
                result[key] = merged
        return result
    if schema_type == "array":
        if "default" in schema:
            default = schema["default"]
            if isinstance(default, list):
                return json.loads(json.dumps(default))
        return []
    if "default" in schema:
        default = schema["default"]
        if isinstance(default, (dict, list)):
            return json.loads(json.dumps(default))
        return default
    return None


def validate_instance(schema: dict[str, Any], value: Any, *, path: str = "$") -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    schema_type = schema.get("type")
    if schema_type == "object":
        if not isinstance(value, dict):
            return [ValidationIssue(path, "expected object")]
        properties = schema.get("properties", {})
        required = schema.get("required", [])
        additional = schema.get("additionalProperties", True)
        for key in required:
            if key not in value:
                issues.append(ValidationIssue(f"{path}.{key}", "missing required property"))
        for key, child in properties.items():
            if key in value:
                issues.extend(validate_instance(child, value[key], path=f"{path}.{key}"))
        if additional is False:
            for key in value:
                if key not in properties:
                    issues.append(ValidationIssue(f"{path}.{key}", "additional property is not allowed"))
        elif isinstance(additional, dict):
            for key in value:
                if key not in properties:
                    issues.extend(validate_instance(additional, value[key], path=f"{path}.{key}"))
        return issues
    if schema_type == "array":
        if not isinstance(value, list):
            return [ValidationIssue(path, "expected array")]
        item_schema = schema.get("items", {})
        for index, item in enumerate(value):
            issues.extend(validate_instance(item_schema, item, path=f"{path}[{index}]"))
        return issues
    if schema_type == "string":
        if not isinstance(value, str):
            return [ValidationIssue(path, "expected string")]
        minimum_length = schema.get("minLength")
        if isinstance(minimum_length, int) and len(value) < minimum_length:
            issues.append(ValidationIssue(path, f"expected length >= {minimum_length}"))
        pattern = schema.get("pattern")
        if pattern and re.search(pattern, value) is None:
            issues.append(ValidationIssue(path, f"expected to match pattern {pattern!r}"))
        enum = schema.get("enum")
        if isinstance(enum, list) and value not in enum:
            issues.append(ValidationIssue(path, f"expected one of {enum!r}"))
        return issues
    if schema_type == "integer":
        if not isinstance(value, int) or isinstance(value, bool):
            return [ValidationIssue(path, "expected integer")]
        return issues + _numeric_issues(schema, value, path)
    if schema_type == "number":
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            return [ValidationIssue(path, "expected number")]
        return issues + _numeric_issues(schema, float(value), path)
    if schema_type == "boolean":
        if not isinstance(value, bool):
            return [ValidationIssue(path, "expected boolean")]
        return issues
    if schema_type == "null":
        if value is not None:
            return [ValidationIssue(path, "expected null")]
        return issues
    return issues


def _numeric_issues(schema: dict[str, Any], value: float, path: str) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    minimum = schema.get("minimum")
    maximum = schema.get("maximum")
    if isinstance(minimum, (int, float)) and value < float(minimum):
        issues.append(ValidationIssue(path, f"expected value >= {minimum}"))
    if isinstance(maximum, (int, float)) and value > float(maximum):
        issues.append(ValidationIssue(path, f"expected value <= {maximum}"))
    return issues


def validate_service_config(service_name: str, payload: Any) -> list[ValidationIssue]:
    return validate_instance(load_schema(service_name), payload)


def _collect_object_types(name: str, schema: dict[str, Any], ordered: list[tuple[str, dict[str, Any]]], seen: set[str]) -> None:
    schema_type = schema.get("type")
    if schema_type == "object":
        if isinstance(schema.get("additionalProperties"), dict) and not schema.get("properties"):
            _collect_object_types(name + "Value", schema["additionalProperties"], ordered, seen)
            return
        type_name = pascal_case(name)
        if type_name not in seen:
            seen.add(type_name)
            ordered.append((type_name, schema))
        for key, property_schema in schema.get("properties", {}).items():
            _collect_object_types(type_name + pascal_case(key), property_schema, ordered, seen)
        return
    if schema_type == "array":
        _collect_object_types(name + "Item", schema.get("items", {}), ordered, seen)


def _go_type_expr(name: str, schema: dict[str, Any]) -> str:
    schema_type = schema.get("type")
    if schema_type == "object":
        if isinstance(schema.get("additionalProperties"), dict) and not schema.get("properties"):
            value_type = _go_type_expr(name + "Value", schema["additionalProperties"])
            return f"map[string]{value_type}"
        return pascal_case(name)
    if schema_type == "array":
        return "[]" + _go_type_expr(name + "Item", schema.get("items", {}))
    if schema_type == "integer":
        return "int"
    if schema_type == "number":
        return "float64"
    if schema_type == "boolean":
        return "bool"
    return "string"


def _render_go_default(schema: dict[str, Any], value: Any, type_name: str) -> str:
    schema_type = schema.get("type")
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return json.dumps(value)
    if isinstance(value, int) and not isinstance(value, bool):
        return str(value)
    if isinstance(value, float):
        return repr(value)
    if isinstance(value, list):
        if not value:
            return f"{type_name}{{}}"
        item_schema = schema.get("items", {})
        item_type = type_name.removeprefix("[]")
        items = ", ".join(_render_go_default(item_schema, item, item_type) for item in value)
        return f"{type_name}{{{items}}}"
    if isinstance(value, dict):
        if isinstance(schema.get("additionalProperties"), dict) and not schema.get("properties"):
            value_schema = schema["additionalProperties"]
            value_type = type_name.split("]", 1)[1]
            entries = ", ".join(
                f"{json.dumps(str(key))}: {_render_go_default(value_schema, item, value_type)}" for key, item in value.items()
            )
            return f"{type_name}{{{entries}}}"
        fields: list[str] = []
        for key, property_schema in schema.get("properties", {}).items():
            if key not in value:
                continue
            field_type = _go_type_expr(type_name + pascal_case(key), property_schema)
            fields.append(f"{pascal_case(str(key))}: {_render_go_default(property_schema, value[key], field_type)}")
        return f"{type_name}{{" + ", ".join(fields) + "}"
    return "nil"


def generate_go_code(service_name: str, schema: dict[str, Any]) -> str:
    root_type = pascal_case(service_name) + "Config"
    ordered_types: list[tuple[str, dict[str, Any]]] = []
    _collect_object_types(root_type, schema, ordered_types, set())

    lines = [
        "// Code generated by `python -m device.devtool config codegen`. DO NOT EDIT.",
        "",
        f"package generatedconfig",
        "",
        "import (",
        '\t"encoding/json"',
        '\t"os"',
        ")",
        "",
    ]
    for type_name, child_schema in ordered_types:
        if child_schema.get("type") != "object" or (
            isinstance(child_schema.get("additionalProperties"), dict) and not child_schema.get("properties")
        ):
            continue
        lines.append(f"type {type_name} struct " + "{")
        properties = child_schema.get("properties", {})
        for key, property_schema in properties.items():
            field_type = _go_type_expr(type_name + pascal_case(key), property_schema)
            lines.append(f'\t{pascal_case(key)} {field_type} `json:"{key}"`')
        lines.append("}")
        lines.append("")

    default_value = generate_defaults(schema)
    lines.append(f"func Default{root_type}() {root_type} " + "{")
    lines.append(f"\treturn {_render_go_default(schema, default_value, root_type)}")
    lines.append("}")
    lines.append("")
    lines.append(f"func Load{root_type}(path string) ({root_type}, error) " + "{")
    lines.append(f"\tcfg := Default{root_type}()")
    lines.append("\tdata, err := os.ReadFile(path)")
    lines.append("\tif err != nil {")
    lines.append("\t\treturn cfg, err")
    lines.append("\t}")
    lines.append("\tif err := json.Unmarshal(data, &cfg); err != nil {")
    lines.append("\t\treturn cfg, err")
    lines.append("\t}")
    lines.append("\treturn cfg, nil")
    lines.append("}")
    lines.append("")
    return "\n".join(lines)


def _python_type_expr(name: str, schema: dict[str, Any]) -> str:
    schema_type = schema.get("type")
    if schema_type == "object":
        if isinstance(schema.get("additionalProperties"), dict) and not schema.get("properties"):
            value_type = _python_type_expr(name + "Value", schema["additionalProperties"])
            return f"dict[str, {value_type}]"
        return pascal_case(name)
    if schema_type == "array":
        return f"list[{_python_type_expr(name + 'Item', schema.get('items', {}))}]"
    if schema_type == "integer":
        return "int"
    if schema_type == "number":
        return "float"
    if schema_type == "boolean":
        return "bool"
    return "str"


def generate_python_code(service_name: str, schema: dict[str, Any]) -> str:
    root_type = pascal_case(service_name) + "Config"
    ordered_types: list[tuple[str, dict[str, Any]]] = []
    _collect_object_types(root_type, schema, ordered_types, set())
    lines = [
        "# Code generated by `python -m device.devtool config codegen`. DO NOT EDIT.",
        "from __future__ import annotations",
        "",
        "from dataclasses import dataclass",
        "from pathlib import Path",
        "",
        "from ._runtime import load_dataclass_from_json",
        "",
    ]
    for type_name, child_schema in ordered_types:
        if child_schema.get("type") != "object" or (
            isinstance(child_schema.get("additionalProperties"), dict) and not child_schema.get("properties")
        ):
            continue
        lines.append("@dataclass(frozen=True)")
        lines.append(f"class {type_name}:")
        properties = child_schema.get("properties", {})
        if not properties:
            lines.append("    pass")
            lines.append("")
            continue
        for key, property_schema in properties.items():
            field_name = snake_case(key)
            field_type = _python_type_expr(type_name + pascal_case(key), property_schema)
            lines.append(f"    {field_name}: {field_type}")
        lines.append("")
    lines.append(f"DEFAULT_{snake_case(service_name).upper()}_JSON = {json.dumps(json.dumps(generate_defaults(schema)))}")
    lines.append("")
    lines.append(f"def load_{snake_case(service_name)}_config(path: str | Path) -> {root_type}:")
    lines.append(f"    return load_dataclass_from_json(path, {root_type}, default_json=DEFAULT_{snake_case(service_name).upper()}_JSON)")
    lines.append("")
    return "\n".join(lines)


def _delete_stale_codegen_outputs(
    *,
    root: Path,
    suffix: str,
    declared_services: set[str],
    ignored_names: set[str],
) -> list[Path]:
    if not root.exists():
        return []

    deleted: list[Path] = []
    for path in sorted(root.glob(f"*{suffix}")):
        if path.name in ignored_names:
            continue
        service_name = path.stem.replace("_", "-")
        if service_name in declared_services:
            continue
        path.unlink()
        deleted.append(path)
    return deleted


def write_codegen(
    *,
    go_services: list[str],
    python_services: list[str],
    declared_go_services: list[str] | None = None,
    declared_python_services: list[str] | None = None,
) -> tuple[list[Path], list[Path]]:
    written: list[Path] = []
    deleted: list[Path] = []
    go_set = set(go_services)
    python_set = set(python_services)
    selected = sorted(go_set | python_set)

    declared_go_set = set(declared_go_services or go_services)
    declared_python_set = set(declared_python_services or python_services)
    deleted.extend(
        _delete_stale_codegen_outputs(
            root=paths.GO_GENERATED_CONFIG_ROOT,
            suffix=".go",
            declared_services=declared_go_set,
            ignored_names=set(),
        )
    )
    deleted.extend(
        _delete_stale_codegen_outputs(
            root=paths.PYTHON_GENERATED_CONFIG_ROOT,
            suffix=".py",
            declared_services=declared_python_set,
            ignored_names={"__init__.py", "_runtime.py"},
        )
    )

    for service_name in selected:
        go_path = paths.GO_GENERATED_CONFIG_ROOT / f"{service_name.replace('-', '_')}.go"
        py_path = paths.PYTHON_GENERATED_CONFIG_ROOT / f"{service_name.replace('-', '_')}.py"
        if service_name not in go_set and go_path.exists():
            go_path.unlink()
            deleted.append(go_path)
        if service_name not in python_set and py_path.exists():
            py_path.unlink()
            deleted.append(py_path)

    if go_set:
        paths.GO_GENERATED_CONFIG_ROOT.mkdir(parents=True, exist_ok=True)
    if python_set:
        paths.PYTHON_GENERATED_CONFIG_ROOT.mkdir(parents=True, exist_ok=True)
        runtime_path = paths.PYTHON_GENERATED_CONFIG_ROOT / "_runtime.py"
        runtime_path.write_text(
            (
                "from __future__ import annotations\n"
                "import json\n"
                "from dataclasses import is_dataclass, fields\n"
                "from functools import lru_cache\n"
                "from pathlib import Path\n"
                "from typing import Any, get_args, get_origin, get_type_hints\n\n"
                "def _deep_merge(base: Any, override: Any) -> Any:\n"
                "    if isinstance(base, dict) and isinstance(override, dict):\n"
                "        merged = dict(base)\n"
                "        for key, value in override.items():\n"
                "            merged[key] = _deep_merge(merged.get(key), value)\n"
                "        return merged\n"
                "    return override if override is not None else base\n\n"
                "@lru_cache(maxsize=None)\n"
                "def _field_types(cls: Any) -> dict[str, Any]:\n"
                "    return get_type_hints(cls)\n\n"
                "def _convert(value: Any, annotation: Any) -> Any:\n"
                "    origin = get_origin(annotation)\n"
                "    if origin is list:\n"
                "        (item_type,) = get_args(annotation) or (Any,)\n"
                "        return [_convert(item, item_type) for item in (value or [])]\n"
                "    if origin is dict:\n"
                "        key_type, value_type = get_args(annotation) or (str, Any)\n"
                "        return {key_type(key): _convert(item, value_type) for key, item in (value or {}).items()}\n"
                "    if is_dataclass(annotation):\n"
                "        raw = value or {}\n"
                "        type_hints = _field_types(annotation)\n"
                "        return annotation(**{field.name: _convert(raw.get(field.name), type_hints.get(field.name, field.type)) for field in fields(annotation) if field.name in raw})\n"
                "    return value\n\n"
                "def load_dataclass_from_json(path: str | Path, cls: Any, default_json: str = '') -> Any:\n"
                "    raw = json.loads(Path(path).read_text(encoding='utf-8'))\n"
                "    if default_json:\n"
                "        raw = _deep_merge(json.loads(default_json), raw)\n"
                "    return _convert(raw, cls)\n"
            ),
            encoding="utf-8",
        )
        written.append(runtime_path)
        init_path = paths.PYTHON_GENERATED_CONFIG_ROOT / "__init__.py"
        if not init_path.exists():
            init_path.write_text("", encoding="utf-8")
            written.append(init_path)
    for service_name in sorted(go_set):
        schema = load_schema(service_name)
        go_path = paths.GO_GENERATED_CONFIG_ROOT / f"{service_name.replace('-', '_')}.go"
        go_path.write_text(generate_go_code(service_name, schema), encoding="utf-8")
        written.append(go_path)
    for service_name in sorted(python_set):
        schema = load_schema(service_name)
        py_path = paths.PYTHON_GENERATED_CONFIG_ROOT / f"{service_name.replace('-', '_')}.py"
        py_path.write_text(generate_python_code(service_name, schema), encoding="utf-8")
        written.append(py_path)
    return written, deleted
