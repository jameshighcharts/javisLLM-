#!/usr/bin/env python3
"""Build the canonical Looker Studio dataset CSV from benchmark outputs.

This builder is intentionally dynamic:
- It infers entity keys from `comparison_table.csv`.
- It keeps Highcharts first for chart ordering.
- It keeps the same Looker field schema so dashboards stay stable.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Sequence, Tuple

HIGHCHARTS_KEY = "highcharts"
HIGHCHARTS_COLOR = "#00788c"
COMPETITOR_COLOR_PALETTE = [
    "#0f4c81",
    "#5f0f40",
    "#1282a2",
    "#7f5539",
    "#4361ee",
    "#2a9d8f",
    "#ef476f",
    "#8a5a44",
    "#2b9348",
    "#bc6c25",
]
ENTITY_LABEL_OVERRIDES = {
    "highcharts": "Highcharts",
    "d3_js": "d3.js",
    "chart_js": "chart.js",
    "echarts": "echarts",
    "amcharts": "amcharts",
    "ag_grid": "AG Grid",
    "ag_chart": "AG Chart",
    "recharts": "Recharts",
}

LOOKER_BASE_FIELDNAMES = [
    "query",
    "entity",
    "entity_key",
    "is_highcharts",
    "is_competitor_excl_highcharts",
    "is_overall_row",
    "query_runs",
    "mentions_count",
    "mentions_rate",
    "ai_visibility_query_score",
    "mentioned_yes",
    "query_citation_count",
    "query_viability_raw_count",
    "query_viability_raw_rate",
    "query_viability_excl_highcharts_count",
    "query_viability_excl_highcharts_rate",
    "window_start_utc",
    "window_end_utc",
    "date_dd_mm_yyyy",
    "models",
    "model_owners",
    "model_owner_map",
    "web_search_enabled",
    "highcharts_query_mentions_count",
    "highcharts_query_mentions_rate",
    "h2h_highcharts_share_score",
    "h2h_competitor_share_score",
    "h2h_gap_rate_highcharts_minus_entity",
    "h2h_winner",
    "is_overall_entity_row",
    "entity_chart_sort",
    "entity_color_hex",
    "overall_entity_mentions_count",
    "overall_entity_mention_rate",
    "overall_entity_mention_rate_pct",
    "overall_entity_mention_rate_label",
    "run_month",
    "run_id",
]

KPI_FIELDNAMES = [
    "metric_name",
    "ai_visibility_overall_score",
    "score_scale",
    "queries_count",
    "window_start_utc",
    "window_end_utc",
    "models",
    "model_owners",
    "model_owner_map",
    "web_search_enabled",
    "total_prompt_tokens",
    "total_completion_tokens",
    "total_tokens",
    "total_duration_ms",
    "model_stats_json",
    "run_month",
    "run_id",
]

COMPETITOR_METRIC_FIELDNAMES = [
    "query",
    "entity",
    "entity_key",
    "is_highcharts",
    "is_overall_row",
    "query_runs",
    "mentions_count",
    "mentions_rate",
    "share_of_voice_total_mentions",
    "share_of_voice_rate",
    "share_of_voice_rate_pct",
    "window_start_utc",
    "window_end_utc",
    "date_dd_mm_yyyy",
    "models",
    "model_owners",
    "model_owner_map",
    "web_search_enabled",
    "run_month",
    "run_id",
]

_SPECIAL_COUNT_COLUMNS = {"citation_count", "viability_index_count"}
_UPPERCASE_TOKENS = {"ag", "ai", "api", "llm", "ml", "sql", "ui", "ux"}


@dataclass(frozen=True)
class EntityMeta:
    key: str
    label: str
    sort_order: int
    color_hex: str


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build canonical Looker dataset CSV.")
    parser.add_argument(
        "--output-dir",
        default=str(Path(__file__).resolve().parents[1] / "output"),
        help="Output directory containing benchmark files.",
    )
    parser.add_argument(
        "--comparison-csv",
        default="comparison_table.csv",
        help="Comparison CSV filename inside output dir.",
    )
    parser.add_argument(
        "--viability-csv",
        default="viability_index.csv",
        help="Viability CSV filename inside output dir (used for entity labels).",
    )
    parser.add_argument(
        "--jsonl",
        default="llm_outputs.jsonl",
        help="Raw JSONL filename inside output dir.",
    )
    parser.add_argument(
        "--out-csv",
        default="looker_studio_table_paste.csv",
        help="Destination CSV filename inside output dir.",
    )
    parser.add_argument(
        "--kpi-csv",
        default="looker_kpi.csv",
        help="Destination KPI CSV filename inside output dir.",
    )
    parser.add_argument(
        "--competitor-csv",
        default="looker_competitor_chart.csv",
        help=(
            "Destination competitor chart CSV filename inside output dir. "
            "Contains mention rate + share of voice per entity."
        ),
    )
    parser.add_argument(
        "--run-month",
        default="",
        help="Run month marker YYYY-MM. Defaults to current local month.",
    )
    parser.add_argument(
        "--run-id",
        default="",
        help="Run UUID marker. Defaults to auto-generated UUIDv4.",
    )
    return parser.parse_args(argv)


def to_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def to_int(value: Any) -> int:
    return int(round(to_float(value)))


def normalize_yes_no(value: Any) -> str:
    raw = str(value or "").strip().lower()
    return "yes" if raw in {"yes", "true", "1"} else "no"


def read_csv_rows(path: Path) -> List[Dict[str, str]]:
    with path.open("r", newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def read_jsonl_rows(path: Path) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    if not path.exists():
        return rows
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return rows


def infer_model_owner_from_model(model: str) -> str:
    normalized = model.strip().lower()
    if not normalized:
        return ""
    if normalized.startswith(("gpt", "o1", "o3", "openai/")):
        return "OpenAI"
    if normalized.startswith(("claude", "anthropic/")):
        return "Anthropic"
    if normalized.startswith(("gemini", "google/")):
        return "Google"
    return "Unknown"


def build_model_owner_mapping(rows: Iterable[Dict[str, Any]]) -> Dict[str, str]:
    mapping: Dict[str, str] = {}
    for row in rows:
        model = str(row.get("model") or "").strip()
        if not model:
            continue
        explicit_owner = str(row.get("model_owner") or "").strip()
        owner = explicit_owner or infer_model_owner_from_model(model)
        if not owner:
            continue
        mapping[model] = owner
    return mapping


def extract_context(jsonl_rows: Iterable[Dict[str, Any]]) -> Dict[str, str]:
    normalized_rows = list(jsonl_rows)
    timestamps = sorted(
        str(row.get("timestamp")) for row in normalized_rows if row.get("timestamp")
    )
    models = sorted(
        {
            str(row.get("model")).strip()
            for row in normalized_rows
            if str(row.get("model") or "").strip()
        }
    )
    owner_mapping = build_model_owner_mapping(normalized_rows)
    model_owners = sorted({owner for owner in owner_mapping.values() if owner})
    owner_map_str = ";".join(
        f"{model}=>{owner}" for model, owner in sorted(owner_mapping.items())
    )

    model_stats: List[Dict[str, Any]] = []
    rows_by_model: Dict[str, List[Dict[str, Any]]] = {}
    total_prompt_tokens = 0
    total_completion_tokens = 0
    total_tokens = 0
    total_duration_ms = 0

    for row in normalized_rows:
        model = str(row.get("model") or "").strip()
        if not model:
            continue
        rows_by_model.setdefault(model, []).append(row)
        prompt_tokens = to_int(row.get("prompt_tokens"))
        completion_tokens = to_int(row.get("completion_tokens"))
        call_total_tokens = to_int(row.get("total_tokens")) or (
            prompt_tokens + completion_tokens
        )
        duration_ms = to_int(row.get("duration_ms"))
        total_prompt_tokens += prompt_tokens
        total_completion_tokens += completion_tokens
        total_tokens += call_total_tokens
        total_duration_ms += duration_ms

    for model in sorted(rows_by_model.keys()):
        model_rows = rows_by_model[model]
        response_count = len(model_rows)
        error_count = sum(1 for row in model_rows if str(row.get("error") or "").strip())
        model_prompt_tokens = sum(to_int(row.get("prompt_tokens")) for row in model_rows)
        model_completion_tokens = sum(
            to_int(row.get("completion_tokens")) for row in model_rows
        )
        model_total_tokens = sum(
            to_int(row.get("total_tokens"))
            or (to_int(row.get("prompt_tokens")) + to_int(row.get("completion_tokens")))
            for row in model_rows
        )
        model_total_duration_ms = sum(to_int(row.get("duration_ms")) for row in model_rows)
        model_stats.append(
            {
                "model": model,
                "owner": owner_mapping.get(model, infer_model_owner_from_model(model)),
                "response_count": response_count,
                "error_count": error_count,
                "total_prompt_tokens": model_prompt_tokens,
                "total_completion_tokens": model_completion_tokens,
                "total_tokens": model_total_tokens,
                "total_duration_ms": model_total_duration_ms,
                "avg_duration_ms": round(
                    model_total_duration_ms / response_count, 2
                )
                if response_count
                else 0.0,
                "avg_total_tokens": round(
                    model_total_tokens / response_count, 2
                )
                if response_count
                else 0.0,
            }
        )

    return {
        "window_start_utc": timestamps[0] if timestamps else "",
        "window_end_utc": timestamps[-1] if timestamps else "",
        "models": ";".join(models),
        "model_owners": ";".join(model_owners),
        "model_owner_map": owner_map_str,
        "total_prompt_tokens": str(total_prompt_tokens),
        "total_completion_tokens": str(total_completion_tokens),
        "total_tokens": str(total_tokens),
        "total_duration_ms": str(total_duration_ms),
        "model_stats_json": json.dumps(model_stats, ensure_ascii=True, separators=(",", ":")),
    }


def format_dd_mm_yyyy(iso_datetime: str) -> str:
    if not iso_datetime:
        return ""
    try:
        parsed = datetime.fromisoformat(iso_datetime.replace("Z", "+00:00"))
    except ValueError:
        return ""
    return parsed.strftime("%d/%m/%Y")


def slugify(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")


def infer_entity_keys(comparison_rows: Sequence[Dict[str, str]]) -> List[str]:
    if not comparison_rows:
        return []
    header = list(comparison_rows[0].keys())
    keys: List[str] = []
    seen = set()
    for column in header:
        if not column.endswith("_count"):
            continue
        if column in _SPECIAL_COUNT_COLUMNS:
            continue
        entity_key = column[: -len("_count")]
        if entity_key == "our_brand":
            continue
        if entity_key in seen:
            continue
        seen.add(entity_key)
        keys.append(entity_key)
    return keys


def humanize_entity_key(entity_key: str) -> str:
    if entity_key in ENTITY_LABEL_OVERRIDES:
        return ENTITY_LABEL_OVERRIDES[entity_key]

    suffix_match = re.match(r"^(.*)_(\d+)$", entity_key)
    if suffix_match:
        base_key = suffix_match.group(1)
        suffix = suffix_match.group(2)
        return f"{humanize_entity_key(base_key)} ({suffix})"

    if entity_key.endswith("_js"):
        return f"{entity_key[:-3].replace('_', ' ')}.js"

    parts = []
    for token in entity_key.split("_"):
        if token in _UPPERCASE_TOKENS:
            parts.append(token.upper())
        elif token:
            parts.append(token.capitalize())
    return " ".join(parts) if parts else entity_key


def infer_entity_labels(
    viability_rows: Sequence[Dict[str, str]],
    entity_keys: Sequence[str],
) -> Dict[str, str]:
    entity_set = set(entity_keys)
    labels: Dict[str, str] = {}

    for row in viability_rows:
        entity_label = str(row.get("entity", "")).strip()
        if not entity_label or entity_label.lower() == "our_brand":
            continue
        key = slugify(entity_label)
        if key in entity_set and key not in labels:
            labels[key] = entity_label

    for key in entity_keys:
        if key in labels:
            continue
        base_match = re.match(r"^(.*)_(\d+)$", key)
        if base_match and base_match.group(1) in labels:
            labels[key] = f"{labels[base_match.group(1)]} ({base_match.group(2)})"
            continue
        labels[key] = humanize_entity_key(key)
    return labels


def build_entity_meta(
    entity_keys: Sequence[str],
    labels_by_key: Dict[str, str],
) -> List[EntityMeta]:
    ordered_keys = [key for key in entity_keys if key == HIGHCHARTS_KEY] + [
        key for key in entity_keys if key != HIGHCHARTS_KEY
    ]
    entities: List[EntityMeta] = []
    next_sort = 2
    palette_index = 0

    for key in ordered_keys:
        label = labels_by_key.get(key, humanize_entity_key(key))
        if key == HIGHCHARTS_KEY:
            entities.append(
                EntityMeta(
                    key=key,
                    label=label,
                    sort_order=1,
                    color_hex=HIGHCHARTS_COLOR,
                )
            )
        else:
            color = COMPETITOR_COLOR_PALETTE[
                palette_index % len(COMPETITOR_COLOR_PALETTE)
            ]
            entities.append(
                EntityMeta(
                    key=key,
                    label=label,
                    sort_order=next_sort,
                    color_hex=color,
                )
            )
            palette_index += 1
            next_sort += 1
    return entities


def compute_ai_visibility_score_100(
    query_row: Dict[str, str],
    highcharts_key: str,
    competitor_keys: Sequence[str],
) -> float:
    runs = to_float(query_row.get("runs"))
    highcharts_count = to_float(query_row.get(f"{highcharts_key}_count"))
    presence = (highcharts_count / runs) if runs else 0.0

    competitor_sum = sum(
        to_float(query_row.get(f"{key}_count")) for key in competitor_keys
    )
    denom = highcharts_count + competitor_sum
    share_of_voice = (highcharts_count / denom) if denom else 0.0
    return round((0.7 * presence + 0.3 * share_of_voice) * 100, 2)


def compute_excl_viability(
    query_row: Dict[str, str],
    competitor_keys: Sequence[str],
) -> Tuple[int, float]:
    runs = to_int(query_row.get("runs"))
    competitor_sum = sum(
        to_int(query_row.get(f"{key}_count")) for key in competitor_keys
    )
    denom = runs * len(competitor_keys)
    rate = round((competitor_sum / denom), 6) if denom else 0.0
    return competitor_sum, rate


def h2h_values(
    highcharts_count: int,
    highcharts_rate: float,
    entity_key: str,
    entity_count: int,
    entity_rate: float,
) -> Dict[str, Any]:
    if entity_key == HIGHCHARTS_KEY:
        return {
            "h2h_highcharts_share_score": 100.0,
            "h2h_competitor_share_score": 0.0,
            "h2h_gap_rate_highcharts_minus_entity": 0.0,
            "h2h_winner": "highcharts",
        }

    denom = highcharts_count + entity_count
    if denom:
        highcharts_share = round((highcharts_count / denom) * 100.0, 2)
        competitor_share = round((entity_count / denom) * 100.0, 2)
    else:
        highcharts_share = 0.0
        competitor_share = 0.0

    gap = round(highcharts_rate - entity_rate, 4)
    if highcharts_count > entity_count:
        winner = "highcharts"
    elif entity_count > highcharts_count:
        winner = "competitor"
    else:
        winner = "tie"

    return {
        "h2h_highcharts_share_score": highcharts_share,
        "h2h_competitor_share_score": competitor_share,
        "h2h_gap_rate_highcharts_minus_entity": gap,
        "h2h_winner": winner,
    }


def build_rows(
    comparison_rows: List[Dict[str, str]],
    entity_meta: Sequence[EntityMeta],
    context: Dict[str, str],
    run_month: str,
    run_id: str,
) -> Tuple[List[Dict[str, Any]], float]:
    query_rows = [row for row in comparison_rows if row.get("query") != "OVERALL"]
    overall_row = next(
        (row for row in comparison_rows if row.get("query") == "OVERALL"), None
    )
    if not overall_row:
        raise RuntimeError("comparison_table.csv must include an OVERALL row.")

    meta_by_key = {item.key: item for item in entity_meta}
    competitor_keys = [item.key for item in entity_meta if item.key != HIGHCHARTS_KEY]

    overall_entity: Dict[str, Dict[str, Any]] = {}
    for item in entity_meta:
        rate = to_float(overall_row.get(f"{item.key}_rate"))
        count = to_int(overall_row.get(f"{item.key}_count"))
        overall_entity[item.key] = {
            "entity": item.label,
            "entity_key": item.key,
            "entity_chart_sort": item.sort_order,
            "entity_color_hex": item.color_hex,
            "overall_entity_mentions_count": count,
            "overall_entity_mention_rate": round(rate, 6),
            "overall_entity_mention_rate_pct": round(rate * 100.0, 2),
            "overall_entity_mention_rate_label": f"{round(rate * 100.0):.0f}%",
        }

    query_scores = {
        row["query"]: compute_ai_visibility_score_100(
            query_row=row,
            highcharts_key=HIGHCHARTS_KEY,
            competitor_keys=competitor_keys,
        )
        for row in query_rows
    }
    overall_score = (
        round(sum(query_scores.values()) / len(query_scores), 2) if query_scores else 0.0
    )

    all_rows: List[Dict[str, Any]] = []
    for query_row in query_rows:
        query = query_row["query"]
        runs = to_int(query_row.get("runs"))
        web_search_enabled = normalize_yes_no(query_row.get("web_search_enabled"))
        highcharts_count = to_int(query_row.get(f"{HIGHCHARTS_KEY}_count"))
        highcharts_rate = to_float(query_row.get(f"{HIGHCHARTS_KEY}_rate"))
        excl_count, excl_rate = compute_excl_viability(
            query_row=query_row,
            competitor_keys=competitor_keys,
        )

        for item in entity_meta:
            entity_info = overall_entity[item.key]
            entity_count = to_int(query_row.get(f"{item.key}_count"))
            entity_rate = to_float(query_row.get(f"{item.key}_rate"))
            mentioned_yes_value = query_row.get(f"{item.key}_yes")
            if mentioned_yes_value in (None, ""):
                mentioned_yes = "yes" if entity_count > 0 else "no"
            else:
                mentioned_yes = normalize_yes_no(mentioned_yes_value)

            h2h = h2h_values(
                highcharts_count=highcharts_count,
                highcharts_rate=highcharts_rate,
                entity_key=item.key,
                entity_count=entity_count,
                entity_rate=entity_rate,
            )

            row = {
                "query": query,
                "entity": entity_info["entity"],
                "entity_key": item.key,
                "is_highcharts": "yes" if item.key == HIGHCHARTS_KEY else "no",
                "is_competitor_excl_highcharts": (
                    "no" if item.key == HIGHCHARTS_KEY else "yes"
                ),
                "is_overall_row": "no",
                "query_runs": runs,
                "mentions_count": entity_count,
                "mentions_rate": round(entity_rate, 6),
                "ai_visibility_query_score": f"{query_scores.get(query, 0.0):.2f}",
                "mentioned_yes": mentioned_yes,
                "query_citation_count": to_int(query_row.get("citation_count")),
                "query_viability_raw_count": to_int(
                    query_row.get("viability_index_count")
                ),
                "query_viability_raw_rate": round(
                    to_float(query_row.get("viability_index_rate")), 6
                ),
                "query_viability_excl_highcharts_count": excl_count,
                "query_viability_excl_highcharts_rate": excl_rate,
                "window_start_utc": context["window_start_utc"],
                "window_end_utc": context["window_end_utc"],
                "date_dd_mm_yyyy": format_dd_mm_yyyy(context["window_end_utc"]),
                "models": context["models"],
                "model_owners": context.get("model_owners", ""),
                "model_owner_map": context.get("model_owner_map", ""),
                "web_search_enabled": web_search_enabled,
                "highcharts_query_mentions_count": highcharts_count,
                "highcharts_query_mentions_rate": round(highcharts_rate, 6),
                "h2h_highcharts_share_score": h2h["h2h_highcharts_share_score"],
                "h2h_competitor_share_score": h2h["h2h_competitor_share_score"],
                "h2h_gap_rate_highcharts_minus_entity": h2h[
                    "h2h_gap_rate_highcharts_minus_entity"
                ],
                "h2h_winner": h2h["h2h_winner"],
                "is_overall_entity_row": "no",
                "entity_chart_sort": entity_info["entity_chart_sort"],
                "entity_color_hex": entity_info["entity_color_hex"],
                "overall_entity_mentions_count": entity_info[
                    "overall_entity_mentions_count"
                ],
                "overall_entity_mention_rate": entity_info[
                    "overall_entity_mention_rate"
                ],
                "overall_entity_mention_rate_pct": entity_info[
                    "overall_entity_mention_rate_pct"
                ],
                "overall_entity_mention_rate_label": entity_info[
                    "overall_entity_mention_rate_label"
                ],
                "run_month": run_month,
                "run_id": run_id,
            }
            add_entity_snapshot_fields(
                row=row,
                source_row=query_row,
                entity_meta=entity_meta,
            )
            all_rows.append(row)

    # Add one OVERALL row per entity for simple chart filtering in Looker.
    overall_runs = to_int(overall_row.get("runs"))
    overall_highcharts_count = to_int(overall_row.get(f"{HIGHCHARTS_KEY}_count"))
    overall_highcharts_rate = to_float(overall_row.get(f"{HIGHCHARTS_KEY}_rate"))
    excl_count, excl_rate = compute_excl_viability(
        query_row=overall_row,
        competitor_keys=competitor_keys,
    )
    overall_web = normalize_yes_no(overall_row.get("web_search_enabled"))

    for item in entity_meta:
        entity_info = overall_entity[item.key]
        entity_count = entity_info["overall_entity_mentions_count"]
        entity_rate = entity_info["overall_entity_mention_rate"]
        h2h = h2h_values(
            highcharts_count=overall_highcharts_count,
            highcharts_rate=overall_highcharts_rate,
            entity_key=item.key,
            entity_count=entity_count,
            entity_rate=entity_rate,
        )

        row = {
            "query": "OVERALL",
            "entity": entity_info["entity"],
            "entity_key": item.key,
            "is_highcharts": "yes" if item.key == HIGHCHARTS_KEY else "no",
            "is_competitor_excl_highcharts": (
                "no" if item.key == HIGHCHARTS_KEY else "yes"
            ),
            "is_overall_row": "yes",
            "query_runs": overall_runs,
            "mentions_count": entity_count,
            "mentions_rate": round(entity_rate, 6),
            "ai_visibility_query_score": f"{overall_score:.2f}",
            "mentioned_yes": "yes" if entity_count > 0 else "no",
            "query_citation_count": to_int(overall_row.get("citation_count")),
            "query_viability_raw_count": to_int(overall_row.get("viability_index_count")),
            "query_viability_raw_rate": round(
                to_float(overall_row.get("viability_index_rate")), 6
            ),
            "query_viability_excl_highcharts_count": excl_count,
            "query_viability_excl_highcharts_rate": excl_rate,
            "window_start_utc": context["window_start_utc"],
            "window_end_utc": context["window_end_utc"],
            "date_dd_mm_yyyy": format_dd_mm_yyyy(context["window_end_utc"]),
            "models": context["models"],
            "model_owners": context.get("model_owners", ""),
            "model_owner_map": context.get("model_owner_map", ""),
            "web_search_enabled": overall_web,
            "highcharts_query_mentions_count": overall_highcharts_count,
            "highcharts_query_mentions_rate": round(overall_highcharts_rate, 6),
            "h2h_highcharts_share_score": h2h["h2h_highcharts_share_score"],
            "h2h_competitor_share_score": h2h["h2h_competitor_share_score"],
            "h2h_gap_rate_highcharts_minus_entity": h2h[
                "h2h_gap_rate_highcharts_minus_entity"
            ],
            "h2h_winner": h2h["h2h_winner"],
            "is_overall_entity_row": "yes",
            "entity_chart_sort": entity_info["entity_chart_sort"],
            "entity_color_hex": entity_info["entity_color_hex"],
            "overall_entity_mentions_count": entity_info["overall_entity_mentions_count"],
            "overall_entity_mention_rate": entity_info["overall_entity_mention_rate"],
            "overall_entity_mention_rate_pct": entity_info[
                "overall_entity_mention_rate_pct"
            ],
            "overall_entity_mention_rate_label": entity_info[
                "overall_entity_mention_rate_label"
            ],
            "run_month": run_month,
            "run_id": run_id,
        }
        add_entity_snapshot_fields(
            row=row,
            source_row=overall_row,
            entity_meta=entity_meta,
        )
        all_rows.append(row)

    query_order = {
        row["query"]: index for index, row in enumerate(query_rows, start=1)
    }
    query_order["OVERALL"] = len(query_order) + 1
    all_rows.sort(
        key=lambda row: (
            query_order.get(str(row.get("query")), 999),
            to_int(row.get("entity_chart_sort")),
            str(row.get("entity")),
        )
    )
    return all_rows, overall_score


def build_entity_snapshot_fieldnames(entity_meta: Sequence[EntityMeta]) -> List[str]:
    fields: List[str] = []
    existing = set(LOOKER_BASE_FIELDNAMES)
    for item in entity_meta:
        key = item.key
        for field_name in (
            f"{key}_query_mentions_count",
            f"{key}_query_mentions_rate",
            f"{key}_query_mentioned_yes",
        ):
            if field_name in existing:
                continue
            existing.add(field_name)
            fields.append(field_name)
    return fields


def add_entity_snapshot_fields(
    row: Dict[str, Any],
    source_row: Dict[str, str],
    entity_meta: Sequence[EntityMeta],
) -> None:
    for item in entity_meta:
        key = item.key
        count = to_int(source_row.get(f"{key}_count"))
        rate = round(to_float(source_row.get(f"{key}_rate")), 6)
        yes_value = source_row.get(f"{key}_yes")
        if yes_value in (None, ""):
            yes = "yes" if count > 0 else "no"
        else:
            yes = normalize_yes_no(yes_value)

        row[f"{key}_query_mentions_count"] = count
        row[f"{key}_query_mentions_rate"] = rate
        row[f"{key}_query_mentioned_yes"] = yes


def write_csv(path: Path, rows: List[Dict[str, Any]], fieldnames: Sequence[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def write_kpi_csv(
    path: Path,
    overall_score: float,
    comparison_rows: List[Dict[str, str]],
    context: Dict[str, str],
    run_month: str,
    run_id: str,
) -> None:
    query_rows = [row for row in comparison_rows if row.get("query") != "OVERALL"]
    overall_row = next((row for row in comparison_rows if row.get("query") == "OVERALL"), {})
    row = {
        "metric_name": "AI Visibility Overall",
        "ai_visibility_overall_score": f"{overall_score:.2f}",
        "score_scale": "0-100",
        "queries_count": str(len(query_rows)),
        "window_start_utc": context["window_start_utc"],
        "window_end_utc": context["window_end_utc"],
        "models": context["models"],
        "model_owners": context.get("model_owners", ""),
        "model_owner_map": context.get("model_owner_map", ""),
        "web_search_enabled": normalize_yes_no(overall_row.get("web_search_enabled")),
        "total_prompt_tokens": context.get("total_prompt_tokens", "0"),
        "total_completion_tokens": context.get("total_completion_tokens", "0"),
        "total_tokens": context.get("total_tokens", "0"),
        "total_duration_ms": context.get("total_duration_ms", "0"),
        "model_stats_json": context.get("model_stats_json", "[]"),
        "run_month": run_month,
        "run_id": run_id,
    }
    write_csv(path, [row], KPI_FIELDNAMES)


def build_competitor_metric_rows(
    comparison_rows: List[Dict[str, str]],
    entity_meta: Sequence[EntityMeta],
    context: Dict[str, str],
    run_month: str,
    run_id: str,
) -> List[Dict[str, Any]]:
    query_order = {
        row.get("query", ""): index for index, row in enumerate(comparison_rows, start=1)
    }
    rows: List[Dict[str, Any]] = []

    for query_row in comparison_rows:
        query = str(query_row.get("query", ""))
        runs = to_int(query_row.get("runs"))
        web_search_enabled = normalize_yes_no(query_row.get("web_search_enabled"))
        is_overall = "yes" if query == "OVERALL" else "no"

        total_mentions = sum(
            to_int(query_row.get(f"{item.key}_count")) for item in entity_meta
        )

        for item in entity_meta:
            mentions_count = to_int(query_row.get(f"{item.key}_count"))
            mentions_rate = round(to_float(query_row.get(f"{item.key}_rate")), 6)
            share_of_voice_rate = (
                round((mentions_count / total_mentions), 6) if total_mentions else 0.0
            )
            row = {
                "query": query,
                "entity": item.label,
                "entity_key": item.key,
                "is_highcharts": "yes" if item.key == HIGHCHARTS_KEY else "no",
                "is_overall_row": is_overall,
                "query_runs": runs,
                "mentions_count": mentions_count,
                "mentions_rate": mentions_rate,
                "share_of_voice_total_mentions": total_mentions,
                "share_of_voice_rate": share_of_voice_rate,
                "share_of_voice_rate_pct": round(share_of_voice_rate * 100.0, 2),
                "window_start_utc": context["window_start_utc"],
                "window_end_utc": context["window_end_utc"],
                "date_dd_mm_yyyy": format_dd_mm_yyyy(context["window_end_utc"]),
                "models": context["models"],
                "model_owners": context.get("model_owners", ""),
                "model_owner_map": context.get("model_owner_map", ""),
                "web_search_enabled": web_search_enabled,
                "run_month": run_month,
                "run_id": run_id,
            }
            rows.append(row)

    rows.sort(
        key=lambda row: (
            query_order.get(str(row.get("query")), 999),
            next(
                (
                    item.sort_order
                    for item in entity_meta
                    if item.key == str(row.get("entity_key"))
                ),
                999,
            ),
            str(row.get("entity")),
        )
    )
    return rows


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)

    output_dir = Path(args.output_dir).expanduser().resolve()
    comparison_path = output_dir / args.comparison_csv
    viability_path = output_dir / args.viability_csv
    jsonl_path = output_dir / args.jsonl
    out_csv_path = output_dir / args.out_csv
    kpi_csv_path = output_dir / args.kpi_csv
    competitor_csv_path = output_dir / args.competitor_csv

    if not comparison_path.exists():
        raise FileNotFoundError(f"Missing comparison CSV: {comparison_path}")

    comparison_rows = read_csv_rows(comparison_path)
    if not comparison_rows:
        raise RuntimeError("comparison_table.csv is empty.")

    entity_keys = infer_entity_keys(comparison_rows)
    if not entity_keys:
        raise RuntimeError("No entity *_count columns were found in comparison_table.csv.")
    if HIGHCHARTS_KEY not in entity_keys:
        raise RuntimeError(
            "comparison_table.csv is missing highcharts columns. "
            "Keep Highcharts in COMPETITORS so AI visibility metrics remain valid."
        )

    viability_rows = read_csv_rows(viability_path) if viability_path.exists() else []
    labels_by_key = infer_entity_labels(viability_rows, entity_keys)
    entity_meta = build_entity_meta(entity_keys, labels_by_key)

    jsonl_rows = read_jsonl_rows(jsonl_path)
    context = extract_context(jsonl_rows)
    run_month = args.run_month.strip() or datetime.now().strftime("%Y-%m")
    run_id = args.run_id.strip() or str(uuid.uuid4())

    rows, overall_score = build_rows(
        comparison_rows=comparison_rows,
        entity_meta=entity_meta,
        context=context,
        run_month=run_month,
        run_id=run_id,
    )
    looker_fieldnames = LOOKER_BASE_FIELDNAMES + build_entity_snapshot_fieldnames(
        entity_meta
    )
    write_csv(out_csv_path, rows, looker_fieldnames)
    write_kpi_csv(
        path=kpi_csv_path,
        overall_score=overall_score,
        comparison_rows=comparison_rows,
        context=context,
        run_month=run_month,
        run_id=run_id,
    )
    competitor_rows = build_competitor_metric_rows(
        comparison_rows=comparison_rows,
        entity_meta=entity_meta,
        context=context,
        run_month=run_month,
        run_id=run_id,
    )
    write_csv(competitor_csv_path, competitor_rows, COMPETITOR_METRIC_FIELDNAMES)

    print(f"Wrote Looker CSV: {out_csv_path}")
    print(f"Wrote KPI CSV: {kpi_csv_path}")
    print(f"Wrote competitor chart CSV: {competitor_csv_path}")
    print(f"Rows: {len(rows)}")
    print(f"Competitor metric rows: {len(competitor_rows)}")
    print(f"Entities: {len(entity_meta)}")
    print(f"run_month={run_month}")
    print(f"run_id={run_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
