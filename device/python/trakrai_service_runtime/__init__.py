from __future__ import annotations

from pathlib import Path
from pkgutil import extend_path

__path__ = extend_path(__path__, __name__)
_SRC_DIR = Path(__file__).resolve().parent / "src"
if _SRC_DIR.is_dir():
    __path__.append(str(_SRC_DIR))

from .config_support import (  # noqa: E402
    bool_value,
    float_value,
    int_value,
    load_json_object,
    optional_object,
    require_object,
    resolve_path,
    string_list,
    string_value,
)
from .ipc import IPCClient, IPCError  # noqa: E402
from .ipc_service import (  # noqa: E402
    append_jsonl,
    publish_error,
    publish_reply,
    report_status,
    run_command_loop,
    run_periodic_loop,
)
from .service_bridge import ServiceRequestBridge, ServiceResponse  # noqa: E402
from .service_main import configure_logging, resolve_log_level, run_service_main  # noqa: E402

__all__ = [
    "IPCClient",
    "IPCError",
    "ServiceRequestBridge",
    "ServiceResponse",
    "append_jsonl",
    "bool_value",
    "configure_logging",
    "float_value",
    "int_value",
    "load_json_object",
    "optional_object",
    "publish_error",
    "publish_reply",
    "report_status",
    "require_object",
    "resolve_log_level",
    "resolve_path",
    "run_command_loop",
    "run_periodic_loop",
    "run_service_main",
    "string_list",
    "string_value",
]
