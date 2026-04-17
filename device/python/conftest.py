from __future__ import annotations

import sys
from pathlib import Path


PYTHON_ROOT = Path(__file__).resolve().parent

python_root_str = str(PYTHON_ROOT)
if python_root_str not in sys.path:
    sys.path.insert(0, python_root_str)
