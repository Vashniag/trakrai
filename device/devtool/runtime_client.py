from __future__ import annotations

import json
import time
from uuid import uuid4

from .websocket_client import SimpleWebSocketClient


class RuntimeWsClient:
    def __init__(self, url: str, *, device_id: str = "", timeout_sec: float = 15.0) -> None:
        self.url = url
        self.device_id = device_id
        self.timeout_sec = timeout_sec
        self.websocket = SimpleWebSocketClient(url, timeout_sec=timeout_sec)
        self._session_ready = False

    def close(self) -> None:
        self.websocket.close()

    def __enter__(self) -> "RuntimeWsClient":
        self.ensure_session()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

    def ensure_session(self) -> None:
        if self._session_ready:
            return
        self.websocket.send_text(json.dumps({"kind": "set-device", "deviceId": self.device_id}))
        deadline = time.time() + self.timeout_sec
        while time.time() < deadline:
            message = json.loads(self.websocket.receive_text())
            if message.get("kind") == "session-info":
                self._session_ready = True
                return
        raise SystemExit("timed out waiting for edge websocket session-info")

    def request(
        self,
        *,
        service: str,
        message_type: str,
        payload: dict[str, object] | None = None,
        expected_types: set[str] | None = None,
        subtopic: str = "command",
        timeout_sec: float | None = None,
    ) -> dict[str, object]:
        self.ensure_session()
        request_payload = dict(payload or {})
        request_id = str(request_payload.get("requestId", "")).strip() or uuid4().hex
        request_payload["requestId"] = request_id
        frame = {
            "kind": "packet",
            "service": service,
            "subtopic": subtopic,
            "envelope": {
                "type": message_type,
                "payload": request_payload,
            },
        }
        self.websocket.send_text(json.dumps(frame))
        expected = expected_types or set()
        deadline = time.time() + (timeout_sec or self.timeout_sec)
        while time.time() < deadline:
            message = json.loads(self.websocket.receive_text())
            if message.get("subtopic") != "response":
                continue
            if message.get("service") != service:
                continue
            envelope = message.get("envelope") or {}
            response_type = str(envelope.get("type", "")).strip()
            response_payload = envelope.get("payload") or {}
            response_request_id = str(response_payload.get("requestId", "")).strip()
            if response_request_id not in {"", request_id}:
                continue
            if expected and response_type not in expected:
                continue
            return message
        raise SystemExit(f"timed out waiting for websocket response from {service}:{message_type}")
