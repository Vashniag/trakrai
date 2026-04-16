from __future__ import annotations

from pathlib import Path

from trakrai_audio_manager.config import TTSConfig
from trakrai_audio_manager.tts import TTSGenerator


def test_mock_tts_generator_caches_wave_files(tmp_path: Path) -> None:
    generator = TTSGenerator(TTSConfig(backend="mock", default_language="en"), str(tmp_path / "cache"))

    first = generator.generate("Alert from TrakrAI", "en")
    second = generator.generate("Alert from TrakrAI", "en")

    assert Path(first.audio_path).exists()
    assert first.cache_hit is False
    assert second.cache_hit is True
    assert first.audio_path == second.audio_path
