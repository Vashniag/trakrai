from __future__ import annotations

import sys
from pathlib import Path

if __package__ in {None, ""}:
    package_parent = Path(__file__).resolve().parent.parent
    if str(package_parent) not in sys.path:
        sys.path.insert(0, str(package_parent))
    from audio_manager._version import __version__
    from audio_manager.config import load_config
    from audio_manager.service import AudioService
    from trakrai_service_runtime import run_service_main
else:
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
