#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import signal
import subprocess
import threading
import uuid
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


class HostAudioPlayer:
    def __init__(self, state_dir: Path, command_template: tuple[str, ...] = ()) -> None:
        self._state_dir = state_dir
        self._requests_dir = state_dir / "requests"
        self._cache_dir = state_dir / "cache"
        self._last_request_path = state_dir / "last-request.json"
        self._lock = threading.Lock()
        self._command_template = command_template

        self._requests_dir.mkdir(parents=True, exist_ok=True)
        self._cache_dir.mkdir(parents=True, exist_ok=True)

        self._backend, self._base_command = self._resolve_command()

    @property
    def backend(self) -> str:
        return self._backend

    def play(self, audio_bytes: bytes, headers: dict[str, str], request_path: str) -> dict[str, Any]:
        request_id = uuid.uuid4().hex
        audio_path = self._cache_dir / f"{request_id}{self._resolve_extension(headers)}"
        audio_path.write_bytes(audio_bytes)

        with self._lock:
            command = self._build_command(audio_path)
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                check=False,
            )

        metadata = {
            "requestId": request_id,
            "receivedAt": utc_now(),
            "path": request_path,
            "headers": headers,
            "audioPath": str(audio_path),
            "audioBytes": len(audio_bytes),
            "backend": self._backend,
            "command": command,
            "returnCode": result.returncode,
            "stdout": result.stdout.strip(),
            "stderr": result.stderr.strip(),
            "played": result.returncode == 0,
        }
        request_file = self._requests_dir / f"{request_id}.json"
        request_file.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
        self._last_request_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")

        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or result.stdout.strip() or f"{self._backend} exited with code {result.returncode}")

        return metadata

    def _resolve_extension(self, headers: dict[str, str]) -> str:
        content_type = headers.get("Content-Type", headers.get("content-type", "")).split(";", 1)[0].strip().lower()
        if content_type in {"audio/mpeg", "audio/mp3"}:
            return ".mp3"
        if content_type in {"audio/wav", "audio/x-wav"}:
            return ".wav"
        return ".bin"

    def _resolve_command(self) -> tuple[str, tuple[str, ...]]:
        if self._command_template:
            return ("command", self._command_template)

        system = platform.system().lower()
        if system == "darwin" and shutil.which("afplay"):
            return ("afplay", ("afplay", "{audio_path}"))

        for candidate, command in (
            ("ffplay", ("ffplay", "-nodisp", "-autoexit", "-loglevel", "error", "{audio_path}")),
            ("paplay", ("paplay", "{audio_path}")),
            ("aplay", ("aplay", "-q", "{audio_path}")),
        ):
            if shutil.which(candidate):
                return (candidate, command)

        raise RuntimeError(
            "no supported host audio player found; tried afplay, ffplay, paplay, and aplay"
        )

    def _build_command(self, audio_path: Path) -> list[str]:
        return [part.replace("{audio_path}", str(audio_path)) for part in self._base_command]


class AudioRequestHandler(BaseHTTPRequestHandler):
    player: HostAudioPlayer

    def do_GET(self) -> None:  # noqa: N802
        if self.path != "/health":
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        self._write_json(HTTPStatus.OK, {"backend": self.player.backend, "ok": True})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/play":
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        content_length = int(self.headers.get("Content-Length", "0") or 0)
        if content_length <= 0:
            self._write_json(HTTPStatus.BAD_REQUEST, {"error": "request body is required"})
            return

        body = self.rfile.read(content_length)
        headers = {key: value for key, value in self.headers.items()}
        try:
            metadata = self.player.play(body, headers, self.path)
        except RuntimeError as exc:
            self._write_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})
            return

        self._write_json(
            HTTPStatus.OK,
            {
                "accepted": True,
                "backend": metadata["backend"],
                "played": metadata["played"],
                "requestId": metadata["requestId"],
            },
        )

    def log_message(self, format: str, *args: object) -> None:
        print(f"[host-audio-player] {self.address_string()} - {format % args}", flush=True)

    def _write_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Play device-generated audio files on the local host speakers.")
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--state-dir", required=True)
    parser.add_argument(
        "--command-template",
        nargs="+",
        default=(),
        help="optional custom playback command template; use {audio_path} as the file placeholder",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    state_dir = Path(args.state_dir).expanduser().resolve()
    state_dir.mkdir(parents=True, exist_ok=True)

    player = HostAudioPlayer(state_dir, tuple(args.command_template))
    AudioRequestHandler.player = player
    server = ThreadingHTTPServer(("0.0.0.0", args.port), AudioRequestHandler)
    server.daemon_threads = True

    def handle_shutdown(_signum: int, _frame: object) -> None:
        server.shutdown()

    signal.signal(signal.SIGTERM, handle_shutdown)
    signal.signal(signal.SIGINT, handle_shutdown)

    print(
        json.dumps(
            {
                "backend": player.backend,
                "pid": os.getpid(),
                "port": args.port,
                "stateDir": str(state_dir),
            }
        ),
        flush=True,
    )
    server.serve_forever()
    server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
