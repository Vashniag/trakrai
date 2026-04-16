from __future__ import annotations

import hashlib
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any


JOB_STATE_QUEUED = "queued"
JOB_STATE_PROCESSING = "processing"
JOB_STATE_COMPLETED = "completed"
JOB_STATE_FAILED = "failed"
JOB_STATE_DEDUPED = "deduped"


def utc_timestamp() -> float:
    return time.time()


def isoformat_ts(value: float | None) -> str:
    if value is None or value <= 0:
        return ""
    return datetime.fromtimestamp(value, timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


@dataclass(frozen=True)
class AudioRequest:
    request_id: str
    text: str
    language: str
    play_local: bool
    play_speaker: bool
    speaker_address: str
    speaker_message_id: str
    speaker_code: str
    camera_id: str
    camera_name: str
    dedupe_key: str


def parse_audio_request(
    payload: dict[str, Any],
    *,
    default_language: str,
    default_speaker_address: str,
) -> AudioRequest:
    request_id = _string(payload.get("requestId")) or uuid.uuid4().hex
    text = _string(payload.get("text"))
    if text == "":
        text = _string(payload.get("message"))
    language = _string(payload.get("language")) or default_language or "en"
    play_local = _bool(payload.get("playLocal"), default=True)
    play_speaker = _bool(payload.get("playSpeaker"), default=False)
    speaker_address = _string(payload.get("speakerAddress")) or default_speaker_address
    speaker_message_id = _string(payload.get("speakerMessageId"))
    speaker_code = _string(payload.get("speakerCode"))
    camera_id = _string(payload.get("cameraId"))
    camera_name = _string(payload.get("cameraName"))

    if not play_local and not play_speaker:
        raise ValueError("audio request must enable at least one target (local or speaker)")
    if play_local and text == "":
        raise ValueError("audio request requires non-empty text when playLocal is enabled")
    if play_speaker and speaker_address == "":
        raise ValueError("audio request requires speakerAddress or a configured default speaker address")

    dedupe_key = _string(payload.get("dedupeKey"))
    if dedupe_key == "":
        dedupe_key = compute_dedupe_key(
            text=text,
            language=language,
            play_local=play_local,
            play_speaker=play_speaker,
            speaker_address=speaker_address,
            speaker_message_id=speaker_message_id,
            speaker_code=speaker_code,
        )

    return AudioRequest(
        request_id=request_id,
        text=text,
        language=language,
        play_local=play_local,
        play_speaker=play_speaker,
        speaker_address=speaker_address,
        speaker_message_id=speaker_message_id,
        speaker_code=speaker_code,
        camera_id=camera_id,
        camera_name=camera_name,
        dedupe_key=dedupe_key,
    )


def compute_dedupe_key(
    *,
    text: str,
    language: str,
    play_local: bool,
    play_speaker: bool,
    speaker_address: str,
    speaker_message_id: str,
    speaker_code: str,
) -> str:
    raw = "|".join(
        [
            text.strip(),
            language.strip().lower(),
            "1" if play_local else "0",
            "1" if play_speaker else "0",
            speaker_address.strip(),
            speaker_message_id.strip(),
            speaker_code.strip(),
        ]
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class AudioJob:
    id: str
    request_id: str
    source_service: str
    text: str
    language: str
    play_local: bool
    play_speaker: bool
    speaker_address: str
    speaker_message_id: str
    speaker_code: str
    camera_id: str
    camera_name: str
    dedupe_key: str
    state: str
    local_state: str
    speaker_state: str
    speaker_payload: str
    audio_path: str
    attempts: int
    error: str
    created_at: float
    updated_at: float
    completed_at: float

    def to_payload(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "requestId": self.request_id,
            "sourceService": self.source_service,
            "text": self.text,
            "language": self.language,
            "playLocal": self.play_local,
            "playSpeaker": self.play_speaker,
            "speakerAddress": self.speaker_address,
            "speakerMessageId": self.speaker_message_id,
            "speakerCode": self.speaker_code,
            "cameraId": self.camera_id,
            "cameraName": self.camera_name,
            "dedupeKey": self.dedupe_key,
            "state": self.state,
            "localState": self.local_state,
            "speakerState": self.speaker_state,
            "speakerPayload": self.speaker_payload,
            "audioPath": self.audio_path,
            "attempts": self.attempts,
            "error": self.error,
            "createdAt": isoformat_ts(self.created_at),
            "updatedAt": isoformat_ts(self.updated_at),
            "completedAt": isoformat_ts(self.completed_at),
        }


def _string(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="ignore").strip()
    if isinstance(value, (str, int, float)):
        return str(value).strip()
    raise ValueError(f"expected a string-like value, got {type(value).__name__}")


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
