from __future__ import annotations

import argparse
import logging
from typing import Any, Callable, Protocol, TypeVar


ConfigT = TypeVar("ConfigT")


class RunnableService(Protocol):
    def run_forever(self) -> None:
        ...


def resolve_log_level(raw_level: str) -> int:
    return getattr(logging, raw_level.upper(), logging.INFO)


def configure_logging(log_level: str) -> None:
    logging.basicConfig(
        level=resolve_log_level(log_level),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )


def run_service_main(
    argv: list[str] | None,
    *,
    description: str,
    version: str,
    logger_name: str,
    load_config: Callable[[str], ConfigT],
    build_service: Callable[[ConfigT, logging.Logger], RunnableService],
) -> int:
    parser = argparse.ArgumentParser(prog=logger_name, description=description)
    parser.add_argument("-config", "--config", default="config.json", help="path to the JSON config file")
    parser.add_argument("--version", action="version", version=f"%(prog)s {version}")
    args = parser.parse_args(argv)

    config = load_config(args.config)
    configure_logging(str(getattr(config, "log_level", "info")))
    logger = logging.getLogger(logger_name)
    logger.info("Starting %s %s", logger_name, version)

    service = build_service(config, logger)
    try:
        service.run_forever()
    except KeyboardInterrupt:
        logger.info("Stopping %s", logger_name)
        return 0

    return 0
