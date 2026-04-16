#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any
from uuid import uuid4


REPO_ROOT = Path(__file__).resolve().parents[2]
DEVICE_ROOT = REPO_ROOT / "device"
COMPOSE_FILE = DEVICE_ROOT / "localdev" / "docker-compose.yml"
COMPOSE_ENV_FILE = DEVICE_ROOT / ".localdev" / "compose.env"
LOCAL_SHARED_DIR = DEVICE_ROOT / ".localdev" / "shared"
LOCAL_AUDIO_WORKFLOW_TEMPLATE = DEVICE_ROOT / "localdev" / "workflows" / "audio-service-verification-workflow.json"
RUNTIME_SHARED_DIR = "/home/hacklab/trakrai-device-runtime/shared"
RUNTIME_CONFIG_PATH = "/home/hacklab/trakrai-device-runtime/configs/workflow-engine.json"
MOCK_SPEAKER_LAST_REQUEST = LOCAL_SHARED_DIR / "mock-speaker" / "last-request.json"
RUNTIME_SHARED_PREFIX = f"{RUNTIME_SHARED_DIR}/"

IPC_CALL_SCRIPT = r"""
import json
import socket
import sys
import time

request = json.loads(sys.argv[1])

sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
sock.connect(request["socketPath"])
sock.settimeout(0.5)

reader = sock.makefile("r", encoding="utf-8")
writer = sock.makefile("w", encoding="utf-8")


def send_frame(frame):
    writer.write(json.dumps(frame) + "\n")
    writer.flush()


def read_frame(deadline):
    while time.time() < deadline:
        try:
            line = reader.readline()
        except TimeoutError:
            continue
        except OSError as exc:
            if "timed out" in str(exc).lower():
                continue
            raise
        if not line:
            raise SystemExit("ipc socket closed")
        return json.loads(line)
    raise SystemExit("timed out waiting for IPC frame")


register_deadline = time.time() + 5
send_frame(
    {
        "id": "register-" + request["requestId"],
        "method": "register-service",
        "params": {"service": request["sourceService"]},
    }
)
register_response = read_frame(register_deadline)
if register_response.get("error") is not None:
    raise SystemExit(register_response["error"].get("message", "register-service failed"))

send_frame(
    {
        "id": "send-" + request["requestId"],
        "method": "send-service-message",
        "params": {
            "targetService": request["targetService"],
            "subtopic": request["subtopic"],
            "type": request["messageType"],
            "payload": request["payload"],
        },
    }
)
send_response = read_frame(register_deadline)
if send_response.get("error") is not None:
    raise SystemExit(send_response["error"].get("message", "send-service-message failed"))

deadline = time.time() + request["waitTimeoutSec"]
expected_types = set(request.get("expectedTypes") or [])

while time.time() < deadline:
    frame = read_frame(deadline)
    if frame.get("method") != "service-message":
        continue
    params = frame.get("params") or {}
    if params.get("sourceService") != request["targetService"]:
        continue
    if params.get("subtopic") != "response":
        continue

    envelope = params.get("envelope") or {}
    payload = envelope.get("payload")
    if not isinstance(payload, dict):
        payload = {}

    response_request_id = payload.get("requestId", "")
    if request["requestId"] and response_request_id not in ("", request["requestId"]):
        continue

    response_type = str(envelope.get("type", "")).strip()
    if expected_types and response_type not in expected_types:
        continue

    print(json.dumps({"envelope": envelope, "params": params}))
    sys.exit(0)

raise SystemExit("timed out waiting for IPC response")
"""


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify the local audio-manager service end to end.")
    parser.add_argument("--timeout-sec", type=int, default=60)
    args = parser.parse_args()

    if not COMPOSE_ENV_FILE.exists():
        raise SystemExit(f"compose env file not found: {COMPOSE_ENV_FILE}")

    direct = verify_direct_audio_request(args.timeout_sec)
    workflow = verify_workflow_audio_request(args.timeout_sec)
    status = service_call(
        target_service="audio-manager",
        message_type="get-status",
        payload={"requestId": uuid4().hex},
        expected_types={"audio-manager-status"},
    )["payload"]

    print(json.dumps({"direct": direct, "status": status, "workflow": workflow}, indent=2))
    return 0


