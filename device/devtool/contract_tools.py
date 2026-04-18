from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from . import paths, service_contracts


REF_PREFIX = "#/schemas/"
SUPPORTED_OUTPUT_KINDS = {"success", "error", "event"}


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


def _type_prefix(service: service_contracts.ServiceContract) -> str:
    return pascal_case(service.name)


def _type_name(service: service_contracts.ServiceContract, schema_name: str) -> str:
    return _type_prefix(service) + pascal_case(schema_name)


def _service_const_name(service: service_contracts.ServiceContract) -> str:
    return f"{snake_case(service.name).upper()}_SERVICE"


def _method_const_name(service: service_contracts.ServiceContract, method: service_contracts.ContractMethod) -> str:
    return f"{snake_case(service.name).upper()}_{snake_case(method.name).upper()}_METHOD"


def _method_subtopic_const_name(service: service_contracts.ServiceContract, method: service_contracts.ContractMethod) -> str:
    return f"{snake_case(service.name).upper()}_{snake_case(method.name).upper()}_SUBTOPIC"


def _message_const_name(service: service_contracts.ServiceContract, message_type: str) -> str:
    stripped = message_type
    prefix = service.name + "-"
    if stripped.startswith(prefix):
        stripped = stripped[len(prefix) :]
    return f"{snake_case(service.name).upper()}_{snake_case(stripped).upper()}_MESSAGE"


def _parse_ref(service: service_contracts.ServiceContract, ref: str) -> str:
    if not ref.startswith(REF_PREFIX):
        raise SystemExit(f"{service.name}: unsupported schema reference {ref!r}")
    schema_name = ref[len(REF_PREFIX) :]
    service.schema(schema_name)
    return schema_name


def _resolve_schema(
    service: service_contracts.ServiceContract,
    schema: dict[str, Any],
) -> dict[str, Any]:
    if "$ref" in schema:
        return service.schema(_parse_ref(service, str(schema["$ref"])))
    return schema


def _schema_is_named_map(
    service: service_contracts.ServiceContract,
    schema: dict[str, Any],
) -> bool:
    resolved = _resolve_schema(service, schema)
    return (
        resolved.get("type") == "object"
        and not resolved.get("properties")
        and resolved.get("additionalProperties") is not False
    )


def _schema_is_named_object(
    service: service_contracts.ServiceContract,
    schema: dict[str, Any],
) -> bool:
    resolved = _resolve_schema(service, schema)
    return resolved.get("type") == "object" and bool(resolved.get("properties"))


def _validate_schema(
    service: service_contracts.ServiceContract,
    schema: dict[str, Any],
    *,
    path: str,
) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    if "$ref" in schema:
        ref = str(schema["$ref"])
        if not ref.startswith(REF_PREFIX):
            issues.append(ValidationIssue(path, f"unsupported $ref {ref!r}"))
            return issues
        try:
            _parse_ref(service, ref)
        except SystemExit as exc:
            issues.append(ValidationIssue(path, str(exc)))
        return issues

    schema_type = schema.get("type")
    if schema_type not in {"object", "array", "string", "integer", "number", "boolean"}:
        issues.append(ValidationIssue(path, f"unsupported schema type {schema_type!r}"))
        return issues

    if schema_type == "object":
        properties = schema.get("properties", {})
        if properties and not isinstance(properties, dict):
            issues.append(ValidationIssue(path, "object properties must be a map"))
            return issues
        required = schema.get("required", [])
        if required and not isinstance(required, list):
            issues.append(ValidationIssue(path, "required must be an array"))
        for key in required:
            if key not in properties:
                issues.append(ValidationIssue(path, f"required property {key!r} is not declared"))
        for key, child_schema in properties.items():
            if not isinstance(child_schema, dict):
                issues.append(ValidationIssue(f"{path}.properties.{key}", "property schema must be an object"))
                continue
            issues.extend(_validate_schema(service, child_schema, path=f"{path}.properties.{key}"))
        additional = schema.get("additionalProperties", False)
        if additional not in (True, False):
            if not isinstance(additional, dict):
                issues.append(ValidationIssue(path, "additionalProperties must be a boolean or schema object"))
            else:
                issues.extend(_validate_schema(service, additional, path=f"{path}.additionalProperties"))
        return issues

    if schema_type == "array":
        items = schema.get("items")
        if not isinstance(items, dict):
            issues.append(ValidationIssue(path, "array schemas must declare an items schema object"))
            return issues
        issues.extend(_validate_schema(service, items, path=f"{path}.items"))
        return issues

    enum = schema.get("enum")
    if enum is not None and not isinstance(enum, list):
        issues.append(ValidationIssue(path, "enum must be an array"))
    return issues


