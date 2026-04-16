from __future__ import annotations

import hashlib
import math
import shutil
import struct
import subprocess
import wave
from dataclasses import dataclass
from pathlib import Path

from .config import TTSConfig


@dataclass(frozen=True)
class GenerationResult:
    audio_path: str
    backend: str
    voice: str
    cache_hit: bool


class TTSGenerator:
    def __init__(self, config: TTSConfig, cache_dir: str) -> None:
        self._config = config
        self._cache_dir = Path(cache_dir)
        self._cache_dir.mkdir(parents=True, exist_ok=True)

    def generate(self, text: str, language: str) -> GenerationResult:
        if text.strip() == "":
            raise ValueError("cannot synthesize empty text")

        resolved_backend = self._resolve_backend()
        voice = self._resolve_voice(language)
        file_name = f"{hashlib.sha256(f'{resolved_backend}|{voice}|{text}'.encode('utf-8')).hexdigest()}.wav"
        output_path = self._cache_dir / file_name

        if output_path.exists():
            return GenerationResult(
                audio_path=str(output_path),
                backend=resolved_backend,
                voice=voice,
                cache_hit=True,
            )

        if resolved_backend == "mock":
            self._write_mock_wave(output_path, text)
        else:
            command = [resolved_backend, "-w", str(output_path), "-v", voice, text]
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=self._config.timeout_sec,
                check=False,
            )
            if result.returncode != 0:
                raise RuntimeError(
                    f"TTS generation failed via {resolved_backend}: {result.stderr.strip() or result.stdout.strip()}"
                )
            if not output_path.exists():
                raise RuntimeError(f"TTS backend {resolved_backend} did not create {output_path}")

        return GenerationResult(
            audio_path=str(output_path),
            backend=resolved_backend,
            voice=voice,
            cache_hit=False,
        )

    def _resolve_backend(self) -> str:
        backend = self._config.backend.strip().lower()
        if backend == "auto":
            for candidate in ("espeak-ng", "espeak"):
                if shutil.which(candidate):
                    return candidate
            raise RuntimeError("no supported TTS backend found (tried espeak-ng, espeak)")
        if backend in {"espeak-ng", "espeak", "mock"}:
            if backend != "mock" and shutil.which(backend) is None:
                raise RuntimeError(f"configured TTS backend {backend!r} is not available on PATH")
            return backend
        raise RuntimeError(f"unsupported TTS backend: {self._config.backend}")

    def _resolve_voice(self, language: str) -> str:
        normalized = language.strip() or self._config.default_language or "en"
        voice_map = self._config.voice_map
        if normalized in voice_map:
            return voice_map[normalized]
        short = normalized.split("-", 1)[0]
        if short in voice_map:
            return voice_map[short]
        return short or "en"

    def _write_mock_wave(self, path: Path, text: str) -> None:
        frame_rate = 16000
        duration_sec = max(0.25, min(1.5, 0.04 * len(text.strip())))
        total_frames = int(frame_rate * duration_sec)
        amplitude = 10000
        frequency = 440.0
        path.parent.mkdir(parents=True, exist_ok=True)
        with wave.open(str(path), "wb") as handle:
            handle.setnchannels(1)
            handle.setsampwidth(2)
            handle.setframerate(frame_rate)
            for index in range(total_frames):
                sample = int(amplitude * math.sin(2.0 * math.pi * frequency * (index / frame_rate)))
                handle.writeframes(struct.pack("<h", sample))
