#!/usr/bin/env python3
"""Embed benchmark output data into dashboard.html as a single shareable HTML."""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Any, Dict, List


ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent
DEFAULT_TEMPLATE = ROOT / "dashboard.html"
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "output"
DEFAULT_EXPORT = PROJECT_ROOT / "output" / "dashboard_standalone.html"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build a standalone dashboard HTML with embedded benchmark data."
    )
    parser.add_argument(
        "--template",
        default=str(DEFAULT_TEMPLATE),
        help="Path to dashboard template HTML.",
    )
    parser.add_argument(
        "--output-dir",
        default=str(DEFAULT_OUTPUT_DIR),
        help="Directory containing comparison_table.csv, viability_index.csv, llm_outputs.jsonl.",
    )
    parser.add_argument(
        "--export",
        default=str(DEFAULT_EXPORT),
        help="Output standalone HTML path.",
    )
    return parser.parse_args()


def read_csv_rows(path: Path) -> List[Dict[str, str]]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def normalize_web_search_flag(value: Any) -> str:
    if isinstance(value, bool):
        return "yes" if value else "no"
    raw = str(value or "").strip().lower()
    if raw in {"1", "true", "yes"}:
        return "yes"
    if raw in {"0", "false", "no"}:
        return "no"
    return raw


def read_jsonl_rows(path: Path) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                raw = json.loads(line)
            except json.JSONDecodeError:
                continue
            citations = raw.get("citations")
            citation_count = len(citations) if isinstance(citations, list) else 0
            rows.append(
                {
                    "timestamp": raw.get("timestamp"),
                    "model": raw.get("model"),
                    "query": raw.get("query"),
                    "run_id": raw.get("run_id"),
                    "web_search_enabled": normalize_web_search_flag(
                        raw.get("web_search_enabled")
                    ),
                    "citation_count": citation_count,
                    "error": raw.get("error"),
                }
            )
    return rows


def build_payload(output_dir: Path) -> Dict[str, Any]:
    comparison_path = output_dir / "comparison_table.csv"
    viability_path = output_dir / "viability_index.csv"
    jsonl_path = output_dir / "llm_outputs.jsonl"

    missing = [
        str(path)
        for path in (comparison_path, viability_path, jsonl_path)
        if not path.exists()
    ]
    if missing:
        missing_text = "\n".join(missing)
        raise FileNotFoundError(f"Missing required output files:\n{missing_text}")

    comparison_rows = read_csv_rows(comparison_path)
    viability_rows = read_csv_rows(viability_path)
    jsonl_rows = read_jsonl_rows(jsonl_path)

    return {
        "comparisonRows": comparison_rows,
        "viabilityRows": viability_rows,
        "jsonlRows": jsonl_rows,
    }


def embed_data(template_text: str, payload: Dict[str, Any]) -> str:
    marker = "  <script>\n    const ENTITY_LABELS = {"
    if marker not in template_text:
        raise ValueError("Could not find dashboard script marker in template HTML.")

    payload_text = json.dumps(payload, ensure_ascii=True).replace("</", "<\\/")
    inject = (
        "  <script>\n"
        f"    window.__EMBEDDED_BENCHMARK_DATA__ = {payload_text};\n"
        "  </script>\n\n"
        "  <script>\n"
        "    const ENTITY_LABELS = {"
    )
    return template_text.replace(marker, inject, 1)


def main() -> int:
    args = parse_args()
    template_path = Path(args.template).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()
    export_path = Path(args.export).expanduser().resolve()

    if not template_path.exists():
        raise FileNotFoundError(f"Template file not found: {template_path}")

    payload = build_payload(output_dir)
    template_text = template_path.read_text(encoding="utf-8")
    standalone_html = embed_data(template_text, payload)

    export_path.write_text(standalone_html, encoding="utf-8")
    print(f"Wrote standalone dashboard: {export_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
