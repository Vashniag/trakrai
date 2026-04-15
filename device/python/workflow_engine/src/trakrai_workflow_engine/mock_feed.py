from __future__ import annotations

import argparse
import json
import logging
import time
import uuid
from pathlib import Path
from typing import Any

from .config import load_config
from .ipc import IPCClient
from .service import SERVICE_NAME, WORKFLOW_ENGINE_ERROR_TYPE, WORKFLOW_ENGINE_RESULT_TYPE


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Feed mock detection frames into workflow-engine")
    parser.add_argument("--config", required=True, help="path to workflow-engine config")
    parser.add_argument("--input", required=True, help="path to the JSON file containing frames")
    parser.add_argument("--delay-ms", type=int, default=-1, help="override delay between frames in milliseconds")
    parser.add_argument("--request-timeout-sec", type=float, default=10.0)
    parser.add_argument("--source-service", default="", help="optional custom IPC source service name")
    args = parser.parse_args(argv)

    config = load_config(args.config)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logger = logging.getLogger("workflow-feed")

    frames_document = json.loads(Path(args.input).expanduser().resolve().read_text(encoding="utf-8"))
    frames, default_delay_ms = _load_frames(frames_document)
    if args.delay_ms >= 0:
        default_delay_ms = args.delay_ms

    source_service = args.source_service.strip() or f"workflow-feed-{uuid.uuid4().hex[:8]}"
    client = IPCClient(config.ipc.socket_path, source_service, logger)
    client.connect()

    outputs: list[dict[str, Any]] = []
    try:
        for index, frame in enumerate(frames):
            request_id = str(frame.get("requestId", "")).strip() or f"wf-feed-{uuid.uuid4().hex}"
            payload = dict(frame)
            payload["requestId"] = request_id
            client.send_service_message(SERVICE_NAME, "command", "enqueue-detection", payload)
            response = _await_response(client, request_id, args.request_timeout_sec)
            outputs.append(response)
            if index < len(frames) - 1:
                delay_ms = int(frame.get("delayMs", default_delay_ms) or 0)
                if delay_ms > 0:
                    time.sleep(delay_ms / 1000.0)
    finally:
        client.close()

    print(json.dumps({"results": outputs}, indent=2))
    return 0


def _load_frames(document: Any) -> tuple[list[dict[str, Any]], int]:
    if isinstance(document, list):
        frames = document
        delay_ms = 0
    elif isinstance(document, dict):
        raw_frames = document.get("frames", [])
        if not isinstance(raw_frames, list):
            raise SystemExit("frames must be an array")
        frames = raw_frames
        delay_ms = int(document.get("delayMs", 0) or 0)
    else:
        raise SystemExit("mock feed input must be a JSON object or array")

    normalized_frames: list[dict[str, Any]] = []
    for index, frame in enumerate(frames):
        if not isinstance(frame, dict):
            raise SystemExit(f"frames[{index}] must be an object")
        normalized_frames.append(frame)
    return normalized_frames, delay_ms


def _await_response(client: IPCClient, request_id: str, timeout_sec: float) -> dict[str, Any]:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        notification = client.read_notification(timeout_sec=0.5)
        if notification is None:
            if client.is_closed:
                raise SystemExit("IPC connection closed while waiting for workflow result")
            continue
        if notification.get("method") != "service-message":
            continue
        params = notification.get("params", {})
        if not isinstance(params, dict):
            continue
        if str(params.get("sourceService", "")).strip() != SERVICE_NAME:
            continue
        if str(params.get("subtopic", "")).strip() != "response":
            continue

        envelope = params.get("envelope", {})
        if not isinstance(envelope, dict):
            continue
        payload = envelope.get("payload", {})
        if not isinstance(payload, dict):
            continue
        if str(payload.get("requestId", "")).strip() != request_id:
            continue

        response_type = str(envelope.get("type", "")).strip()
        if response_type == WORKFLOW_ENGINE_ERROR_TYPE:
            raise SystemExit(json.dumps(payload, indent=2))
        if response_type == WORKFLOW_ENGINE_RESULT_TYPE:
            return payload

    raise SystemExit(f"timed out waiting for workflow result for request {request_id}")


if __name__ == "__main__":
    raise SystemExit(main())
