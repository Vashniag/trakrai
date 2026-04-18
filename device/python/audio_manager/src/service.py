from __future__ import annotations

import json
import logging
import queue
import threading
from typing import Any

from trakrai_service_runtime import (
    IPCClient,
    append_jsonl,
    publish_error,
    publish_reply,
    report_status,
    run_command_loop,
    run_periodic_loop,
)
from trakrai_service_runtime.generated_contracts._runtime import to_wire_value
from trakrai_service_runtime.generated_contracts.audio_manager import (
    AudioManagerAudioRequest,
    AudioManagerGetJobRequest,
    AudioManagerListJobsRequest,
    AudioManagerStatusRequest,
    dispatch_audio_manager,
)

from .config import ServiceConfig
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
            threading.Thread(
                target=run_periodic_loop,
                args=(
                    self._stop_event,
                    float(self._config.queue.status_report_interval_sec),
                    self._report_status,
                ),
                name="audio-manager-status",
                daemon=True,
            ),
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
        run_command_loop(
            self._ipc,
            self._stop_event,
            self._handle_command,
            closed_error_message="audio-manager IPC connection closed",
        )

    def _handle_command(self, source_service: str, envelope: dict[str, Any]) -> None:
        message_type = str(envelope.get("type", "")).strip()
        payload = envelope.get("payload", {})
        if not isinstance(payload, dict):
            payload = {}

        if dispatch_audio_manager(source_service, "command", envelope, self):
            return

        self._publish_error(
            source_service,
            request_id=str(payload.get("requestId", "")).strip(),
            request_type=message_type,
            error=f"unsupported audio-manager command {message_type!r}",
        )

    def handle_play_audio(self, source_service: str, request: AudioManagerAudioRequest) -> None:
        self._handle_play_audio(source_service, request)

    def handle_get_job(self, source_service: str, request: AudioManagerGetJobRequest) -> None:
        self._handle_get_job(source_service, request)

    def handle_list_jobs(self, source_service: str, request: AudioManagerListJobsRequest) -> None:
        self._handle_list_jobs(source_service, request)

    def handle_get_status(self, source_service: str, request: AudioManagerStatusRequest) -> None:
        self._publish_reply(
            source_service,
            STATUS_MESSAGE_TYPE,
            self._build_status_payload(request_id=request.request_id or ""),
        )

    def _handle_play_audio(self, source_service: str, request: AudioManagerAudioRequest) -> None:
        payload = to_wire_value(request)
        try:
            parsed_request = parse_audio_request(
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
            parsed_request.dedupe_key,
            utc_timestamp() - float(self._config.queue.dedupe_window_sec),
        )
        if previous is not None:
            deduped = self._store.create_deduped_job(parsed_request, source_service, previous)
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

        job = self._store.create_job(parsed_request, source_service)
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

    def _handle_get_job(self, source_service: str, request: AudioManagerGetJobRequest) -> None:
        request_id = request.request_id or ""
        if request.job_id == "":
            self._publish_error(source_service, request_id=request_id, request_type="get-job", error="jobId is required")
            return

        try:
            job = self._store.get_job(request.job_id)
        except KeyError:
            self._publish_error(
                source_service,
                request_id=request_id,
                request_type="get-job",
                error=f"job not found: {request.job_id}",
            )
            return

        self._publish_reply(
            source_service,
            JOB_MESSAGE_TYPE,
            {"requestId": request_id, "job": job.to_payload()},
        )

    def _handle_list_jobs(self, source_service: str, request: AudioManagerListJobsRequest) -> None:
        request_id = request.request_id or ""
        limit = request.limit or 20
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
                    playback = self._playback.play(audio_path, content_type=generation.content_type)
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
            "ttsBackend": "gtts-primary/espeak-fallback",
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
        publish_reply(
            self._ipc,
            self._logger,
            target_service,
            message_type,
            payload,
            warning_message="failed to publish audio-manager reply",
        )

    def _publish_error(self, target_service: str, *, request_id: str, request_type: str, error: str) -> None:
        publish_error(
            self._ipc,
            self._logger,
            target_service,
            ERROR_MESSAGE_TYPE,
            request_id=request_id,
            request_type=request_type,
            error=error,
            warning_message="failed to publish audio-manager reply",
            debug_message="audio-manager error report failed",
        )

    def _report_status(self, status_override: str | None = None) -> None:
        report_status(
            self._ipc,
            self._logger,
            status_override or "running",
            self._build_status_payload(),
            debug_message="audio-manager status report failed",
        )

    def _append_event(self, event: dict[str, Any]) -> None:
        append_jsonl(self._config.storage.event_log_path, event)