def validate_service_contracts() -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    seen_services: set[str] = set()
    for service in service_contracts.load_service_contracts():
        service_path = f"services[{service.name}]"
        if service.name in seen_services:
            issues.append(ValidationIssue(service_path, "duplicate service name"))
        seen_services.add(service.name)

        for schema_name, schema in service.schemas.items():
            issues.extend(_validate_schema(service, schema, path=f"{service_path}.schemas.{schema_name}"))

        seen_messages: set[str] = set()
        for message_type, message in service.messages.items():
            if message_type in seen_messages:
                issues.append(ValidationIssue(f"{service_path}.messages.{message_type}", "duplicate message type"))
            seen_messages.add(message_type)
            if message.schema_name not in service.schemas:
                issues.append(
                    ValidationIssue(
                        f"{service_path}.messages.{message_type}",
                        f"unknown schema {message.schema_name!r}",
                    )
                )

        seen_method_keys: set[tuple[str, str]] = set()
        for method in service.methods:
            method_key = (method.subtopic, method.name)
            if method_key in seen_method_keys:
                issues.append(
                    ValidationIssue(
                        f"{service_path}.methods.{method.name}",
                        f"duplicate method for subtopic {method.subtopic!r}",
                    )
                )
            seen_method_keys.add(method_key)
            if method.request_schema not in service.schemas:
                issues.append(
                    ValidationIssue(
                        f"{service_path}.methods.{method.name}",
                        f"unknown request schema {method.request_schema!r}",
                    )
                )
            for alias in method.aliases:
                if not alias:
                    issues.append(ValidationIssue(f"{service_path}.methods.{method.name}", "aliases must be non-empty"))
            for output in method.outputs:
                if output.kind not in SUPPORTED_OUTPUT_KINDS:
                    issues.append(
                        ValidationIssue(
                            f"{service_path}.methods.{method.name}.outputs.{output.message_type}",
                            f"unsupported output kind {output.kind!r}",
                        )
                    )
                if output.message_type not in service.messages:
                    issues.append(
                        ValidationIssue(
                            f"{service_path}.methods.{method.name}.outputs.{output.message_type}",
                            "references unknown message type",
                        )
                    )
    return issues


def _go_type_expr(service: service_contracts.ServiceContract, schema: dict[str, Any], name: str) -> str:
    if "$ref" in schema:
        return _type_name(service, _parse_ref(service, str(schema["$ref"])))

    schema_type = schema.get("type")
    if schema_type == "object":
        additional = schema.get("additionalProperties", False)
        properties = schema.get("properties", {})
        if not properties and additional is True:
            return "map[string]interface{}"
        if not properties and isinstance(additional, dict):
            value_type = _go_type_expr(service, additional, name + "Value")
            return f"map[string]{value_type}"
        return name
    if schema_type == "array":
        return f"[]{_go_type_expr(service, schema.get('items', {}), name + 'Item')}"
    if schema_type == "integer":
        return "int"
    if schema_type == "number":
        return "float64"
    if schema_type == "boolean":
        return "bool"
    return "string"


def _collect_go_types(
    service: service_contracts.ServiceContract,
    type_name: str,
    schema: dict[str, Any],
    ordered: list[tuple[str, dict[str, Any]]],
    seen: set[str],
) -> None:
    if "$ref" in schema:
        ref_name = _parse_ref(service, str(schema["$ref"]))
        ref_type_name = _type_name(service, ref_name)
        if ref_type_name in seen:
            return
        _collect_go_types(service, ref_type_name, service.schema(ref_name), ordered, seen)
        return

    resolved = _resolve_schema(service, schema)
    schema_type = resolved.get("type")
    if schema_type != "object":
        if schema_type == "array":
            _collect_go_types(service, type_name + "Item", resolved.get("items", {}), ordered, seen)
        return

    if type_name in seen:
        return
    seen.add(type_name)
    ordered.append((type_name, resolved))

    for key, child_schema in resolved.get("properties", {}).items():
        _collect_go_types(service, type_name + pascal_case(key), child_schema, ordered, seen)

    additional = resolved.get("additionalProperties", False)
    if isinstance(additional, dict):
        _collect_go_types(service, type_name + "Value", additional, ordered, seen)


def _python_type_expr(service: service_contracts.ServiceContract, schema: dict[str, Any], name: str) -> str:
    if "$ref" in schema:
        return _type_name(service, _parse_ref(service, str(schema["$ref"])))

    schema_type = schema.get("type")
    if schema_type == "object":
        additional = schema.get("additionalProperties", False)
        properties = schema.get("properties", {})
        if not properties and additional is True:
            return "Dict[str, Any]"
        if not properties and isinstance(additional, dict):
            value_type = _python_type_expr(service, additional, name + "Value")
            return f"Dict[str, {value_type}]"
        return name
    if schema_type == "array":
        return f"List[{_python_type_expr(service, schema.get('items', {}), name + 'Item')}]"
    if schema_type == "integer":
        return "int"
    if schema_type == "number":
        return "float"
    if schema_type == "boolean":
        return "bool"
    return "str"


def _python_field_decl(
    service: service_contracts.ServiceContract,
    type_name: str,
    key: str,
    schema: dict[str, Any],
    *,
    required: bool,
) -> str:
    field_name = snake_case(key)
    base_type = _python_type_expr(service, schema, type_name + pascal_case(key))
    metadata_expr = f'{{"wire_name": {json.dumps(key)}}}'
    if required:
        return f"    {field_name}: {base_type} = field(metadata={metadata_expr})"
    return f"    {field_name}: Optional[{base_type}] = field(default=None, metadata={metadata_expr})"


