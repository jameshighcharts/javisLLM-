#!/usr/bin/env python3
"""Rebuild legacy Google Sheets CSV exports from a Supabase benchmark run."""

from __future__ import annotations

import argparse
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Sequence

from build_looker_dataset import (
    COMPETITOR_METRIC_FIELDNAMES,
    HIGHCHARTS_KEY,
    KPI_FIELDNAMES,
    LOOKER_BASE_FIELDNAMES,
    build_competitor_metric_rows,
    build_entity_meta,
    build_entity_snapshot_fieldnames,
    build_rows,
    write_csv,
)

ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_ENV_FILE = ROOT_DIR / ".env.monthly"
DEFAULT_OUTPUT_DIR = ROOT_DIR / "output" / "supabase_legacy_dump"
PAGE_SIZE = 1000
LEGACY_V1_DROP_FIELDS = {"model_owners", "model_owner_map"}
LEGACY_V1_LOOKER_FIELDNAMES = [
    field_name
    for field_name in LOOKER_BASE_FIELDNAMES
    if field_name not in LEGACY_V1_DROP_FIELDS
]
LEGACY_V1_COMPETITOR_FIELDNAMES = [
    field_name
    for field_name in COMPETITOR_METRIC_FIELDNAMES
    if field_name not in LEGACY_V1_DROP_FIELDS
]
LEGACY_V1_KPI_FIELDNAMES = [
    "metric_name",
    "ai_visibility_overall_score",
    "score_scale",
    "queries_count",
    "window_start_utc",
    "window_end_utc",
    "models",
    "web_search_enabled",
    "run_month",
    "run_id",
]


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
        os.environ.setdefault(key, value.strip().strip('"').strip("'"))


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export a Supabase run into the legacy Apps Script CSV format."
    )
    parser.add_argument(
        "--run-id",
        default="",
        help="Completed benchmark run UUID. Defaults to the latest completed run.",
    )
    parser.add_argument(
        "--output-dir",
        default=str(DEFAULT_OUTPUT_DIR),
        help="Directory where rebuilt CSVs will be written.",
    )
    parser.add_argument(
        "--env-file",
        default=str(DEFAULT_ENV_FILE),
        help="Optional env file to load before reading Supabase credentials.",
    )
    parser.add_argument(
        "--out-csv",
        default="looker_studio_table_paste.csv",
        help="Legacy main sheet CSV filename.",
    )
    parser.add_argument(
        "--kpi-csv",
        default="looker_kpi.csv",
        help="Legacy KPI CSV filename.",
    )
    parser.add_argument(
        "--competitor-csv",
        default="looker_competitor_chart.csv",
        help="Legacy competitor chart CSV filename.",
    )
    parser.add_argument(
        "--schema-version",
        choices=("legacy_v1", "current"),
        default="legacy_v1",
        help=(
            "Column set to emit. 'legacy_v1' matches the older live Apps Script sheet tabs; "
            "'current' matches the repo's latest CSV schema."
        ),
    )
    return parser.parse_args(argv)


def require_env(name: str) -> str:
    value = str(os.getenv(name, "")).strip()
    if not value:
        raise RuntimeError(f"Missing required env var: {name}")
    return value


def split_csv(value: Any) -> List[str]:
    parts = [part.strip() for part in str(value or "").split(",")]
    return [part for part in parts if part]


def unique_preserve_order(values: Iterable[str]) -> List[str]:
    items: List[str] = []
    seen = set()
    for value in values:
        cleaned = str(value).strip()
        if not cleaned:
            continue
        lowered = cleaned.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        items.append(cleaned)
    return items


def as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"1", "true", "yes", "y"}


def as_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def as_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def parse_citations(value: Any) -> List[Any]:
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return []
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            return []
        return parsed if isinstance(parsed, list) else []
    return []


