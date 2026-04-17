#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse
from uuid import uuid4


REPO_ROOT = Path(__file__).resolve().parents[2]
DEVICE_ROOT = REPO_ROOT / "device"
COMPOSE_FILE = DEVICE_ROOT / "localdev" / "docker-compose.yml"
COMPOSE_ENV_FILE = DEVICE_ROOT / ".localdev" / "compose.env"
LOCAL_STAGE_DIR = DEVICE_ROOT / ".localdev" / "stage"
LOCAL_SHARED_DIR = DEVICE_ROOT / ".localdev" / "shared"
LOCAL_WORKFLOW_TEMPLATE = DEVICE_ROOT / "localdev" / "workflows" / "violation-service-verification-workflow.json"
RUNTIME_SHARED_DIR = "/home/hacklab/trakrai-device-runtime/shared"
RUNTIME_CONFIG_PATH = "/home/hacklab/trakrai-device-runtime/configs/workflow-engine.json"

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
    parser = argparse.ArgumentParser(description="Verify the local send-violation-to-cloud workflow and video-recorder service.")
    parser.add_argument("--timeout-sec", type=int, default=120)
    args = parser.parse_args()

    if not COMPOSE_ENV_FILE.exists():
        raise SystemExit(f"compose env file not found: {COMPOSE_ENV_FILE}")
    if not LOCAL_STAGE_DIR.exists():
        raise SystemExit(f"local stage dir not found: {LOCAL_STAGE_DIR}")

    cloud_transfer_config = json.loads((LOCAL_STAGE_DIR / "configs" / "cloud-transfer.json").read_text(encoding="utf-8"))
    cloud_comm_config = json.loads((LOCAL_STAGE_DIR / "configs" / "cloud-comm.json").read_text(encoding="utf-8"))
    cloud_api = cloud_transfer_config.get("cloud_api") or {}
    cloud_api_base_url = host_accessible_cloud_url(str(cloud_api.get("base_url", "")).strip())
    access_token = str(cloud_api.get("access_token", "")).strip()
    device_id = str(cloud_transfer_config.get("device_id", "")).strip()
    download_path = str(cloud_api.get("download_presign_path", "")).strip()

    if cloud_api_base_url == "":
        raise SystemExit("cloud-transfer config is missing cloud_api.base_url")
    if access_token == "":
        raise SystemExit("cloud-transfer config is missing cloud_api.access_token; start local_device_runtime.py with --cloud-api-access-token")
    if device_id == "":
        raise SystemExit("cloud-transfer config is missing device_id")
    if download_path == "":
        raise SystemExit("cloud-transfer config is missing cloud_api.download_presign_path")

    workflow_path = LOCAL_SHARED_DIR / "workflow.json"
    backup_path = LOCAL_SHARED_DIR / "workflow.backup.violation-verify.json"
    if workflow_path.exists():
        shutil.copy2(workflow_path, backup_path)

    workflow = json.loads(LOCAL_WORKFLOW_TEMPLATE.read_text(encoding="utf-8"))
    workflow["metadata"]["name"] = f"Violation Service Verification {uuid4().hex[:6]}"
    violation_node = workflow["nodes"][0]
    violation_node["data"]["configuration"]["remotePrefix"] = f"violations-verification/{uuid4().hex[:6]}"
    workflow_path.write_text(json.dumps(workflow, indent=2) + "\n", encoding="utf-8")

    mqtt_process = start_mqtt_subscriber(
        mqtt_broker_url=str((cloud_comm_config.get("mqtt") or {}).get("broker_url", "")).strip(),
        device_id=device_id,
    )
    time.sleep(1.0)
    try:
        wait_for_workflow_name(str(workflow["metadata"]["name"]), args.timeout_sec)
        latest_frame_id = read_latest_frame_id("Camera-1")
        response = service_call(
            target_service="workflow-engine",
            message_type="enqueue-detection",
            payload={
                "cameraId": "1",
                "cameraName": "Camera-1",
                "detections": [{"bbox": [10, 10, 30, 30], "confidence": 0.95, "label": "person"}],
                "frameId": latest_frame_id,
                "requestId": uuid4().hex,
            },
            expected_types={"workflow-engine-result"},
            wait_timeout_sec=20,
        )
        run = response["payload"]["run"]
        violation = run["outputs"].get("violation")
        if not isinstance(violation, dict):
            raise SystemExit(json.dumps({"error": "workflow did not produce violation output", "run": run}, indent=2))

        photo_transfer = wait_for_transfer(violation["photoTransferId"], args.timeout_sec)
        video_job = wait_for_video_job(violation["videoJobId"], args.timeout_sec)
        if video_job["state"] != "completed":
            raise SystemExit(json.dumps({"error": "video recorder job did not complete", "job": video_job}, indent=2))
        if not str(video_job.get("transferId", "")).strip():
            raise SystemExit(json.dumps({"error": "video recorder job did not expose an upload transfer id", "job": video_job}, indent=2))
        video_transfer = wait_for_transfer(str(video_job["transferId"]), args.timeout_sec)

        photo_bytes = fetch_cloud_asset(
            base_url=cloud_api_base_url,
            access_token=access_token,
            device_id=device_id,
            download_path=download_path,
            remote_path=str(violation["photoRemotePath"]),
        )
        video_bytes = fetch_cloud_asset(
            base_url=cloud_api_base_url,
            access_token=access_token,
            device_id=device_id,
            download_path=download_path,
            remote_path=str(violation["videoRemotePath"]),
        )
        if not photo_bytes.startswith(b"\xff\xd8"):
            raise SystemExit("downloaded photo does not look like a JPEG")
        if len(video_bytes) == 0:
            raise SystemExit("downloaded video asset is empty")

        mqtt_envelope = wait_for_mqtt_violation_event(mqtt_process, args.timeout_sec)
        payload = mqtt_envelope.get("payload") or {}
        if payload.get("violationId") != violation["violationId"]:
            raise SystemExit(json.dumps({"error": "MQTT violation payload mismatch", "envelope": mqtt_envelope, "violation": violation}, indent=2))

        print(
            json.dumps(
                {
                    "mqttEnvelope": mqtt_envelope,
                    "photoTransfer": photo_transfer,
                    "run": run,
                    "videoJob": video_job,
                    "videoTransfer": video_transfer,
                },
                indent=2,
            )
        )
        return 0
    finally:
        stop_process(mqtt_process)
        if backup_path.exists():
            shutil.move(str(backup_path), str(workflow_path))
            wait_for_workflow_reload(args.timeout_sec)
        elif workflow_path.exists():
            workflow_path.unlink()