def _method_handler_name(method: service_contracts.ContractMethod) -> str:
    return "Handle" + pascal_case(method.name)


def _schema_parse_func(service: service_contracts.ServiceContract, schema_name: str) -> str:
    return "Parse" + _type_name(service, schema_name)


def _message_parse_func(service: service_contracts.ServiceContract, message_type: str) -> str:
    message = service.message(message_type)
    return _schema_parse_func(service, message.schema_name)


def _client_method_candidates(
    service: service_contracts.ServiceContract,
) -> list[tuple[service_contracts.ContractMethod, service_contracts.ContractOutput, service_contracts.ContractOutput | None]]:
    methods: list[tuple[service_contracts.ContractMethod, service_contracts.ContractOutput, service_contracts.ContractOutput | None]] = []
    for method in service.methods:
        if method.subtopic != "command":
            continue
        success_outputs = [output for output in method.outputs if output.kind == "success" and output.subtopic == "response"]
        if len(success_outputs) != 1:
            continue
        error_output = next((output for output in method.outputs if output.kind == "error" and output.subtopic == "response"), None)
        methods.append((method, success_outputs[0], error_output))
    return methods


def generate_go_code(service: service_contracts.ServiceContract) -> str:
    prefix = _type_prefix(service)
    ordered_types: list[tuple[str, dict[str, Any]]] = []
    seen_types: set[str] = set()
    for schema_name, schema in service.schemas.items():
        _collect_go_types(service, _type_name(service, schema_name), schema, ordered_types, seen_types)

    lines = [
        "// Code generated by `python -m device.devtool contract codegen`. DO NOT EDIT.",
        "",
        "package contracts",
        "",
        "import (",
        '\t"context"',
        '\t"encoding/json"',
        '\t"fmt"',
        '\t"strings"',
        "",
        '\t"github.com/trakrai/device-services/internal/ipc"',
        ")",
        "",
        "const (",
        f'\t{prefix}Service = "{service.name}"',
    ]
    for method in service.methods:
        lines.append(f'\t{prefix}{pascal_case(method.name)}Method = "{method.name}"')
        lines.append(f'\t{prefix}{pascal_case(method.name)}Subtopic = "{method.subtopic}"')
    for message_type in service.messages:
        stripped = message_type
        prefix_token = service.name + "-"
        if stripped.startswith(prefix_token):
            stripped = stripped[len(prefix_token) :]
        lines.append(f'\t{prefix}{pascal_case(stripped)}Message = "{message_type}"')
    lines.extend([")", ""])

    for type_name, schema in ordered_types:
        additional = schema.get("additionalProperties", False)
        properties = schema.get("properties", {})
        if not properties and additional is True:
            lines.append(f"type {type_name} map[string]interface{{}}")
            lines.append("")
            continue
        if not properties and isinstance(additional, dict):
            value_type = _go_type_expr(service, additional, type_name + "Value")
            lines.append(f"type {type_name} map[string]{value_type}")
            lines.append("")
            continue
        lines.append(f"type {type_name} struct " + "{")
        required = set(schema.get("required", []))
        for key, child_schema in properties.items():
            field_type = _go_type_expr(service, child_schema, type_name + pascal_case(key))
            json_tag = key
            if key not in required:
                json_tag += ",omitempty"
            lines.append(f'\t{pascal_case(key)} {field_type} `json:"{json_tag}"`')
        lines.append("}")
        lines.append("")
    for schema_name in service.schemas:
        type_name = _type_name(service, schema_name)
        lines.append(f"func {_schema_parse_func(service, schema_name)}(payload json.RawMessage) ({type_name}, error) " + "{")
        lines.append(f"\tvar decoded {type_name}")
        lines.append("\tif len(payload) == 0 {")
        lines.append('\t\tpayload = json.RawMessage(`{}`)')
        lines.append("\t}")
        lines.append("\tif err := json.Unmarshal(payload, &decoded); err != nil {")
        lines.append('\t\treturn decoded, fmt.Errorf("decode payload: %w", err)')
        lines.append("\t}")
        lines.append("\treturn decoded, nil")
        lines.append("}")
        lines.append("")
    lines.append(f"type {prefix}Handler interface " + "{")
    for method in service.methods:
        request_type = _type_name(service, method.request_schema)
        lines.append(f"\t{_method_handler_name(method)}(ctx context.Context, sourceService string, request {request_type}) error")
    lines.append("}")
    lines.append("")
    lines.append(
        f"func Dispatch{prefix}(ctx context.Context, sourceService string, subtopic string, env ipc.MQTTEnvelope, handler {prefix}Handler) (bool, error) " + "{"
    )
    lines.append('\tnormalizedSubtopic := strings.Trim(strings.TrimSpace(subtopic), "/")')
    lines.append("\tnormalizedType := strings.TrimSpace(env.Type)")
    lines.append("\tswitch normalizedSubtopic {")
    subtopics = sorted({method.subtopic for method in service.methods})
    for subtopic in subtopics:
        lines.append(f'\tcase "{subtopic}":')
        lines.append("\t\tswitch normalizedType {")
        for method in [item for item in service.methods if item.subtopic == subtopic]:
            case_values = [f"{prefix}{pascal_case(method.name)}Method"] + [json.dumps(alias) for alias in method.aliases]
            lines.append("\t\tcase " + ", ".join(case_values) + ":")
            lines.append(
                f"\t\t\trequest, err := {_schema_parse_func(service, method.request_schema)}(env.Payload)"
            )
            lines.append("\t\t\tif err != nil {")
            lines.append(f'\t\t\t\treturn true, fmt.Errorf("decode {method.name}: %w", err)')
            lines.append("\t\t\t}")
            lines.append(
                f"\t\t\treturn true, handler.{_method_handler_name(method)}(ctx, sourceService, request)"
            )
        lines.append("\t\tdefault:")
        lines.append("\t\t\treturn false, nil")
        lines.append("\t\t}")
    lines.append("\tdefault:")
    lines.append("\t\treturn false, nil")
    lines.append("\t}")
    lines.append("}")
    lines.append("")

    client_methods = _client_method_candidates(service)
    if client_methods:
        lines.append(f"type {prefix}Client struct " + "{")
        lines.append("\tipcClient *ipc.Client")
        lines.append("\tresponseRouter *ipc.ResponseRouter")
        lines.append("\ttargetService string")
        lines.append("}")
        lines.append("")
        lines.append(
            f"func New{prefix}Client(ipcClient *ipc.Client, responseRouter *ipc.ResponseRouter, targetService string) *{prefix}Client " + "{"
        )
        lines.append('\tif strings.TrimSpace(targetService) == "" {')
        lines.append(f"\t\ttargetService = {prefix}Service")
        lines.append("\t}")
        lines.append(f"\treturn &{prefix}Client" + "{")
        lines.append("\t\tipcClient: ipcClient,")
        lines.append("\t\tresponseRouter: responseRouter,")
        lines.append("\t\ttargetService: strings.TrimSpace(targetService),")
        lines.append("\t}")
        lines.append("}")
        lines.append("")
        for method, success_output, error_output in client_methods:
            success_type = _type_name(service, service.message(success_output.message_type).schema_name)
            lines.append(
                f"func (c *{prefix}Client) {pascal_case(method.name)}(ctx context.Context, request {_type_name(service, method.request_schema)}) ({success_type}, error) " + "{"
            )
            lines.append(
                f"\tmessage, err := c.responseRouter.Request(ctx, c.ipcClient, c.targetService, {prefix}{pascal_case(method.name)}Method, request)"
            )
            lines.append("\tif err != nil {")
            lines.append(f"\t\treturn {success_type}" + "{}, err")
            lines.append("\t}")
            lines.append(
                f"\treturn Decode{prefix}{pascal_case(method.name)}Response(message)"
            )
            lines.append("}")
            lines.append("")
            lines.append(
                f"func Decode{prefix}{pascal_case(method.name)}Response(message ipc.ServiceMessageNotification) ({success_type}, error) " + "{"
            )
            lines.append("\tswitch strings.TrimSpace(message.Envelope.Type) {")
            lines.append(f"\tcase {prefix}{pascal_case(success_output.message_type.removeprefix(service.name + '-'))}Message:")
            lines.append(
                f"\t\treturn {_message_parse_func(service, success_output.message_type)}(message.Envelope.Payload)"
            )
            if error_output is not None:
                error_type = _type_name(service, service.message(error_output.message_type).schema_name)
                lines.append(f"\tcase {prefix}{pascal_case(error_output.message_type.removeprefix(service.name + '-'))}Message:")
                lines.append(
                    f"\t\terrorPayload, err := {_message_parse_func(service, error_output.message_type)}(message.Envelope.Payload)"
                )
                lines.append("\t\tif err != nil {")
                lines.append(f"\t\t\treturn {success_type}" + "{}, err")
                lines.append("\t\t}")
                lines.append(f"\t\treturn {success_type}" + "{}, fmt.Errorf(strings.TrimSpace(errorPayload.Error))")
                lines.append("\tdefault:")
                lines.append(
                    f'\t\treturn {success_type}' + "{}, fmt.Errorf(\"unexpected " + method.name + " response type %q\", message.Envelope.Type)"
                )
            else:
                lines.append("\tdefault:")
                lines.append(
                    f'\t\treturn {success_type}' + "{}, fmt.Errorf(\"unexpected " + method.name + " response type %q\", message.Envelope.Type)"
                )
            lines.append("\t}")
            lines.append("}")
            lines.append("")
    return "\n".join(lines)


