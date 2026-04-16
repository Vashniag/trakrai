from __future__ import annotations

import hashlib
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .config import TTSConfig

try:
    from gtts import gTTS
except ImportError:  # pragma: no cover - exercised through runtime fallback
    gTTS = None


@dataclass(frozen=True)
class GenerationResult:
    audio_path: str
    backend: str
    content_type: str
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

        gtts_language = self._resolve_language(language)
        file_key = hashlib.sha256(f"{gtts_language}|{text}".encode("utf-8")).hexdigest()
        attempts: tuple[tuple[str, Callable[[Path], GenerationResult]], ...] = (
            ("gtts", lambda output_path: self._generate_gtts(output_path, text, gtts_language)),
            ("espeak", lambda output_path: self._generate_espeak(output_path, text, language)),
        )
        errors: list[str] = []

        for backend, generator in attempts:
            output_path = self._build_output_path(file_key, backend)
            if output_path.exists():
                return self._generation_result(output_path, backend=backend, language=language, cache_hit=True)
            try:
                return generator(output_path)
            except Exception as exc:
                errors.append(f"{backend}: {exc}")

        raise RuntimeError("TTS generation failed. " + "; ".join(errors))

    def _resolve_language(self, language: str) -> str:
        normalized = language.strip() or self._config.default_language or "en"
        voice_map = self._config.voice_map
        if normalized in voice_map:
            return voice_map[normalized]
        short = normalized.split("-", 1)[0]
        if short in voice_map:
            return voice_map[short]
        return short or "en"

    def _resolve_espeak_backend(self) -> str:
        for candidate in ("espeak-ng", "espeak"):
            if shutil.which(candidate):
                return candidate
        raise RuntimeError("no supported fallback TTS backend found (tried espeak-ng, espeak)")

    def _build_output_path(self, file_key: str, backend: str) -> Path:
        extension = "mp3" if backend == "gtts" else "wav"
        return self._cache_dir / f"{file_key}.{extension}"

    def _generate_gtts(self, output_path: Path, text: str, language: str) -> GenerationResult:
        if gTTS is None:
            raise RuntimeError("gTTS is not installed")
        output_path.parent.mkdir(parents=True, exist_ok=True)
        gTTS(text=text, lang=language, timeout=self._config.timeout_sec).save(str(output_path))
        if not output_path.exists():
            raise RuntimeError(f"gTTS did not create {output_path}")
        return self._generation_result(output_path, backend="gtts", language=language, cache_hit=False)

    def _generate_espeak(self, output_path: Path, text: str, language: str) -> GenerationResult:
        backend = self._resolve_espeak_backend()
        voice = self._resolve_language(language)
        command = [backend, "-w", str(output_path), "-v", voice, text]
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=self._config.timeout_sec,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"TTS generation failed via {backend}: {result.stderr.strip() or result.stdout.strip()}"
            )
        if not output_path.exists():
            raise RuntimeError(f"TTS backend {backend} did not create {output_path}")
        return self._generation_result(output_path, backend=backend, language=language, cache_hit=False)

    def _generation_result(self, output_path: Path, *, backend: str, language: str, cache_hit: bool) -> GenerationResult:
        return GenerationResult(
            audio_path=str(output_path),
            backend=backend,
            content_type="audio/mpeg" if output_path.suffix.lower() == ".mp3" else "audio/wav",
            voice=self._resolve_language(language),
            cache_hit=cache_hit,
        )
