from __future__ import annotations

import queue
import threading
import time
import uuid
from dataclasses import dataclass
from typing import Any

from .ipc import IPCClient


@dataclass(frozen=True)
class ServiceResponse:
    source_service: str
    message_type: str
    payload: dict[str, Any]


class ServiceRequestBridge:
    def __init__(self, ipc: IPCClient) -> None:
        self._ipc = ipc
        self._pending: dict[str, "queue.Queue[ServiceResponse]"] = {}
        self._lock = threading.Lock()

    def handle_notification(self, notification: dict[str, Any]) -> bool:
        method = str(notification.get("method", "")).strip()
        if method != "service-message":
            return False
        params = notification.get("params", {})
        if not isinstance(params, dict):
            return False
        envelope = params.get("envelope")
        if not isinstance(envelope, dict):
            return False
        return self.handle_service_notification(
            str(params.get("sourceService", "")).strip(),
            str(params.get("subtopic", "")).strip(),
            envelope,
        )

    def handle_service_notification(self, source_service: str, subtopic: str, envelope: dict[str, Any]) -> bool:
        if subtopic.strip() != "response":
            return False
        payload = envelope.get("payload", {})
        if not isinstance(payload, dict):
            return False
        request_id = str(payload.get("requestId", "")).strip()
        if request_id == "":
            return False
        with self._lock:
            waiter = self._pending.get(request_id)
        if waiter is None:
            return False
        waiter.put(
            ServiceResponse(
                source_service=source_service.strip(),
                message_type=str(envelope.get("type", "")).strip(),
                payload=payload,
            )
        )
        return True

    def request(
        self,
        *,
        target_service: str,
        message_type: str,
        payload: dict[str, Any],
        expected_types: set[str],
        timeout_sec: float,
    ) -> dict[str, Any]:
        request_id = str(payload.get("requestId", "")).strip() or uuid.uuid4().hex
        request_payload = dict(payload)
        request_payload["requestId"] = request_id
        waiter: "queue.Queue[ServiceResponse]" = queue.Queue()
        with self._lock:
            if request_id in self._pending:
                raise RuntimeError(f"duplicate service request id: {request_id}")
            self._pending[request_id] = waiter

        try:
            self._ipc.send_service_message(target_service, "command", message_type, request_payload, timeout_sec=timeout_sec)
            deadline = time.time() + timeout_sec
            while time.time() < deadline:
                remaining = max(0.1, deadline - time.time())
                try:
                    response = waiter.get(timeout=remaining)
                except queue.Empty as exc:
                    raise RuntimeError(
                        f"timed out waiting for {target_service} response to {message_type} ({request_id})"
                    ) from exc
                if expected_types and response.message_type not in expected_types:
                    continue
                return {
                    "sourceService": response.source_service,
                    "type": response.message_type,
                    "payload": response.payload,
                }
        finally:
            with self._lock:
                self._pending.pop(request_id, None)

        raise RuntimeError(f"timed out waiting for {target_service} response to {message_type} ({request_id})")

    def publish(
        self,
        *,
        subtopic: str,
        message_type: str,
        payload: dict[str, Any],
        timeout_sec: float,
    ) -> None:
        self._ipc.publish(subtopic, message_type, payload, timeout_sec=timeout_sec)
