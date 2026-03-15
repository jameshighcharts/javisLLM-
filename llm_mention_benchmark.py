#!/usr/bin/env python3
"""Compatibility shim to the extracted benchmark_core package."""

from __future__ import annotations

import sys
from pathlib import Path

PACKAGE_SRC = Path(__file__).resolve().parent / "packages" / "py" / "benchmark_core" / "src"
if str(PACKAGE_SRC) not in sys.path:
    sys.path.insert(0, str(PACKAGE_SRC))

import benchmark_core.legacy as _legacy  # noqa: E402

_EXPORTED_NAMES = [name for name in dir(_legacy) if not name.startswith("_")]
_SYNCABLE_NAMES = [
    name for name in _EXPORTED_NAMES if name not in {"main", "parse_args", "run_benchmark"}
]

for _name in _EXPORTED_NAMES:
    globals()[_name] = getattr(_legacy, _name)


def _sync_legacy_overrides() -> None:
    for name in _SYNCABLE_NAMES:
        if name in globals():
            setattr(_legacy, name, globals()[name])


def main(argv=None):
    _sync_legacy_overrides()
    return _legacy.main(argv)


def parse_args(argv=None):
    return _legacy.parse_args(argv)


def run_benchmark(*args, **kwargs):
    _sync_legacy_overrides()
    return _legacy.run_benchmark(*args, **kwargs)


__all__ = list(_EXPORTED_NAMES)


if __name__ == "__main__":
    raise SystemExit(main())
