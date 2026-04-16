from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


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
    backend: str = "auto"
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
    config_path = Path(path)
    raw = json.loads(config_path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError(f"audio-manager config must be a JSON object: {config_path}")

    ipc_raw = _mapping(raw, "ipc")
    queue_raw = _optional_mapping(raw.get("queue"))
    storage_raw = _mapping(raw, "storage")
    tts_raw = _optional_mapping(raw.get("tts"))
    playback_raw = _optional_mapping(raw.get("playback"))
    speaker_raw = _optional_mapping(raw.get("speaker"))

    return ServiceConfig(
        log_level=_string(raw.get("log_level"), default="info"),
        device_id=_string(raw.get("device_id"), default=""),
        ipc=IPCConfig(socket_path=_string(ipc_raw.get("socket_path"))),
        queue=QueueConfig(
            max_pending=max(1, _int(queue_raw.get("max_pending"), default=128)),
            status_report_interval_sec=max(1, _int(queue_raw.get("status_report_interval_sec"), default=15)),
            dedupe_window_sec=max(0, _int(queue_raw.get("dedupe_window_sec"), default=60)),
        ),
        storage=StorageConfig(
            state_db_path=_string(storage_raw.get("state_db_path")),
            cache_dir=_string(storage_raw.get("cache_dir")),
            event_log_path=_string(storage_raw.get("event_log_path")),
        ),
        tts=TTSConfig(
            backend=_string(tts_raw.get("backend"), default="auto"),
            default_language=_string(tts_raw.get("default_language"), default="en"),
            timeout_sec=max(1, _int(tts_raw.get("timeout_sec"), default=30)),
            voice_map={str(key): str(value) for key, value in _optional_mapping(tts_raw.get("voice_map")).items()},
        ),
        playback=PlaybackConfig(
            backend=_string(playback_raw.get("backend"), default="auto"),
            timeout_sec=max(1, _int(playback_raw.get("timeout_sec"), default=60)),
            command_template=tuple(_string_list(playback_raw.get("command_template"))),
        ),
        speaker=SpeakerConfig(
            enabled=_bool(speaker_raw.get("enabled"), default=False),
            transport=_string(speaker_raw.get("transport"), default="short-code-http"),
            mapping_file=_string(speaker_raw.get("mapping_file"), default=""),
            default_address=_string(speaker_raw.get("default_address"), default=""),
            request_timeout_sec=max(0.1, _float(speaker_raw.get("request_timeout_sec"), default=2.0)),
            retry_count=max(1, _int(speaker_raw.get("retry_count"), default=1)),
            backoff_sec=max(0.0, _float(speaker_raw.get("backoff_sec"), default=1.0)),
        ),
    )


def _mapping(raw: dict[str, Any], key: str) -> dict[str, Any]:
    value = raw.get(key)
    if not isinstance(value, dict):
        raise ValueError(f"audio-manager config field {key!r} must be an object")
    return value


def _optional_mapping(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _string(value: Any, *, default: str = "") -> str:
    if value is None:
        return default
    if isinstance(value, (str, int, float)):
        return str(value).strip()
    raise ValueError(f"expected a string-like value, got {type(value).__name__}")


def _int(value: Any, *, default: int) -> int:
    if value is None:
        return default
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str) and value.strip():
        return int(value.strip())
    raise ValueError(f"expected an integer-like value, got {type(value).__name__}")


def _float(value: Any, *, default: float) -> float:
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str) and value.strip():
        return float(value.strip())
    raise ValueError(f"expected a float-like value, got {type(value).__name__}")


def _bool(value: Any, *, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "on"}:
            return True
        if normalized in {"0", "false", "no", "off"}:
            return False
    raise ValueError(f"expected a boolean-like value, got {type(value).__name__}")


def _string_list(value: Any) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError("expected a list of strings")
    return [_string(item) for item in value]
