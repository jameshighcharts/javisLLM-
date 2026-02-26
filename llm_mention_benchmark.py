#!/usr/bin/env python3
"""Benchmark mention presence of brand and competitors in LLM outputs."""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Sequence

DEFAULT_OUTPUT_DIR = Path(__file__).resolve().parent / "output"
DEFAULT_CONFIG_PATH = (
    Path(__file__).resolve().parent / "config" / "benchmark_config.json"
)
DEFAULT_QUERIES = [
    "javascript charting libraries",
    "data visualization library",
    "React graph visualization library",
    "accessibility charting library"
]
COMPETITORS = [
    "d3.js",
    "Highcharts",
    "chart.js",
    "echarts",
    "amcharts",
    "AG Grid",
    "AG Chart",
    "Recharts",
]
COMPETITOR_ALIASES: Dict[str, List[str]] = {
    "d3.js": ["d3.js", "d3 js", "d3js", "d3"],
    "Highcharts": ["highcharts"],
    "chart.js": ["chart.js", "chart js", "chartjs"],
    "echarts": ["echarts", "e charts", "e-charts"],
    "amcharts": ["amcharts", "am charts", "am-charts"],
    "AG Grid": ["ag grid", "ag-grid"],
    "AG Chart": ["ag chart", "ag charts", "ag-chart", "ag-charts"],
    "Recharts": ["recharts", "re charts", "re-charts"],
}
SYSTEM_PROMPT = (
    "You are a helpful assistant. Answer with concise bullets and include direct library names."
)
USER_PROMPT_TEMPLATE = (
    "Query: {query}\n"
    "List relevant libraries/tools with a short rationale for each in bullet points."
)
MAX_ATTEMPTS = 3
BACKOFF_BASE_SECONDS = 1.0
GEMINI_GENERATE_CONTENT_API_ROOT = (
    "https://generativelanguage.googleapis.com/v1beta/models"
)
MODEL_OWNER_BY_PROVIDER = {
    "openai": "OpenAI",
    "anthropic": "Anthropic",
    "google": "Google",
}


@dataclass(frozen=True)
class EntitySpec:
    key: str
    label: str
    aliases: List[str]
    is_competitor: bool


class ProviderRequestError(RuntimeError):
    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class GeminiRestClient:
    def __init__(self, api_key: str) -> None:
        self.api_key = api_key

    def generate_content(
        self,
        *,
        model: str,
        system_prompt: str,
        user_prompt: str,
        temperature: float,
    ) -> Dict[str, Any]:
        model_path = urllib.parse.quote(model, safe="")
        endpoint = (
            f"{GEMINI_GENERATE_CONTENT_API_ROOT}/{model_path}:generateContent"
            f"?key={urllib.parse.quote(self.api_key, safe='')}"
        )
        payload = {
            "systemInstruction": {"parts": [{"text": system_prompt}]},
            "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
            "generationConfig": {"temperature": temperature},
        }
        request = urllib.request.Request(
            endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                raw = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            status_code = int(getattr(exc, "code", 0) or 0)
            raw_error = ""
            try:
                raw_error = exc.read().decode("utf-8")
            except Exception:  # noqa: BLE001
                raw_error = ""
            message = f"Gemini request failed ({status_code})."
            try:
                parsed = json.loads(raw_error) if raw_error else {}
                if isinstance(parsed, dict):
                    candidate_message = parsed.get("error", {}).get("message")
                    if isinstance(candidate_message, str) and candidate_message.strip():
                        message = candidate_message.strip()
            except json.JSONDecodeError:
                pass
            raise ProviderRequestError(message, status_code=status_code) from exc
        except urllib.error.URLError as exc:
            raise ProviderRequestError(
                f"Gemini request failed: {exc}",
                status_code=None,
            ) from exc

        if not raw.strip():
            return {}
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ProviderRequestError("Gemini returned invalid JSON.") from exc
        if not isinstance(parsed, dict):
            return {}
        return parsed


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Benchmark mention presence for your brand and competitor libraries "
            "across fixed queries."
        )
    )
    parser.add_argument(
        "--our-terms",
        required=True,
        help='Comma-separated brand terms, e.g. "EasyLLM, Easy LLM Benchmarker".',
    )
    parser.add_argument(
        "--model",
        default="gpt-4o-mini",
        help=(
            "LLM model name, or a comma-separated model list. "
            "Example: gpt-4o-mini,claude-sonnet-4-5-20250929"
        ),
    )
    parser.add_argument(
        "--runs", type=int, default=3, help="Responses per query (default: 3)."
    )
    parser.add_argument(
        "--temperature",
        type=float,
        default=0.7,
        help="Sampling temperature for generation (default: 0.7).",
    )
    parser.add_argument(
        "--web-search",
        action="store_true",
        help="Enable OpenAI web search tool for each response.",
    )
    parser.add_argument(
        "--api-key-env",
        default="",
        help=(
            "Optional environment variable override for API key lookup. "
            'Defaults to provider-specific vars ("OPENAI_API_KEY", '
            '"ANTHROPIC_API_KEY", or "GEMINI_API_KEY").'
        ),
    )
    parser.add_argument(
        "--output-dir",
        default=str(DEFAULT_OUTPUT_DIR),
        help="Output directory for CSV and JSONL files.",
    )
    parser.add_argument(
        "--config",
        default=str(DEFAULT_CONFIG_PATH),
        help=(
            "Path to JSON config file with queries/competitors/aliases. "
            "Defaults to config/benchmark_config.json."
        ),
    )
    parser.add_argument(
        "--prompt-limit",
        type=int,
        default=0,
        help=(
            "Optional limit on number of prompts (queries) to run, in config order. "
            "0 means run all prompts."
        ),
    )
    return parser.parse_args(argv)


