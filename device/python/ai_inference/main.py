from __future__ import annotations

import sys
from pathlib import Path

if __package__ in {None, ""}:
    package_parent = Path(__file__).resolve().parent.parent
    if str(package_parent) not in sys.path:
        sys.path.insert(0, str(package_parent))
    from ai_inference._version import __version__
    from ai_inference.config import load_config
    from ai_inference.service import InferenceRedisService
    from trakrai_service_runtime import run_service_main
else:
    from trakrai_service_runtime import run_service_main
    from ._version import __version__
    from .config import load_config
    from .service import InferenceRedisService


def main(argv: list[str] | None = None) -> int:
    return run_service_main(
        argv,
        description="Standalone Redis-driven AI inference worker",
        version=__version__,
        logger_name="ai-inference",
        load_config=load_config,
        build_service=InferenceRedisService,
    )


if __name__ == "__main__":
    raise SystemExit(main())
