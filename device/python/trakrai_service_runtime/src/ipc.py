from __future__ import annotations

import json
import queue
import socket
import threading
import time
from pathlib import Path
from typing import Any


class IPCError(RuntimeError):
    pass


class IPCClient:
    def __init__(self, socket_path: str, service_name: str, logger: Any) -> None:
        self._socket_path = str(Path(socket_path))
        self._service_name = service_name
        self._logger = logger
        self._socket: socket.socket | None = None
        self._reader = None
        self._writer = None
        self._write_lock = threading.Lock()
        self._pending: dict[str, queue.Queue[dict[str, Any]]] = {}
        self._pending_lock = threading.Lock()
        self._notifications: "queue.Queue[dict[str, Any]]" = queue.Queue()
        self._closed = threading.Event()
        self._reader_thread: threading.Thread | None = None

    @property
    def is_closed(self) -> bool:
        return self._closed.is_set()

    def connect(self, timeout_sec: float = 5.0) -> None:
        if self._socket is not None and not self.is_closed:
            return

        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(timeout_sec)
        try:
            sock.connect(self._socket_path)
        except OSError as exc:
            raise IPCError(f"failed to connect to IPC socket {self._socket_path}: {exc}") from exc
        sock.settimeout(None)

        self._socket = sock
        self._reader = sock.makefile("r", encoding="utf-8")
        self._writer = sock.makefile("w", encoding="utf-8")
        self._closed.clear()
        self._reader_thread = threading.Thread(target=self._reader_loop, name=f"{self._service_name}-ipc", daemon=True)
        self._reader_thread.start()
        self._request("register-service", {"service": self._service_name}, timeout_sec=timeout_sec)

    def close(self) -> None:
        if self.is_closed and self._socket is None and self._reader is None and self._writer is None:
            return

        self._closed.set()

        sock = self._socket
        reader = self._reader
        writer = self._writer
        self._socket = None
        self._reader = None
        self._writer = None

        if sock is not None:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            try:
                sock.close()
            except OSError:
                pass
        if writer is not None:
            try:
                writer.close()
            except OSError:
                pass
        if reader is not None:
            try:
                reader.close()
            except OSError:
                pass
        if self._reader_thread is not None and self._reader_thread.is_alive():
            self._reader_thread.join(timeout=0.2)
        self._fail_pending("ipc client closed")

    def publish(self, subtopic: str, message_type: str, payload: Any, timeout_sec: float = 2.0) -> None:
        self._request(
            "publish-message",
            {
                "service": self._service_name,
                "subtopic": subtopic,
                "type": message_type,
                "payload": payload,
            },
            timeout_sec=timeout_sec,
        )

    def send_service_message(
        self,
        target_service: str,
        subtopic: str,
        message_type: str,
        payload: Any,
        timeout_sec: float = 2.0,
    ) -> None:
        self._request(
            "send-service-message",
            {
                "targetService": target_service,
                "subtopic": subtopic,
                "type": message_type,
                "payload": payload,
            },
            timeout_sec=timeout_sec,
        )

    def report_status(self, status: str, details: dict[str, Any] | None = None, timeout_sec: float = 2.0) -> None:
        self._request(
            "report-status",
            {
                "service": self._service_name,
                "status": status,
                "details": details or {},
            },
            timeout_sec=timeout_sec,
        )

    def report_error(self, error: str, fatal: bool = False, timeout_sec: float = 2.0) -> None:
        self._request(
            "report-error",
            {
                "service": self._service_name,
                "error": error,
                "fatal": fatal,
            },
            timeout_sec=timeout_sec,
        )

    def read_notification(self, timeout_sec: float = 1.0) -> dict[str, Any] | None:
        if self.is_closed and self._notifications.empty():
            return None
        try:
            return self._notifications.get(timeout=timeout_sec)
        except queue.Empty:
            return None

    def _request(self, method: str, params: Any, timeout_sec: float) -> dict[str, Any]:
        if self._writer is None:
            raise IPCError("ipc client is not connected")

        request_id = f"{self._service_name}-{time.time_ns()}"
        response_queue: "queue.Queue[dict[str, Any]]" = queue.Queue(maxsize=1)
        with self._pending_lock:
            self._pending[request_id] = response_queue

        self._write_json(
            {
                "id": request_id,
                "method": method,
                "params": params,
            }
        )
        try:
            response = response_queue.get(timeout=timeout_sec)
        except queue.Empty as exc:
            with self._pending_lock:
                self._pending.pop(request_id, None)
            raise IPCError(f"IPC request {method!r} timed out") from exc

        error = response.get("error")
        if isinstance(error, dict):
            raise IPCError(str(error.get("message", "ipc request failed")))
        return response

    def _reader_loop(self) -> None:
        try:
            assert self._reader is not None
            for raw_line in self._reader:
                line = raw_line.strip()
                if not line:
                    continue
                try:
                    frame = json.loads(line)
                except json.JSONDecodeError:
                    self._logger.warning("Ignoring malformed IPC frame", extra={"line": line})
                    continue

                frame_id = frame.get("id")
                if isinstance(frame_id, str) and frame_id:
                    with self._pending_lock:
                        response_queue = self._pending.pop(frame_id, None)
                    if response_queue is not None:
                        response_queue.put(frame)
                    continue

                method = frame.get("method")
                if isinstance(method, str):
                    self._notifications.put(frame)
        except OSError as exc:
            if not self.is_closed:
                self._logger.warning("IPC reader exited", extra={"error": str(exc)})
        finally:
            self._closed.set()
            self._fail_pending("ipc connection closed")

    def _fail_pending(self, message: str) -> None:
        with self._pending_lock:
            pending = self._pending
            self._pending = {}
        for response_queue in pending.values():
            response_queue.put({"error": {"message": message}})

    def _write_json(self, value: dict[str, Any]) -> None:
        if self._writer is None:
            raise IPCError("ipc client is not connected")
        data = json.dumps(value, separators=(",", ":")) + "\n"
        with self._write_lock:
            try:
                self._writer.write(data)
                self._writer.flush()
            except OSError as exc:
                self._closed.set()
                raise IPCError(f"failed to write IPC request: {exc}") from exc
