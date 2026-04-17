from __future__ import annotations

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