def parse_csv_terms(raw_terms: str) -> List[str]:
    terms: List[str] = []
    for item in raw_terms.split(","):
        value = item.strip()
        if value and value not in terms:
            terms.append(value)
    return terms


def parse_model_names(raw_models: str) -> List[str]:
    parsed = dedupe_preserve_order(raw_models.split(","))
    return parsed if parsed else ["gpt-4o-mini"]


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")
    return slug or "entity"


def dedupe_preserve_order(items: Iterable[str]) -> List[str]:
    seen = set()
    output = []
    for item in items:
        normalized = item.strip()
        if not normalized:
            continue
        key = normalized.lower()
        if key in seen:
            continue
        seen.add(key)
        output.append(normalized)
    return output


def normalize_competitor_names(competitors: Iterable[str]) -> List[str]:
    normalized: List[str] = []
    seen = set()
    for raw in competitors:
        value = str(raw).strip()
        if not value:
            continue
        lowered = value.lower()
        canonical = "Highcharts" if lowered == "highcharts" else value
        if lowered in seen:
            continue
        seen.add(lowered)
        normalized.append(canonical)

    if "highcharts" not in seen:
        normalized.insert(0, "Highcharts")
    return normalized


def normalize_alias_map(raw_aliases: Any) -> Dict[str, List[str]]:
    if raw_aliases is None:
        return {}
    if not isinstance(raw_aliases, dict):
        raise RuntimeError('"aliases" must be an object mapping names to alias lists.')

    normalized: Dict[str, List[str]] = {}
    for raw_name, raw_values in raw_aliases.items():
        name = str(raw_name).strip()
        if not name:
            continue
        values: List[str]
        if isinstance(raw_values, str):
            values = [raw_values]
        elif isinstance(raw_values, list):
            values = [str(item) for item in raw_values]
        else:
            raise RuntimeError(
                f'Aliases for "{name}" must be a string or a list of strings.'
            )

        cleaned = dedupe_preserve_order(values)
        if cleaned:
            normalized[name.lower()] = cleaned
    return normalized


