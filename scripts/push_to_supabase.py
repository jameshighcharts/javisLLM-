#!/usr/bin/env python3
"""Compatibility wrapper for benchmark_core.supabase_sync."""

from __future__ import annotations

import sys
from pathlib import Path

PACKAGE_SRC = Path(__file__).resolve().parents[1] / "packages" / "py" / "benchmark_core" / "src"
if str(PACKAGE_SRC) not in sys.path:
    sys.path.insert(0, str(PACKAGE_SRC))

from benchmark_core import supabase_sync as _supabase_sync  # noqa: E402

SyncError = _supabase_sync.SyncError
main = _supabase_sync.main


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SyncError as exc:
        print(f"Supabase sync failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
