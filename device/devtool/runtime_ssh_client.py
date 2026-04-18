from __future__ import annotations

import json
import shlex
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from . import paths
from .ssh_transport import ExpectSSHClient, SSHConnectionInfo


REMOTE_HELPER_PATH = "/tmp/trakrai-runtime-manager-request.py"


@dataclass(frozen=True)
class SSHRuntimeConnection:
    host: str
    user: str
    password: str
    port: int = 22
    url: str = "ws://127.0.0.1:8080/ws"
    device_id: str = ""
    timeout_sec: float = 30.0


class SSHRuntimeClient:
    def __init__(self, connection: SSHRuntimeConnection) -> None:
        self.connection = connection
        self.ssh = ExpectSSHClient(
            SSHConnectionInfo(
                host=connection.host,
                user=connection.user,
                password=connection.password,
                port=connection.port,
            )
        )
        self._helper_ready = False

    def close(self) -> None:
        return

    def ensure_helper(self) -> None:
        if self._helper_ready:
            return
        self.ssh.upload_file(paths.DEVTOOL_RUNTIME_ASSETS_ROOT / "runtime_manager_request.py", REMOTE_HELPER_PATH, timeout_sec=120)
        self.ssh.run(f"chmod +x {shlex.quote(REMOTE_HELPER_PATH)}", timeout_sec=30)
        self._helper_ready = True

    def request(
        self,
        *,
        service: str,
        message_type: str,
        payload: dict[str, object],
        expected_types: set[str],
        timeout_sec: float | None = None,
    ) -> dict[str, Any]:
        self.ensure_helper()
        timeout_value = timeout_sec or self.connection.timeout_sec
        with tempfile.TemporaryDirectory(prefix="trakrai-runtime-request-") as tmp_dir_name:
            tmp_dir = Path(tmp_dir_name)
            local_payload = tmp_dir / "payload.json"
            local_payload.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
            remote_payload = f"/tmp/trakrai-runtime-request-{service}-{message_type}.json"
            self.ssh.upload_file(local_payload, remote_payload, timeout_sec=120)
            expected_flags = " ".join(
                f"--expected-type {shlex.quote(value)}" for value in sorted(expected_types)
            )
            command = (
                f"python3 {shlex.quote(REMOTE_HELPER_PATH)} "
                f"--url {shlex.quote(self.connection.url)} "
                f"--device-id {shlex.quote(self.connection.device_id)} "
                f"--service {shlex.quote(service)} "
                f"--message-type {shlex.quote(message_type)} "
                f"--payload-file {shlex.quote(remote_payload)} "
                f"--timeout-sec {timeout_value} "
                f"{expected_flags}; "
                f"status=$?; "
                f"rm -f {shlex.quote(remote_payload)}; "
                f"exit $status"
            )
            output = self.ssh.run(command, timeout_sec=int(timeout_value) + 15, capture_output=True)
        return json.loads(output)

    def get_status(self, *, timeout_sec: float | None = None) -> dict[str, Any]:
        return self.request(
            service="runtime-manager",
            message_type="get-status",
            payload={},
            expected_types={"runtime-manager-status"},
            timeout_sec=timeout_sec,
        )

    def get_service_definition(self, service_name: str, *, timeout_sec: float | None = None) -> dict[str, Any]:
        return self.request(
            service="runtime-manager",
            message_type="get-service-definition",
            payload={"serviceName": service_name},
            expected_types={"runtime-manager-service-definition", "runtime-manager-error"},
            timeout_sec=timeout_sec,
        )

    def get_config(self, config_name: str, *, timeout_sec: float | None = None) -> dict[str, Any]:
        return self.request(
            service="runtime-manager",
            message_type="get-config",
            payload={"configName": config_name},
            expected_types={"runtime-manager-config", "runtime-manager-error"},
            timeout_sec=timeout_sec,
        )

    def put_config(
        self,
        config_name: str,
        content: object,
        *,
        create_if_missing: bool,
        restart_services: list[str] | None = None,
        timeout_sec: float | None = None,
    ) -> dict[str, Any]:
        return self.request(
            service="runtime-manager",
            message_type="put-config",
            payload={
                "configName": config_name,
                "content": content,
                "createIfMissing": create_if_missing,
                "restartServices": list(restart_services or []),
            },
            expected_types={"runtime-manager-config", "runtime-manager-error"},
            timeout_sec=timeout_sec,
        )

    def upsert_service(self, definition: dict[str, object], *, timeout_sec: float | None = None) -> dict[str, Any]:
        return self.request(
            service="runtime-manager",
            message_type="upsert-service",
            payload={"definition": definition},
            expected_types={"runtime-manager-service-action", "runtime-manager-error"},
            timeout_sec=timeout_sec,
        )

    def put_runtime_file(
        self,
        path: str,
        content: str,
        *,
        mode: int = 0o644,
        timeout_sec: float | None = None,
    ) -> dict[str, Any]:
        return self.request(
            service="runtime-manager",
            message_type="put-runtime-file",
            payload={
                "path": path,
                "content": content,
                "mode": mode,
            },
            expected_types={"runtime-manager-file", "runtime-manager-error"},
            timeout_sec=timeout_sec,
        )

    def update_service(
        self,
        service_name: str,
        *,
        remote_path: str = "",
        local_path: str = "",
        artifact_sha256: str = "",
        timeout_sec: float | None = None,
    ) -> dict[str, Any]:
        return self.request(
            service="runtime-manager",
            message_type="update-service",
            payload={
                "serviceName": service_name,
                "remotePath": remote_path,
                "localPath": local_path,
                "artifactSha256": artifact_sha256,
            },
            expected_types={"runtime-manager-update", "runtime-manager-error"},
            timeout_sec=timeout_sec,
        )

    def service_action(self, action: str, service_name: str, *, timeout_sec: float | None = None) -> dict[str, Any]:
        return self.request(
            service="runtime-manager",
            message_type=f"{action}-service",
            payload={"serviceName": service_name},
            expected_types={"runtime-manager-service-action", "runtime-manager-error"},
            timeout_sec=timeout_sec,
        )
