from __future__ import annotations

import json
import logging
import queue
import threading
from pathlib import Path
from typing import Any

from .config import ServiceConfig
from .ipc import IPCClient
from .models import AudioJob, parse_audio_request, utc_timestamp
from .playback import PlaybackManager
from .speaker import SpeakerClient
from .store import AudioJobStore
from .tts import TTSGenerator

SERVICE_NAME = "audio-manager"
JOB_MESSAGE_TYPE = "audio-manager-job"
RESULT_MESSAGE_TYPE = "audio-manager-result"
STATUS_MESSAGE_TYPE = "audio-manager-status"
LIST_MESSAGE_TYPE = "audio-manager-list"
ERROR_MESSAGE_TYPE = "audio-manager-error"


class AudioService:
    def __init__(self, config: ServiceConfig, logger: logging.Logger) -> None:
        self._config = config
        self._logger = logger
        self._ipc = IPCClient(config.ipc.socket_path, SERVICE_NAME, logger)
        self._store = AudioJobStore(config.storage.state_db_path)
        self._tts = TTSGenerator(config.tts, config.storage.cache_dir)
        self._playback = PlaybackManager(config.playback)
        self._speaker = SpeakerClient(config.speaker)
        self._queue: "queue.Queue[str]" = queue.Queue(maxsize=config.queue.max_pending)
        self._stop_event = threading.Event()

    def run_forever(self) -> None:
        self._ipc.connect()
        self._requeue_incomplete_jobs()
        self._report_status()

        threads = [
            threading.Thread(target=self._worker_loop, name="audio-manager-worker", daemon=True),
            threading.Thread(target=self._status_loop, name="audio-manager-status", daemon=True),
        ]
        for thread in threads:
            thread.start()

        try:
            self._handle_notifications()
        finally:
            self._stop_event.set()
            for thread in threads:
                thread.join(timeout=2.0)
            self._report_status(status_override="stopped")
            self._store.close()
            self._ipc.close()

    def _requeue_incomplete_jobs(self) -> None:
        for job in self._store.requeue_incomplete_jobs():
            try:
                self._queue.put_nowait(job.id)
            except queue.Full:
                self._logger.warning("audio queue full while requeueing pending job", extra={"jobId": job.id})
                break

    def _handle_notifications(self) -> None:
        while not self._stop_event.is_set():
            notification = self._ipc.read_notification(timeout_sec=1.0)
            if notification is None:
                if self._ipc.is_closed:
                    raise RuntimeError("audio-manager IPC connection closed")
                continue

            method = str(notification.get("method", "")).strip()
            params = notification.get("params", {})
            if not isinstance(params, dict):
                continue

            if method == "mqtt-message":
                if str(params.get("subtopic", "")).strip() != "command":
                    continue
                envelope = params.get("envelope")
                if isinstance(envelope, dict):
                    self._handle_command("", envelope)
            elif method == "service-message":
                if str(params.get("subtopic", "")).strip() != "command":
                    continue
                envelope = params.get("envelope")
                if isinstance(envelope, dict):
                    self._handle_command(str(params.get("sourceService", "")).strip(), envelope)

    def _handle_command(self, source_service: str, envelope: dict[str, Any]) -> None:
        message_type = str(envelope.get("type", "")).strip()
        payload = envelope.get("payload", {})
        if not isinstance(payload, dict):
            payload = {}

        if message_type == "play-audio":
            self._handle_play_audio(source_service, payload)
            return
        if message_type == "get-status":
            self._publish_reply(
                source_service,
                STATUS_MESSAGE_TYPE,
                self._build_status_payload(request_id=str(payload.get("requestId", "")).strip()),
            )
            return
        if message_type == "get-job":
            self._handle_get_job(source_service, payload)
            return
        if message_type == "list-jobs":
            self._handle_list_jobs(source_service, payload)
            return

        self._publish_error(
            source_service,
            request_id=str(payload.get("requestId", "")).strip(),
            request_type=message_type,
            error=f"unsupported audio-manager command {message_type!r}",
        )

    def _handle_play_audio(self, source_service: str, payload: dict[str, Any]) -> None:
        try:
            request = parse_audio_request(
                payload,
                default_language=self._config.tts.default_language,
                default_speaker_address=self._config.speaker.default_address,
            )
        except ValueError as exc:
            self._publish_error(
                source_service,
                request_id=str(payload.get("requestId", "")).strip(),
                request_type="play-audio",
                error=str(exc),
            )
            return

        previous = self._store.find_recent_success(
            request.dedupe_key,
            utc_timestamp() - float(self._config.queue.dedupe_window_sec),
        )
        if previous is not None:
            deduped = self._store.create_deduped_job(request, source_service, previous)
            self._append_event(
                {
                    "event": "deduped",
                    "job": deduped.to_payload(),
                    "previousJobId": previous.id,
                }
            )
            self._publish_job(source_service, deduped)
            self._report_status()
            return

        job = self._store.create_job(request, source_service)
        try:
            self._queue.put_nowait(job.id)
        except queue.Full:
            failed = self._store.mark_failed(
                job.id,
                error="audio queue is full",
                local_state="failed",
                speaker_state="failed",
                speaker_payload="",
                audio_path="",
            )
            self._publish_error(
                source_service,
                request_id=failed.request_id,
                request_type="play-audio",
                error="audio queue is full",
            )
            self._report_status(status_override="degraded")
            return

        self._publish_job(source_service, job)
        self._report_status()

    def _handle_get_job(self, source_service: str, payload: dict[str, Any]) -> None:
        request_id = str(payload.get("requestId", "")).strip()
        job_id = str(payload.get("jobId", "")).strip()
        if job_id == "":
            self._publish_error(source_service, request_id=request_id, request_type="get-job", error="jobId is required")
            return

        try:
            job = self._store.get_job(job_id)
        except KeyError:
            self._publish_error(
                source_service,
                request_id=request_id,
                request_type="get-job",
                error=f"job not found: {job_id}",
            )
            return

        self._publish_reply(
            source_service,
            JOB_MESSAGE_TYPE,
            {"requestId": request_id, "job": job.to_payload()},
        )

    def _handle_list_jobs(self, source_service: str, payload: dict[str, Any]) -> None:
        request_id = str(payload.get("requestId", "")).strip()
        limit_raw = payload.get("limit", 20)
        try:
            limit = int(limit_raw)
        except (TypeError, ValueError):
            limit = 20
        jobs = [job.to_payload() for job in self._store.list_jobs(limit)]
        self._publish_reply(
            source_service,
            LIST_MESSAGE_TYPE,
            {"requestId": request_id, "jobs": jobs, "stats": self._store.stats()},
        )

    def _worker_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                job_id = self._queue.get(timeout=0.5)
            except queue.Empty:
                continue

            try:
                job = self._store.mark_processing(job_id)
            except KeyError:
                continue

            local_state = "not-requested"
            speaker_state = "not-requested"
            speaker_payload = ""
            audio_path = ""
            local_detail: dict[str, Any] = {}
            speaker_detail: dict[str, Any] = {}
            try:
                if job.play_local:
                    generation = self._tts.generate(job.text, job.language)
                    audio_path = generation.audio_path
                    playback = self._playback.play(audio_path)
                    local_state = playback.state
                    local_detail = {
                        "audioPath": generation.audio_path,
                        "backend": generation.backend,
                        "cacheHit": generation.cache_hit,
                        "command": list(playback.command),
                        "voice": generation.voice,
                    }

                if job.play_speaker:
                    speaker_request = parse_audio_request(
                        {
                            "requestId": job.request_id,
                            "text": job.text,
                            "language": job.language,
                            "playLocal": job.play_local,
                            "playSpeaker": job.play_speaker,
                            "speakerAddress": job.speaker_address,
                            "speakerMessageId": job.speaker_message_id,
                            "speakerCode": job.speaker_code,
                            "cameraId": job.camera_id,
                            "cameraName": job.camera_name,
                            "dedupeKey": job.dedupe_key,
                        },
                        default_language=self._config.tts.default_language,
                        default_speaker_address=self._config.speaker.default_address,
                    )
                    speaker = self._speaker.deliver(speaker_request)
                    speaker_state = speaker.state
                    speaker_payload = speaker.payload_text
                    speaker_detail = {
                        "payload": speaker.payload_text,
                        "responseBody": speaker.response_body,
                        "responseCode": speaker.response_code,
                        "transport": speaker.transport,
                    }

                completed = self._store.mark_completed(
                    job.id,
                    local_state=local_state,
                    speaker_state=speaker_state,
                    speaker_payload=speaker_payload,
                    audio_path=audio_path,
                )
                self._append_event(
                    {
                        "event": "completed",
                        "job": completed.to_payload(),
                        "local": local_detail,
                        "speaker": speaker_detail,
                    }
                )
                self._publish_result(completed)
            except Exception as exc:
                failed = self._store.mark_failed(
                    job.id,
                    error=str(exc),
                    local_state=local_state if local_state != "not-requested" else "failed" if job.play_local else "not-requested",
                    speaker_state=speaker_state if speaker_state != "not-requested" else "failed" if job.play_speaker else "not-requested",
                    speaker_payload=speaker_payload,
                    audio_path=audio_path,
                )
                self._append_event(
                    {
                        "event": "failed",
                        "job": failed.to_payload(),
                        "error": str(exc),
                        "local": local_detail,
                        "speaker": speaker_detail,
                    }
                )
                self._publish_error(
                    failed.source_service,
                    request_id=failed.request_id,
                    request_type="play-audio",
                    error=str(exc),
                )
            finally:
                self._queue.task_done()
                self._report_status()

    def _status_loop(self) -> None:
        interval_sec = float(self._config.queue.status_report_interval_sec)
        while not self._stop_event.wait(interval_sec):
            self._report_status()

    def _build_status_payload(self, *, request_id: str = "") -> dict[str, Any]:
        return {
            "requestId": request_id,
            "cacheDir": self._config.storage.cache_dir,
            "deviceId": self._config.device_id,
            "eventLogPath": self._config.storage.event_log_path,
            "pendingQueueDepth": self._queue.qsize(),
            "playbackBackend": self._config.playback.backend,
            "speakerEnabled": self._config.speaker.enabled,
            "speakerTransport": self._config.speaker.transport,
            "stateDbPath": self._config.storage.state_db_path,
            "stats": self._store.stats(),
            "ttsBackend": self._config.tts.backend,
        }

    def _publish_job(self, target_service: str, job: AudioJob) -> None:
        self._publish_reply(
            target_service,
            JOB_MESSAGE_TYPE,
            {"requestId": job.request_id, "job": job.to_payload()},
        )

    def _publish_result(self, job: AudioJob) -> None:
        self._publish_reply(
            job.source_service,
            RESULT_MESSAGE_TYPE,
            {"requestId": job.request_id, "job": job.to_payload()},
        )

    def _publish_reply(self, target_service: str, message_type: str, payload: dict[str, Any]) -> None:
        target_service = target_service.strip()
        try:
            if target_service != "":
                self._ipc.send_service_message(target_service, "response", message_type, payload)
            else:
                self._ipc.publish("response", message_type, payload)
        except Exception as exc:
            self._logger.warning("failed to publish audio-manager reply", extra={"error": str(exc)})

    def _publish_error(self, target_service: str, *, request_id: str, request_type: str, error: str) -> None:
        payload = {
            "error": error,
            "requestId": request_id.strip(),
            "requestType": request_type.strip(),
        }
        self._publish_reply(target_service, ERROR_MESSAGE_TYPE, payload)
        try:
            self._ipc.report_error(error, fatal=False)
        except Exception:
            self._logger.debug("audio-manager error report failed", exc_info=True)

    def _report_status(self, status_override: str | None = None) -> None:
        payload = self._build_status_payload()
        status = status_override or "running"
        try:
            self._ipc.report_status(status, payload)
        except Exception:
            self._logger.debug("audio-manager status report failed", exc_info=True)

    def _append_event(self, event: dict[str, Any]) -> None:
        path = Path(self._config.storage.event_log_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(event, sort_keys=True) + "\n")
