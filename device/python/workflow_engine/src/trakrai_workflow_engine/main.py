from __future__ import annotations

import argparse
import logging

from ._version import __version__
from .config import load_config
from .service import WorkflowService


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="TrakrAI workflow engine service")
    parser.add_argument("-config", "--config", default="config.json", help="path to the JSON config file")
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    args = parser.parse_args(argv)

    config = load_config(args.config)
    logging.basicConfig(
        level=_resolve_level(config.log_level),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    logger = logging.getLogger("workflow-engine")
    logger.info("Starting workflow-engine %s", __version__)

    service = WorkflowService(config, logger)
    try:
        service.run_forever()
    except KeyboardInterrupt:
        logger.info("Stopping workflow-engine")
        return 0

    return 0


def _resolve_level(raw_level: str) -> int:
    return getattr(logging, raw_level.upper(), logging.INFO)