def verify_direct_audio_request(timeout_sec: int) -> dict[str, Any]:
    token = uuid4().hex[:8]
    request_id = uuid4().hex
    before_speaker_mtime = MOCK_SPEAKER_LAST_REQUEST.stat().st_mtime if MOCK_SPEAKER_LAST_REQUEST.exists() else 0.0
    response = service_call(
        target_service="audio-manager",
        message_type="play-audio",
        payload={
            "cameraId": "1",
            "cameraName": "Camera-1",
            "language": "en",
            "playLocal": True,
            "playSpeaker": True,
            "requestId": request_id,
            "speakerMessageId": "local-alert",
            "text": f"Local audio verification {token}",
        },
        expected_types={"audio-manager-job"},
        wait_timeout_sec=10,
    )
    job = response["payload"]["job"]
    completed_job = wait_for_audio_job(job["id"], timeout_sec)
    if completed_job["state"] != "completed":
        raise SystemExit(json.dumps({"error": "direct audio job did not complete", "job": completed_job}, indent=2))
    if completed_job["localState"] != "completed" or completed_job["speakerState"] != "completed":
        raise SystemExit(json.dumps({"error": "direct audio job had partial completion", "job": completed_job}, indent=2))

    audio_path = runtime_to_host_path(completed_job["audioPath"])
    if not audio_path.exists():
        raise SystemExit(f"expected generated audio file at {audio_path}")
    if not MOCK_SPEAKER_LAST_REQUEST.exists() or MOCK_SPEAKER_LAST_REQUEST.stat().st_mtime <= before_speaker_mtime:
        raise SystemExit("mock speaker did not record a new direct audio request")

    speaker_request = json.loads(MOCK_SPEAKER_LAST_REQUEST.read_text(encoding="utf-8"))
    if speaker_request.get("body") != "m:901":
        raise SystemExit(json.dumps({"error": "unexpected speaker payload", "speakerRequest": speaker_request}, indent=2))

    event = find_event_for_job(completed_job["id"])
    if event.get("event") != "completed":
        raise SystemExit(json.dumps({"error": "missing completed audio event", "event": event}, indent=2))

    return {"event": event, "job": completed_job, "speakerRequest": speaker_request}


def verify_workflow_audio_request(timeout_sec: int) -> dict[str, Any]:
    workflow_path = LOCAL_SHARED_DIR / "workflow.json"
    backup_path = LOCAL_SHARED_DIR / "workflow.backup.audio-verify.json"
    if workflow_path.exists():
        shutil.copy2(workflow_path, backup_path)

    workflow = json.loads(LOCAL_AUDIO_WORKFLOW_TEMPLATE.read_text(encoding="utf-8"))
    workflow["metadata"]["name"] = f"Audio Service Verification Workflow {uuid4().hex[:6]}"
    workflow["nodes"][1]["data"]["configuration"]["message"] = f"Workflow audio verification {uuid4().hex[:6]}"
    workflow_path.write_text(json.dumps(workflow, indent=2) + "\n", encoding="utf-8")

    try:
        wait_for_workflow_name(str(workflow["metadata"]["name"]), timeout_sec)
        response = service_call(
            target_service="workflow-engine",
            message_type="enqueue-detection",
            payload={
                "cameraId": "1",
                "cameraName": "Camera-1",
                "detections": [{"bbox": [10, 10, 30, 30], "confidence": 0.95, "label": "person"}],
                "frameId": f"frame-{uuid4().hex[:6]}",
                "requestId": uuid4().hex,
            },
            expected_types={"workflow-engine-result"},
            wait_timeout_sec=15,
        )
        run = response["payload"]["run"]
        audio_output = run["outputs"].get("audio")
        if not isinstance(audio_output, dict):
            raise SystemExit(json.dumps({"error": "workflow did not produce audio node output", "run": run}, indent=2))
        completed_job = wait_for_audio_job(str(audio_output.get("jobId", "")).strip(), timeout_sec)
        if completed_job["state"] != "completed":
            raise SystemExit(json.dumps({"error": "workflow audio job did not complete", "job": completed_job}, indent=2))

        speaker_request = json.loads(MOCK_SPEAKER_LAST_REQUEST.read_text(encoding="utf-8"))
        if speaker_request.get("body") != "m:902":
            raise SystemExit(json.dumps({"error": "unexpected workflow speaker payload", "speakerRequest": speaker_request}, indent=2))
        return {"job": completed_job, "run": run, "speakerRequest": speaker_request}
    finally:
        if backup_path.exists():
            shutil.move(str(backup_path), str(workflow_path))
            wait_for_workflow_reload(timeout_sec)
        elif workflow_path.exists():
            workflow_path.unlink()


