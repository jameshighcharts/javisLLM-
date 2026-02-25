#!/usr/bin/env python3
"""Upsert competitor blog post data into Supabase.

Expected input shape:
- JSON array of blog post objects
- JSON array of n8n item objects ({ "json": { ...postFields } })
- JSON object with an `items` or `data` array of either shape

Required env vars:
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Sequence, Tuple
from urllib.parse import urlparse

from supabase import Client, create_client

ROOT_DIR = Path(__file__).resolve().parents[1]


class SyncError(RuntimeError):
    """Raised when blog sync fails with a user-actionable message."""


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Push competitor blog post data into Supabase"
    )
    parser.add_argument(
        "--input",
        required=True,
        help="Path to JSON file containing blog post rows",
    )
    parser.add_argument(
        "--env-file",
        default=str(ROOT_DIR / ".env.monthly"),
        help="Optional env file to load before reading env vars",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=250,
        help="Supabase upsert batch size",
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
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise SyncError(f"Missing required env var: {name}")
    return value


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        raise SyncError(f"Could not read JSON from {path}: {exc}") from exc


def slugify(value: str) -> str:
    out: List[str] = []
    prev_sep = False
    for char in value.lower():
        if char.isalnum():
            out.append(char)
            prev_sep = False
        else:
            if not prev_sep:
                out.append("_")
            prev_sep = True
    return "".join(out).strip("_")


def normalize_source(source: str, link: str) -> str:
    cleaned = source.strip()
    if cleaned:
        return cleaned

    hostname = urlparse(link).hostname or ""
    hostname = hostname.lower()
    if hostname.startswith("www."):
        hostname = hostname[4:]
    if hostname.startswith("blog."):
        hostname = hostname[5:]
    return hostname or "unknown"


def parse_date_value(value: Any) -> date | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None

    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        pass

    parsed_dt = parse_datetime_value(text)
    return parsed_dt.date() if parsed_dt else None


def parse_datetime_value(value: Any) -> datetime | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None

    if text.endswith("Z"):
        text = text[:-1] + "+00:00"

    try:
        parsed = datetime.fromisoformat(text)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except ValueError:
        pass

    try:
        parsed = parsedate_to_datetime(text)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except Exception:  # noqa: BLE001
        return None


def clean_text(value: Any, default: str = "") -> str:
    text = str(value or "").strip()
    return text if text else default


def extract_post_items(payload: Any) -> List[Dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]

    if isinstance(payload, dict):
        if "nodes" in payload and "connections" in payload:
            raise SyncError(
                "Input appears to be an n8n workflow export, not workflow output data. "
                "Export the execution results (items) and pass that JSON instead."
            )
        for key in ("items", "data"):
            rows = payload.get(key)
            if isinstance(rows, list):
                return [item for item in rows if isinstance(item, dict)]

    raise SyncError("Input JSON must be an array or an object with `items`/`data` array.")


def normalize_post(raw_item: Dict[str, Any]) -> Dict[str, Any] | None:
    item = raw_item.get("json") if isinstance(raw_item.get("json"), dict) else raw_item

    title = clean_text(item.get("title"))
    link = clean_text(item.get("link"))
    if not title or not link:
        return None

    source = normalize_source(clean_text(item.get("source")), link)
    source_slug = slugify(source) or "unknown"

    raw_date = item.get("date")
    raw_publish_date = item.get("publish_date") or item.get("published_at")

    publish_date = parse_date_value(raw_date) or parse_date_value(raw_publish_date)
    published_at = parse_datetime_value(raw_publish_date) or parse_datetime_value(raw_date)

    known_fields = {
        "title",
        "date",
        "publish_date",
        "published_at",
        "content_theme",
        "type",
        "description",
        "summary",
        "contentSnippet",
        "source",
        "link",
        "author",
        "creator",
    }
    metadata = {
        key: value for key, value in item.items() if key not in known_fields
    }

    return {
        "source": source,
        "source_slug": source_slug,
        "title": title,
        "content_theme": clean_text(item.get("content_theme") or item.get("type"), "General"),
        "description": clean_text(
            item.get("description") or item.get("summary") or item.get("contentSnippet")
        ),
        "author": clean_text(item.get("author") or item.get("creator")) or None,
        "link": link,
        "publish_date": publish_date.isoformat() if publish_date else None,
        "published_at": published_at.isoformat() if published_at else None,
        "publish_date_raw": clean_text(raw_publish_date) or None,
        "metadata": metadata,
    }


def dedupe_by_link(rows: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = set()
    out: List[Dict[str, Any]] = []
    for row in rows:
        link = str(row.get("link") or "").strip().lower()
        if not link or link in seen:
            continue
        seen.add(link)
        out.append(row)
    return out


def batched(items: Sequence[Dict[str, Any]], size: int) -> Iterable[List[Dict[str, Any]]]:
    for idx in range(0, len(items), size):
        yield list(items[idx : idx + size])


def execute_or_raise(result: Any, context: str) -> List[Dict[str, Any]]:
    error = getattr(result, "error", None)
    if error:
        raise SyncError(f"{context}: {error}")
    data = getattr(result, "data", None)
    if data is None:
        return []
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return [data]
    return []


def sync_posts(client: Client, rows: List[Dict[str, Any]], batch_size: int) -> Tuple[int, int]:
    if not rows:
        return 0, 0

    upserted = 0
    for chunk in batched(rows, max(batch_size, 1)):
        execute_or_raise(
            client.table("competitor_blog_posts")
            .upsert(chunk, on_conflict="link")
            .execute(),
            "Failed to upsert competitor_blog_posts",
        )
        upserted += len(chunk)

    source_count = len({str(row.get("source_slug") or "") for row in rows})
    return upserted, source_count


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    load_env_file(Path(args.env_file).expanduser().resolve())

    supabase_url = require_env("SUPABASE_URL")
    service_role_key = require_env("SUPABASE_SERVICE_ROLE_KEY")
    client = create_client(supabase_url, service_role_key)

    payload = read_json(Path(args.input).expanduser().resolve())
    raw_items = extract_post_items(payload)

    normalized = [
        row for row in (normalize_post(item) for item in raw_items) if row is not None
    ]
    deduped = dedupe_by_link(normalized)

    if not deduped:
        raise SyncError(
            "No valid blog rows found. Each row must include at least `title` and `link`."
        )

    upserted, source_count = sync_posts(client, deduped, args.batch_size)
    print(
        "Synced competitor blog posts: "
        f"rows={upserted}, sources={source_count}, input={args.input}"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SyncError as exc:
        print(f"Supabase blog sync failed: {exc}", file=sys.stderr)
        print(
            "If the table does not exist yet, apply supabase/sql/005_competitor_blog_posts.sql first.",
            file=sys.stderr,
        )
        raise SystemExit(1)