def load_benchmark_config(
    config_path_raw: str,
) -> tuple[List[str], List[str], Dict[str, List[str]], str]:
    queries = list(DEFAULT_QUERIES)
    competitors = list(COMPETITORS)
    aliases = {key.lower(): list(values) for key, values in COMPETITOR_ALIASES.items()}
    source = "built-in defaults"

    if not config_path_raw:
        return queries, normalize_competitor_names(competitors), aliases, source

    config_path = Path(config_path_raw).expanduser().resolve()
    if not config_path.exists():
        if config_path == DEFAULT_CONFIG_PATH:
            return queries, normalize_competitor_names(competitors), aliases, source
        raise FileNotFoundError(f"Config file not found: {config_path}")

    try:
        raw_config = json.loads(config_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid JSON in config file: {config_path}") from exc

    if not isinstance(raw_config, dict):
        raise RuntimeError("Config root must be a JSON object.")

    if "queries" in raw_config:
        raw_queries = raw_config.get("queries")
        if not isinstance(raw_queries, list):
            raise RuntimeError('"queries" must be a JSON array.')
        parsed_queries = dedupe_preserve_order(str(item) for item in raw_queries)
        if not parsed_queries:
            raise RuntimeError('"queries" cannot be empty.')
        queries = parsed_queries

    if "competitors" in raw_config:
        raw_competitors = raw_config.get("competitors")
        if not isinstance(raw_competitors, list):
            raise RuntimeError('"competitors" must be a JSON array.')
        parsed_competitors = normalize_competitor_names(raw_competitors)
        if not parsed_competitors:
            raise RuntimeError('"competitors" cannot be empty.')
        competitors = parsed_competitors
    else:
        competitors = normalize_competitor_names(competitors)

    if "aliases" in raw_config:
        aliases.update(normalize_alias_map(raw_config.get("aliases")))

    source = str(config_path)
    return queries, competitors, aliases, source


def build_entity_specs(
    our_terms: List[str],
    competitors: Sequence[str] | None = None,
    competitor_aliases: Dict[str, List[str]] | None = None,
) -> List[EntitySpec]:
    active_competitors = normalize_competitor_names(
        competitors if competitors is not None else COMPETITORS
    )
    active_aliases = normalize_alias_map(
        competitor_aliases if competitor_aliases is not None else COMPETITOR_ALIASES
    )

    specs = [
        EntitySpec(
            key="our_brand",
            label="our_brand",
            aliases=dedupe_preserve_order(our_terms),
            is_competitor=False,
        )
    ]
    used_keys = {"our_brand"}
    for competitor in active_competitors:
        base_key = slugify(competitor)
        key = base_key
        suffix = 2
        while key in used_keys:
            key = f"{base_key}_{suffix}"
            suffix += 1
        used_keys.add(key)
        aliases = dedupe_preserve_order(
            [competitor] + active_aliases.get(competitor.lower(), [])
        )
        specs.append(
            EntitySpec(
                key=key,
                label=competitor,
                aliases=aliases,
                is_competitor=True,
            )
        )
    return specs


def alias_to_pattern(alias: str) -> re.Pattern[str]:
    escaped_chunks = [re.escape(chunk) for chunk in alias.split()]
    body = r"\s+".join(escaped_chunks)
    return re.compile(rf"(?<![A-Za-z0-9]){body}(?![A-Za-z0-9])", re.IGNORECASE)


def compile_entity_patterns(specs: Sequence[EntitySpec]) -> Dict[str, List[re.Pattern[str]]]:
    compiled: Dict[str, List[re.Pattern[str]]] = {}
    for spec in specs:
        compiled[spec.key] = [alias_to_pattern(alias) for alias in spec.aliases]
    return compiled


def detect_mentions(
    text: str, compiled_patterns: Dict[str, List[re.Pattern[str]]]
) -> Dict[str, bool]:
    mentions: Dict[str, bool] = {}
    for key, patterns in compiled_patterns.items():
        mentions[key] = any(pattern.search(text) for pattern in patterns)
    return mentions


def create_openai_client(api_key: str) -> Any:
    try:
        from openai import OpenAI  # type: ignore
    except ImportError as exc:
        raise RuntimeError(
            'Missing dependency "openai". Install with: pip3 install openai'
        ) from exc
    return OpenAI(api_key=api_key)


def create_anthropic_client(api_key: str) -> Any:
    try:
        from anthropic import Anthropic  # type: ignore
    except ImportError as exc:
        raise RuntimeError(
            'Missing dependency "anthropic". Install with: pip3 install anthropic'
        ) from exc
    return Anthropic(api_key=api_key)


def create_gemini_client(api_key: str) -> Any:
    return GeminiRestClient(api_key=api_key)


def infer_provider_from_model(model: str) -> str:
    normalized = str(model).strip().lower()
    if normalized.startswith("claude") or normalized.startswith("anthropic/"):
        return "anthropic"
    if normalized.startswith("gemini") or normalized.startswith("google/"):
        return "google"
    return "openai"


def resolve_api_key_env(provider: str, api_key_env_override: str) -> str:
    override = str(api_key_env_override or "").strip()
    if override:
        return override
    if provider == "anthropic":
        return "ANTHROPIC_API_KEY"
    if provider == "google":
        return "GEMINI_API_KEY"
    return "OPENAI_API_KEY"


def create_llm_client(provider: str, api_key: str) -> Any:
    if provider == "anthropic":
        return create_anthropic_client(api_key)
    if provider == "google":
        return create_gemini_client(api_key)
    return create_openai_client(api_key)


def infer_model_owner(provider: str) -> str:
    return MODEL_OWNER_BY_PROVIDER.get(provider, "Unknown")


def normalize_api_key(raw_value: str | None) -> str:
    value = (raw_value or "").strip()
    # Guard against accidental quote wrapping in CI secrets.
    if len(value) >= 2 and (
        (value.startswith('"') and value.endswith('"'))
        or (value.startswith("'") and value.endswith("'"))
    ):
        value = value[1:-1].strip()
    return value


def is_transient_error(exc: Exception) -> bool:
    class_name = exc.__class__.__name__.lower()
    if any(
        token in class_name
        for token in (
            "ratelimit",
            "timeout",
            "connection",
            "internalserver",
            "serviceunavailable",
        )
    ):
        return True

    status_code = getattr(exc, "status_code", None)
    if isinstance(status_code, int) and (status_code == 429 or status_code >= 500):
        return True

    response = getattr(exc, "response", None)
    response_status = getattr(response, "status_code", None)
    if isinstance(response_status, int) and (
        response_status == 429 or response_status >= 500
    ):
        return True

    message = str(exc).lower()
    return any(
        token in message
        for token in (
            "rate limit",
            "timed out",
            "timeout",
            "connection",
            "temporarily unavailable",
            "server error",
            "status code: 429",
            "status code: 500",
            "status code: 502",
            "status code: 503",
            "status code: 504",
        )
    )


def to_plain_dict(response_obj: Any) -> Dict[str, Any]:
    if isinstance(response_obj, dict):
        return response_obj
    if hasattr(response_obj, "model_dump"):
        model_dump = getattr(response_obj, "model_dump")
        try:
            data = model_dump(mode="python")
        except TypeError:
            data = model_dump()
        if isinstance(data, dict):
            return data
    if hasattr(response_obj, "to_dict"):
        data = response_obj.to_dict()
        if isinstance(data, dict):
            return data
    if hasattr(response_obj, "__dict__"):
        data = response_obj.__dict__
        if isinstance(data, dict):
            return data
    return {}


def extract_response_text(response_obj: Any, response_dict: Dict[str, Any]) -> str:
    output_text = response_dict.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text.strip()

    attr_text = getattr(response_obj, "output_text", None)
    if isinstance(attr_text, str) and attr_text.strip():
        return attr_text.strip()

    texts: List[str] = []
    output_items = response_dict.get("output", [])
    if isinstance(output_items, list):
        for item in output_items:
            if not isinstance(item, dict):
                continue
            content_items = item.get("content", [])
            if not isinstance(content_items, list):
                continue
            for content in content_items:
                if not isinstance(content, dict):
                    continue
                text = content.get("text")
                if isinstance(text, str) and text.strip():
                    texts.append(text.strip())

    content_items = response_dict.get("content", [])
    if isinstance(content_items, list):
        for content in content_items:
            if not isinstance(content, dict):
                continue
            text = content.get("text")
            if isinstance(text, str) and text.strip():
                texts.append(text.strip())

    # Gemini responses usually return candidates[].content.parts[].text
    candidates = response_dict.get("candidates", [])
    if isinstance(candidates, list):
        for candidate in candidates:
            if not isinstance(candidate, dict):
                continue
            content = candidate.get("content", {})
            if not isinstance(content, dict):
                continue
            parts = content.get("parts", [])
            if not isinstance(parts, list):
                continue
            for part in parts:
                if not isinstance(part, dict):
                    continue
                text = part.get("text")
                if isinstance(text, str) and text.strip():
                    texts.append(text.strip())

    return "\n".join(texts).strip()


def extract_citations(response_dict: Dict[str, Any]) -> List[Dict[str, str]]:
    citations: List[Dict[str, str]] = []
    seen = set()

    def append(raw: Dict[str, Any]) -> None:
        url = raw.get("url") or raw.get("uri")
        if not isinstance(url, str) or not url.strip():
            return
        title = raw.get("title") or raw.get("source") or ""
        snippet = raw.get("snippet") or raw.get("text") or ""
        entry = {
            "title": str(title).strip(),
            "url": url.strip(),
            "snippet": str(snippet).strip(),
        }
        dedupe_key = (entry["url"], entry["title"], entry["snippet"])
        if dedupe_key in seen:
            return
        seen.add(dedupe_key)
        citations.append(entry)

    for key in ("citations", "sources", "references"):
        value = response_dict.get(key)
        if isinstance(value, list):
            for candidate in value:
                if isinstance(candidate, dict):
                    append(candidate)

    output_items = response_dict.get("output", [])
    if isinstance(output_items, list):
        for item in output_items:
            if not isinstance(item, dict):
                continue
            content_items = item.get("content", [])
            if not isinstance(content_items, list):
                continue
            for content in content_items:
                if not isinstance(content, dict):
                    continue
                content_citations = content.get("citations")
                if isinstance(content_citations, list):
                    for candidate in content_citations:
                        if isinstance(candidate, dict):
                            append(candidate)
                annotations = content.get("annotations")
                if not isinstance(annotations, list):
                    continue
                for annotation in annotations:
                    if not isinstance(annotation, dict):
                        continue
                    if "citation" in str(annotation.get("type", "")).lower():
                        append(annotation)
                    nested = annotation.get("url_citation")
                    if isinstance(nested, dict):
                        append(nested)

    content_items = response_dict.get("content", [])
    if isinstance(content_items, list):
        for content in content_items:
            if not isinstance(content, dict):
                continue
            content_citations = content.get("citations")
            if isinstance(content_citations, list):
                for candidate in content_citations:
                    if isinstance(candidate, dict):
                        append(candidate)

    candidates = response_dict.get("candidates", [])
    if isinstance(candidates, list):
        for candidate in candidates:
            if not isinstance(candidate, dict):
                continue
            grounding = candidate.get("groundingMetadata", {})
            if not isinstance(grounding, dict):
                continue
            chunks = grounding.get("groundingChunks", [])
            if isinstance(chunks, list):
                for chunk in chunks:
                    if not isinstance(chunk, dict):
                        continue
                    web = chunk.get("web")
                    if isinstance(web, dict):
                        append(web)
                    append(chunk)
            citation_metadata = grounding.get("citationMetadata", {})
            if isinstance(citation_metadata, dict):
                sources = citation_metadata.get("citationSources", [])
                if isinstance(sources, list):
                    for source in sources:
                        if isinstance(source, dict):
                            append(source)

    return citations


def to_non_negative_int(value: Any) -> int:
    try:
        parsed = int(float(value))
    except (TypeError, ValueError):
        return 0
    return parsed if parsed > 0 else 0


def extract_token_usage(response_dict: Dict[str, Any]) -> Dict[str, int]:
    usage = response_dict.get("usage", {})
    prompt_tokens = 0
    completion_tokens = 0
    total_tokens = 0

    if isinstance(usage, dict):
        prompt_tokens = to_non_negative_int(
            usage.get("input_tokens", usage.get("prompt_tokens"))
        )
        completion_tokens = to_non_negative_int(
            usage.get("output_tokens", usage.get("completion_tokens"))
        )
        total_tokens = to_non_negative_int(usage.get("total_tokens"))

    usage_metadata = response_dict.get("usageMetadata", {})
    if isinstance(usage_metadata, dict):
        prompt_tokens = max(
            prompt_tokens,
            to_non_negative_int(
                usage_metadata.get("promptTokenCount", usage_metadata.get("prompt_tokens"))
            ),
        )
        completion_tokens = max(
            completion_tokens,
            to_non_negative_int(
                usage_metadata.get(
                    "candidatesTokenCount",
                    usage_metadata.get("completion_tokens"),
                )
            ),
        )
        total_tokens = max(
            total_tokens,
            to_non_negative_int(
                usage_metadata.get("totalTokenCount", usage_metadata.get("total_tokens"))
            ),
        )

    if total_tokens <= 0:
        total_tokens = prompt_tokens + completion_tokens

    return {
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": total_tokens,
    }


def generate_with_optional_retry(
    client: Any,
    provider: str,
    model: str,
    query: str,
    temperature: float,
    web_search: bool,
) -> tuple[str, List[Dict[str, str]], Dict[str, int]]:
    user_prompt = USER_PROMPT_TEMPLATE.format(query=query)
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            if provider == "anthropic":
                response_obj = client.messages.create(
                    model=model,
                    temperature=temperature,
                    max_tokens=1024,
                    system=SYSTEM_PROMPT,
                    messages=[
                        {
                            "role": "user",
                            "content": user_prompt,
                        }
                    ],
                )
            elif provider == "google":
                response_obj = client.generate_content(
                    model=model,
                    system_prompt=SYSTEM_PROMPT,
                    user_prompt=user_prompt,
                    temperature=temperature,
                )
            else:
                payload: Dict[str, Any] = {
                    "model": model,
                    "temperature": temperature,
                    "input": [
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": user_prompt},
                    ],
                }
                if web_search:
                    payload["tools"] = [{"type": "web_search_preview"}]
                response_obj = client.responses.create(**payload)
            response_dict = to_plain_dict(response_obj)
            text = extract_response_text(response_obj, response_dict)
            citations = extract_citations(response_dict)
            usage = extract_token_usage(response_dict)
            return text, citations, usage
        except Exception as exc:  # noqa: BLE001
            retry = attempt < MAX_ATTEMPTS and is_transient_error(exc)
            if not retry:
                raise
            sleep_seconds = BACKOFF_BASE_SECONDS * (2 ** (attempt - 1))
            time.sleep(sleep_seconds)

    raise RuntimeError("Retries exhausted unexpectedly")


def reset_jsonl(path: Path) -> None:
    path.write_text("", encoding="utf-8")


def append_jsonl(path: Path, record: Dict[str, Any]) -> None:
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=True) + "\n")


