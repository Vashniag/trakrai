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

from . import manifests, paths
from .request_files import apply_request_overrides, load_request_file, require_argument_values
from .runtime_client import RuntimeWsClient
from .tools.mock_workflow_detections import feed_mock_detections


RUNTIME_SHARED_DIR = f"{paths.DEFAULT_RUNTIME_ROOT}/shared"


def _lookup_path(value: Any, path: str) -> Any:
    if path == "":
        return value
    current = value
    for raw_segment in path.split("."):
        segment = raw_segment
        while "[" in segment and segment.endswith("]"):
            prefix, _, suffix = segment.partition("[")
            if prefix:
                if not isinstance(current, dict):
                    raise KeyError(path)
                current = current[prefix]
            index = int(suffix[:-1])
            current = current[index]
            segment = ""
        if segment:
            if isinstance(current, dict):
                current = current[segment]
            else:
                raise KeyError(path)
    return current


def _set_path(target: dict[str, Any], path: str, value: Any) -> None:
    parts = path.split(".")
    current: Any = target
    for raw_part in parts[:-1]:
        part = raw_part
        while "[" in part and part.endswith("]"):
            prefix, _, suffix = part.partition("[")
            if prefix:
                if prefix not in current or not isinstance(current[prefix], list):
                    current[prefix] = []
                current = current[prefix]
            index = int(suffix[:-1])
            while len(current) <= index:
                current.append({})
            current = current[index]
            part = ""
        if part:
            if part not in current or not isinstance(current[part], dict):
                current[part] = {}
            current = current[part]
    final = parts[-1]
    if "[" in final and final.endswith("]"):
        prefix, _, suffix = final.partition("[")
        if prefix:
            if prefix not in current or not isinstance(current[prefix], list):
                current[prefix] = []
            current = current[prefix]
        index = int(suffix[:-1])
        while len(current) <= index:
            current.append(None)
        current[index] = value
        return
    current[final] = value


def _render_template(value: Any, context: dict[str, Any]) -> Any:
    if isinstance(value, str):
        result = value
        while "${" in result:
            start = result.index("${")
            end = result.index("}", start)
            token = result[start + 2 : end]
            resolved = _lookup_path(context, token)
            if result == f"${{{token}}}":
                return resolved
            result = result[:start] + str(resolved) + result[end + 1 :]
        return result
    if isinstance(value, list):
        return [_render_template(item, context) for item in value]
    if isinstance(value, dict):
        return {key: _render_template(item, context) for key, item in value.items()}
    return value