class SupabaseRestClient:
    def __init__(self, base_url: str, api_key: str):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key

    def _request(self, path: str, params: Dict[str, str]) -> List[Dict[str, Any]]:
        query_string = urllib.parse.urlencode(params)
        url = f"{self.base_url}/rest/v1/{path}?{query_string}"
        request = urllib.request.Request(
            url,
            headers={
                "apikey": self.api_key,
                "Authorization": f"Bearer {self.api_key}",
                "Accept": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Supabase request failed for {path}: HTTP {exc.code}: {detail}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Supabase request failed for {path}: {exc}") from exc

        if not payload:
            return []
        parsed = json.loads(payload)
        if not isinstance(parsed, list):
            raise RuntimeError(f"Expected list payload from {path}, got {type(parsed).__name__}")
        return parsed

    def fetch_all(
        self,
        path: str,
        select: str,
        *,
        filters: Dict[str, str] | None = None,
        order: str | None = None,
        page_size: int = PAGE_SIZE,
    ) -> List[Dict[str, Any]]:
        rows: List[Dict[str, Any]] = []
        offset = 0
        while True:
            params: Dict[str, str] = {
                "select": select,
                "limit": str(page_size),
                "offset": str(offset),
            }
            if filters:
                params.update(filters)
            if order:
                params["order"] = order
            page = self._request(path, params)
            if not page:
                return rows
            rows.extend(page)
            if len(page) < page_size:
                return rows
            offset += len(page)


def fetch_latest_completed_run(client: SupabaseRestClient) -> Dict[str, Any]:
    rows = client.fetch_all(
        "mv_run_summary",
        (
            "run_id,run_month,web_search_enabled,created_at,started_at,ended_at,"
            "input_tokens,output_tokens,total_tokens,total_duration_ms,models_csv,"
            "model_owners_csv,model_owner_map"
        ),
        filters={"ended_at": "not.is.null"},
        order="created_at.desc",
        page_size=1,
    )
    if not rows:
        raise RuntimeError("No completed benchmark runs found in Supabase.")
    return rows[0]


def fetch_run_summary(client: SupabaseRestClient, run_id: str) -> Dict[str, Any]:
    rows = client.fetch_all(
        "mv_run_summary",
        (
            "run_id,run_month,web_search_enabled,created_at,started_at,ended_at,"
            "input_tokens,output_tokens,total_tokens,total_duration_ms,models_csv,"
            "model_owners_csv,model_owner_map"
        ),
        filters={"run_id": f"eq.{run_id}"},
        page_size=1,
    )
    if not rows:
        raise RuntimeError(f"Run not found in mv_run_summary: {run_id}")
    return rows[0]


def fetch_prompt_rows(client: SupabaseRestClient) -> List[Dict[str, Any]]:
    return client.fetch_all(
        "prompt_queries",
        "id,query_text,sort_order",
        filters={"is_active": "eq.true"},
        order="sort_order.asc,query_text.asc",
    )


def fetch_competitor_rows(client: SupabaseRestClient) -> List[Dict[str, Any]]:
    return client.fetch_all(
        "competitors",
        "name,slug,sort_order,is_primary",
        filters={"is_active": "eq.true"},
        order="sort_order.asc,name.asc",
    )


def fetch_model_rows(client: SupabaseRestClient, run_id: str) -> List[Dict[str, Any]]:
    return client.fetch_all(
        "mv_model_performance",
        (
            "run_id,model,owner,response_count,success_count,failure_count,"
            "total_duration_ms,avg_duration_ms,p95_duration_ms,total_input_tokens,"
            "total_output_tokens,total_tokens,avg_input_tokens,avg_output_tokens,"
            "avg_total_tokens"
        ),
        filters={"run_id": f"eq.{run_id}"},
        order="model.asc",
    )


def fetch_mention_rows(client: SupabaseRestClient, run_id: str) -> List[Dict[str, Any]]:
    return client.fetch_all(
        "mv_competitor_mention_rates",
        (
            "run_id,query_id,query_key,query_text,entity,entity_key,is_highcharts,"
            "is_overall_row,response_count,mentions_count,mentions_rate,created_at,"
            "started_at,ended_at,web_search_enabled"
        ),
        filters={"run_id": f"eq.{run_id}"},
        order="is_overall_row.asc,query_text.asc,entity_key.asc",
    )


def fetch_response_rows(client: SupabaseRestClient, run_id: str) -> List[Dict[str, Any]]:
    return client.fetch_all(
        "benchmark_responses",
        "query_id,citations,created_at,error",
        filters={"run_id": f"eq.{run_id}"},
        order="created_at.asc",
    )


def order_entity_keys(
    mention_rows: Sequence[Dict[str, Any]],
    competitor_rows: Sequence[Dict[str, Any]],
) -> List[str]:
    run_keys = unique_preserve_order(
        str(row.get("entity_key") or "").strip() for row in mention_rows
    )
    competitor_order = [
        str(row.get("slug") or "").strip()
        for row in competitor_rows
        if str(row.get("slug") or "").strip() in set(run_keys)
    ]
    remainder = [key for key in run_keys if key not in competitor_order]
    return competitor_order + remainder


def build_labels_by_key(
    ordered_entity_keys: Sequence[str],
    mention_rows: Sequence[Dict[str, Any]],
    competitor_rows: Sequence[Dict[str, Any]],
) -> Dict[str, str]:
    labels: Dict[str, str] = {}
    for row in competitor_rows:
        key = str(row.get("slug") or "").strip()
        label = str(row.get("name") or "").strip()
        if key and label:
            labels[key] = label
    for row in mention_rows:
        key = str(row.get("entity_key") or "").strip()
        label = str(row.get("entity") or "").strip()
        if key and label and key not in labels:
            labels[key] = label
    return {key: labels.get(key, key) for key in ordered_entity_keys}


def build_context(
    run_summary: Dict[str, Any],
    model_rows: Sequence[Dict[str, Any]],
    response_rows: Sequence[Dict[str, Any]],
) -> Dict[str, str]:
    successful_responses = [
        row for row in response_rows if not str(row.get("error") or "").strip()
    ]
    timestamps = [
        str(row.get("created_at") or "").strip()
        for row in successful_responses
        if str(row.get("created_at") or "").strip()
    ]
    timestamps.sort()

    models = unique_preserve_order(
        str(row.get("model") or "").strip() for row in model_rows
    ) or split_csv(run_summary.get("models_csv"))
    owners = unique_preserve_order(
        str(row.get("owner") or "").strip() for row in model_rows
    ) or split_csv(run_summary.get("model_owners_csv"))

    model_stats = [
        {
            "model": str(row.get("model") or ""),
            "owner": str(row.get("owner") or ""),
            "response_count": as_int(row.get("response_count")),
            "error_count": as_int(row.get("failure_count")),
            "total_prompt_tokens": as_int(row.get("total_input_tokens")),
            "total_completion_tokens": as_int(row.get("total_output_tokens")),
            "total_tokens": as_int(row.get("total_tokens")),
            "total_duration_ms": as_int(row.get("total_duration_ms")),
            "avg_duration_ms": round(as_float(row.get("avg_duration_ms")), 2),
            "avg_total_tokens": round(as_float(row.get("avg_total_tokens")), 2),
        }
        for row in model_rows
    ]

    return {
        "window_start_utc": (
            timestamps[0]
            if timestamps
            else str(run_summary.get("started_at") or run_summary.get("created_at") or "")
        ),
        "window_end_utc": (
            timestamps[-1]
            if timestamps
            else str(run_summary.get("ended_at") or run_summary.get("created_at") or "")
        ),
        "models": ";".join(models),
        "model_owners": ";".join(owners),
        "model_owner_map": str(run_summary.get("model_owner_map") or ""),
        "total_prompt_tokens": str(as_int(run_summary.get("input_tokens"))),
        "total_completion_tokens": str(as_int(run_summary.get("output_tokens"))),
        "total_tokens": str(as_int(run_summary.get("total_tokens"))),
        "total_duration_ms": str(as_int(run_summary.get("total_duration_ms"))),
        "model_stats_json": json.dumps(
            model_stats, ensure_ascii=True, separators=(",", ":")
        ),
    }


def build_comparison_rows_from_supabase(
    run_summary: Dict[str, Any],
    mention_rows: Sequence[Dict[str, Any]],
    response_rows: Sequence[Dict[str, Any]],
    prompt_rows: Sequence[Dict[str, Any]],
    ordered_entity_keys: Sequence[str],
) -> List[Dict[str, Any]]:
    per_query_entity: Dict[str, Dict[str, Dict[str, Any]]] = defaultdict(dict)
    query_id_by_key: Dict[str, str] = {}
    query_text_by_key: Dict[str, str] = {}
    overall_entities: Dict[str, Dict[str, Any]] = {}

    for row in mention_rows:
        entity_key = str(row.get("entity_key") or "").strip()
        if not entity_key:
            continue
        if as_bool(row.get("is_overall_row")):
            overall_entities[entity_key] = row
            continue

        query_id = str(row.get("query_id") or "").strip()
        query_text = str(row.get("query_text") or "").strip()
        query_key = query_id or query_text
        if not query_key:
            continue
        query_id_by_key[query_key] = query_id
        query_text_by_key[query_key] = query_text or query_id
        per_query_entity[query_key][entity_key] = row

    successful_responses = [
        row for row in response_rows if not str(row.get("error") or "").strip()
    ]
    citation_count_by_query_id: Dict[str, int] = defaultdict(int)
    overall_citation_count = 0
    for row in successful_responses:
        citations = parse_citations(row.get("citations"))
        citation_count = len(citations)
        overall_citation_count += citation_count
        query_id = str(row.get("query_id") or "").strip()
        if query_id:
            citation_count_by_query_id[query_id] += citation_count

    prompt_order = {
        str(row.get("id") or ""): index for index, row in enumerate(prompt_rows, start=1)
    }
    ordered_query_keys = sorted(
        per_query_entity.keys(),
        key=lambda key: (
            prompt_order.get(query_id_by_key.get(key, ""), 999999),
            query_text_by_key.get(key, key).lower(),
        ),
    )

    competitor_count = len(ordered_entity_keys)
    web_search_enabled = "yes" if as_bool(run_summary.get("web_search_enabled")) else "no"
    comparison_rows: List[Dict[str, Any]] = []

    for query_key in ordered_query_keys:
        entity_rows = per_query_entity[query_key]
        query_text = query_text_by_key.get(query_key, query_key)
        sample_row = next(iter(entity_rows.values()))
        runs = as_int(sample_row.get("response_count"))
        row: Dict[str, Any] = {
            "query": query_text,
            "runs": runs,
            "web_search_enabled": web_search_enabled,
            "citation_count": citation_count_by_query_id.get(
                query_id_by_key.get(query_key, ""),
                0,
            ),
        }

        viability_count = 0
        for entity_key in ordered_entity_keys:
            entity_row = entity_rows.get(entity_key, {})
            mentions_count = as_int(entity_row.get("mentions_count"))
            mentions_rate = round(as_float(entity_row.get("mentions_rate")), 6)
            row[f"{entity_key}_yes"] = "yes" if mentions_count > 0 else "no"
            row[f"{entity_key}_count"] = mentions_count
            row[f"{entity_key}_rate"] = mentions_rate
            viability_count += mentions_count

        row["viability_index_count"] = viability_count
        denom = runs * competitor_count
        row["viability_index_rate"] = round((viability_count / denom), 6) if denom else 0.0
        comparison_rows.append(row)

    overall_runs = 0
    if overall_entities:
        overall_runs = as_int(next(iter(overall_entities.values())).get("response_count"))
    elif comparison_rows:
        overall_runs = sum(as_int(row.get("runs")) for row in comparison_rows)

    overall_row: Dict[str, Any] = {
        "query": "OVERALL",
        "runs": overall_runs,
        "web_search_enabled": web_search_enabled,
        "citation_count": overall_citation_count,
    }
    overall_viability_count = 0
    for entity_key in ordered_entity_keys:
        entity_row = overall_entities.get(entity_key, {})
        mentions_count = as_int(entity_row.get("mentions_count"))
        mentions_rate = round(as_float(entity_row.get("mentions_rate")), 6)
        overall_row[f"{entity_key}_yes"] = "yes" if mentions_count > 0 else "no"
        overall_row[f"{entity_key}_count"] = mentions_count
        overall_row[f"{entity_key}_rate"] = mentions_rate
        overall_viability_count += mentions_count

    overall_row["viability_index_count"] = overall_viability_count
    overall_denom = overall_runs * competitor_count
    overall_row["viability_index_rate"] = (
        round((overall_viability_count / overall_denom), 6) if overall_denom else 0.0
    )
    comparison_rows.append(overall_row)
    return comparison_rows


def build_kpi_row(
    overall_score: float,
    comparison_rows: Sequence[Dict[str, Any]],
    context: Dict[str, str],
    run_month: str,
    run_id: str,
) -> Dict[str, Any]:
    query_rows = [row for row in comparison_rows if row.get("query") != "OVERALL"]
    overall_row = next(
        (row for row in comparison_rows if row.get("query") == "OVERALL"),
        {},
    )
    return {
        "metric_name": "AI Visibility Overall",
        "ai_visibility_overall_score": f"{overall_score:.2f}",
        "score_scale": "0-100",
        "queries_count": str(len(query_rows)),
        "window_start_utc": context["window_start_utc"],
        "window_end_utc": context["window_end_utc"],
        "models": context["models"],
        "model_owners": context.get("model_owners", ""),
        "model_owner_map": context.get("model_owner_map", ""),
        "web_search_enabled": "yes" if as_bool(overall_row.get("web_search_enabled")) else "no",
        "total_prompt_tokens": context.get("total_prompt_tokens", "0"),
        "total_completion_tokens": context.get("total_completion_tokens", "0"),
        "total_tokens": context.get("total_tokens", "0"),
        "total_duration_ms": context.get("total_duration_ms", "0"),
        "model_stats_json": context.get("model_stats_json", "[]"),
        "run_month": run_month,
        "run_id": run_id,
    }


def project_rows(
    rows: Sequence[Dict[str, Any]],
    fieldnames: Sequence[str],
) -> List[Dict[str, Any]]:
    projected: List[Dict[str, Any]] = []
    for row in rows:
        projected.append({field_name: row.get(field_name, "") for field_name in fieldnames})
    return projected


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)

    load_env_file(Path(args.env_file).expanduser().resolve())
    supabase_url = require_env("SUPABASE_URL")
    supabase_key = require_env("SUPABASE_SERVICE_ROLE_KEY")
    client = SupabaseRestClient(supabase_url, supabase_key)

    run_summary = (
        fetch_run_summary(client, args.run_id.strip())
        if args.run_id.strip()
        else fetch_latest_completed_run(client)
    )
    run_id = str(run_summary.get("run_id") or "").strip()
    run_month = str(run_summary.get("run_month") or "").strip()
    if not run_id or not run_month:
        raise RuntimeError("Run summary is missing run_id or run_month.")

    prompt_rows = fetch_prompt_rows(client)
    competitor_rows = fetch_competitor_rows(client)
    model_rows = fetch_model_rows(client, run_id)
    mention_rows = fetch_mention_rows(client, run_id)
    response_rows = fetch_response_rows(client, run_id)

    if not mention_rows:
        raise RuntimeError(f"No mv_competitor_mention_rates rows found for run {run_id}")

    ordered_entity_keys = order_entity_keys(mention_rows, competitor_rows)
    if HIGHCHARTS_KEY not in ordered_entity_keys:
        raise RuntimeError(
            f"Run {run_id} does not include the '{HIGHCHARTS_KEY}' entity required for legacy exports."
        )

    labels_by_key = build_labels_by_key(ordered_entity_keys, mention_rows, competitor_rows)
    entity_meta = build_entity_meta(ordered_entity_keys, labels_by_key)
    context = build_context(run_summary, model_rows, response_rows)
    comparison_rows = build_comparison_rows_from_supabase(
        run_summary=run_summary,
        mention_rows=mention_rows,
        response_rows=response_rows,
        prompt_rows=prompt_rows,
        ordered_entity_keys=ordered_entity_keys,
    )

    looker_rows, overall_score = build_rows(
        comparison_rows=comparison_rows,
        entity_meta=entity_meta,
        context=context,
        run_month=run_month,
        run_id=run_id,
    )
    competitor_metric_rows = build_competitor_metric_rows(
        comparison_rows=comparison_rows,
        entity_meta=entity_meta,
        context=context,
        run_month=run_month,
        run_id=run_id,
    )

    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    looker_path = output_dir / args.out_csv
    kpi_path = output_dir / args.kpi_csv
    competitor_path = output_dir / args.competitor_csv

    if args.schema_version == "current":
        looker_fieldnames = LOOKER_BASE_FIELDNAMES + build_entity_snapshot_fieldnames(
            entity_meta
        )
        competitor_fieldnames = COMPETITOR_METRIC_FIELDNAMES
        kpi_fieldnames = KPI_FIELDNAMES
    else:
        looker_fieldnames = LEGACY_V1_LOOKER_FIELDNAMES + build_entity_snapshot_fieldnames(
            entity_meta
        )
        competitor_fieldnames = LEGACY_V1_COMPETITOR_FIELDNAMES
        kpi_fieldnames = LEGACY_V1_KPI_FIELDNAMES

    write_csv(looker_path, project_rows(looker_rows, looker_fieldnames), looker_fieldnames)
    write_csv(
        kpi_path,
        project_rows(
            [
                build_kpi_row(
                    overall_score=overall_score,
                    comparison_rows=comparison_rows,
                    context=context,
                    run_month=run_month,
                    run_id=run_id,
                )
            ],
            kpi_fieldnames,
        ),
        kpi_fieldnames,
    )
    write_csv(
        competitor_path,
        project_rows(competitor_metric_rows, competitor_fieldnames),
        competitor_fieldnames,
    )

    print(f"schema_version={args.schema_version}")
    print(f"Wrote Looker CSV: {looker_path}")
    print(f"Wrote KPI CSV: {kpi_path}")
    print(f"Wrote competitor chart CSV: {competitor_path}")
    print(f"Rows: {len(looker_rows)}")
    print(f"Competitor metric rows: {len(competitor_metric_rows)}")
    print(f"Entities: {len(entity_meta)}")
    print(f"run_month={run_month}")
    print(f"run_id={run_id}")
    print(f"window_start_utc={context['window_start_utc']}")
    print(f"window_end_utc={context['window_end_utc']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
