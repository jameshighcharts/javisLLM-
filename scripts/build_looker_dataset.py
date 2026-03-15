#!/usr/bin/env python3
"""Compatibility wrapper for benchmark_core.exports."""

from __future__ import annotations

import sys
from pathlib import Path

PACKAGE_SRC = Path(__file__).resolve().parents[1] / "packages" / "py" / "benchmark_core" / "src"
if str(PACKAGE_SRC) not in sys.path:
    sys.path.insert(0, str(PACKAGE_SRC))

from benchmark_core import exports as _exports  # noqa: E402

_EXPORTED_NAMES = [name for name in dir(_exports) if not name.startswith("_")]

for _name in _EXPORTED_NAMES:
    globals()[_name] = getattr(_exports, _name)

main = _exports.main
__all__ = list(_EXPORTED_NAMES)


if __name__ == "__main__":
    raise SystemExit(main())