def build_comparison_rows(
    records: Sequence[Dict[str, Any]],
    specs: Sequence[EntitySpec],
    queries: Sequence[str],
    runs_per_query: int,
    web_search_enabled: bool,
) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    competitor_keys = [spec.key for spec in specs if spec.is_competitor]

    def summarize(query_name: str, subset: Sequence[Dict[str, Any]], runs: int) -> Dict[str, Any]:
        row: Dict[str, Any] = {
            "query": query_name,
            "runs": runs,
            "web_search_enabled": "yes" if web_search_enabled else "no",
        }
        citation_count = sum(len(item.get("citations", [])) for item in subset)
        row["citation_count"] = citation_count

        viability_count = 0
        for spec in specs:
            count = sum(
                1
                for item in subset
                if bool(item.get("mentions", {}).get(spec.key, False))
            )
            row[f"{spec.key}_yes"] = "yes" if count > 0 else "no"
            row[f"{spec.key}_count"] = count
            row[f"{spec.key}_rate"] = round((count / runs), 4) if runs else 0.0
            if spec.key in competitor_keys:
                viability_count += count

        row["viability_index_count"] = viability_count
        viability_denom = runs * len(competitor_keys)
        row["viability_index_rate"] = (
            round((viability_count / viability_denom), 4) if viability_denom else 0.0
        )
        return row

    for query in queries:
        query_records = [record for record in records if record.get("query") == query]
        rows.append(summarize(query, query_records, runs_per_query))

    overall_runs = runs_per_query * len(queries)
    rows.append(summarize("OVERALL", records, overall_runs))
    return rows