def generate_python_code(service: service_contracts.ServiceContract) -> str:
    prefix = _type_prefix(service)
    ordered_types: list[tuple[str, dict[str, Any]]] = []
    seen_types: set[str] = set()
    for schema_name, schema in service.schemas.items():
        _collect_go_types(service, _type_name(service, schema_name), schema, ordered_types, seen_types)

    lines = [
        "# Code generated by `python -m device.devtool contract codegen`. DO NOT EDIT.",
        "from __future__ import annotations",
        "",
        "from dataclasses import dataclass, field",
        "from typing import Any, Dict, List, Mapping, Optional, Protocol",
        "",
        "from trakrai_service_runtime import ServiceRequestBridge",
        "",
        "from ._runtime import convert_value, to_wire_value",
        "",
        f'{_service_const_name(service)} = "{service.name}"',
    ]
    for method in service.methods:
        lines.append(f'{_method_const_name(service, method)} = "{method.name}"')
        lines.append(f'{_method_subtopic_const_name(service, method)} = "{method.subtopic}"')
    for message_type in service.messages:
        stripped = message_type
        prefix_token = service.name + "-"
        if stripped.startswith(prefix_token):
            stripped = stripped[len(prefix_token) :]
        lines.append(f'{_message_const_name(service, message_type)} = "{message_type}"')
    lines.extend(["", ""])

    for type_name, schema in ordered_types:
        additional = schema.get("additionalProperties", False)
        properties = schema.get("properties", {})
        if not properties and additional is True:
            lines.append(f"{type_name} = Dict[str, Any]")
            lines.append("")
            continue
        if not properties and isinstance(additional, dict):
            value_type = _python_type_expr(service, additional, type_name + "Value")
            lines.append(f"{type_name} = Dict[str, {value_type}]")
            lines.append("")
            continue
        lines.append("@dataclass(frozen=True)")
        lines.append(f"class {type_name}:")
        if not properties:
            lines.append("    pass")
            lines.append("")
            continue
        required = set(schema.get("required", []))
        ordered_properties = [
            *[(key, properties[key]) for key in properties if key in required],
            *[(key, properties[key]) for key in properties if key not in required],
        ]
        for key, child_schema in ordered_properties:
            lines.append(
                _python_field_decl(
                    service,
                    type_name,
                    key,
                    child_schema,
                    required=key in required,
                )
            )
        lines.append("")
    for schema_name in service.schemas:
        type_name = _type_name(service, schema_name)
        lines.append(
            f"def {snake_case(_schema_parse_func(service, schema_name))}(payload: Optional[Mapping[str, Any]]) -> {type_name}:"
        )
        lines.append(f"    return convert_value(dict(payload or {{}}), {type_name})")
        lines.append("")
    lines.append(f"class {prefix}Handler(Protocol):")
    for method in service.methods:
        request_type = _type_name(service, method.request_schema)
        lines.append(
            f"    def {snake_case(_method_handler_name(method))}(self, source_service: str, request: {request_type}) -> None: ..."
        )
    lines.append("")
    lines.append(
        f"def dispatch_{snake_case(service.name)}(source_service: str, subtopic: str, envelope: Mapping[str, Any], handler: {prefix}Handler) -> bool:"
    )
    lines.append('    normalized_subtopic = str(subtopic or "").strip().strip("/")')
    lines.append('    message_type = str(envelope.get("type", "")).strip()')
    lines.append('    payload = envelope.get("payload", {})')
    lines.append("    if not isinstance(payload, Mapping):")
    lines.append("        payload = {}")
    for method in service.methods:
        conditions = [f'normalized_subtopic == "{method.subtopic}"', f'message_type == {_method_const_name(service, method)}']
        for alias in method.aliases:
            conditions.append(f'message_type == {json.dumps(alias)}')
        prefix_token = "if" if method == service.methods[0] else "elif"
        lines.append(f"    {prefix_token} " + " and ".join(conditions) + ":")
        lines.append(
            f"        handler.{snake_case(_method_handler_name(method))}("
            "source_service, "
            f"{snake_case(_schema_parse_func(service, method.request_schema))}(payload)"
            ")"
        )
        lines.append("        return True")
    lines.append("    return False")
    lines.append("")

    client_methods = _client_method_candidates(service)
    if client_methods:
        lines.append(f"class {prefix}Client:")
        lines.append("    def __init__(self, bridge: ServiceRequestBridge, target_service: str = \"\") -> None:")
        lines.append("        self._bridge = bridge")
        lines.append(f"        self._target_service = target_service.strip() or {_service_const_name(service)}")
        lines.append("")
        for method, success_output, error_output in client_methods:
            success_type = _type_name(service, service.message(success_output.message_type).schema_name)
            parse_success = snake_case(_message_parse_func(service, success_output.message_type))
            lines.append(
                f"    def {snake_case(method.name)}(self, request: {_type_name(service, method.request_schema)}, timeout_sec: float = 5.0) -> {success_type}:"
            )
            expected_types = [
                _message_const_name(service, success_output.message_type),
            ]
            if error_output is not None:
                expected_types.append(_message_const_name(service, error_output.message_type))
            expected_expr = "{" + ", ".join(expected_types) + "}"
            lines.append("        response = self._bridge.request(")
            lines.append("            target_service=self._target_service,")
            lines.append(f"            message_type={_method_const_name(service, method)},")
            lines.append("            payload=to_wire_value(request),")
            lines.append(f"            expected_types={expected_expr},")
            lines.append("            timeout_sec=timeout_sec,")
            lines.append("        )")
            if error_output is not None:
                parse_error = snake_case(_message_parse_func(service, error_output.message_type))
                lines.append(f"        if response['type'] == {_message_const_name(service, error_output.message_type)}:")
                lines.append(f"            error_payload = {parse_error}(response['payload'])")
                lines.append("            raise RuntimeError(str(error_payload.error).strip())")
            lines.append(f"        return {parse_success}(response['payload'])")
            lines.append("")
    return "\n".join(lines)