def wait_for_audio_job(job_id: str, timeout_sec: int) -> dict[str, Any]:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        response = service_call(
            target_service="audio-manager",
            message_type="get-job",
            payload={"jobId": job_id, "requestId": uuid4().hex},
            expected_types={"audio-manager-job"},
            wait_timeout_sec=10,
        )
        job = response["payload"]["job"]
        if job["state"] in {"completed", "failed", "deduped"}:
            return job
        time.sleep(0.5)
    raise SystemExit(f"timed out waiting for audio job {job_id}")


def wait_for_workflow_name(workflow_name: str, timeout_sec: int) -> None:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        response = service_call(
            target_service="workflow-engine",
            message_type="get-status",
            payload={"requestId": uuid4().hex},
            expected_types={"workflow-engine-status"},
            wait_timeout_sec=10,
        )
        workflow = response["payload"].get("workflow") or {}
        if workflow.get("loaded") and workflow.get("name") == workflow_name:
            return
        time.sleep(0.5)
    raise SystemExit(f"timed out waiting for workflow-engine to load {workflow_name!r}")


def wait_for_workflow_reload(timeout_sec: int) -> None:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        response = service_call(
            target_service="workflow-engine",
            message_type="get-status",
            payload={"requestId": uuid4().hex},
            expected_types={"workflow-engine-status"},
            wait_timeout_sec=10,
        )
        workflow = response["payload"].get("workflow") or {}
        if workflow.get("loaded"):
            return
        time.sleep(0.5)
    raise SystemExit("timed out waiting for workflow-engine reload")


def find_event_for_job(job_id: str) -> dict[str, Any]:
    event_log = LOCAL_SHARED_DIR / "audio" / "audio-events.jsonl"
    if not event_log.exists():
        raise SystemExit(f"audio event log not found: {event_log}")
    for line in reversed(event_log.read_text(encoding="utf-8").splitlines()):
        if not line.strip():
            continue
        event = json.loads(line)
        job = event.get("job") or {}
        if job.get("id") == job_id:
            return event
    raise SystemExit(f"audio event for job {job_id} not found")


def runtime_to_host_path(runtime_path: str) -> Path:
    if not runtime_path.startswith(RUNTIME_SHARED_PREFIX):
        raise SystemExit(f"runtime path does not point inside the shared dir: {runtime_path}")
    return LOCAL_SHARED_DIR / runtime_path[len(RUNTIME_SHARED_PREFIX) :]


def service_call(
    *,
    target_service: str,
    message_type: str,
    payload: dict[str, object],
    expected_types: set[str],
    wait_timeout_sec: int = 20,
) -> dict[str, Any]:
    request_id = str(payload.get("requestId", "")).strip() or uuid4().hex
    request_payload = dict(payload)
    request_payload["requestId"] = request_id

    output = exec_in_emulator(
        [
            "python3.8",
            "-c",
            IPC_CALL_SCRIPT,
            json.dumps(
                {
                    "expectedTypes": sorted(expected_types),
                    "messageType": message_type,
                    "payload": request_payload,
                    "requestId": request_id,
                    "socketPath": "/tmp/trakrai-cloud-comm.sock",
                    "sourceService": f"audio-verifier-{request_id[:12]}",
                    "subtopic": "command",
                    "targetService": target_service,
                    "waitTimeoutSec": wait_timeout_sec,
                }
            ),
        ]
    )
    response = json.loads(output)
    envelope = response["envelope"]
    payload_data = envelope.get("payload") or {}
    response_type = str(envelope.get("type", "")).strip()
    if response_type.endswith("-error"):
        raise SystemExit(json.dumps(payload_data, indent=2))
    response["payload"] = payload_data
    return response


def exec_in_emulator(command: list[str]) -> str:
    result = subprocess.run(
        compose_command("exec", "-T", "device-emulator", *command),
        cwd=DEVICE_ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise SystemExit(result.stderr or result.stdout or f"command failed: {command}")
    return result.stdout.strip()


def compose_command(*args: str) -> list[str]:
    return [
        "docker",
        "compose",
        "--env-file",
        str(COMPOSE_ENV_FILE),
        "-f",
        str(COMPOSE_FILE),
        *args,
    ]


if __name__ == "__main__":
    raise SystemExit(main())
