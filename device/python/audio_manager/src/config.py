from __future__ import annotations

from pathlib import Path

from generated_configs.audio_manager import (
    AudioManagerConfig as ServiceConfig,
    AudioManagerConfigIpc as IPCConfig,
    AudioManagerConfigPlayback as PlaybackConfig,
    AudioManagerConfigQueue as QueueConfig,
    AudioManagerConfigSpeaker as SpeakerConfig,
    AudioManagerConfigStorage as StorageConfig,
    AudioManagerConfigTts as TTSConfig,
    load_audio_manager_config,
)


def load_config(path: str | Path) -> ServiceConfig:
    return load_audio_manager_config(path)