def _ts_type_name(service: service_contracts.ServiceContract, schema_name: str) -> str:
    return f"{_type_prefix(service)}_{pascal_case(schema_name)}"


def _ts_message_alias(service: service_contracts.ServiceContract, message_type: str) -> str:
    stripped = message_type
    prefix = service.name + "-"
    if stripped.startswith(prefix):
        stripped = stripped[len(prefix) :]
    return f"{_type_prefix(service)}_{pascal_case(stripped)}_Message"


def _ts_method_alias_prefix(
    service: service_contracts.ServiceContract,
    method: service_contracts.ContractMethod,
) -> str:
    return f"{_type_prefix(service)}_{pascal_case(method.name)}"


def _ts_type_expr(service: service_contracts.ServiceContract, schema: dict[str, Any], name: str) -> str:
    if "$ref" in schema:
        return _ts_type_name(service, _parse_ref(service, str(schema["$ref"])))

    schema_type = schema.get("type")
    if schema_type == "object":
        additional = schema.get("additionalProperties", False)
        properties = schema.get("properties", {})
        if not properties and additional is True:
            return "Record<string, unknown>"
        if not properties and isinstance(additional, dict):
            value_type = _ts_type_expr(service, additional, name + "Value")
            return f"Record<string, {value_type}>"
        if not properties:
            return "Record<string, never>"
        return name
    if schema_type == "array":
        return f"Array<{_ts_type_expr(service, schema.get('items', {}), name + 'Item')}>"
    if schema_type in {"integer", "number"}:
        return "number"
    if schema_type == "boolean":
        return "boolean"
    if schema_type == "string":
        enum = schema.get("enum")
        if isinstance(enum, list) and enum:
            return " | ".join(json.dumps(str(item)) for item in enum)
        return "string"
    return "unknown"


