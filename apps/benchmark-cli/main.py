#!/usr/bin/env python3
"""Thin repo CLI for benchmark-core commands."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Sequence

REPO_ROOT = Path(__file__).resolve().parents[2]
PACKAGE_SRC = REPO_ROOT / "packages" / "py" / "benchmark_core" / "src"
if str(PACKAGE_SRC) not in sys.path:
    sys.path.insert(0, str(PACKAGE_SRC))

from benchmark_core import config_sync, exports, runner, supabase_sync  # noqa: E402


def parse_args(argv: Sequence[str] | None = None):
    parser = argparse.ArgumentParser(prog="benchmark", description="Benchmark repo CLI.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    for name in ("run", "export-datasets", "sync-supabase", "sync-config", "monthly"):
        subparsers.add_parser(name)

    return parser.parse_known_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args, remainder = parse_args(argv)

    if args.command == "run":
        return runner.main(remainder)
    if args.command == "export-datasets":
        return exports.main(remainder)
    if args.command == "sync-supabase":
        return supabase_sync.main(remainder)
    if args.command == "sync-config":
        return config_sync.main(remainder)
    if args.command == "monthly":
        print(
            "Monthly orchestration remains in scripts/monthly_run.sh during the staged migration.",
            file=sys.stderr,
        )
        return 0

    raise SystemExit(f"Unsupported command: {args.command}")


if __name__ == "__main__":
    raise SystemExit(main())
