from __future__ import annotations

import sqlite3
import threading
import uuid
from pathlib import Path
from typing import Any

from .models import (
    AudioJob,
    AudioRequest,
    JOB_STATE_COMPLETED,
    JOB_STATE_DEDUPED,
    JOB_STATE_FAILED,
    JOB_STATE_PROCESSING,
    JOB_STATE_QUEUED,
    utc_timestamp,
)


class AudioJobStore:
    def __init__(self, db_path: str) -> None:
        self._db_path = Path(db_path)
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(self._db_path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.RLock()
        with self._lock:
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA synchronous=NORMAL")
            self._ensure_schema()

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    def requeue_incomplete_jobs(self) -> list[AudioJob]:
        now = utc_timestamp()
        with self._lock:
            self._conn.execute(
                """
                UPDATE jobs
                SET state = ?, updated_at = ?
                WHERE state IN (?, ?)
                """,
                (JOB_STATE_QUEUED, now, JOB_STATE_QUEUED, JOB_STATE_PROCESSING),
            )
            self._conn.commit()
            rows = self._conn.execute(
                "SELECT * FROM jobs WHERE state = ? ORDER BY created_at ASC",
                (JOB_STATE_QUEUED,),
            ).fetchall()
        return [self._row_to_job(row) for row in rows]

    def create_job(self, request: AudioRequest, source_service: str) -> AudioJob:
        job_id = uuid.uuid4().hex
        now = utc_timestamp()
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO jobs (
                  id, request_id, source_service, text, language,
                  play_local, play_speaker, speaker_address, speaker_message_id, speaker_code,
                  camera_id, camera_name, dedupe_key, state, local_state, speaker_state,
                  speaker_payload, audio_path, attempts, error, created_at, updated_at, completed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    job_id,
                    request.request_id,
                    source_service.strip(),
                    request.text,
                    request.language,
                    1 if request.play_local else 0,
                    1 if request.play_speaker else 0,
                    request.speaker_address,
                    request.speaker_message_id,
                    request.speaker_code,
                    request.camera_id,
                    request.camera_name,
                    request.dedupe_key,
                    JOB_STATE_QUEUED,
                    "pending",
                    "pending",
                    "",
                    "",
                    0,
                    "",
                    now,
                    now,
                    0.0,
                ),
            )
            self._conn.commit()
        return self.get_job(job_id)

    def create_deduped_job(self, request: AudioRequest, source_service: str, previous_job: AudioJob) -> AudioJob:
        job_id = uuid.uuid4().hex
        now = utc_timestamp()
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO jobs (
                  id, request_id, source_service, text, language,
                  play_local, play_speaker, speaker_address, speaker_message_id, speaker_code,
                  camera_id, camera_name, dedupe_key, state, local_state, speaker_state,
                  speaker_payload, audio_path, attempts, error, created_at, updated_at, completed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    job_id,
                    request.request_id,
                    source_service.strip(),
                    request.text,
                    request.language,
                    1 if request.play_local else 0,
                    1 if request.play_speaker else 0,
                    request.speaker_address,
                    request.speaker_message_id,
                    request.speaker_code,
                    request.camera_id,
                    request.camera_name,
                    request.dedupe_key,
                    JOB_STATE_DEDUPED,
                    previous_job.local_state,
                    previous_job.speaker_state,
                    previous_job.speaker_payload,
                    previous_job.audio_path,
                    0,
                    "",
                    now,
                    now,
                    now,
                ),
            )
            self._conn.commit()
        return self.get_job(job_id)

    def find_recent_success(self, dedupe_key: str, cutoff_ts: float) -> AudioJob | None:
        with self._lock:
            row = self._conn.execute(
                """
                SELECT * FROM jobs
                WHERE dedupe_key = ?
                  AND state IN (?, ?)
                  AND completed_at >= ?
                ORDER BY completed_at DESC
                LIMIT 1
                """,
                (dedupe_key, JOB_STATE_COMPLETED, JOB_STATE_DEDUPED, cutoff_ts),
            ).fetchone()
        return self._row_to_job(row) if row is not None else None

    def mark_processing(self, job_id: str) -> AudioJob:
        now = utc_timestamp()
        with self._lock:
            self._conn.execute(
                """
                UPDATE jobs
                SET state = ?, attempts = attempts + 1, updated_at = ?
                WHERE id = ?
                """,
                (JOB_STATE_PROCESSING, now, job_id),
            )
            self._conn.commit()
        return self.get_job(job_id)

    def mark_completed(
        self,
        job_id: str,
        *,
        local_state: str,
        speaker_state: str,
        speaker_payload: str,
        audio_path: str,
    ) -> AudioJob:
        now = utc_timestamp()
        with self._lock:
            self._conn.execute(
                """
                UPDATE jobs
                SET state = ?, local_state = ?, speaker_state = ?, speaker_payload = ?, audio_path = ?,
                    error = '', updated_at = ?, completed_at = ?
                WHERE id = ?
                """,
                (JOB_STATE_COMPLETED, local_state, speaker_state, speaker_payload, audio_path, now, now, job_id),
            )
            self._conn.commit()
        return self.get_job(job_id)

    def mark_failed(
        self,
        job_id: str,
        *,
        error: str,
        local_state: str,
        speaker_state: str,
        speaker_payload: str,
        audio_path: str,
    ) -> AudioJob:
        now = utc_timestamp()
        with self._lock:
            self._conn.execute(
                """
                UPDATE jobs
                SET state = ?, local_state = ?, speaker_state = ?, speaker_payload = ?, audio_path = ?,
                    error = ?, updated_at = ?, completed_at = ?
                WHERE id = ?
                """,
                (JOB_STATE_FAILED, local_state, speaker_state, speaker_payload, audio_path, error, now, now, job_id),
            )
            self._conn.commit()
        return self.get_job(job_id)

    def get_job(self, job_id: str) -> AudioJob:
        with self._lock:
            row = self._conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        if row is None:
            raise KeyError(job_id)
        return self._row_to_job(row)

    def list_jobs(self, limit: int) -> list[AudioJob]:
        capped_limit = max(1, min(200, int(limit)))
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?",
                (capped_limit,),
            ).fetchall()
        return [self._row_to_job(row) for row in rows]

    def stats(self) -> dict[str, int]:
        counts = {
            JOB_STATE_QUEUED: 0,
            JOB_STATE_PROCESSING: 0,
            JOB_STATE_COMPLETED: 0,
            JOB_STATE_FAILED: 0,
            JOB_STATE_DEDUPED: 0,
        }
        with self._lock:
            rows = self._conn.execute(
                "SELECT state, COUNT(*) AS count FROM jobs GROUP BY state",
            ).fetchall()
        for row in rows:
            counts[str(row["state"])] = int(row["count"])
        counts["total"] = sum(counts[state] for state in (
            JOB_STATE_QUEUED,
            JOB_STATE_PROCESSING,
            JOB_STATE_COMPLETED,
            JOB_STATE_FAILED,
            JOB_STATE_DEDUPED,
        ))
        return counts

    def _ensure_schema(self) -> None:
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS jobs (
              id TEXT PRIMARY KEY,
              request_id TEXT NOT NULL,
              source_service TEXT NOT NULL,
              text TEXT NOT NULL,
              language TEXT NOT NULL,
              play_local INTEGER NOT NULL,
              play_speaker INTEGER NOT NULL,
              speaker_address TEXT NOT NULL,
              speaker_message_id TEXT NOT NULL,
              speaker_code TEXT NOT NULL,
              camera_id TEXT NOT NULL,
              camera_name TEXT NOT NULL,
              dedupe_key TEXT NOT NULL,
              state TEXT NOT NULL,
              local_state TEXT NOT NULL,
              speaker_state TEXT NOT NULL,
              speaker_payload TEXT NOT NULL,
              audio_path TEXT NOT NULL,
              attempts INTEGER NOT NULL DEFAULT 0,
              error TEXT NOT NULL,
              created_at REAL NOT NULL,
              updated_at REAL NOT NULL,
              completed_at REAL NOT NULL DEFAULT 0
            )
            """
        )
        self._conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_jobs_state_created ON jobs(state, created_at DESC)"
        )
        self._conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_jobs_dedupe_completed ON jobs(dedupe_key, completed_at DESC)"
        )
        self._conn.commit()

    def _row_to_job(self, row: sqlite3.Row) -> AudioJob:
        return AudioJob(
            id=str(row["id"]),
            request_id=str(row["request_id"]),
            source_service=str(row["source_service"]),
            text=str(row["text"]),
            language=str(row["language"]),
            play_local=bool(row["play_local"]),
            play_speaker=bool(row["play_speaker"]),
            speaker_address=str(row["speaker_address"]),
            speaker_message_id=str(row["speaker_message_id"]),
            speaker_code=str(row["speaker_code"]),
            camera_id=str(row["camera_id"]),
            camera_name=str(row["camera_name"]),
            dedupe_key=str(row["dedupe_key"]),
            state=str(row["state"]),
            local_state=str(row["local_state"]),
            speaker_state=str(row["speaker_state"]),
            speaker_payload=str(row["speaker_payload"]),
            audio_path=str(row["audio_path"]),
            attempts=int(row["attempts"]),
            error=str(row["error"]),
            created_at=float(row["created_at"]),
            updated_at=float(row["updated_at"]),
            completed_at=float(row["completed_at"]),
        )
