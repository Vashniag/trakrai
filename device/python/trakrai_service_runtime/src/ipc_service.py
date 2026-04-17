from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any, Callable, Dict

from .ipc import IPCClient

CommandHandler = Callable[[str, Dict[str, Any]], None]
NotificationInterceptor = Callable[[Dict[str, Any]], bool]


def run_command_loop(
    ipc: IPCClient,
    stop_event: threading.Event,
    command_handler: CommandHandler,
    *,
    notification_interceptor: NotificationInterceptor | None = None,
    timeout_sec: float = 1.0,
    closed_error_message: str,
) -> None:
    while not stop_event.is_set():
        notification = ipc.read_notification(timeout_sec=timeout_sec)
        if notification is None:
            if ipc.is_closed:
                raise RuntimeError(closed_error_message)
            continue
        if notification_interceptor is not None and notification_interceptor(notification):
            continue
        extracted = _extract_command_envelope(notification)
        if extracted is None:
            continue
        source_service, envelope = extracted
        command_handler(source_service, envelope)


def run_periodic_loop(stop_event: threading.Event, interval_sec: float, callback: Callable[[], None]) -> None:
    while not stop_event.wait(interval_sec):
        callback()


def publish_reply(
    ipc: IPCClient,
    logger: Any,
    target_service: str,
    message_type: str,
    payload: dict[str, Any],
    *,
    warning_message: str,
) -> None:
    try:
        if target_service.strip():
            ipc.send_service_message(target_service.strip(), "response", message_type, payload)
        else:
            ipc.publish("response", message_type, payload)
    except Exception as exc:
        logger.warning(warning_message, extra={"error": str(exc)})


def publish_error(
    ipc: IPCClient,
    logger: Any,
    target_service: str,
    error_type: str,
    *,
    request_id: str,
    request_type: str,
    error: str,
    warning_message: str,
    debug_message: str,
) -> None:
    publish_reply(
        ipc,
        logger,
        target_service,
        error_type,
        {
            "error": error,
            "requestId": request_id.strip(),
            "requestType": request_type.strip(),
        },
        warning_message=warning_message,
    )
    try:
        ipc.report_error(error, fatal=False)
    except Exception:
        logger.debug(debug_message, exc_info=True)


def report_status(
    ipc: IPCClient,
    logger: Any,
    status: str,
    details: dict[str, Any],
    *,
    debug_message: str,
) -> None:
    try:
        ipc.report_status(status, details)
    except Exception:
        logger.debug(debug_message, exc_info=True)


def append_jsonl(path: str | Path, payload: dict[str, Any]) -> None:
    output_path = Path(path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, sort_keys=True) + "\n")


def _extract_command_envelope(notification: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
    method = str(notification.get("method", "")).strip()
    params = notification.get("params", {})
    if not isinstance(params, dict):
        return None

    if method == "mqtt-message":
        if str(params.get("subtopic", "")).strip() != "command":
            return None
        envelope = params.get("envelope")
        if isinstance(envelope, dict):
            return "", envelope
        return None

    if method == "service-message":
        if str(params.get("subtopic", "")).strip() != "command":
            return None
        envelope = params.get("envelope")
        if isinstance(envelope, dict):
            return str(params.get("sourceService", "")).strip(), envelope
        return None

    return None
