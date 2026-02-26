#!/usr/bin/env python3
"""Sync benchmark config + latest run artifacts into Supabase.

Tables expected (created by supabase/sql/001_init_schema.sql):
- prompt_queries
- competitors
- competitor_aliases
- benchmark_runs
- benchmark_responses
- response_mentions
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Sequence, Tuple

from supabase import Client, create_client

ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG_PATH = ROOT_DIR / "config" / "benchmark_config.json"
DEFAULT_OUTPUT_DIR = ROOT_DIR / "output"
BENCHMARK_RESPONSE_OPTIONAL_COLUMNS = {
    "model_run_id",
    "model_index",
    "provider",
    "model_owner",
    "duration_ms",
    "prompt_tokens",
    "completion_tokens",
    "total_tokens",
}
BENCHMARK_RESPONSE_CONFLICT_MODEL_AWARE = "run_id,query_id,run_iteration,model"
BENCHMARK_RESPONSE_CONFLICT_LEGACY = "run_id,query_id,run_iteration"


class SyncError(RuntimeError):
    """Raised when sync fails with a user-actionable message."""


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Push benchmark data into Supabase")
    parser.add_argument(
        "--config",
        default=str(DEFAULT_CONFIG_PATH),
        help="Path to benchmark config JSON",
    )
    parser.add_argument(
        "--output-dir",
        default=str(DEFAULT_OUTPUT_DIR),
        help="Directory with benchmark output artifacts",
    )
    parser.add_argument(
        "--env-file",
        default=str(ROOT_DIR / ".env.monthly"),
        help="Optional env file to load before reading env vars",
    )
    parser.add_argument(
        "--run-month",
        default="",
        help="Override run_month for benchmark_runs row",
    )
    parser.add_argument(
        "--run-id",
        default="",
        help="Optional run id marker to include in benchmark_runs.raw_kpi",
    )
    parser.add_argument(
        "--skip-run",
        action="store_true",
        help="Only sync prompts/competitors/aliases; skip benchmark run rows",
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


def read_json(path: Path) -> Dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        raise SyncError(f"Could not read JSON {path}: {exc}") from exc


def read_csv_rows(path: Path) -> List[Dict[str, str]]:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def read_jsonl_rows(path: Path) -> List[Dict[str, Any]]:
    if not path.exists():
        return []
    rows: List[Dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        payload = line.strip()
        if not payload:
            continue
        try:
            item = json.loads(payload)
        except json.JSONDecodeError:
            continue
        if isinstance(item, dict):
            rows.append(item)
    return rows


def unique_non_empty(values: Iterable[str]) -> List[str]:
    out: List[str] = []
    seen = set()
    for value in values:
        cleaned = str(value).strip()
        if not cleaned:
            continue
        lowered = cleaned.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        out.append(cleaned)
    return out


def infer_prompt_tags(query: str) -> List[str]:
    normalized = query.lower()
    tags: List[str] = []
    if "react" in normalized:
        tags.append("react")
    if "javascript" in normalized or " js " in f" {normalized} ":
        tags.append("javascript")
    if not tags:
        tags.append("generic")
    return tags


def normalize_prompt_tags(raw_tags: Any, query: str) -> List[str]:
    if isinstance(raw_tags, str):
        candidates = raw_tags.split(",")
    elif isinstance(raw_tags, list):
        candidates = [str(item) for item in raw_tags]
    else:
        candidates = []

    normalized = unique_non_empty(value.lower() for value in candidates)
    return normalized if normalized else infer_prompt_tags(query)


def normalize_query_tags(
    queries: List[str],
    raw_query_tags: Dict[str, Any] | None,
) -> Dict[str, List[str]]:
    lookup: Dict[str, Any] = {}
    for query, tags in (raw_query_tags or {}).items():
        lookup[str(query).strip().lower()] = tags

    return {
        query: normalize_prompt_tags(lookup.get(query.strip().lower()), query)
        for query in queries
    }


def extract_missing_column_name(error: Any, table_name: str) -> str | None:
    text = str(error)
    cache_match = re.search(
        rf"Could not find the '([^']+)' column of '{re.escape(table_name)}' in the schema cache",
        text,
    )
    if cache_match:
        return cache_match.group(1)
    relation_match = re.search(
        rf'column "([^"]+)" of relation "{re.escape(table_name)}" does not exist',
        text,
    )
    if relation_match:
        return relation_match.group(1)
    generic_match = re.search(r'column "([^"]+)" does not exist', text)
    if generic_match:
        return generic_match.group(1)
    return None


def is_on_conflict_constraint_error(error: Any) -> bool:
    text = str(error)
    return "42P10" in text or "no unique or exclusion constraint matching" in text.lower()


def slugify(value: str) -> str:
    out = []
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


def as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    text = str(value or "").strip().lower()
    return text in {"1", "true", "yes", "y"}


def as_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:  # noqa: BLE001
        return default


def as_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:  # noqa: BLE001
        return default


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


def upsert_with_optional_columns(
    client: Client,
    table_name: str,
    rows: Sequence[Dict[str, Any]],
    *,
    on_conflict: str,
    optional_columns: set[str],
    context: str,
) -> None:
    if not rows:
        return

    payload = [dict(row) for row in rows]
    skipped_columns: set[str] = set()
    while True:
        try:
            client.table(table_name).upsert(payload, on_conflict=on_conflict).execute()
            return
        except Exception as exc:  # noqa: BLE001
            missing_column = extract_missing_column_name(exc, table_name)
            if (
                missing_column
                and missing_column in optional_columns
                and missing_column not in skipped_columns
            ):
                skipped_columns.add(missing_column)
                for row in payload:
                    row.pop(missing_column, None)
                print(
                    f"Supabase table '{table_name}' missing optional column '{missing_column}'. "
                    "Retrying without it."
                )
                continue
            raise SyncError(f"{context}: {exc}") from exc


def upsert_benchmark_response_chunk(
    client: Client,
    rows: Sequence[Dict[str, Any]],
    *,
    allow_legacy_conflict: bool,
) -> None:
    if not rows:
        return

    payload = [dict(row) for row in rows]
    skipped_columns: set[str] = set()
    conflict_target = BENCHMARK_RESPONSE_CONFLICT_MODEL_AWARE

    while True:
        try:
            client.table("benchmark_responses").upsert(
                payload,
                on_conflict=conflict_target,
            ).execute()
            return
        except Exception as exc:  # noqa: BLE001
            missing_column = extract_missing_column_name(exc, "benchmark_responses")
            if (
                missing_column
                and missing_column in BENCHMARK_RESPONSE_OPTIONAL_COLUMNS
                and missing_column not in skipped_columns
            ):
                skipped_columns.add(missing_column)
                for row in payload:
                    row.pop(missing_column, None)
                print(
                    "Supabase table 'benchmark_responses' missing optional column "
                    f"'{missing_column}'. Retrying without it."
                )
                continue

            if (
                conflict_target == BENCHMARK_RESPONSE_CONFLICT_MODEL_AWARE
                and is_on_conflict_constraint_error(exc)
            ):
                if not allow_legacy_conflict:
                    raise SyncError(
                        "Supabase schema is missing model-aware uniqueness for "
                        "`benchmark_responses` required by multi-model runs. "
                        "Apply supabase/sql/006_benchmark_response_model_metrics.sql "
                        "and rerun."
                    ) from exc
                conflict_target = BENCHMARK_RESPONSE_CONFLICT_LEGACY
                print(
                    "Supabase `benchmark_responses` uses legacy uniqueness; falling back "
                    "to on_conflict='run_id,query_id,run_iteration' for this single-model run."
                )
                continue

            raise SyncError(f"Failed to upsert benchmark_responses rows: {exc}") from exc


def batched(items: Sequence[Dict[str, Any]], size: int) -> Iterable[List[Dict[str, Any]]]:
    for idx in range(0, len(items), size):
        yield list(items[idx : idx + size])


def sync_config(client: Client, config: Dict[str, Any]) -> Tuple[Dict[str, str], Dict[str, str]]:
    queries = unique_non_empty(config.get("queries", []))
    competitors = unique_non_empty(config.get("competitors", []))
    query_tags_raw = config.get("queryTags", {}) if isinstance(config.get("queryTags"), dict) else {}
    query_tags = normalize_query_tags(queries, query_tags_raw)
    alias_map_raw = config.get("aliases", {}) if isinstance(config.get("aliases"), dict) else {}

    if not queries:
        raise SyncError("Config has no queries.")
    if not competitors:
        raise SyncError("Config has no competitors.")
    if not any(name.lower() == "highcharts" for name in competitors):
        raise SyncError('Config competitors must include "Highcharts".')

    query_rows = [
        {
            "query_text": query,
            "sort_order": index + 1,
            "is_active": True,
            "tags": query_tags.get(query) or infer_prompt_tags(query),
        }
        for index, query in enumerate(queries)
    ]
    upsert_with_optional_columns(
        client,
        "prompt_queries",
        query_rows,
        on_conflict="query_text",
        optional_columns={"tags"},
        context="Failed to upsert prompt_queries",
    )

    all_queries = execute_or_raise(
        client.table("prompt_queries").select("id,query_text,is_active").execute(),
        "Failed to read prompt_queries",
    )
    active_queries = {query.lower() for query in queries}
    for row in all_queries:
        current = str(row.get("query_text", ""))
        should_be_active = current.lower() in active_queries
        if bool(row.get("is_active")) != should_be_active:
            execute_or_raise(
                client.table("prompt_queries")
                .update({"is_active": should_be_active})
                .eq("id", row.get("id"))
                .execute(),
                f"Failed to update prompt query active state: {current}",
            )

    competitor_rows = [
        {
            "name": name,
            "slug": slugify(name),
            "is_primary": name.lower() == "highcharts",
            "sort_order": index + 1,
            "is_active": True,
        }
        for index, name in enumerate(competitors)
    ]
    execute_or_raise(
        client.table("competitors").upsert(competitor_rows, on_conflict="slug").execute(),
        "Failed to upsert competitors",
    )

    all_competitors = execute_or_raise(
        client.table("competitors").select("id,name,slug,is_active").execute(),
        "Failed to read competitors",
    )
    active_slugs = {slugify(name) for name in competitors}
    for row in all_competitors:
        current_slug = str(row.get("slug", ""))
        should_be_active = current_slug in active_slugs
        if bool(row.get("is_active")) != should_be_active:
            execute_or_raise(
                client.table("competitors")
                .update({"is_active": should_be_active})
                .eq("id", row.get("id"))
                .execute(),
                f"Failed to update competitor active state: {current_slug}",
            )

    active_competitors = execute_or_raise(
        client.table("competitors")
        .select("id,name,slug")
        .eq("is_active", True)
        .order("sort_order")
        .execute(),
        "Failed to read active competitors",
    )

    competitor_name_to_id = {str(row["name"]): str(row["id"]) for row in active_competitors}
    competitor_slug_to_id = {str(row["slug"]): str(row["id"]) for row in active_competitors}

    for competitor in active_competitors:
        competitor_id = str(competitor["id"])
        competitor_name = str(competitor["name"])

        desired_aliases = unique_non_empty(
            [
                competitor_name,
                *alias_map_raw.get(competitor_name, []),
                *alias_map_raw.get(competitor_name.lower(), []),
            ]
        )

        if desired_aliases:
            execute_or_raise(
                client.table("competitor_aliases")
                .upsert(
                    [
                        {
                            "competitor_id": competitor_id,
                            "alias": alias,
                        }
                        for alias in desired_aliases
                    ],
                    on_conflict="competitor_id,alias",
                )
                .execute(),
                f"Failed to upsert aliases for {competitor_name}",
            )

        existing_alias_rows = execute_or_raise(
            client.table("competitor_aliases")
            .select("alias")
            .eq("competitor_id", competitor_id)
            .execute(),
            f"Failed to read aliases for {competitor_name}",
        )
        existing_aliases = {str(row.get("alias", "")) for row in existing_alias_rows}
        desired_alias_set = {alias for alias in desired_aliases}
        stale_aliases = existing_aliases - desired_alias_set

        for alias in stale_aliases:
            execute_or_raise(
                client.table("competitor_aliases")
                .delete()
                .eq("competitor_id", competitor_id)
                .eq("alias", alias)
                .execute(),
                f"Failed to delete stale alias {alias} for {competitor_name}",
            )

    print(
        f"Synced config tables: prompt_queries={len(queries)}, competitors={len(competitors)}"
    )
    return competitor_name_to_id, competitor_slug_to_id


def sync_run_data(
    client: Client,
    output_dir: Path,
    competitor_slug_to_id: Dict[str, str],
    run_month_override: str,
    run_id_override: str,
) -> None:
    kpi_rows = read_csv_rows(output_dir / "looker_kpi.csv")
    jsonl_rows = read_jsonl_rows(output_dir / "llm_outputs.jsonl")

    if not kpi_rows:
        print("Skipping benchmark_runs sync: output/looker_kpi.csv not found or empty.")
        return

    kpi = kpi_rows[0]
    run_month = run_month_override or str(kpi.get("run_month") or "")
    run_payload = {
        "run_month": run_month,
        "model": str(kpi.get("models") or ""),
        "web_search_enabled": as_bool(kpi.get("web_search_enabled")),
        "started_at": str(kpi.get("window_start_utc") or None),
        "ended_at": str(kpi.get("window_end_utc") or None),
        "overall_score": as_float(kpi.get("ai_visibility_overall_score")),
        "query_count": as_int(kpi.get("queries_count")),
        "competitor_count": len(competitor_slug_to_id),
        "total_responses": len(jsonl_rows),
        "raw_kpi": {**kpi, **({"run_id": run_id_override} if run_id_override else {})},
    }

    run_rows = execute_or_raise(
        client.table("benchmark_runs").insert(run_payload).execute(),
        "Failed to insert benchmark_runs row",
    )
    if not run_rows:
        raise SyncError("benchmark_runs insert returned no row.")
    run_id = str(run_rows[0]["id"])

    prompt_rows = execute_or_raise(
        client.table("prompt_queries")
        .select("id,query_text")
        .eq("is_active", True)
        .execute(),
        "Failed to read active prompt queries",
    )
    query_to_id = {str(row["query_text"]): str(row["id"]) for row in prompt_rows}

    response_payload: List[Dict[str, Any]] = []
    for record in jsonl_rows:
        query = str(record.get("query") or "")
        query_id = query_to_id.get(query)
        if not query_id:
            continue

        response_payload.append(
            {
                "run_id": run_id,
                "query_id": query_id,
                "run_iteration": as_int(record.get("run_id"), 0),
                "model": str(record.get("model") or ""),
                "model_run_id": as_int(record.get("model_run_id"), as_int(record.get("run_id"), 0)),
                "model_index": as_int(record.get("model_index"), 0),
                "provider": str(record.get("provider") or "") or None,
                "model_owner": str(record.get("model_owner") or "") or None,
                "web_search_enabled": as_bool(record.get("web_search_enabled")),
                "duration_ms": as_int(record.get("duration_ms"), 0),
                "prompt_tokens": as_int(record.get("prompt_tokens"), 0),
                "completion_tokens": as_int(record.get("completion_tokens"), 0),
                "total_tokens": as_int(record.get("total_tokens"), 0)
                or (
                    as_int(record.get("prompt_tokens"), 0)
                    + as_int(record.get("completion_tokens"), 0)
                ),
                "response_text": str(record.get("response_text") or ""),
                "citations": record.get("citations") if isinstance(record.get("citations"), list) else [],
                "error": str(record.get("error") or "") or None,
            }
        )

    if response_payload:
        unique_models = {str(row.get("model") or "") for row in response_payload if row.get("model")}
        allow_legacy_conflict = len(unique_models) <= 1
        for chunk in batched(response_payload, 300):
            upsert_benchmark_response_chunk(
                client,
                chunk,
                allow_legacy_conflict=allow_legacy_conflict,
            )

    run_response_rows = execute_or_raise(
        client.table("benchmark_responses")
        .select("id,query_id,run_iteration,model")
        .eq("run_id", run_id)
        .execute(),
        "Failed to read benchmark_responses for mention sync",
    )
    response_key_to_id = {
        (
            str(row["query_id"]),
            as_int(row["run_iteration"], 0),
            str(row.get("model") or ""),
        ): int(row["id"])
        for row in run_response_rows
    }

    mention_payload: List[Dict[str, Any]] = []
    for record in jsonl_rows:
        query = str(record.get("query") or "")
        query_id = query_to_id.get(query)
        if not query_id:
            continue

        run_iteration = as_int(record.get("run_id"), 0)
        model = str(record.get("model") or "")
        response_id = response_key_to_id.get((query_id, run_iteration, model))
        if not response_id:
            continue

        mention_map = record.get("mentions") if isinstance(record.get("mentions"), dict) else {}

        for slug, competitor_id in competitor_slug_to_id.items():
            mention_payload.append(
                {
                    "response_id": response_id,
                    "competitor_id": competitor_id,
                    "mentioned": as_bool(mention_map.get(slug)),
                }
            )

    if mention_payload:
        for chunk in batched(mention_payload, 500):
            execute_or_raise(
                client.table("response_mentions")
                .upsert(chunk, on_conflict="response_id,competitor_id")
                .execute(),
                "Failed to upsert response_mentions rows",
            )

    print(
        "Synced benchmark run data: "
        f"run_id={run_id}, responses={len(response_payload)}, mentions={len(mention_payload)}"
    )


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    env_file = Path(args.env_file).expanduser().resolve()
    load_env_file(env_file)

    supabase_url = require_env("SUPABASE_URL")
    service_role_key = require_env("SUPABASE_SERVICE_ROLE_KEY")

    client = create_client(supabase_url, service_role_key)

    config_path = Path(args.config).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()

    config = read_json(config_path)

    try:
        _name_to_id, slug_to_id = sync_config(client, config)
        if not args.skip_run:
            sync_run_data(client, output_dir, slug_to_id, args.run_month, args.run_id)
    except SyncError as exc:
        print(f"Supabase sync failed: {exc}", file=sys.stderr)
        print(
            "If run tables are missing, apply supabase/sql/001_init_schema.sql first. "
            "If multi-model/token fields fail, also apply "
            "supabase/sql/006_benchmark_response_model_metrics.sql.",
            file=sys.stderr,
        )
        return 1
    except Exception as exc:  # noqa: BLE001
        print(f"Supabase sync failed: {exc}", file=sys.stderr)
        print(
            "Unexpected Supabase API error. Verify credentials and apply the latest schema "
            "migrations, including supabase/sql/006_benchmark_response_model_metrics.sql.",
            file=sys.stderr,
        )
        return 1

    print("Supabase sync complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
