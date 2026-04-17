from __future__ import annotations

from pathlib import Path
from pkgutil import extend_path

__path__ = extend_path(__path__, __name__)
_SRC_DIR = Path(__file__).resolve().parent / "src"
if _SRC_DIR.is_dir():
    __path__.append(str(_SRC_DIR))

from ._version import __version__

__all__ = ["__version__"]
