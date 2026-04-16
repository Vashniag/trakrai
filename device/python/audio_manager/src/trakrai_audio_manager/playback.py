from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass

from .config import PlaybackConfig


@dataclass(frozen=True)
class PlaybackResult:
    state: str
    backend: str
    command: tuple[str, ...]


class PlaybackManager:
    def __init__(self, config: PlaybackConfig) -> None:
        self._config = config

    def play(self, audio_path: str, *, content_type: str = "") -> PlaybackResult:
        backend = self._resolve_backend(audio_path)
        if backend == "mock":
            return PlaybackResult(state="completed", backend=backend, command=())

        command = self._build_command(backend, audio_path, content_type)
        result = subprocess.run(
            list(command),
            capture_output=True,
            text=True,
            timeout=self._config.timeout_sec,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"audio playback failed via {backend}: {result.stderr.strip() or result.stdout.strip()}"
            )
        return PlaybackResult(state="completed", backend=backend, command=command)

    def _resolve_backend(self, audio_path: str) -> str:
        backend = self._config.backend.strip().lower()
        if backend == "mock":
            return "mock"
        if backend == "auto":
            suffix = audio_path.rsplit(".", 1)[-1].lower() if "." in audio_path else ""
            candidates = ("ffplay", "mpg123") if suffix == "mp3" else ("ffplay", "aplay", "paplay")
            for candidate in candidates:
                if shutil.which(candidate):
                    return candidate
            raise RuntimeError(
                f"no supported playback backend found for .{suffix or 'audio'} files (tried {', '.join(candidates)})"
            )
        if backend == "command":
            if not self._config.command_template:
                raise RuntimeError("playback backend 'command' requires a non-empty command_template")
            return "command"
        if shutil.which(backend):
            return backend
        raise RuntimeError(f"unsupported or unavailable playback backend: {self._config.backend}")

    def _build_command(self, backend: str, audio_path: str, content_type: str) -> tuple[str, ...]:
        if backend == "command":
            resolved_content_type = content_type.strip() or "application/octet-stream"
            return tuple(
                part.replace("{audio_path}", audio_path).replace("{audio_content_type}", resolved_content_type)
                for part in self._config.command_template
            )
        if backend == "ffplay":
            return ("ffplay", "-nodisp", "-autoexit", "-loglevel", "error", audio_path)
        if backend == "mpg123":
            return ("mpg123", "-q", audio_path)
        if backend == "aplay":
            return ("aplay", "-q", audio_path)
        if backend == "paplay":
            return ("paplay", audio_path)
        return (backend, audio_path)