def _ts_property_name(name: str) -> str:
    if re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]*", name):
        return name
    return json.dumps(name)


def generate_typescript_code(service: service_contracts.ServiceContract) -> str:
    ordered_types: list[tuple[str, dict[str, Any]]] = []
    seen_types: set[str] = set()
    for schema_name, schema in service.schemas.items():
        _collect_go_types(service, _ts_type_name(service, schema_name), schema, ordered_types, seen_types)

    lines = [
        "// Code generated by `python -m device.devtool contract codegen`. DO NOT EDIT.",
        "'use client';",
        "",
        "import {",
        "  defineServiceContract,",
        "  defineServiceContractMethod,",
        "  defineServiceContractOutput,",
        "  type ServiceContractOutput,",
        "} from '../lib/service-contract-runtime';",
        "",
        f"export const {_service_const_name(service)} = {json.dumps(service.name)};",
    ]
    for method in service.methods:
        lines.append(
            f"export const {_method_const_name(service, method)} = {json.dumps(method.name)};"
        )
        lines.append(
            f"export const {_method_subtopic_const_name(service, method)} = {json.dumps(method.subtopic)};"
        )
    for message_type in service.messages:
        lines.append(
            f"export const {_message_const_name(service, message_type)} = {json.dumps(message_type)};"
        )
    lines.append("")

    for type_name, schema in ordered_types:
        additional = schema.get("additionalProperties", False)
        properties = schema.get("properties", {})
        if not properties and additional is True:
            lines.append(f"export type {type_name} = Readonly<Record<string, unknown>>;")
            lines.append("")
            continue
        if not properties and isinstance(additional, dict):
            value_type = _ts_type_expr(service, additional, type_name + "Value")
            lines.append(f"export type {type_name} = Readonly<Record<string, {value_type}>>;")
            lines.append("")
            continue
        if not properties:
            lines.append(f"export type {type_name} = Readonly<Record<string, never>>;")
            lines.append("")
            continue

        lines.append(f"export type {type_name} = Readonly<" + "{")
        required = set(schema.get("required", []))
        for key, child_schema in properties.items():
            optional = "" if key in required else "?"
            field_type = _ts_type_expr(service, child_schema, type_name + pascal_case(key))
            lines.append(f"  {_ts_property_name(key)}{optional}: {field_type};")
        lines.append("}>;")
        lines.append("")

    for message_type, message in service.messages.items():
        lines.append(
            f"export type {_ts_message_alias(service, message_type)} = {_ts_type_name(service, message.schema_name)};"
        )
    if service.messages:
        lines.append("")

    for method in service.methods:
        method_prefix = _ts_method_alias_prefix(service, method)
        request_type = _ts_type_name(service, method.request_schema)
        success_output = next(
            (
                output
                for output in method.outputs
                if output.kind == "success" and output.subtopic == "response"
            ),
            None,
        )
        error_output = next(
            (
                output
                for output in method.outputs
                if output.kind == "error" and output.subtopic == "response"
            ),
            None,
        )
        lines.append(f"export type {method_prefix}_Input = {request_type};")
        lines.append(
            f"export type {method_prefix}_Output = "
            + (
                _ts_type_name(service, service.message(success_output.message_type).schema_name)
                if success_output is not None
                else "void"
            )
            + ";"
        )
        lines.append(
            f"export type {method_prefix}_Error = "
            + (
                _ts_type_name(service, service.message(error_output.message_type).schema_name)
                if error_output is not None
                else "never"
            )
            + ";"
        )
    if service.methods:
        lines.append("")

    contract_name = snake_case(service.name)
    lines.append(f"export const {contract_name}Contract = defineServiceContract(" + "{")
    lines.append(f"  name: {_service_const_name(service)},")
    lines.append("  methods: {")
    for method in service.methods:
        method_prefix = _ts_method_alias_prefix(service, method)
        output_tuple_types = ", ".join(
            (
                "ServiceContractOutput<"
                f"{_ts_type_name(service, service.message(output.message_type).schema_name)}, "
                f"{json.dumps(output.kind)}, "
                f"typeof {_message_const_name(service, output.message_type)}, "
                f"{json.dumps(output.subtopic)}"
                ">"
            )
            for output in method.outputs
        )
        method_outputs_type = f"readonly [{output_tuple_types}]" if output_tuple_types else "readonly []"
        lines.append(
            f"    {json.dumps(method.name)}: defineServiceContractMethod<{method_prefix}_Input, {method_outputs_type}>("
            + "{"
        )
        if method.aliases:
            aliases = ", ".join(json.dumps(alias) for alias in method.aliases)
            lines.append(f"      aliases: [{aliases}] as const,")
        lines.append("      outputs: [")
        for output in method.outputs:
            output_type = _ts_type_name(service, service.message(output.message_type).schema_name)
            lines.append(
                "        defineServiceContractOutput<"
                f"{output_type}, "
                f"{json.dumps(output.kind)}, "
                f"typeof {_message_const_name(service, output.message_type)}, "
                f"{json.dumps(output.subtopic)}"
                ">("
                + "{"
            )
            lines.append(f"          kind: {json.dumps(output.kind)},")
            lines.append(
                f"          messageType: {_message_const_name(service, output.message_type)},"
            )
            lines.append(f"          subtopic: {json.dumps(output.subtopic)},")
            lines.append("        }),")
        lines.append("      ] as const,")
        lines.append(f"      subtopic: {_method_subtopic_const_name(service, method)},")
        lines.append("    }),")
    lines.append("  },")
    lines.append("});")
    lines.append("")
    lines.append(f"export type {_type_prefix(service)}Contract = typeof {contract_name}Contract;")
    lines.append("")
    return "\n".join(lines)


