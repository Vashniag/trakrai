#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import socket
import ssl
import sys
import time
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4


class SimpleWebSocketClient:
    def __init__(self, url: str, *, timeout_sec: float) -> None:
        self.url = url
        self.timeout_sec = timeout_sec
        self._socket: socket.socket | ssl.SSLSocket | None = None
        self._connect()

    def _connect(self) -> None:
        parsed = urlparse(self.url)
        scheme = parsed.scheme or "ws"
        host = parsed.hostname or "127.0.0.1"
        port = parsed.port or (443 if scheme == "wss" else 80)
        path = parsed.path or "/"
        if parsed.query:
            path += f"?{parsed.query}"
        raw_socket = socket.create_connection((host, port), timeout=self.timeout_sec)
        raw_socket.settimeout(self.timeout_sec)
        if scheme == "wss":
            context = ssl.create_default_context()
            self._socket = context.wrap_socket(raw_socket, server_hostname=host)
        else:
            self._socket = raw_socket
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        request = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {host}:{port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n"
            "\r\n"
        )
        assert self._socket is not None
        self._socket.sendall(request.encode("utf-8"))
        response = self._read_http_headers()
        if " 101 " not in response.splitlines()[0]:
            raise SystemExit(f"websocket upgrade failed: {response.splitlines()[0]}")
        expected_accept = base64.b64encode(
            hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode("utf-8")).digest()
        ).decode("ascii")
        if f"sec-websocket-accept: {expected_accept}".lower() not in response.lower():
            raise SystemExit("websocket upgrade failed: invalid accept header")

    def _read_http_headers(self) -> str:
        assert self._socket is not None
        data = b""
        while b"\r\n\r\n" not in data:
            chunk = self._socket.recv(4096)
            if not chunk:
                break
            data += chunk
        return data.decode("utf-8", errors="replace")

    def _recv_exact(self, size: int) -> bytes:
        assert self._socket is not None
        data = bytearray()
        while len(data) < size:
            chunk = self._socket.recv(size - len(data))
            if not chunk:
                raise SystemExit("unexpected websocket EOF")
            data.extend(chunk)
        return bytes(data)

    def _send_frame(self, opcode: int, payload: bytes) -> None:
        assert self._socket is not None
        mask = os.urandom(4)
        first = 0x80 | (opcode & 0x0F)
        length = len(payload)
        header = bytearray([first])
        if length < 126:
            header.append(0x80 | length)
        elif length < (1 << 16):
            header.append(0x80 | 126)
            header.extend(length.to_bytes(2, "big"))
        else:
            header.append(0x80 | 127)
            header.extend(length.to_bytes(8, "big"))
        header.extend(mask)
        masked = bytes(payload[index] ^ mask[index % 4] for index in range(length))
        self._socket.sendall(bytes(header) + masked)

    def send_text(self, text: str) -> None:
        self._send_frame(0x1, text.encode("utf-8"))

    def receive_text(self) -> str:
        fragments: list[bytes] = []
        saw_text = False
        while True:
            first_two = self._recv_exact(2)
            first = first_two[0]
            second = first_two[1]
            fin = (first & 0x80) != 0
            opcode = first & 0x0F
            length = second & 0x7F
            masked = second & 0x80
            if length == 126:
                length = int.from_bytes(self._recv_exact(2), "big")
            elif length == 127:
                length = int.from_bytes(self._recv_exact(8), "big")
            mask = self._recv_exact(4) if masked else b""
            payload = self._recv_exact(length)
            if masked:
                payload = bytes(payload[index] ^ mask[index % 4] for index in range(length))
            if opcode == 0x1:
                fragments = [payload]
                saw_text = True
                if fin:
                    return payload.decode("utf-8")
                continue
            if opcode == 0x0 and saw_text:
                fragments.append(payload)
                if fin:
                    return b"".join(fragments).decode("utf-8")
                continue
            if opcode == 0x8:
                raise SystemExit("websocket closed by remote peer")
            if opcode == 0x9:
                self._send_frame(0xA, payload)

    def close(self) -> None:
        if self._socket is None:
            return
        try:
            self._send_frame(0x8, b"")
        except OSError:
            pass
        try:
            self._socket.close()
        finally:
            self._socket = None


def main() -> int:
    parser = argparse.ArgumentParser(description="Send a runtime-manager websocket request from the device itself.")
    parser.add_argument("--url", default="ws://127.0.0.1:8080/ws")
    parser.add_argument("--device-id", default="")
    parser.add_argument("--service", default="runtime-manager")
    parser.add_argument("--message-type", required=True)
    parser.add_argument("--payload-file", required=True)
    parser.add_argument("--expected-type", action="append")
    parser.add_argument("--timeout-sec", type=float, default=30.0)
    args = parser.parse_args()

    payload = json.loads(Path(args.payload_file).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise SystemExit("payload file must contain a JSON object")
    request_id = str(payload.get("requestId", "")).strip() or uuid4().hex
    payload["requestId"] = request_id

    client = SimpleWebSocketClient(args.url, timeout_sec=args.timeout_sec)
    try:
        client.send_text(json.dumps({"kind": "set-device", "deviceId": args.device_id}))
        deadline = time.time() + args.timeout_sec
        while time.time() < deadline:
            message = json.loads(client.receive_text())
            if message.get("kind") == "session-info":
                break
        else:
            raise SystemExit("timed out waiting for edge websocket session-info")

        client.send_text(
            json.dumps(
                {
                    "kind": "packet",
                    "service": args.service,
                    "subtopic": "command",
                    "envelope": {"type": args.message_type, "payload": payload},
                }
            )
        )

        expected = set(args.expected_type or [])
        deadline = time.time() + args.timeout_sec
        while time.time() < deadline:
            message = json.loads(client.receive_text())
            if message.get("subtopic") != "response":
                continue
            if message.get("service") != args.service:
                continue
            envelope = message.get("envelope") or {}
            response_type = str(envelope.get("type", "")).strip()
            response_payload = envelope.get("payload") or {}
            response_request_id = str(response_payload.get("requestId", "")).strip()
            if response_request_id not in {"", request_id}:
                continue
            if expected and response_type not in expected:
                continue
            print(json.dumps(message, indent=2))
            return 0
        raise SystemExit(f"timed out waiting for websocket response from {args.service}:{args.message_type}")
    finally:
        client.close()


if __name__ == "__main__":
    sys.exit(main())
