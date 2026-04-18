from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from . import paths


@dataclass(frozen=True)
class ContractMessage:
    message_type: str
    schema_name: str


@dataclass(frozen=True)
class ContractOutput:
    kind: str
    message_type: str
    subtopic: str


@dataclass(frozen=True)
class ContractMethod:
    name: str
    subtopic: str
    request_schema: str
    outputs: tuple[ContractOutput, ...]
    aliases: tuple[str, ...] = ()


@dataclass(frozen=True)
class ServiceContract:
    name: str
    schemas: dict[str, dict[str, Any]]
    messages: dict[str, ContractMessage]
    methods: tuple[ContractMethod, ...]

    def schema(self, name: str) -> dict[str, Any]:
        try:
            return self.schemas[name]
        except KeyError as exc:
            raise SystemExit(f"{self.name}: unknown schema {name!r}") from exc

    def message(self, message_type: str) -> ContractMessage:
        try:
            return self.messages[message_type]
        except KeyError as exc:
            raise SystemExit(f"{self.name}: unknown message type {message_type!r}") from exc


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def load_service_contracts() -> tuple[ServiceContract, ...]:
    payload = _read_json(paths.SERVICE_METHODS_MANIFEST_PATH)
    services: list[ServiceContract] = []
    for item in payload.get("services", []):
        schemas = {
            str(schema_name): json.loads(json.dumps(schema_payload))
            for schema_name, schema_payload in dict(item.get("schemas", {})).items()
        }
        messages = {
            str(message_type): ContractMessage(
                message_type=str(message_type),
                schema_name=str(dict(message_payload).get("schema", "")),
            )
            for message_type, message_payload in dict(item.get("messages", {})).items()
        }
        methods = tuple(
            ContractMethod(
                name=str(method_payload.get("name", "")).strip(),
                subtopic=str(method_payload.get("subtopic", "")).strip(),
                request_schema=str(method_payload.get("requestSchema", "")).strip(),
                aliases=tuple(str(value).strip() for value in method_payload.get("aliases", [])),
                outputs=tuple(
                    ContractOutput(
                        kind=str(output_payload.get("kind", "")).strip(),
                        message_type=str(output_payload.get("messageType", "")).strip(),
                        subtopic=str(output_payload.get("subtopic", "")).strip(),
                    )
                    for output_payload in method_payload.get("outputs", [])
                ),
            )
            for method_payload in item.get("methods", [])
        )
        services.append(
            ServiceContract(
                name=str(item.get("name", "")).strip(),
                schemas=schemas,
                messages=messages,
                methods=methods,
            )
        )
    return tuple(services)


@lru_cache(maxsize=1)
def service_contracts_by_name() -> dict[str, ServiceContract]:
    return {service.name: service for service in load_service_contracts()}


def require_service_contract(name: str) -> ServiceContract:
    try:
        return service_contracts_by_name()[name]
    except KeyError as exc:
        raise SystemExit(f"unknown service contract: {name}") from exc
