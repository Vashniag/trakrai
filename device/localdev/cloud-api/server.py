from __future__ import annotations

import io
import json
import os
import threading
import time
from dataclasses import dataclass
from datetime import timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, quote, urlparse

from minio import Minio
from minio.error import S3Error


DEVICE_STORAGE_PREFIX = "devices"
PACKAGE_STORAGE_PREFIX = "device-packages"
PACKAGE_ARTIFACT_SEGMENT_COUNT = 4


def env_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name, "")
    if value == "":
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def isoformat_z(value: Any) -> str | None:
    if value is None:
        return None
    normalized = value.astimezone(timezone.utc).replace(microsecond=0).isoformat()
    return normalized.replace("+00:00", "Z")


def parse_semver(value: str) -> tuple[int, int, int]:
    parts = value.split(".")
    if len(parts) != 3:
        raise ValueError(value)
    return tuple(int(part) for part in parts)


def normalize_segments(value: str, field_name: str) -> list[str]:
    normalized = value.strip().strip("/")
    if normalized == "":
        raise LocalCloudAPIError(HTTPStatus.BAD_REQUEST, f"{field_name} is required")
    segments = normalized.split("/")
    if any(segment in {"", ".", ".."} for segment in segments):
        raise LocalCloudAPIError(
            HTTPStatus.BAD_REQUEST,
            f"{field_name} must not contain empty, current-directory, or parent-directory segments",
        )
    return segments


def join_key(prefix: str, segments: list[str]) -> str:
    return "/".join([prefix, *segments])


def build_key(*, device_id: str, path_value: str, is_package: bool) -> str:
    prefix = PACKAGE_STORAGE_PREFIX if is_package else DEVICE_STORAGE_PREFIX
    if is_package:
        return join_key(prefix, normalize_segments(path_value, "path"))
    return join_key(
        prefix,
        [*normalize_segments(device_id, "deviceId"), *normalize_segments(path_value, "path")],
    )


def parse_package_artifact(object_key: str, size_bytes: int | None, updated_at: str | None) -> dict[str, Any] | None:
    prefix = f"{PACKAGE_STORAGE_PREFIX}/"
    if not object_key.startswith(prefix):
        return None
    relative_path = object_key[len(prefix) :]
    segments = relative_path.split("/")
    if len(segments) != PACKAGE_ARTIFACT_SEGMENT_COUNT:
        return None
    service_name, version, platform, file_name = segments
    try:
        parse_semver(version)
    except ValueError:
        return None
    payload: dict[str, Any] = {
        "fileName": file_name,
        "platform": platform,
        "provider": "MINIO",
        "remotePath": relative_path,
        "serviceName": service_name,
        "version": version,
    }
    if size_bytes is not None:
        payload["sizeBytes"] = size_bytes
    if updated_at:
        payload["updatedAt"] = updated_at
    return payload


@dataclass(frozen=True)
class Settings:
    bind_host: str
    port: int
    minio_endpoint: str
    minio_access_key: str
    minio_secret_key: str
    minio_secure: bool
    minio_bucket: str
    device_access_token: str
    package_release_token: str

    @classmethod
    def load(cls) -> "Settings":
        return cls(
            bind_host=os.environ.get("TRAKRAI_LOCAL_CLOUD_API_BIND", "0.0.0.0").strip() or "0.0.0.0",
            port=int(os.environ.get("TRAKRAI_LOCAL_CLOUD_API_PORT", "3000")),
            minio_endpoint=os.environ.get("TRAKRAI_MINIO_ENDPOINT", "minio:9000").strip() or "minio:9000",
            minio_access_key=os.environ.get("TRAKRAI_MINIO_ACCESS_KEY", "minioadmin").strip() or "minioadmin",
            minio_secret_key=os.environ.get("TRAKRAI_MINIO_SECRET_KEY", "minioadmin").strip() or "minioadmin",
            minio_secure=env_bool("TRAKRAI_MINIO_SECURE", False),
            minio_bucket=os.environ.get("TRAKRAI_MINIO_BUCKET", "trakrai-local").strip() or "trakrai-local",
            device_access_token=os.environ.get("TRAKRAI_DEVICE_ACCESS_TOKEN", "").strip(),
            package_release_token=os.environ.get("TRAKRAI_PACKAGE_RELEASE_TOKEN", "").strip(),
        )