def generate_typescript_index(service_names: list[str]) -> str:
    lines = [
        "// Code generated by `python -m device.devtool contract codegen`. DO NOT EDIT.",
        "'use client';",
        "",
    ]
    for service_name in sorted(service_names):
        module_name = service_name.replace("-", "_")
        lines.append(f"export * from './{module_name}';")
    lines.append("")
    return "\n".join(lines)


def _python_runtime_source() -> str:
    return "\n".join(
        [
            "from __future__ import annotations",
            "from dataclasses import fields, is_dataclass",
            "from functools import lru_cache",
            "from typing import Any, Mapping, Union, get_args, get_origin, get_type_hints",
            "import types",
            "",
            "_UNION_TYPE = getattr(types, \"UnionType\", None)",
            "",
            "@lru_cache(maxsize=None)",
            "def _field_types(cls: Any) -> dict[str, Any]:",
            "    return get_type_hints(cls)",
            "",
            "def _wire_name(field: Any) -> str:",
            "    return str(field.metadata.get(\"wire_name\", field.name))",
            "",
            "def _convert_primitive(value: Any, annotation: Any) -> Any:",
            "    if value is None:",
            "        return None",
            "    if annotation is bool:",
            "        return bool(value)",
            "    if annotation is int:",
            "        return int(value)",
            "    if annotation is float:",
            "        return float(value)",
            "    if annotation is str:",
            "        return str(value)",
            "    return value",
            "",
            "def convert_value(value: Any, annotation: Any) -> Any:",
            "    if annotation is Any:",
            "        return value",
            "    origin = get_origin(annotation)",
            "    if origin in (list,):",
            "        (item_type,) = get_args(annotation) or (Any,)",
            "        return [convert_value(item, item_type) for item in (value or [])]",
            "    if origin in (dict,):",
            "        _key_type, value_type = get_args(annotation) or (str, Any)",
            "        return {str(key): convert_value(item, value_type) for key, item in dict(value or {}).items()}",
            "    if origin is Union or (_UNION_TYPE is not None and origin is _UNION_TYPE):",
            "        args = [item for item in get_args(annotation) if item is not type(None)]",
            "        if value is None:",
            "            return None",
            "        if len(args) == 1:",
            "            return convert_value(value, args[0])",
            "    if is_dataclass(annotation):",
            "        raw = value or {}",
            "        if not isinstance(raw, Mapping):",
            "            raise TypeError(f'expected mapping for {annotation.__name__}, got {type(raw).__name__}')",
            "        type_hints = _field_types(annotation)",
            "        kwargs: dict[str, Any] = {}",
            "        for field in fields(annotation):",
            "            wire_name = _wire_name(field)",
            "            if wire_name in raw:",
            "                kwargs[field.name] = convert_value(raw[wire_name], type_hints.get(field.name, field.type))",
            "        return annotation(**kwargs)",
            "    return _convert_primitive(value, annotation)",
            "",
            "def to_wire_value(value: Any) -> Any:",
            "    if is_dataclass(value):",
            "        payload: dict[str, Any] = {}",
            "        for field in fields(value):",
            "            child = getattr(value, field.name)",
            "            if child is None:",
            "                continue",
            "            payload[_wire_name(field)] = to_wire_value(child)",
            "        return payload",
            "    if isinstance(value, list):",
            "        return [to_wire_value(item) for item in value]",
            "    if isinstance(value, dict):",
            "        return {str(key): to_wire_value(item) for key, item in value.items() if item is not None}",
            "    return value",
            "",
        ]
    )


