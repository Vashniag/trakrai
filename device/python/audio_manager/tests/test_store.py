from __future__ import annotations

from pathlib import Path

from trakrai_audio_manager.models import JOB_STATE_COMPLETED, JOB_STATE_DEDUPED, parse_audio_request, utc_timestamp
from trakrai_audio_manager.store import AudioJobStore


def test_store_tracks_job_lifecycle(tmp_path: Path) -> None:
    store = AudioJobStore(str(tmp_path / "audio.sqlite3"))
    request = parse_audio_request(
        {
            "requestId": "req-1",
            "text": "Wear a helmet",
            "playLocal": True,
            "playSpeaker": True,
            "speakerAddress": "http://speaker.local/play",
            "speakerCode": "201",
        },
        default_language="en",
        default_speaker_address="",
    )

    job = store.create_job(request, "workflow-engine")
    assert job.state == "queued"

    job = store.mark_processing(job.id)
    assert job.state == "processing"
    assert job.attempts == 1

    job = store.mark_completed(
        job.id,
        local_state="completed",
        speaker_state="completed",
        speaker_payload="m:201",
        audio_path="/tmp/audio.wav",
    )
    assert job.state == JOB_STATE_COMPLETED
    assert job.audio_path == "/tmp/audio.wav"
    assert job.speaker_payload == "m:201"

    recent = store.find_recent_success(request.dedupe_key, utc_timestamp() - 10)
    assert recent is not None
    assert recent.id == job.id

    deduped = store.create_deduped_job(request, "workflow-engine", recent)
    assert deduped.state == JOB_STATE_DEDUPED
    assert deduped.audio_path == "/tmp/audio.wav"

    stats = store.stats()
    assert stats["completed"] == 1
    assert stats["deduped"] == 1
    assert stats["total"] == 2

    listed = store.list_jobs(10)
    assert {row.id for row in listed} == {job.id, deduped.id}
    store.close()


def test_parse_audio_request_accepts_message_alias() -> None:
    request = parse_audio_request(
        {
            "requestId": "req-2",
            "message": "Alias field works",
            "playLocal": True,
        },
        default_language="en",
        default_speaker_address="",
    )

    assert request.text == "Alias field works"
