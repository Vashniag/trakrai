from __future__ import annotations

import csv
import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from .config import SpeakerConfig
from .models import AudioRequest


@dataclass(frozen=True)
class SpeakerResult:
    state: str
    payload_text: str
    transport: str
    response_code: int
    response_body: str


class SpeakerClient:
    def __init__(self, config: SpeakerConfig) -> None:
        self._config = config
        self._mapping_file = Path(config.mapping_file) if config.mapping_file else None
        self._mapping_mtime = 0.0
        self._mapping: dict[str, str] = {}

    def deliver(self, request: AudioRequest) -> SpeakerResult:
        if not self._config.enabled:
            raise RuntimeError("speaker delivery requested but speaker support is disabled in config")

        address = request.speaker_address.strip() or self._config.default_address.strip()
        if address == "":
            raise RuntimeError("speaker delivery requested without a speaker address")

        transport = self._config.transport.strip().lower()
        if transport == "short-code-http":
            code = request.speaker_code.strip() or self._resolve_code(request.speaker_message_id)
            if code == "":
                raise RuntimeError("speaker delivery requires speakerCode or speakerMessageId")
            body = f"m:{code}".encode("utf-8")
            headers = {"Content-Type": "text/plain"}
            payload_text = body.decode("utf-8")
        elif transport == "json-http":
            payload_text = json.dumps(
                {
                    "cameraId": request.camera_id,
                    "cameraName": request.camera_name,
                    "code": request.speaker_code.strip() or self._resolve_code(request.speaker_message_id),
                    "language": request.language,
                    "messageId": request.speaker_message_id,
                    "text": request.text,
                },
                separators=(",", ":"),
            )
            body = payload_text.encode("utf-8")
            headers = {"Content-Type": "application/json"}
        else:
            raise RuntimeError(f"unsupported speaker transport: {self._config.transport}")

        last_error = ""
        for attempt in range(1, self._config.retry_count + 1):
            req = urllib.request.Request(address, data=body, headers=headers, method="POST")
            try:
                with urllib.request.urlopen(req, timeout=self._config.request_timeout_sec) as response:
                    response_body = response.read().decode("utf-8", errors="ignore")
                    return SpeakerResult(
                        state="completed",
                        payload_text=payload_text,
                        transport=transport,
                        response_code=int(getattr(response, "status", response.getcode())),
                        response_body=response_body,
                    )
            except urllib.error.URLError as exc:
                last_error = str(exc)
            except OSError as exc:
                last_error = str(exc)

            if attempt < self._config.retry_count and self._config.backoff_sec > 0:
                time.sleep(self._config.backoff_sec)

        raise RuntimeError(f"speaker delivery failed after {self._config.retry_count} attempt(s): {last_error}")

    def _resolve_code(self, message_id: str) -> str:
        normalized = message_id.strip()
        if normalized == "":
            return ""
        mapping = self._load_mapping()
        return mapping.get(normalized, "")

    def _load_mapping(self) -> dict[str, str]:
        if self._mapping_file is None:
            return self._mapping
        if not self._mapping_file.exists():
            return self._mapping

        stat = self._mapping_file.stat()
        if self._mapping and stat.st_mtime <= self._mapping_mtime:
            return self._mapping

        mapping: dict[str, str] = {}
        with self._mapping_file.open("r", encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                identifier = str(row.get("text_identifier", "")).strip()
                if identifier == "":
                    continue
                code = str(row.get("speaker_code", "")).strip()
                if code == "":
                    code = str(row.get("Male_audio_short_code", "")).strip()
                if code == "":
                    code = str(row.get("Female_audio_short_code", "")).strip()
                if code != "":
                    mapping[identifier] = code

        self._mapping = mapping
        self._mapping_mtime = stat.st_mtime
        return self._mapping
