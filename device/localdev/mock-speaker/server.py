from __future__ import annotations

import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


OUTPUT_DIR = Path(os.environ.get("MOCK_SPEAKER_OUTPUT_DIR", "/data"))
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
REQUESTS_DIR = OUTPUT_DIR / "requests"
REQUESTS_DIR.mkdir(parents=True, exist_ok=True)
LAST_REQUEST_PATH = OUTPUT_DIR / "last-request.json"


class Handler(BaseHTTPRequestHandler):
    server_version = "trakrai-mock-speaker/1.0"

    def do_GET(self) -> None:  # noqa: N802
        if self.path != "/health":
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"status":"ok"}')

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        payload = {
            "body": body.decode("utf-8", errors="ignore"),
            "headers": {key: value for key, value in self.headers.items()},
            "method": "POST",
            "path": self.path,
            "receivedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        request_path = REQUESTS_DIR / f"{time.time_ns()}.json"
        request_path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        LAST_REQUEST_PATH.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"accepted":true}')

    def log_message(self, format: str, *args: object) -> None:
        return


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", 8081), Handler)
    server.serve_forever()
