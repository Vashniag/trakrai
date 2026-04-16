from __future__ import annotations

from pathlib import Path

from trakrai_audio_manager.config import TTSConfig
from trakrai_audio_manager import tts
from trakrai_audio_manager.tts import TTSGenerator


class _FakeGTTS:
    def __init__(self, *, text: str, lang: str, timeout: int | None = None) -> None:
        self._text = text
        self._lang = lang
        self._timeout = timeout

    def save(self, path: str) -> None:
        Path(path).write_bytes(f"{self._lang}:{self._text}".encode("utf-8"))


def test_gtts_generator_caches_audio_files(tmp_path: Path, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(tts, "gTTS", _FakeGTTS)
    generator = TTSGenerator(TTSConfig(default_language="en"), str(tmp_path / "cache"))
    first = generator.generate("Alert from TrakrAI", "en")
    second = generator.generate("Alert from TrakrAI", "en")

    assert Path(first.audio_path).exists()
    assert first.backend == "gtts"
    assert first.content_type == "audio/mpeg"
    assert first.cache_hit is False
    assert second.cache_hit is True
    assert first.audio_path == second.audio_path


def test_gtts_falls_back_to_espeak(tmp_path: Path, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    class _FailingGTTS:
        def __init__(self, *, text: str, lang: str, timeout: int | None = None) -> None:
            self._text = text
            self._lang = lang
            self._timeout = timeout

        def save(self, path: str) -> None:
            raise RuntimeError("network unavailable")

    def fake_run(command, capture_output, text, timeout, check):  # type: ignore[no-untyped-def]
        output_path = Path(command[2])
        output_path.write_bytes(b"RIFFmockwav")

        class _Result:
            returncode = 0
            stderr = ""
            stdout = ""

        return _Result()

    monkeypatch.setattr(tts, "gTTS", _FailingGTTS)
    monkeypatch.setattr(tts.shutil, "which", lambda name: "/usr/bin/espeak" if name == "espeak" else None)
    monkeypatch.setattr(tts.subprocess, "run", fake_run)

    generator = TTSGenerator(TTSConfig(default_language="en"), str(tmp_path / "cache"))
    result = generator.generate("Fallback alert", "en")

    assert Path(result.audio_path).exists()
    assert result.backend == "espeak"
    assert result.content_type == "audio/wav"