def start_mqtt_subscriber(*, mqtt_broker_url: str, device_id: str) -> subprocess.Popen[str]:
    from urllib.parse import urlparse

    parsed = urlparse(mqtt_broker_url)
    host = parsed.hostname or "host.docker.internal"
    port = parsed.port or 1883
    topic = f"trakrai/device/{device_id}/service/workflow-engine/event"
    return subprocess.Popen(
        [
            "docker",
            "run",
            "--rm",
            "eclipse-mosquitto:2",
            "mosquitto_sub",
            "-h",
            host,
            "-p",
            str(port),
            "-t",
            topic,
            "-C",
            "1",
        ],
        cwd=DEVICE_ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def wait_for_mqtt_violation_event(process: subprocess.Popen[str], timeout_sec: int) -> dict[str, Any]:
    try:
        stdout, stderr = process.communicate(timeout=timeout_sec)
    except subprocess.TimeoutExpired as exc:
        process.kill()
        raise SystemExit("timed out waiting for MQTT violation event") from exc
    if process.returncode != 0:
        raise SystemExit(stderr.strip() or stdout.strip() or "mosquitto_sub failed")
    envelope = json.loads(stdout.strip())
    if str(envelope.get("type", "")).strip() != "violation-created":
        raise SystemExit(json.dumps({"error": "unexpected MQTT envelope", "envelope": envelope}, indent=2))
    return envelope


def fetch_cloud_asset(*, base_url: str, access_token: str, device_id: str, download_path: str, remote_path: str) -> bytes:
    session = request_cloud_download_session(
        base_url=base_url,
        access_token=access_token,
        device_id=device_id,
        download_path=download_path,
        remote_path=remote_path,
    )
    url = str(session["url"])
    parsed = urlparse(url)
    if parsed.hostname == "host.docker.internal":
        curl_command = [
            "curl",
            "--silent",
            "--show-error",
            "--fail",
            "--location",
            "--resolve",
            f"host.docker.internal:{parsed.port or 80}:127.0.0.1",
            url,
        ]
        result = subprocess.run(
            curl_command,
            cwd=DEVICE_ROOT,
            capture_output=True,
            check=False,
        )
        if result.returncode != 0:
            stderr = result.stderr.decode("utf-8", errors="replace")
            stdout = result.stdout.decode("utf-8", errors="replace")
            raise SystemExit(stderr or stdout or f"curl download failed for {url}")
        return result.stdout

    request = urllib.request.Request(url, method=session.get("method", "GET"))
    for key, value in (session.get("headers") or {}).items():
        request.add_header(key, value)
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def request_cloud_download_session(*, base_url: str, access_token: str, device_id: str, download_path: str, remote_path: str) -> dict[str, Any]:
    payload = json.dumps({"deviceId": device_id, "path": remote_path}).encode("utf-8")
    request = urllib.request.Request(
        urljoin(base_url.rstrip("/") + "/", download_path.lstrip("/")),
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise SystemExit(exc.read().decode("utf-8", errors="replace") or str(exc)) from exc


def host_accessible_cloud_url(base_url: str) -> str:
    return base_url.replace("host.docker.internal", "127.0.0.1")


def read_latest_frame_id(camera_name: str) -> str:
    image_id = subprocess.run(
        compose_command(
            "exec",
            "-T",
            "redis",
            "redis-cli",
            "--raw",
            "HGET",
            f"camera:{camera_name}:latest",
            "imgID",
        ),
        cwd=DEVICE_ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    if image_id.returncode != 0:
        raise SystemExit(image_id.stderr or image_id.stdout or "failed to read latest camera imgID")
    value = image_id.stdout.strip()
    if value == "":
        raise SystemExit(f"camera {camera_name!r} does not have a latest imgID in redis")
    return value


def wait_for_video_job(job_id: str, timeout_sec: int) -> dict[str, Any]:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        response = service_call(
            target_service="video-recorder",
            message_type="get-job",
            payload={"jobId": job_id, "requestId": uuid4().hex},
            expected_types={"video-recorder-job"},
            wait_timeout_sec=10,
        )
        job = response["payload"]["job"]
        if job["state"] in {"completed", "failed"}:
            return job
        time.sleep(1.0)
    raise SystemExit(f"timed out waiting for video-recorder job {job_id}")


def wait_for_transfer(transfer_id: str, timeout_sec: int) -> dict[str, Any]:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        response = service_call(
            target_service="cloud-transfer",
            message_type="get-transfer",
            payload={"transferId": transfer_id, "requestId": uuid4().hex},
            expected_types={"cloud-transfer-transfer"},
            wait_timeout_sec=10,
        )
        transfer = response["payload"]["transfer"]
        if transfer["state"] in {"completed", "failed"}:
            return transfer
        time.sleep(1.0)
    raise SystemExit(f"timed out waiting for cloud-transfer transfer {transfer_id}")


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
                    "sourceService": f"violation-verifier-{request_id[:12]}",
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


def stop_process(process: subprocess.Popen[str] | None) -> None:
    if process is None or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()


if __name__ == "__main__":
    raise SystemExit(main())