def _delete_stale_outputs(
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
    typescript_services: list[str],
    declared_go_services: list[str] | None = None,
    declared_python_services: list[str] | None = None,
    declared_typescript_services: list[str] | None = None,
) -> tuple[list[Path], list[Path]]:
    written: list[Path] = []
    deleted: list[Path] = []
    go_set = set(go_services)
    python_set = set(python_services)
    typescript_set = set(typescript_services)
    declared_go_set = set(declared_go_services or go_services)
    declared_python_set = set(declared_python_services or python_services)
    declared_typescript_set = set(declared_typescript_services or typescript_services)

    deleted.extend(
        _delete_stale_outputs(
            root=paths.GO_GENERATED_SERVICE_CONTRACT_ROOT,
            suffix=".go",
            declared_services=declared_go_set,
            ignored_names=set(),
        )
    )
    deleted.extend(
        _delete_stale_outputs(
            root=paths.PYTHON_GENERATED_SERVICE_CONTRACT_ROOT,
            suffix=".py",
            declared_services=declared_python_set,
            ignored_names={"__init__.py", "_runtime.py"},
        )
    )
    deleted.extend(
        _delete_stale_outputs(
            root=paths.WEB_GENERATED_SERVICE_CONTRACT_ROOT,
            suffix=".ts",
            declared_services=declared_typescript_set,
            ignored_names={"index.ts"},
        )
    )

    if go_set:
        paths.GO_GENERATED_SERVICE_CONTRACT_ROOT.mkdir(parents=True, exist_ok=True)
    if python_set:
        paths.PYTHON_GENERATED_SERVICE_CONTRACT_ROOT.mkdir(parents=True, exist_ok=True)
        runtime_path = paths.PYTHON_GENERATED_SERVICE_CONTRACT_ROOT / "_runtime.py"
        runtime_path.write_text(_python_runtime_source(), encoding="utf-8")
        written.append(runtime_path)
        init_path = paths.PYTHON_GENERATED_SERVICE_CONTRACT_ROOT / "__init__.py"
        if not init_path.exists():
            init_path.write_text("", encoding="utf-8")
            written.append(init_path)
    if typescript_set:
        paths.WEB_GENERATED_SERVICE_CONTRACT_ROOT.mkdir(parents=True, exist_ok=True)
        index_path = paths.WEB_GENERATED_SERVICE_CONTRACT_ROOT / "index.ts"
        index_path.write_text(generate_typescript_index(sorted(typescript_set)), encoding="utf-8")
        written.append(index_path)

    for service_name in sorted(go_set):
        service = service_contracts.require_service_contract(service_name)
        target_path = paths.GO_GENERATED_SERVICE_CONTRACT_ROOT / f"{service_name.replace('-', '_')}.go"
        target_path.write_text(generate_go_code(service), encoding="utf-8")
        written.append(target_path)

    for service_name in sorted(python_set):
        service = service_contracts.require_service_contract(service_name)
        target_path = paths.PYTHON_GENERATED_SERVICE_CONTRACT_ROOT / f"{service_name.replace('-', '_')}.py"
        target_path.write_text(generate_python_code(service), encoding="utf-8")
        written.append(target_path)

    for service_name in sorted(typescript_set):
        service = service_contracts.require_service_contract(service_name)
        target_path = paths.WEB_GENERATED_SERVICE_CONTRACT_ROOT / f"{service_name.replace('-', '_')}.ts"
        target_path.write_text(generate_typescript_code(service), encoding="utf-8")
        written.append(target_path)

    return written, deleted
