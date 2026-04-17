from __future__ import annotations

import base64
import hashlib
import os
import socket
import ssl
from dataclasses import dataclass
from types import TracebackType
from typing import Self
from urllib.parse import urlparse


@dataclass
class WebSocketFrame:
    fin: bool
    opcode: int
    payload: bytes


class SimpleWebSocketClient:
    def __init__(self, url: str, *, timeout_sec: float = 10.0) -> None:
        self.url = url
        self.timeout_sec = timeout_sec
        self._socket: socket.socket | ssl.SSLSocket | None = None
        self._connect()

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self.close()

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

    def send_text(self, text: str) -> None:
        self._send_frame(0x1, text.encode("utf-8"))

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

    def receive_text(self) -> str:
        fragments: list[bytes] = []
        saw_text = False
        while True:
            frame = self._read_frame()
            if frame.opcode == 0x1:
                fragments = [frame.payload]
                saw_text = True
                if frame.fin:
                    return frame.payload.decode("utf-8")
                continue
            if frame.opcode == 0x0 and saw_text:
                fragments.append(frame.payload)
                if frame.fin:
                    return b"".join(fragments).decode("utf-8")
                continue
            if frame.opcode == 0x8:
                raise SystemExit("websocket closed by remote peer")
            if frame.opcode == 0x9:
                self._send_frame(0xA, frame.payload)
                continue

    def _read_frame(self) -> WebSocketFrame:
        assert self._socket is not None
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
        return WebSocketFrame(fin=fin, opcode=opcode, payload=payload)

    def _recv_exact(self, size: int) -> bytes:
        assert self._socket is not None
        data = bytearray()
        while len(data) < size:
            chunk = self._socket.recv(size - len(data))
            if not chunk:
                raise SystemExit("unexpected websocket EOF")
            data.extend(chunk)
        return bytes(data)

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
