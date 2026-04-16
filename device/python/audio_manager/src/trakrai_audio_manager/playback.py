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

    def play(self, audio_path: str) -> PlaybackResult:
        backend = self._resolve_backend()
        if backend == "mock":
            return PlaybackResult(state="completed", backend=backend, command=())

        command = self._build_command(backend, audio_path)
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

    def _resolve_backend(self) -> str:
        backend = self._config.backend.strip().lower()
        if backend == "mock":
            return "mock"
        if backend == "auto":
            for candidate in ("ffplay", "aplay", "paplay"):
                if shutil.which(candidate):
                    return candidate
            raise RuntimeError("no supported playback backend found (tried ffplay, aplay, paplay)")
        if backend == "command":
            if not self._config.command_template:
                raise RuntimeError("playback backend 'command' requires a non-empty command_template")
            return "command"
        if shutil.which(backend):
            return backend
        raise RuntimeError(f"unsupported or unavailable playback backend: {self._config.backend}")

    def _build_command(self, backend: str, audio_path: str) -> tuple[str, ...]:
        if backend == "command":
            return tuple(part.replace("{audio_path}", audio_path) for part in self._config.command_template)
        if backend == "ffplay":
            return ("ffplay", "-nodisp", "-autoexit", "-loglevel", "error", audio_path)
        if backend == "aplay":
            return ("aplay", "-q", audio_path)
        if backend == "paplay":
            return ("paplay", audio_path)
        return (backend, audio_path)
