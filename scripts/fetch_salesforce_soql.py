#!/usr/bin/env python3
"""Fetch Salesforce data with SOQL via the sf CLI.

This wrapper keeps local usage consistent with the rest of this repo by:
- optionally loading .env.monthly
- using SF_TARGET_ORG by default
- emitting normalized JSON for downstream scripts
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence

ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_ENV_FILE = ROOT_DIR / ".env.monthly"
DEFAULT_OUTPUT_DIR = ROOT_DIR / "output"


class SalesforceQueryError(RuntimeError):
    """Raised for actionable query failures."""


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run SOQL with Salesforce CLI and emit normalized JSON output.",
    )
    source_group = parser.add_mutually_exclusive_group(required=True)
    source_group.add_argument(
        "--query",
        help="SOQL string to execute.",
    )
    source_group.add_argument(
        "--query-file",
        help="Path to a .soql file that contains the query.",
    )
    parser.add_argument(
        "--target-org",
        default="",
        help="Salesforce org alias/username. Defaults to SF_TARGET_ORG env var.",
    )
    parser.add_argument(
        "--env-file",
        default=str(DEFAULT_ENV_FILE),
        help="Optional env file to load before reading SF_TARGET_ORG.",
    )
    parser.add_argument(
        "--output",
        default="",
        help="Optional path to write normalized JSON payload.",
    )
    parser.add_argument(
        "--use-tooling-api",
        action="store_true",
        help="Use Tooling API instead of Data API.",
    )
    parser.add_argument(
        "--bulk",
        action="store_true",
        help="Use bulk query mode in sf CLI.",
    )
    parser.add_argument(
        "--wait",
        default="",
        help="Optional wait time in minutes when using --bulk.",
    )
    parser.add_argument(
        "--raw",
        action="store_true",
        help="Print raw sf --json response instead of normalized payload.",
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


def require_sf_cli() -> str:
    binary = shutil.which("sf")
    if binary:
        return binary
    raise SalesforceQueryError(
        "Salesforce CLI `sf` is not installed or not on PATH. "
        "Install it first: https://developer.salesforce.com/tools/salesforcecli",
    )


def resolve_query(args: argparse.Namespace) -> tuple[str, str]:
    if args.query:
        query = args.query.strip()
        if not query:
            raise SalesforceQueryError("`--query` cannot be empty.")
        return query, "inline"

    query_file = Path(str(args.query_file)).expanduser().resolve()
    if not query_file.exists():
        raise SalesforceQueryError(f"SOQL file does not exist: {query_file}")
    query = query_file.read_text(encoding="utf-8").strip()
    if not query:
        raise SalesforceQueryError(f"SOQL file is empty: {query_file}")
    return query, str(query_file)


def find_result_node(payload: Any) -> dict[str, Any] | None:
    if isinstance(payload, dict):
        if "records" in payload and isinstance(payload.get("records"), list):
            return payload
        for value in payload.values():
            child = find_result_node(value)
            if child:
                return child
    elif isinstance(payload, list):
        for item in payload:
            child = find_result_node(item)
            if child:
                return child
    return None


def build_normalized_payload(
    *,
    sf_payload: dict[str, Any],
    query: str,
    query_source: str,
    target_org: str,
) -> dict[str, Any]:
    result_node = find_result_node(sf_payload) or {}
    records = result_node.get("records") if isinstance(result_node.get("records"), list) else []
    total_size = result_node.get("totalSize")
    done = result_node.get("done")
    return {
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "target_org": target_org or None,
        "query_source": query_source,
        "query": query,
        "total_size": int(total_size) if isinstance(total_size, int) else len(records),
        "done": bool(done) if isinstance(done, bool) else None,
        "records": records,
    }


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    load_env_file(Path(args.env_file).expanduser().resolve())

    sf_binary = require_sf_cli()
    target_org = (args.target_org or os.getenv("SF_TARGET_ORG", "")).strip()
    query, query_source = resolve_query(args)

    command = [
        sf_binary,
        "data",
        "query",
        "--query",
        query,
        "--result-format",
        "json",
        "--json",
    ]
    if target_org:
        command.extend(["--target-org", target_org])
    if args.use_tooling_api:
        command.append("--use-tooling-api")
    if args.bulk:
        command.append("--bulk")
    if args.wait:
        if not args.bulk:
            raise SalesforceQueryError("--wait requires --bulk.")
        command.extend(["--wait", args.wait])

    completed = subprocess.run(
        command,
        text=True,
        capture_output=True,
        check=False,
    )

    if completed.returncode != 0:
        error_details = completed.stderr.strip() or completed.stdout.strip() or "Unknown sf error."
        raise SalesforceQueryError(f"sf data query failed: {error_details}")

    try:
        sf_payload = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise SalesforceQueryError(f"sf output was not valid JSON: {exc}") from exc

    if args.raw:
        output_payload: dict[str, Any] = sf_payload
    else:
        output_payload = build_normalized_payload(
            sf_payload=sf_payload,
            query=query,
            query_source=query_source,
            target_org=target_org,
        )

    serialized = json.dumps(output_payload, indent=2)
    output_path = (args.output or "").strip()
    if output_path:
        destination = Path(output_path).expanduser()
        if not destination.is_absolute():
            destination = (DEFAULT_OUTPUT_DIR / destination).resolve()
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(f"{serialized}\n", encoding="utf-8")
        print(f"Wrote SOQL result to {destination}")
    else:
        print(serialized)

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SalesforceQueryError as exc:
        print(f"Salesforce SOQL fetch failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
