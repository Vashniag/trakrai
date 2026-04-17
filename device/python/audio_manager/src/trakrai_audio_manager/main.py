from __future__ import annotations

from trakrai_service_runtime import run_service_main
from ._version import __version__
from .config import load_config
from .service import AudioService


def main(argv: list[str] | None = None) -> int:
    return run_service_main(
        argv,
        description="TrakrAI audio manager service",
        version=__version__,
        logger_name="audio-manager",
        load_config=load_config,
        build_service=AudioService,
    )


if __name__ == "__main__":
    raise SystemExit(main())
