from __future__ import annotations

import shlex
import subprocess
from dataclasses import dataclass
from pathlib import Path


def _run_expect(script: str, *, timeout_sec: int, cwd: Path | None = None, capture_output: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["expect", "-c", script],
        cwd=cwd,
        text=True,
        capture_output=capture_output,
        check=False,
        timeout=timeout_sec,
    )


def _expect_login_script(command: str, *, password: str, timeout_sec: int) -> str:
    quoted_password = password.replace("\\", "\\\\").replace('"', '\\"')
    return f"""
set timeout {timeout_sec}
log_user 1
spawn bash -lc "{command}"
expect {{
  -re "Are you sure you want to continue connecting.*" {{
    send "yes\\r"
    exp_continue
  }}
  -re "(?i)password:" {{
    send "{quoted_password}\\r"
    exp_continue
  }}
  eof
}}
set wait_result [wait]
set exit_status [lindex $wait_result 3]
exit $exit_status
"""


@dataclass(frozen=True)
class SSHConnectionInfo:
    host: str
    user: str
    password: str
    port: int = 22

    @property
    def target(self) -> str:
        return f"{self.user}@{self.host}"


class ExpectSSHClient:
    def __init__(self, connection: SSHConnectionInfo) -> None:
        self.connection = connection

    def run(self, command: str, *, timeout_sec: int = 60, capture_output: bool = False) -> str:
        ssh_command = (
            "ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "
            f"-p {self.connection.port} {shlex.quote(self.connection.target)} "
            f"{shlex.quote(command)}"
        )
        result = _run_expect(
            _expect_login_script(ssh_command, password=self.connection.password, timeout_sec=timeout_sec),
            timeout_sec=timeout_sec + 5,
            capture_output=capture_output,
        )
        if result.returncode != 0:
            stderr = result.stderr or result.stdout or command
            raise SystemExit(stderr.strip())
        return result.stdout if capture_output else ""

    def upload_file(self, local_path: Path, remote_path: str, *, timeout_sec: int = 120) -> None:
        scp_command = (
            "scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "
            f"-P {self.connection.port} {shlex.quote(str(local_path))} "
            f"{shlex.quote(f'{self.connection.target}:{remote_path}')}"
        )
        result = _run_expect(
            _expect_login_script(scp_command, password=self.connection.password, timeout_sec=timeout_sec),
            timeout_sec=timeout_sec + 5,
        )
        if result.returncode != 0:
            raise SystemExit(result.stderr or result.stdout or f"scp failed for {local_path}")

    def upload_tree(self, local_root: Path, remote_root: str, *, timeout_sec: int = 300) -> None:
        self.run(f"rm -rf {shlex.quote(remote_root)} && mkdir -p {shlex.quote(remote_root)}", timeout_sec=timeout_sec)
        scp_command = (
            "scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "
            f"-P {self.connection.port} -r {shlex.quote(str(local_root))}/. "
            f"{shlex.quote(f'{self.connection.target}:{remote_root}')}"
        )
        result = _run_expect(
            _expect_login_script(scp_command, password=self.connection.password, timeout_sec=timeout_sec),
            timeout_sec=timeout_sec + 5,
        )
        if result.returncode != 0:
            raise SystemExit(result.stderr or result.stdout or f"scp tree failed for {local_root}")

    def read_text(self, remote_path: str, *, timeout_sec: int = 60) -> str:
        return self.run(f"cat {shlex.quote(remote_path)}", timeout_sec=timeout_sec, capture_output=True)
