#!/usr/bin/env python3
"""Pull active benchmark config tables from Supabase into benchmark_config.json."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Sequence

from supabase import create_client

ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG_PATH = ROOT_DIR / "config" / "benchmark_config.json"
DEFAULT_ENV_FILE = ROOT_DIR / ".env.monthly"


class SyncError(RuntimeError):
    """Raised when Supabase config sync fails."""


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch active prompt/competitor config from Supabase into local JSON.",
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_CONFIG_PATH),
        help="Path to write benchmark_config.json",
    )
    parser.add_argument(
        "--env-file",
        default=str(DEFAULT_ENV_FILE),
        help="Optional env file to source before reading env vars",
    )
    return parser.parse_args(argv)


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        raw = line.strip()
        if not raw or raw.startswith("#") or "=" not in raw:
            continue
        key, value = raw.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise SyncError(f"Missing required env var: {name}")
    return value


def unique_non_empty(values: Iterable[str]) -> List[str]:
    seen = set()
    output: List[str] = []
    for value in values:
        text = str(value).strip()
        if not text:
            continue
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        output.append(text)
    return output


def sort_key(row: Dict[str, Any]) -> int:
    try:
        return int(row.get("sort_order") or 0)
    except Exception:  # noqa: BLE001
        return 0


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    load_env_file(Path(args.env_file).expanduser().resolve())

    supabase_url = require_env("SUPABASE_URL")
    service_role_key = require_env("SUPABASE_SERVICE_ROLE_KEY")
    client = create_client(supabase_url, service_role_key)

    prompt_result = (
        client.table("prompt_queries")
        .select("query_text,sort_order")
        .eq("is_active", True)
        .order("sort_order")
        .execute()
    )
    if getattr(prompt_result, "error", None):
        raise SyncError(f"Failed to read prompt_queries: {prompt_result.error}")
    prompt_rows = list(getattr(prompt_result, "data", []) or [])
    prompt_rows.sort(key=sort_key)
    queries = unique_non_empty(row.get("query_text", "") for row in prompt_rows)

    competitor_result = (
        client.table("competitors")
        .select("name,slug,sort_order,is_primary,competitor_aliases(alias)")
        .eq("is_active", True)
        .order("sort_order")
        .execute()
    )
    if getattr(competitor_result, "error", None):
        raise SyncError(f"Failed to read competitors: {competitor_result.error}")
    competitor_rows = list(getattr(competitor_result, "data", []) or [])
    competitor_rows.sort(key=sort_key)

    competitors = unique_non_empty(row.get("name", "") for row in competitor_rows)
    aliases: Dict[str, List[str]] = {}
    for row in competitor_rows:
        name = str(row.get("name") or "").strip()
        if not name:
            continue
        alias_rows = row.get("competitor_aliases") or []
        alias_values = [
            str(alias_row.get("alias") or "").strip()
            for alias_row in alias_rows
            if isinstance(alias_row, dict)
        ]
        aliases[name] = unique_non_empty([name, *alias_values])

    if not queries:
        raise SyncError("No active prompt_queries found.")
    if not competitors:
        raise SyncError("No active competitors found.")
    if not any(name.lower() == "highcharts" for name in competitors):
        raise SyncError('Active competitors must include "Highcharts".')

    output_path = Path(args.output).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    payload = {
        "queries": queries,
        "competitors": competitors,
        "aliases": aliases,
    }
    output_path.write_text(f"{json.dumps(payload, indent=2)}\n", encoding="utf-8")

    print(
        "Pulled config from Supabase: "
        f"queries={len(queries)}, competitors={len(competitors)}, output={output_path}",
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SyncError as exc:
        print(f"Supabase config pull failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
