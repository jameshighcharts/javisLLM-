#!/usr/bin/env python3
"""Push Looker CSV rows to a Google Apps Script web app endpoint."""

from __future__ import annotations

import argparse
import csv
import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Sequence

DEFAULT_ENV_FILE = Path(__file__).resolve().parents[1] / ".env.monthly"


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not key:
            continue
        cleaned = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, cleaned)


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Push looker_studio_table_paste.csv to a Google Apps Script web app."
    )
    parser.add_argument(
        "--csv",
        default=str(
            Path(__file__).resolve().parents[1]
            / "output"
            / "looker_studio_table_paste.csv"
        ),
        help="Path to Looker CSV file.",
    )
    parser.add_argument(
        "--url",
        default=os.getenv("GSHEET_WEBAPP_URL", ""),
        help="Apps Script Web App URL (or env GSHEET_WEBAPP_URL).",
    )
    parser.add_argument(
        "--secret",
        default=os.getenv("GSHEET_WEBAPP_SECRET", ""),
        help="Shared secret token (or env GSHEET_WEBAPP_SECRET).",
    )
    parser.add_argument(
        "--sheet-name",
        default=os.getenv("GSHEET_TAB_NAME", "Sheet1"),
        help="Target sheet/tab name (or env GSHEET_TAB_NAME).",
    )
    parser.add_argument(
        "--run-month",
        default="",
        help="Optional override for run_month. Defaults to first CSV row value.",
    )
    parser.add_argument(
        "--run-id",
        default="",
        help="Optional override for run_id. Defaults to first CSV row value.",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=45,
        help="HTTP timeout seconds.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate payload and print summary without HTTP request.",
    )
    return parser.parse_args(argv)


def read_csv_payload(path: Path) -> Dict[str, Any]:
    with path.open("r", newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        headers = list(reader.fieldnames or [])
        rows = list(reader)

    if not headers:
        raise RuntimeError("CSV has no header row.")
    if not rows:
        raise RuntimeError("CSV has no data rows.")
    if "run_month" not in headers or "run_id" not in headers:
        raise RuntimeError("CSV must include run_month and run_id columns.")

    matrix_rows: List[List[str]] = []
    for row in rows:
        matrix_rows.append([str(row.get(col, "")) for col in headers])

    return {
        "headers": headers,
        "row_dicts": rows,
        "rows": matrix_rows,
    }


def build_request_payload(
    csv_payload: Dict[str, Any],
    sheet_name: str,
    run_month: str,
    run_id: str,
) -> Dict[str, Any]:
    row_dicts = csv_payload["row_dicts"]
    effective_run_month = run_month or str(row_dicts[0].get("run_month", "")).strip()
    effective_run_id = run_id or str(row_dicts[0].get("run_id", "")).strip()
    if not effective_run_month:
        raise RuntimeError("run_month missing in args and CSV.")
    if not effective_run_id:
        raise RuntimeError("run_id missing in args and CSV.")

    return {
        "sheet_name": sheet_name,
        "run_month": effective_run_month,
        "run_id": effective_run_id,
        "headers": csv_payload["headers"],
        "rows": csv_payload["rows"],
    }


def build_signature_payload(payload: Dict[str, Any], secret: str) -> Dict[str, Any]:
    timestamp = str(int(time.time()))
    headers_json = json.dumps(
        payload.get("headers", []), separators=(",", ":"), ensure_ascii=False
    )
    rows_json = json.dumps(
        payload.get("rows", []), separators=(",", ":"), ensure_ascii=False
    )
    body_hash = hashlib.sha256(f"{headers_json}\n{rows_json}".encode("utf-8")).hexdigest()
    signing_message = "\n".join(
        [
            str(payload.get("sheet_name", "")),
            str(payload.get("run_month", "")),
            str(payload.get("run_id", "")),
            body_hash,
            timestamp,
        ]
    )
    signature = hmac.new(
        secret.encode("utf-8"), signing_message.encode("utf-8"), hashlib.sha256
    ).hexdigest()
    return {**payload, "ts": timestamp, "sig": signature}


def post_payload(url: str, payload: Dict[str, Any], timeout: int, secret: str) -> Dict[str, Any]:
    signed_payload = build_signature_payload(payload, secret)
    body = json.dumps(signed_payload).encode("utf-8")
    request = urllib.request.Request(
        url=url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            content = response.read().decode("utf-8")
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {err.code}: {detail}") from err
    except urllib.error.URLError as err:
        raise RuntimeError(f"Request failed: {err}") from err

    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        parsed = {
            "status": "error",
            "rows_appended": 0,
            "message": f"Non-JSON response: {content[:400]}",
        }
    return parsed


def main(argv: Sequence[str] | None = None) -> int:
    load_env_file(DEFAULT_ENV_FILE)
    args = parse_args(argv)

    csv_path = Path(args.csv).expanduser().resolve()
    if not csv_path.exists():
        raise FileNotFoundError(f"Missing CSV file: {csv_path}")

    csv_payload = read_csv_payload(csv_path)
    payload = build_request_payload(
        csv_payload=csv_payload,
        sheet_name=args.sheet_name,
        run_month=args.run_month.strip(),
        run_id=args.run_id.strip(),
    )

    if args.dry_run:
        print("Dry run: payload validated.")
        print(f"csv={csv_path}")
        print(f"sheet_name={payload['sheet_name']}")
        print(f"run_month={payload['run_month']}")
        print(f"run_id={payload['run_id']}")
        print(f"headers={len(payload['headers'])}")
        print(f"rows={len(payload['rows'])}")
        preview = {
            "headers": payload["headers"][:6],
            "first_row_preview": payload["rows"][0][:6] if payload["rows"] else [],
        }
        print(json.dumps(preview, indent=2))
        return 0

    if not args.url:
        raise RuntimeError("--url is required (or set GSHEET_WEBAPP_URL).")
    if not args.secret:
        raise RuntimeError("--secret is required (or set GSHEET_WEBAPP_SECRET).")

    result = post_payload(url=args.url, payload=payload, timeout=args.timeout, secret=args.secret)
    status = str(result.get("status", "")).strip().lower()
    rows_appended = result.get("rows_appended", 0)
    message = result.get("message", "")

    print(json.dumps(result, indent=2))
    print(f"status={status}")
    print(f"rows_appended={rows_appended}")
    print(f"message={message}")

    if status in {"appended", "skipped_duplicate"}:
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
