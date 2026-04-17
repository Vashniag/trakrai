from __future__ import annotations

import sys
from pathlib import Path

if __package__ in {None, ""}:
    package_parent = Path(__file__).resolve().parent.parent
    if str(package_parent) not in sys.path:
        sys.path.insert(0, str(package_parent))
    from trakrai_service_runtime import run_service_main
    from workflow_engine._version import __version__
    from workflow_engine.config import load_config
    from workflow_engine.service import WorkflowService
else:
    from trakrai_service_runtime import run_service_main
    from ._version import __version__
    from .config import load_config
    from .service import WorkflowService


def main(argv: list[str] | None = None) -> int:
    return run_service_main(
        argv,
        description="TrakrAI workflow engine service",
        version=__version__,
        logger_name="workflow-engine",
        load_config=load_config,
        build_service=WorkflowService,
    )


if __name__ == "__main__":
    raise SystemExit(main())
