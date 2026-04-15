#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from uuid import uuid4


REPO_ROOT = Path(__file__).resolve().parents[2]
DEVICE_ROOT = REPO_ROOT / "device"
COMPOSE_FILE = DEVICE_ROOT / "localdev" / "docker-compose.yml"
COMPOSE_ENV_FILE = DEVICE_ROOT / ".localdev" / "compose.env"
RUNTIME_SHARED_DIR = "/home/hacklab/trakrai-device-runtime/shared"

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

raise SystemExit("timed out waiting for cloud-transfer response")
"""


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify the local cloud-transfer service against MinIO.")
    parser.add_argument("--mock-cloud-api-url", default="http://127.0.0.1:18090")
    parser.add_argument("--timeout-sec", type=int, default=90)
    args = parser.parse_args()

    if not COMPOSE_ENV_FILE.exists():
        raise SystemExit(f"compose env file not found: {COMPOSE_ENV_FILE}")

    happy_path = verify_happy_path(args.mock_cloud_api_url, args.timeout_sec)
    retry_recovery = verify_retry_recovery(args.mock_cloud_api_url, args.timeout_sec)
    timeout_failure = verify_timeout_failure(args.timeout_sec, args.mock_cloud_api_url)
    transfers = cloud_transfer_call(
        "list-transfers",
        {"requestId": uuid4().hex},
        expected_types={"cloud-transfer-list"},
    )["payload"]
    stats = cloud_transfer_call(
        "get-stats",
        {"requestId": uuid4().hex},
        expected_types={"cloud-transfer-stats"},
    )["payload"]
    print(
        json.dumps(
            {
                "happyPath": happy_path,
                "retryRecovery": retry_recovery,
                "stats": stats,
                "timeoutFailure": timeout_failure,
                "transfers": transfers,
            },
            indent=2,
        )
    )
    return 0


def cloud_transfer_call(
    message_type: str,
    payload: dict[str, object],
    *,
    expected_types: set[str],
    wait_timeout_sec: int = 20,
) -> dict[str, object]:
    request_id = str(payload.get("requestId", "")).strip()
    if request_id == "":
        request_id = uuid4().hex
        payload = {**payload, "requestId": request_id}

    output = exec_in_emulator(
        [
            "python3.8",
            "-c",
            IPC_CALL_SCRIPT,
            json.dumps(
                {
                    "expectedTypes": sorted(expected_types),
                    "messageType": message_type,
                    "payload": payload,
                    "requestId": request_id,
                    "socketPath": "/tmp/trakrai-cloud-comm.sock",
                    "sourceService": f"cloud-transfer-verifier-{request_id[:12]}",
                    "subtopic": "command",
                    "targetService": "cloud-transfer",
                    "waitTimeoutSec": wait_timeout_sec,
                }
            ),
        ]
    )
    response = json.loads(output)
    envelope = response["envelope"]
    payload_data = envelope.get("payload") or {}
    response_type = str(envelope.get("type", "")).strip()
    if response_type == "cloud-transfer-error":
        raise SystemExit(json.dumps(payload_data, indent=2))
    response["payload"] = payload_data
    return response


def wait_for_transfer(transfer_id: str, timeout_sec: int, *, expected_states: set[str]) -> dict[str, object]:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        response = cloud_transfer_call(
            "get-transfer",
            {
                "requestId": uuid4().hex,
                "transferId": transfer_id,
            },
            expected_types={"cloud-transfer-transfer"},
        )
        transfer = response["payload"]["transfer"]
        if transfer["state"] in expected_states:
            return transfer
        time.sleep(1)
    raise SystemExit(
        f"timed out waiting for transfer {transfer_id} to reach {sorted(expected_states)}"
    )


def verify_happy_path(mock_cloud_api_url: str, timeout_sec: int) -> dict[str, object]:
    token = uuid4().hex
    remote_path = f"cloud-transfer-tests/{token}/payload.txt"
    upload_relative_path = f"cloud-transfer-tests/{token}/upload/payload.txt"
    download_relative_path = f"cloud-transfer-tests/{token}/download/payload.txt"
    upload_absolute_path = f"{RUNTIME_SHARED_DIR}/{upload_relative_path}"
    download_absolute_path = f"{RUNTIME_SHARED_DIR}/{download_relative_path}"
    content = f"trakrai-cloud-transfer-{token}\n"

    write_remote_file(upload_absolute_path, content)

    upload_response = cloud_transfer_call(
        "enqueue-upload",
        {
            "contentType": "text/plain",
            "localPath": upload_relative_path,
            "remotePath": remote_path,
            "requestId": uuid4().hex,
            "timeout": "4h",
        },
        expected_types={"cloud-transfer-transfer"},
    )
    upload_status = wait_for_transfer(
        upload_response["payload"]["transfer"]["id"],
        timeout_sec,
        expected_states={"completed"},
    )

    debug_payload = fetch_json(
        f"{mock_cloud_api_url}/api/v1/device-storage/debug/object?"
        + urllib.parse.urlencode({"deviceId": upload_status["deviceId"], "path": remote_path})
    )
    if debug_payload.get("exists") is not True:
        raise SystemExit(f"uploaded object was not found in mock cloud storage: {json.dumps(debug_payload, indent=2)}")

    download_response = cloud_transfer_call(
        "enqueue-download",
        {
            "localPath": download_relative_path,
            "remotePath": remote_path,
            "requestId": uuid4().hex,
            "timeout": "4h",
        },
        expected_types={"cloud-transfer-transfer"},
    )
    download_status = wait_for_transfer(
        download_response["payload"]["transfer"]["id"],
        timeout_sec,
        expected_states={"completed"},
    )

    downloaded_content = read_remote_file(download_absolute_path)
    if downloaded_content != content:
        raise SystemExit(
            "downloaded content mismatch:\n"
            + json.dumps(
                {"expected": content, "actual": downloaded_content, "download": download_status},
                indent=2,
            )
        )

    return {
        "download": download_status,
        "mockObject": debug_payload,
        "upload": upload_status,
    }


def verify_retry_recovery(mock_cloud_api_url: str, timeout_sec: int) -> dict[str, object]:
    token = uuid4().hex
    remote_path = f"cloud-transfer-tests/{token}/retry.txt"
    upload_relative_path = f"cloud-transfer-tests/{token}/retry/upload.txt"
    upload_absolute_path = f"{RUNTIME_SHARED_DIR}/{upload_relative_path}"
    content = f"trakrai-cloud-transfer-retry-{token}\n"

    write_remote_file(upload_absolute_path, content)
    stop_compose_service("mock-cloud-api")
    try:
        enqueue_response = cloud_transfer_call(
            "enqueue-upload",
            {
                "contentType": "text/plain",
                "localPath": upload_relative_path,
                "remotePath": remote_path,
                "requestId": uuid4().hex,
                "timeout": "4h",
            },
            expected_types={"cloud-transfer-transfer"},
        )
        transfer_id = enqueue_response["payload"]["transfer"]["id"]
        retry_status = wait_for_transfer(transfer_id, 20, expected_states={"retry_wait"})
    finally:
        start_compose_service("mock-cloud-api")

    completed_status = wait_for_transfer(transfer_id, timeout_sec, expected_states={"completed"})
    debug_payload = fetch_json(
        f"{mock_cloud_api_url}/api/v1/device-storage/debug/object?"
        + urllib.parse.urlencode({"deviceId": completed_status["deviceId"], "path": remote_path})
    )
    if debug_payload.get("exists") is not True:
        raise SystemExit(f"recovered upload was not found in mock cloud storage: {json.dumps(debug_payload, indent=2)}")

    return {
        "completed": completed_status,
        "debugObject": debug_payload,
        "retryWait": retry_status,
    }


def verify_timeout_failure(timeout_sec: int, mock_cloud_api_url: str | None = None) -> dict[str, object]:
    token = uuid4().hex
    remote_path = f"cloud-transfer-tests/{token}/timeout.txt"
    upload_relative_path = f"cloud-transfer-tests/{token}/timeout/upload.txt"
    upload_absolute_path = f"{RUNTIME_SHARED_DIR}/{upload_relative_path}"
    content = f"trakrai-cloud-transfer-timeout-{token}\n"

    write_remote_file(upload_absolute_path, content)
    stop_compose_service("mock-cloud-api")
    try:
        enqueue_response = cloud_transfer_call(
            "enqueue-upload",
            {
                "contentType": "text/plain",
                "localPath": upload_relative_path,
                "remotePath": remote_path,
                "requestId": uuid4().hex,
                "timeout": "3s",
            },
            expected_types={"cloud-transfer-transfer"},
        )
        transfer_id = enqueue_response["payload"]["transfer"]["id"]
        failed_status = wait_for_transfer(transfer_id, timeout_sec, expected_states={"failed"})
    finally:
        start_compose_service("mock-cloud-api")

    result = {"failed": failed_status, "sourceContent": content}
    if mock_cloud_api_url:
        debug_payload = fetch_json(
            f"{mock_cloud_api_url}/api/v1/device-storage/debug/object?"
            + urllib.parse.urlencode({"deviceId": failed_status["deviceId"], "path": remote_path})
        )
        if debug_payload.get("exists") is True:
            raise SystemExit(f"timed-out transfer unexpectedly uploaded an object: {json.dumps(debug_payload, indent=2)}")
        result["debugObject"] = debug_payload
    return result


def write_remote_file(path: str, content: str) -> None:
    script = (
        "from pathlib import Path; "
        f"path = Path({path!r}); "
        "path.parent.mkdir(parents=True, exist_ok=True); "
        f"path.write_text({content!r}, encoding='utf-8')"
    )
    exec_in_emulator(["python3.8", "-c", script], capture_output=False)


def read_remote_file(path: str) -> str:
    script = f"from pathlib import Path; print(Path({path!r}).read_text(encoding='utf-8'), end='')"
    return exec_in_emulator(["python3.8", "-c", script])


def exec_host(command: list[str]) -> str:
    result = subprocess.run(
        command,
        cwd=DEVICE_ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise SystemExit(result.stderr or result.stdout or f"command failed: {' '.join(command)}")
    return result.stdout


def exec_in_emulator(command: list[str], *, capture_output: bool = True) -> str:
    full_command = compose_command(
        "exec",
        "-T",
        "device-emulator",
        *command,
    )
    result = subprocess.run(
        full_command,
        cwd=DEVICE_ROOT,
        text=True,
        capture_output=capture_output,
        check=False,
    )
    if result.returncode != 0:
        raise SystemExit(result.stderr or result.stdout or f"command failed: {' '.join(full_command)}")
    return result.stdout if capture_output else ""


def stop_compose_service(service: str) -> None:
    exec_host(compose_command("stop", service))


def start_compose_service(service: str) -> None:
    exec_host(compose_command("up", "-d", "--wait", service))


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


def fetch_json(url: str) -> dict[str, object]:
    request = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.URLError as exc:
        raise SystemExit(f"failed to fetch {url}: {exc}") from exc


if __name__ == "__main__":
    raise SystemExit(main())