def build_viability_rows(
    records: Sequence[Dict[str, Any]],
    specs: Sequence[EntitySpec],
    queries: Sequence[str],
    runs_per_query: int,
) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []

    def summarize(query_name: str, subset: Sequence[Dict[str, Any]], runs: int) -> None:
        for spec in specs:
            count = sum(
                1
                for item in subset
                if bool(item.get("mentions", {}).get(spec.key, False))
            )
            rate = round((count / runs), 4) if runs else 0.0
            rows.append(
                {
                    "query": query_name,
                    "entity": spec.label if spec.key != "our_brand" else "our_brand",
                    "mentions_count": count,
                    "mentions_rate": rate,
                    "mentioned_yes": "yes" if count > 0 else "no",
                }
            )

    for query in queries:
        query_records = [record for record in records if record.get("query") == query]
        summarize(query, query_records, runs_per_query)

    overall_runs = runs_per_query * len(queries)
    summarize("OVERALL", records, overall_runs)
    return rows


def write_csv(path: Path, rows: Sequence[Dict[str, Any]], fieldnames: Sequence[str]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def run_benchmark(args: argparse.Namespace, client: Any | None = None) -> int:
    if args.runs < 1:
        print("--runs must be >= 1", file=sys.stderr)
        return 2
    if args.prompt_limit < 0:
        print("--prompt-limit must be >= 0", file=sys.stderr)
        return 2

    selected_models = parse_model_names(str(args.model or ""))
    providers_by_model = {
        model_name: infer_provider_from_model(model_name)
        for model_name in selected_models
    }
    providers = sorted(set(providers_by_model.values()))

    if client is not None and len(providers) > 1:
        print(
            "Custom test client injection only supports single-provider runs.",
            file=sys.stderr,
        )
        return 2

    provider_clients: Dict[str, Any] = {}
    provider_model_owner: Dict[str, str] = {}
    for provider in providers:
        api_key_env = resolve_api_key_env(provider, args.api_key_env)
        api_key = normalize_api_key(os.getenv(api_key_env))
        if not api_key:
            print(
                f'Missing API key env var "{api_key_env}" for provider "{provider}". '
                "Set it and rerun.",
                file=sys.stderr,
            )
            return 2

        provider_clients[provider] = (
            client if client is not None else create_llm_client(provider, api_key)
        )
        provider_model_owner[provider] = infer_model_owner(provider)

    our_terms = parse_csv_terms(args.our_terms)
    if not our_terms:
        print("--our-terms must include at least one non-empty term", file=sys.stderr)
        return 2

    try:
        queries, competitors, alias_map, config_source = load_benchmark_config(
            args.config
        )
    except Exception as exc:  # noqa: BLE001
        print(f"Config error: {exc}", file=sys.stderr)
        return 2
    total_config_queries = len(queries)
    if args.prompt_limit > 0:
        queries = queries[: args.prompt_limit]
        print(
            f"Prompt limit enabled: running {len(queries)}/{total_config_queries} prompts."
        )

    specs = build_entity_specs(
        our_terms=our_terms,
        competitors=competitors,
        competitor_aliases=alias_map,
    )
    compiled_patterns = compile_entity_patterns(specs)

    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    jsonl_path = output_dir / "llm_outputs.jsonl"
    comparison_path = output_dir / "comparison_table.csv"
    viability_path = output_dir / "viability_index.csv"
    reset_jsonl(jsonl_path)

    if args.web_search:
        non_openai_models = [
            model_name
            for model_name in selected_models
            if providers_by_model.get(model_name) != "openai"
        ]
        if non_openai_models:
            model_list = ", ".join(non_openai_models)
            print(
                "Warning: --web-search is currently only applied to OpenAI models. "
                f"Running these models without web-search tool support: {model_list}",
                file=sys.stderr,
            )

    effective_runs_per_query = args.runs * len(selected_models)
    if effective_runs_per_query <= 0:
        print("No model runs resolved. Provide at least one model.", file=sys.stderr)
        return 2

    records: List[Dict[str, Any]] = []
    successful_calls = 0
    total_calls = len(queries) * effective_runs_per_query

    for query in queries:
        for model_index, model_name in enumerate(selected_models):
            provider = providers_by_model[model_name]
            llm_client = provider_clients[provider]
            model_owner = provider_model_owner[provider]
            effective_web_search = args.web_search if provider == "openai" else False

            for model_run_idx in range(1, args.runs + 1):
                run_iteration = (model_index * args.runs) + model_run_idx
                timestamp = datetime.now(timezone.utc).isoformat()
                response_text = ""
                citations: List[Dict[str, str]] = []
                token_usage = {
                    "prompt_tokens": 0,
                    "completion_tokens": 0,
                    "total_tokens": 0,
                }
                error = None
                started_at = time.perf_counter()
                try:
                    response_text, citations, token_usage = generate_with_optional_retry(
                        client=llm_client,
                        provider=provider,
                        model=model_name,
                        query=query,
                        temperature=args.temperature,
                        web_search=effective_web_search,
                    )
                    successful_calls += 1
                except Exception as exc:  # noqa: BLE001
                    error = f"{exc.__class__.__name__}: {exc}"

                duration_ms = int(round((time.perf_counter() - started_at) * 1000))
                mentions = detect_mentions(response_text, compiled_patterns)
                record = {
                    "timestamp": timestamp,
                    "model": model_name,
                    "provider": provider,
                    "model_owner": model_owner,
                    "query": query,
                    "run_id": run_iteration,
                    "model_run_id": model_run_idx,
                    "model_index": model_index + 1,
                    "web_search_enabled": effective_web_search,
                    "duration_ms": duration_ms,
                    "prompt_tokens": token_usage["prompt_tokens"],
                    "completion_tokens": token_usage["completion_tokens"],
                    "total_tokens": token_usage["total_tokens"],
                    "response_text": response_text,
                    "citations": citations,
                    "error": error,
                    "mentions": mentions,
                }
                append_jsonl(jsonl_path, record)
                records.append(record)

    comparison_rows = build_comparison_rows(
        records=records,
        specs=specs,
        queries=queries,
        runs_per_query=effective_runs_per_query,
        web_search_enabled=args.web_search,
    )
    comparison_fields = ["query", "runs", "web_search_enabled"]
    for spec in specs:
        comparison_fields.append(f"{spec.key}_yes")
        comparison_fields.append(f"{spec.key}_count")
        comparison_fields.append(f"{spec.key}_rate")
    comparison_fields.extend(
        ["citation_count", "viability_index_count", "viability_index_rate"]
    )
    write_csv(comparison_path, comparison_rows, comparison_fields)

    viability_rows = build_viability_rows(
        records=records,
        specs=specs,
        queries=queries,
        runs_per_query=effective_runs_per_query,
    )
    write_csv(
        viability_path,
        viability_rows,
        ["query", "entity", "mentions_count", "mentions_rate", "mentioned_yes"],
    )

    failed_calls = total_calls - successful_calls
    print(f"Wrote JSONL: {jsonl_path}")
    print(f"Wrote comparison CSV: {comparison_path}")
    print(f"Wrote viability CSV: {viability_path}")
    print(
        f"Config source: {config_source} "
        f"(queries={len(queries)}/{total_config_queries}, competitors={len(competitors)})"
    )
    print(f"Models: {', '.join(selected_models)}")
    print(f"Successful calls: {successful_calls}/{total_calls}")
    if failed_calls:
        print(f"Failed calls: {failed_calls}/{total_calls}", file=sys.stderr)
        error_messages = [
            str(record.get("error") or "").strip()
            for record in records
            if record.get("error")
        ]
        if error_messages:
            print("Top API errors:", file=sys.stderr)
            for message, count in Counter(error_messages).most_common(3):
                print(f"- {count}x {message}", file=sys.stderr)
            all_connection_errors = all(
                "connection error" in message.lower()
                or "apiconnectionerror" in message.lower()
                for message in error_messages
            )
            if all_connection_errors:
                error_providers = sorted(
                    {
                        str(record.get("provider") or "").strip().lower()
                        for record in records
                        if record.get("error")
                    }
                )
                if len(error_providers) == 1:
                    provider = error_providers[0]
                    if provider == "anthropic":
                        print(
                            "Hint: all calls failed with connection errors. "
                            "Verify ANTHROPIC_API_KEY in GitHub Secrets has no quotes/newlines, "
                            "and that the runner can reach api.anthropic.com.",
                            file=sys.stderr,
                        )
                    elif provider == "google":
                        print(
                            "Hint: all calls failed with connection errors. "
                            "Verify GEMINI_API_KEY in GitHub Secrets has no quotes/newlines, "
                            "and that the runner can reach generativelanguage.googleapis.com.",
                            file=sys.stderr,
                        )
                    else:
                        print(
                            "Hint: all calls failed with connection errors. "
                            "Verify OPENAI_API_KEY in GitHub Secrets has no quotes/newlines, "
                            "and that the runner can reach api.openai.com.",
                            file=sys.stderr,
                        )
                else:
                    print(
                        "Hint: all calls failed with connection errors across multiple providers. "
                        "Verify API keys and outbound network access for each provider endpoint.",
                        file=sys.stderr,
                    )

    return 0 if successful_calls > 0 else 1


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    return run_benchmark(args)


if __name__ == "__main__":
    raise SystemExit(main())
