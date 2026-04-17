from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from trakrai_service_runtime import (
    bool_value,
    float_value,
    int_value,
    load_json_object,
    optional_object,
    require_object,
    string_list,
    string_value,
)


@dataclass(frozen=True)
class IPCConfig:
    socket_path: str


@dataclass(frozen=True)
class QueueConfig:
    max_pending: int = 128
    status_report_interval_sec: int = 15
    dedupe_window_sec: int = 60


@dataclass(frozen=True)
class StorageConfig:
    state_db_path: str
    cache_dir: str
    event_log_path: str


@dataclass(frozen=True)
class TTSConfig:
    default_language: str = "en"
    timeout_sec: int = 30
    voice_map: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class PlaybackConfig:
    backend: str = "auto"
    timeout_sec: int = 60
    command_template: tuple[str, ...] = ()


@dataclass(frozen=True)
class SpeakerConfig:
    enabled: bool = False
    transport: str = "short-code-http"
    mapping_file: str = ""
    default_address: str = ""
    request_timeout_sec: float = 2.0
    retry_count: int = 1
    backoff_sec: float = 1.0


@dataclass(frozen=True)
class ServiceConfig:
    log_level: str
    device_id: str
    ipc: IPCConfig
    queue: QueueConfig
    storage: StorageConfig
    tts: TTSConfig
    playback: PlaybackConfig
    speaker: SpeakerConfig


def load_config(path: str | Path) -> ServiceConfig:
    config_path, raw = load_json_object(path, label="audio-manager config")

    ipc_raw = require_object(raw.get("ipc"), "ipc")
    queue_raw = optional_object(raw.get("queue"))
    storage_raw = require_object(raw.get("storage"), "storage")
    tts_raw = optional_object(raw.get("tts"))
    playback_raw = optional_object(raw.get("playback"))
    speaker_raw = optional_object(raw.get("speaker"))

    return ServiceConfig(
        log_level=string_value(raw.get("log_level"), default="info", field="log_level"),
        device_id=string_value(raw.get("device_id"), default="", field="device_id"),
        ipc=IPCConfig(socket_path=string_value(ipc_raw.get("socket_path"), field="ipc.socket_path")),
        queue=QueueConfig(
            max_pending=int_value(queue_raw.get("max_pending"), default=128, field="queue.max_pending", minimum=1),
            status_report_interval_sec=int_value(
                queue_raw.get("status_report_interval_sec"),
                default=15,
                field="queue.status_report_interval_sec",
                minimum=1,
            ),
            dedupe_window_sec=int_value(
                queue_raw.get("dedupe_window_sec"),
                default=60,
                field="queue.dedupe_window_sec",
                minimum=0,
            ),
        ),
        storage=StorageConfig(
            state_db_path=string_value(storage_raw.get("state_db_path"), field="storage.state_db_path"),
            cache_dir=string_value(storage_raw.get("cache_dir"), field="storage.cache_dir"),
            event_log_path=string_value(storage_raw.get("event_log_path"), field="storage.event_log_path"),
        ),
        tts=TTSConfig(
            default_language=string_value(tts_raw.get("default_language"), default="en", field="tts.default_language"),
            timeout_sec=int_value(tts_raw.get("timeout_sec"), default=30, field="tts.timeout_sec", minimum=1),
            voice_map={str(key): str(value) for key, value in optional_object(tts_raw.get("voice_map")).items()},
        ),
        playback=PlaybackConfig(
            backend=string_value(playback_raw.get("backend"), default="auto", field="playback.backend"),
            timeout_sec=int_value(
                playback_raw.get("timeout_sec"),
                default=60,
                field="playback.timeout_sec",
                minimum=1,
            ),
            command_template=tuple(string_list(playback_raw.get("command_template"), field="playback.command_template")),
        ),
        speaker=SpeakerConfig(
            enabled=bool_value(speaker_raw.get("enabled"), default=False, field="speaker.enabled"),
            transport=string_value(speaker_raw.get("transport"), default="short-code-http", field="speaker.transport"),
            mapping_file=string_value(speaker_raw.get("mapping_file"), default="", field="speaker.mapping_file"),
            default_address=string_value(
                speaker_raw.get("default_address"),
                default="",
                field="speaker.default_address",
            ),
            request_timeout_sec=float_value(
                speaker_raw.get("request_timeout_sec"),
                default=2.0,
                field="speaker.request_timeout_sec",
                minimum=0.1,
            ),
            retry_count=int_value(speaker_raw.get("retry_count"), default=1, field="speaker.retry_count", minimum=1),
            backoff_sec=float_value(
                speaker_raw.get("backoff_sec"),
                default=1.0,
                field="speaker.backoff_sec",
                minimum=0.0,
            ),
        ),
    )
