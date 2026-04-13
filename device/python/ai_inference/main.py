from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

if __package__ is None or __package__ == "":
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from ai_inference.config import load_config
    from ai_inference.service import InferenceRedisService
else:
    from .config import load_config
    from .service import InferenceRedisService


def main() -> int:
    parser = argparse.ArgumentParser(description="Standalone Redis-driven AI inference worker")
    parser.add_argument("-config", "--config", default="config.json", help="path to the JSON config file")
    args = parser.parse_args()

    config = load_config(args.config)
    logging.basicConfig(
        level=_resolve_level(config.log_level),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    logger = logging.getLogger("ai-inference")

    service = InferenceRedisService(config, logger)
    try:
        service.run_forever()
    except KeyboardInterrupt:
        logger.info("Stopping ai-inference")
        return 0

    return 0


def _resolve_level(raw_level: str) -> int:
    return getattr(logging, raw_level.upper(), logging.INFO)


if __name__ == "__main__":
    raise SystemExit(main())