class LocalCloudAPIError(Exception):
    def __init__(self, status: HTTPStatus, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


class ObjectStore:
    def __init__(self, settings: Settings) -> None:
        self.bucket = settings.minio_bucket
        self.client = Minio(
            settings.minio_endpoint,
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            secure=settings.minio_secure,
        )
        self._ready = False
        self._lock = threading.Lock()

    def ensure_bucket(self) -> None:
        if self._ready:
            return
        with self._lock:
            if self._ready:
                return
            if not self.client.bucket_exists(self.bucket):
                self.client.make_bucket(self.bucket)
            self._ready = True

    def put_object(self, key: str, stream: io.BufferedIOBase, length: int, content_type: str) -> None:
        self.ensure_bucket()
        self.client.put_object(
            self.bucket,
            key,
            stream,
            length=length,
            content_type=content_type or "application/octet-stream",
        )

    def get_object(self, key: str):
        self.ensure_bucket()
        stat = self.client.stat_object(self.bucket, key)
        response = self.client.get_object(self.bucket, key)
        return stat, response

    def list_objects(self, prefix: str) -> list[dict[str, Any]]:
        self.ensure_bucket()
        objects: list[dict[str, Any]] = []
        for item in self.client.list_objects(self.bucket, prefix=prefix, recursive=True):
            objects.append(
                {
                    "key": item.object_name,
                    "sizeBytes": item.size,
                    "updatedAt": isoformat_z(item.last_modified),
                }
            )
        return objects


class LocalCloudAPIServer(ThreadingHTTPServer):
    def __init__(self, server_address: tuple[str, int], settings: Settings, store: ObjectStore) -> None:
        super().__init__(server_address, LocalCloudAPIHandler)
        self.settings = settings
        self.store = store


class LocalCloudAPIHandler(BaseHTTPRequestHandler):
    server: LocalCloudAPIServer

    def do_GET(self) -> None:
        self._dispatch()

    def do_POST(self) -> None:
        self._dispatch()

    def do_PUT(self) -> None:
        self._dispatch()

    def _dispatch(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        try:
            if self.command == "GET" and path == "/health":
                self._write_json(
                    HTTPStatus.OK,
                    {
                        "status": "ok",
                        "bucket": self.server.settings.minio_bucket,
                        "minioEndpoint": self.server.settings.minio_endpoint,
                    },
                )
                return
            if self.command == "GET" and path == "/api/external/storage/packages/releases":
                self._handle_list_packages(parsed)
                return
            if path == "/api/external/objects":
                if self.command == "GET":
                    self._handle_get_object(parsed)
                    return
                if self.command == "PUT":
                    self._handle_put_object(parsed)
                    return
                raise LocalCloudAPIError(HTTPStatus.METHOD_NOT_ALLOWED, "unsupported method")
            if self.command != "POST":
                raise LocalCloudAPIError(HTTPStatus.NOT_FOUND, "not found")
            if path == "/api/external/storage/devices/upload-session":
                self._require_token(self.server.settings.device_access_token, "Device access token is missing or invalid.")
                self._handle_device_session(method="PUT")
                return
            if path == "/api/external/storage/devices/download-session":
                self._require_token(self.server.settings.device_access_token, "Device access token is missing or invalid.")
                self._handle_device_session(method="GET")
                return
            if path == "/api/external/storage/packages/upload-session":
                self._require_token(
                    self.server.settings.package_release_token,
                    "Package release token is missing or invalid.",
                )
                self._handle_package_session(method="PUT")
                return
            if path == "/api/external/storage/packages/download-session":
                self._require_token(self.server.settings.device_access_token, "Device access token is missing or invalid.")
                self._handle_package_session(method="GET")
                return
            raise LocalCloudAPIError(HTTPStatus.NOT_FOUND, "not found")
        except LocalCloudAPIError as exc:
            self._write_text(exc.status, exc.message)
        except S3Error as exc:
            status = HTTPStatus.NOT_FOUND if exc.code == "NoSuchKey" else HTTPStatus.BAD_GATEWAY
            self._write_text(status, exc.message or str(exc))
        except Exception as exc:  # pragma: no cover - exercised through end-to-end flow
            self._write_text(HTTPStatus.INTERNAL_SERVER_ERROR, str(exc))

    def _handle_device_session(self, *, method: str) -> None:
        payload = self._read_json()
        key = build_key(
            device_id=str(payload.get("deviceId", "")),
            path_value=str(payload.get("path", "")),
            is_package=False,
        )
        response = self._session_response(method=method, key=key)
        self._write_json(HTTPStatus.OK, response)

    def _handle_package_session(self, *, method: str) -> None:
        payload = self._read_json()
        key = build_key(device_id="", path_value=str(payload.get("path", "")), is_package=True)
        response = self._session_response(method=method, key=key)
        self._write_json(HTTPStatus.OK, response)

    def _handle_put_object(self, parsed) -> None:
        key = self._read_key_query(parsed)
        content_length = int(self.headers.get("Content-Length", "0") or "0")
        content_type = self.headers.get("Content-Type", "application/octet-stream")
        if content_length < 0:
            raise LocalCloudAPIError(HTTPStatus.BAD_REQUEST, "invalid content length")
        if content_length == 0:
            payload = self.rfile.read()
            self.server.store.put_object(key, io.BytesIO(payload), len(payload), content_type)
        else:
            self.server.store.put_object(key, self.rfile, content_length, content_type)
        self._write_json(HTTPStatus.OK, {"bucket": self.server.settings.minio_bucket, "objectKey": key})

    def _handle_get_object(self, parsed) -> None:
        key = self._read_key_query(parsed)
        stat, response = self.server.store.get_object(key)
        try:
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", stat.content_type or "application/octet-stream")
            self.send_header("Content-Length", str(stat.size))
            self.end_headers()
            for chunk in response.stream(32 * 1024):
                self.wfile.write(chunk)
        finally:
            response.close()
            response.release_conn()

    def _handle_list_packages(self, parsed) -> None:
        service_name = parse_qs(parsed.query).get("serviceName", [""])[0].strip()
        prefix = PACKAGE_STORAGE_PREFIX
        if service_name:
            prefix = f"{PACKAGE_STORAGE_PREFIX}/{'/'.join(normalize_segments(service_name, 'serviceName'))}"
        objects = self.server.store.list_objects(prefix=prefix)
        artifacts = []
        for item in objects:
            artifact = parse_package_artifact(item["key"], item["sizeBytes"], item["updatedAt"])
            if artifact is not None:
                artifacts.append(artifact)
        artifacts.sort(
            key=lambda item: (
                item["serviceName"],
                tuple(-value for value in parse_semver(item["version"])),
                item["platform"],
                item["fileName"],
            )
        )
        self._write_json(HTTPStatus.OK, {"artifacts": artifacts})

    def _read_key_query(self, parsed) -> str:
        values = parse_qs(parsed.query).get("key", [])
        key = values[0].strip() if values else ""
        if key == "":
            raise LocalCloudAPIError(HTTPStatus.BAD_REQUEST, "key is required")
        if not (key.startswith(f"{DEVICE_STORAGE_PREFIX}/") or key.startswith(f"{PACKAGE_STORAGE_PREFIX}/")):
            raise LocalCloudAPIError(HTTPStatus.BAD_REQUEST, "key prefix is not allowed")
        if "/../" in f"/{key}/" or "/./" in f"/{key}/":
            raise LocalCloudAPIError(HTTPStatus.BAD_REQUEST, "key must not contain parent-directory or current-directory segments")
        return key

    def _session_response(self, *, method: str, key: str) -> dict[str, Any]:
        return {
            "bucket": self.server.settings.minio_bucket,
            "headers": {},
            "method": method,
            "objectKey": key,
            "provider": "MINIO",
            "url": self._external_url(f"/api/external/objects?key={quote(key, safe='')}"),
        }

    def _external_url(self, path: str) -> str:
        host = (self.headers.get("X-Forwarded-Host") or self.headers.get("Host") or f"127.0.0.1:{self.server.settings.port}").strip()
        scheme = (self.headers.get("X-Forwarded-Proto") or "http").split(",", 1)[0].strip() or "http"
        return f"{scheme}://{host}{path}"

    def _read_json(self) -> dict[str, Any]:
        raw_length = self.headers.get("Content-Length", "0") or "0"
        try:
            length = int(raw_length)
        except ValueError as exc:
            raise LocalCloudAPIError(HTTPStatus.BAD_REQUEST, "invalid content length") from exc
        raw_body = self.rfile.read(length)
        try:
            payload = json.loads(raw_body.decode("utf-8") if raw_body else "{}")
        except json.JSONDecodeError as exc:
            raise LocalCloudAPIError(HTTPStatus.BAD_REQUEST, f"invalid JSON body: {exc}") from exc
        if not isinstance(payload, dict):
            raise LocalCloudAPIError(HTTPStatus.BAD_REQUEST, "JSON body must be an object")
        return payload

    def _require_token(self, expected_token: str, message: str) -> None:
        if expected_token == "":
            return
        authorization = self.headers.get("Authorization", "").strip()
        matched = authorization[len("Bearer ") :].strip() if authorization.startswith("Bearer ") else ""
        if matched != expected_token:
            raise LocalCloudAPIError(HTTPStatus.UNAUTHORIZED, message)

    def _write_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _write_text(self, status: HTTPStatus, message: str) -> None:
        body = message.encode("utf-8", errors="replace")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: Any) -> None:
        print(f"[local-cloud-api] {self.address_string()} - {format % args}")


def wait_for_store(store: ObjectStore, timeout_sec: float = 60.0) -> None:
    deadline = time.time() + timeout_sec
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            store.ensure_bucket()
            return
        except Exception as exc:  # pragma: no cover - exercised during startup integration
            last_error = exc
            time.sleep(1.0)
    raise SystemExit(f"local cloud API could not reach MinIO within {timeout_sec:.0f}s: {last_error}")


def main() -> int:
    settings = Settings.load()
    store = ObjectStore(settings)
    wait_for_store(store)
    server = LocalCloudAPIServer((settings.bind_host, settings.port), settings, store)
    print(
        json.dumps(
            {
                "bind": f"{settings.bind_host}:{settings.port}",
                "bucket": settings.minio_bucket,
                "minioEndpoint": settings.minio_endpoint,
                "secure": settings.minio_secure,
            }
        )
    )
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