def _request_cloud_download_session(*, base_url: str, access_token: str, device_id: str, download_path: str, remote_path: str) -> dict[str, Any]:
    payload = json.dumps({"deviceId": device_id, "path": remote_path}).encode("utf-8")
    request = urllib.request.Request(
        urljoin(base_url.rstrip("/") + "/", download_path.lstrip("/")),
        data=payload,
        method="POST",
        headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise SystemExit(exc.read().decode("utf-8", errors="replace") or str(exc)) from exc


def _fetch_cloud_asset(*, session: dict[str, Any]) -> bytes:
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
        result = subprocess.run(curl_command, cwd=paths.DEVICE_ROOT, capture_output=True, check=False)
        if result.returncode != 0:
            stderr = result.stderr.decode("utf-8", errors="replace")
            stdout = result.stdout.decode("utf-8", errors="replace")
            raise SystemExit(stderr or stdout or f"curl download failed for {url}")
        return result.stdout
    request = urllib.request.Request(url, method=str(session.get("method", "GET")).upper())
    for key, value in (session.get("headers") or {}).items():
        request.add_header(key, value)
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def _compose_command(*args: str) -> list[str]:
    return ["docker", "compose", "--env-file", str(paths.LOCALDEV_COMPOSE_ENV), "-f", str(paths.LOCALDEV_COMPOSE_FILE), *args]


class TestRunner:
    def __init__(self, *, url: str, device_id: str, timeout_sec: float) -> None:
        self.url = url
        self.device_id = device_id
        self.timeout_sec = timeout_sec
        self.context: dict[str, Any] = {
            "vars": {
                "deviceId": device_id,
                "jpegMagic": b"\xff\xd8",
                "runtimeSharedDir": RUNTIME_SHARED_DIR,
                "localSharedDir": str(paths.LOCALDEV_SHARED_ROOT),
                "localStageDir": str(paths.LOCALDEV_STAGE_ROOT),
                "runtimeUrl": url,
            }
        }
        self.client = RuntimeWsClient(url, device_id=device_id, timeout_sec=timeout_sec)

    def close(self) -> None:
        self.client.close()

    def run_test(self, test_manifest: manifests.TestManifest) -> dict[str, Any]:
        try:
            for step in test_manifest.steps:
                self.run_step(step)
        finally:
            for step in test_manifest.cleanup_steps:
                try:
                    self.run_step(step, cleanup=True)
                except Exception:
                    continue
        return self.context

    def run_step(self, step: dict[str, Any], *, cleanup: bool = False) -> Any:
        action = str(step.get("action", "")).strip()
        step_id = str(step.get("id", "")).strip()
        payload = _render_template({key: value for key, value in step.items() if key not in {"id", "action"}}, self.context)
        handlers = {
            "assert_equals": self._assert_equals,
            "assert_gt": self._assert_gt,
            "assert_nonempty": self._assert_nonempty,
            "assert_startswith": self._assert_startswith,
            "backup_file": self._backup_file,
            "cloud_download_session": self._cloud_download_session,
            "fetch_cloud_asset": self._fetch_cloud_asset,
            "host_accessible_url": self._host_accessible_url,
            "load_json": self._load_json,
            "poll_service": self._poll_service,
            "read_json_file": self._read_json_file,
            "read_redis_hash_field": self._read_redis_hash_field,
            "read_text": self._read_text,
            "read_file_mtime": self._read_file_mtime,
            "restore_file": self._restore_file,
            "service_request": self._service_request,
            "start_mqtt_subscriber": self._start_mqtt_subscriber,
            "stop_process": self._stop_process,
            "uuid": self._uuid,
            "wait_mqtt_message": self._wait_mqtt_message,
            "write_json_template": self._write_json_template,
            "write_text": self._write_text,
        }
        if action not in handlers:
            raise SystemExit(f"unsupported test action: {action}")
        result = handlers[action](payload, cleanup=cleanup)
        if step_id:
            self.context[step_id] = result
        return result

    def _uuid(self, payload: dict[str, Any], *, cleanup: bool) -> str:
        del payload, cleanup
        return uuid4().hex

    def _write_text(self, payload: dict[str, Any], *, cleanup: bool) -> dict[str, Any]:
        del cleanup
        path = Path(str(payload["path"])).expanduser().resolve()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(str(payload["content"]), encoding="utf-8")
        return {"path": str(path)}

    def _backup_file(self, payload: dict[str, Any], *, cleanup: bool) -> dict[str, Any]:
        del cleanup
        path = Path(str(payload["path"])).expanduser().resolve()
        backup_path = Path(str(payload["backupPath"])).expanduser().resolve()
        if path.exists():
            backup_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, backup_path)
        return {"path": str(path), "backupPath": str(backup_path), "existed": path.exists()}

    def _restore_file(self, payload: dict[str, Any], *, cleanup: bool) -> dict[str, Any]:
        del cleanup
        path = Path(str(payload["path"])).expanduser().resolve()
        backup_path = Path(str(payload["backupPath"])).expanduser().resolve()
        delete_if_missing = bool(payload.get("deleteIfMissing", False))
        if backup_path.exists():
            backup_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(backup_path), str(path))
        elif delete_if_missing and path.exists():
            path.unlink()
        return {"path": str(path)}

    def _load_json(self, payload: dict[str, Any], *, cleanup: bool) -> Any:
        del cleanup
        path = Path(str(payload["path"])).expanduser().resolve()
        return json.loads(path.read_text(encoding="utf-8"))

    def _write_json_template(self, payload: dict[str, Any], *, cleanup: bool) -> dict[str, Any]:
        del cleanup
        template = Path(str(payload["template"])).expanduser().resolve()
        target = Path(str(payload["target"])).expanduser().resolve()
        data = json.loads(template.read_text(encoding="utf-8"))
        for path, value in dict(payload.get("set", {})).items():
            _set_path(data, path, value)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
        return {"path": str(target), "content": data}

    def _service_request(self, payload: dict[str, Any], *, cleanup: bool) -> Any:
        del cleanup
        return self.client.request(
            service=str(payload["service"]),
            message_type=str(payload["messageType"]),
            payload=dict(payload.get("payload", {})),
            expected_types=set(payload.get("expectedTypes", [])),
            timeout_sec=float(payload.get("waitTimeoutSec", self.timeout_sec)),
        )

    def _poll_service(self, payload: dict[str, Any], *, cleanup: bool) -> Any:
        del cleanup
        deadline = time.time() + float(payload.get("timeoutSec", self.timeout_sec))
        interval_sec = float(payload.get("intervalSec", 1.0))
        until = dict(payload.get("until", {}))
        path = str(until.get("path", "")).strip()
        while time.time() < deadline:
            response = self._service_request(payload, cleanup=False)
            candidate = _lookup_path(response, path) if path else response
            if "equals" in until and candidate == until["equals"]:
                return response
            if "in" in until and candidate in until["in"]:
                return response
            if until.get("truthy") and candidate:
                return response
            time.sleep(interval_sec)
        raise SystemExit(f"timed out waiting for service condition {until}")

    def _read_text(self, payload: dict[str, Any], *, cleanup: bool) -> str:
        del cleanup
        path = Path(str(payload["path"])).expanduser().resolve()
        return path.read_text(encoding="utf-8")

    def _read_json_file(self, payload: dict[str, Any], *, cleanup: bool) -> Any:
        del cleanup
        path = Path(str(payload["path"])).expanduser().resolve()
        return json.loads(path.read_text(encoding="utf-8"))

    def _read_file_mtime(self, payload: dict[str, Any], *, cleanup: bool) -> float:
        del cleanup
        path = Path(str(payload["path"])).expanduser().resolve()
        if not path.exists():
            return 0.0
        return path.stat().st_mtime

    def _assert_equals(self, payload: dict[str, Any], *, cleanup: bool) -> dict[str, Any]:
        del cleanup
        if payload.get("left") != payload.get("right"):
            raise SystemExit(json.dumps({"assertEquals": payload}, indent=2))
        return payload

    def _assert_gt(self, payload: dict[str, Any], *, cleanup: bool) -> dict[str, Any]:
        del cleanup
        if not payload.get("left", 0) > payload.get("right", 0):
            raise SystemExit(json.dumps({"assertGt": payload}, indent=2))
        return payload

    def _assert_nonempty(self, payload: dict[str, Any], *, cleanup: bool) -> dict[str, Any]:
        del cleanup
        value = payload.get("value")
        if value is None or value == "" or value == [] or value == {} or value == b"":
            raise SystemExit(json.dumps({"assertNonempty": payload}, indent=2))
        return payload

    def _assert_startswith(self, payload: dict[str, Any], *, cleanup: bool) -> dict[str, Any]:
        del cleanup
        value = payload.get("value")
        prefix = payload.get("prefix")
        if isinstance(value, str):
            ok = value.startswith(str(prefix))
        else:
            ok = bytes(value).startswith(bytes(prefix))
        if not ok:
            raise SystemExit(json.dumps({"assertStartswith": payload}, indent=2))
        return payload

    def _host_accessible_url(self, payload: dict[str, Any], *, cleanup: bool) -> str:
        del cleanup
        return str(payload["value"]).replace("host.docker.internal", "127.0.0.1")

    def _cloud_download_session(self, payload: dict[str, Any], *, cleanup: bool) -> Any:
        del cleanup
        return _request_cloud_download_session(
            base_url=str(payload["baseUrl"]),
            access_token=str(payload["accessToken"]),
            device_id=str(payload["deviceId"]),
            download_path=str(payload["downloadPath"]),
            remote_path=str(payload["remotePath"]),
        )

    def _fetch_cloud_asset(self, payload: dict[str, Any], *, cleanup: bool) -> bytes:
        del cleanup
        session = payload.get("session")
        if not isinstance(session, dict):
            raise SystemExit("fetch_cloud_asset requires a session object")
        return _fetch_cloud_asset(session=session)

    def _read_redis_hash_field(self, payload: dict[str, Any], *, cleanup: bool) -> str:
        del cleanup
        command = _compose_command("exec", "-T", "redis", "redis-cli", "--raw", "HGET", str(payload["key"]), str(payload["field"]))
        result = subprocess.run(command, cwd=paths.DEVICE_ROOT, text=True, capture_output=True, check=False)
        if result.returncode != 0:
            raise SystemExit(result.stderr or result.stdout or "failed to read redis hash field")
        return result.stdout.strip()

    def _start_mqtt_subscriber(self, payload: dict[str, Any], *, cleanup: bool) -> subprocess.Popen[str]:
        del cleanup
        parsed = urlparse(str(payload["brokerUrl"]))
        host = parsed.hostname or "host.docker.internal"
        port = parsed.port or 1883
        topic = str(payload["topic"])
        return subprocess.Popen(
            ["docker", "run", "--rm", "eclipse-mosquitto:2", "mosquitto_sub", "-h", host, "-p", str(port), "-t", topic, "-C", "1"],
            cwd=paths.DEVICE_ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

    def _wait_mqtt_message(self, payload: dict[str, Any], *, cleanup: bool) -> Any:
        del cleanup
        process = payload.get("process")
        if not isinstance(process, subprocess.Popen):
            raise SystemExit("wait_mqtt_message requires a process handle")
        timeout_sec = float(payload.get("timeoutSec", self.timeout_sec))
        try:
            stdout, stderr = process.communicate(timeout=timeout_sec)
        except subprocess.TimeoutExpired as exc:
            process.kill()
            raise SystemExit("timed out waiting for MQTT message") from exc
        if process.returncode != 0:
            raise SystemExit(stderr.strip() or stdout.strip() or "mosquitto_sub failed")
        message = json.loads(stdout.strip())
        expected_type = str(payload.get("expectedType", "")).strip()
        if expected_type and str(message.get("type", "")).strip() != expected_type:
            raise SystemExit(json.dumps({"error": "unexpected MQTT envelope", "envelope": message}, indent=2))
        return message

    def _stop_process(self, payload: dict[str, Any], *, cleanup: bool) -> dict[str, Any]:
        del cleanup
        process = payload.get("process")
        if isinstance(process, subprocess.Popen) and process.poll() is None:
            process.kill()
        return {"stopped": True}


def cmd_list(args: argparse.Namespace) -> int:
    payload = {"tests": [{"name": test.name, "profile": test.profile, "description": test.description} for test in manifests.load_tests()]}
    print(json.dumps(payload, indent=2))
    return 0


def cmd_run(args: argparse.Namespace) -> int:
    request = load_request_file(args.request)
    apply_request_overrides(args, request, ["test_name", "url", "device_id", "timeout_sec"])
    require_argument_values(args, {"test_name": "--test-name"})
    test_manifest = manifests.require_test(args.test_name)
    runner = TestRunner(url=args.url, device_id=args.device_id, timeout_sec=args.timeout_sec or test_manifest.timeout_sec)
    try:
        context = runner.run_test(test_manifest)
    finally:
        runner.close()
    serializable = {
        key: value
        for key, value in context.items()
        if not isinstance(value, subprocess.Popen)
    }
    print(json.dumps({"test": test_manifest.name, "context": serializable}, indent=2, default=str))
    return 0


def cmd_feed_workflow(args: argparse.Namespace) -> int:
    request = load_request_file(args.request)
    apply_request_overrides(
        args,
        request,
        ["input", "compose_project_name", "delay_ms", "request_timeout_sec", "shared_target"],
    )
    require_argument_values(args, {"input": "--input"})
    output = feed_mock_detections(
        input_path=Path(args.input),
        compose_project_name=args.compose_project_name,
        delay_ms=args.delay_ms,
        request_timeout_sec=args.request_timeout_sec,
        shared_target=args.shared_target,
    )
    print(output, end="")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run reusable local emulator verification workflows.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    list_parser = subparsers.add_parser("list", help="list available test workflows")
    list_parser.set_defaults(func=cmd_list)

    run_parser = subparsers.add_parser("run", help="run a JSON-defined test workflow")
    run_parser.add_argument("--request", default="")
    run_parser.add_argument("--test-name", default="")
    run_parser.add_argument("--url", default="ws://127.0.0.1:18080/ws")
    run_parser.add_argument("--device-id", default="")
    run_parser.add_argument("--timeout-sec", type=float, default=120)
    run_parser.set_defaults(func=cmd_run)

    feed_parser = subparsers.add_parser("feed-workflow", help="feed mock detections into the local workflow-engine")
    feed_parser.add_argument("--request", default="")
    feed_parser.add_argument("--input", default="")
    feed_parser.add_argument("--compose-project-name", default="trakrai-local-device")
    feed_parser.add_argument("--delay-ms", type=int, default=-1)
    feed_parser.add_argument("--request-timeout-sec", type=float, default=10.0)
    feed_parser.add_argument("--shared-target", default="mock-workflow-inputs/detections.json")
    feed_parser.set_defaults(func=cmd_feed_workflow)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
