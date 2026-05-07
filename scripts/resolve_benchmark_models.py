#!/usr/bin/env python3
"""Resolve benchmark model slots into concrete provider model IDs."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CATALOG_PATH = REPO_ROOT / "config" / "benchmark" / "models.json"
OPENAI_MODELS_URL = "https://api.openai.com/v1/models"
OPENAI_RESPONSES_API_URL = "https://api.openai.com/v1/responses"
ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models?limit=1000"
ANTHROPIC_MESSAGES_API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"
GEMINI_MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/models"
REQUEST_TIMEOUT_SECONDS = 10
SMOKE_TEST_PROMPT = "Reply with OK."

LEGACY_ALIASES = {
    "claude-3-5-sonnet-latest": "anthropic:sonnet:latest",
    "claude-4-6-sonnet-latest": "anthropic:sonnet:latest",
    "claude-4-6-opus-latest": "anthropic:opus:latest",
    "gemini-3.0-flash": "google:flash:latest",
}


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Resolve configured benchmark model aliases to model IDs."
    )
    parser.add_argument(
        "--config",
        default=os.environ.get("BENCHMARK_MODEL_CATALOG_PATH", str(DEFAULT_CATALOG_PATH)),
        help="Path to benchmark model catalog JSON.",
    )
    parser.add_argument(
        "--models",
        default="",
        help="Optional comma-separated model list. Defaults to catalog defaults.",
    )
    parser.add_argument(
        "--set",
        choices=("default", "all"),
        default="default",
        help="Catalog model set to resolve when --models is not provided.",
    )
    parser.add_argument(
        "--format",
        choices=("csv", "json"),
        default="csv",
        help="Output format.",
    )
    parser.add_argument(
        "--no-live",
        action="store_true",
        help="Do not call provider model APIs; use catalog fallbacks for latest slots.",
    )
    parser.add_argument(
        "--no-smoke-test",
        action="store_true",
        help="List live models but skip the tiny provider request that verifies API usability.",
    )
    return parser.parse_args(argv)


def load_catalog(path_raw: str) -> dict[str, Any]:
    path = Path(path_raw).expanduser().resolve()
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise RuntimeError(f"Model catalog not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid model catalog JSON: {path}") from exc
    if not isinstance(parsed, dict) or not isinstance(parsed.get("models"), list):
        raise RuntimeError("Model catalog must be an object with a models array.")
    return parsed


def clean(value: Any) -> str:
    return str(value or "").strip()


def dedupe_preserve_order(values: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for value in values:
        normalized = clean(value)
        if not normalized:
            continue
        key = normalized.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(normalized)
    return out


def parse_csv(value: str) -> list[str]:
    return [entry.strip() for entry in value.split(",") if entry.strip()]


def catalog_entries(catalog: dict[str, Any]) -> list[dict[str, Any]]:
    entries = []
    for entry in catalog.get("models", []):
        if isinstance(entry, dict) and entry.get("enabled") is not False:
            entries.append(entry)
    return entries


def build_alias_map(catalog: dict[str, Any]) -> dict[str, str]:
    aliases = dict(LEGACY_ALIASES)
    for entry in catalog_entries(catalog):
        entry_id = clean(entry.get("id"))
        if not entry_id:
            continue
        for alias in entry.get("aliases") or []:
            alias_key = clean(alias).lower()
            if alias_key:
                aliases[alias_key] = entry_id
    return aliases


def normalize_alias(model_id: str, catalog: dict[str, Any]) -> str:
    normalized = clean(model_id)
    if not normalized:
        return ""
    return build_alias_map(catalog).get(normalized.lower(), normalized)


def default_model_ids(catalog: dict[str, Any]) -> list[str]:
    entry_ids = {clean(entry.get("id")).lower() for entry in catalog_entries(catalog)}
    configured = [
        clean(model_id)
        for model_id in catalog.get("defaultModelIds", [])
        if clean(model_id).lower() in entry_ids
    ]
    if configured:
        return dedupe_preserve_order(configured)
    return dedupe_preserve_order(
        [
            clean(entry.get("id"))
            for entry in catalog_entries(catalog)
            if entry.get("includeByDefault") is not False
        ]
    )


def all_model_ids(catalog: dict[str, Any]) -> list[str]:
    return dedupe_preserve_order([clean(entry.get("id")) for entry in catalog_entries(catalog)])


def request_json(
    url: str,
    headers: dict[str, str] | None = None,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    request_headers = dict(headers or {})
    data = None
    method = "GET"
    if payload is not None:
        method = "POST"
        request_headers.setdefault("Content-Type", "application/json")
        data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers=request_headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        raw_error = ""
        try:
            raw_error = exc.read().decode("utf-8")
        except Exception:
            raw_error = ""
        raise RuntimeError(f"Request failed ({exc.code}): {raw_error[:300]}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Request failed: {exc}") from exc
    parsed = json.loads(raw or "{}")
    if not isinstance(parsed, dict):
        return {}
    return parsed


def openai_frontier_score(model_id: str) -> int | None:
    match = re.fullmatch(r"gpt-(\d+)(?:\.(\d+))?", model_id)
    if not match:
        return None
    return int(match.group(1)) * 1000 + int(match.group(2) or 0)


def is_openai_frontier_candidate(model_id: str) -> bool:
    normalized = model_id.lower()
    excluded = (
        "mini",
        "nano",
        "realtime",
        "audio",
        "tts",
        "transcribe",
        "image",
        "codex",
    )
    return not any(token in normalized for token in excluded) and (
        openai_frontier_score(normalized) is not None
    )


def smoke_test_openai_model(model_id: str) -> None:
    api_key = clean(os.environ.get("OPENAI_API_KEY"))
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set.")
    request_json(
        OPENAI_RESPONSES_API_URL,
        {"Authorization": f"Bearer {api_key}"},
        {
            "model": model_id,
            "input": SMOKE_TEST_PROMPT,
            "max_output_tokens": 8,
        },
    )


def smoke_test_anthropic_model(model_id: str) -> None:
    api_key = clean(os.environ.get("ANTHROPIC_API_KEY"))
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set.")
    request_json(
        ANTHROPIC_MESSAGES_API_URL,
        {"x-api-key": api_key, "anthropic-version": ANTHROPIC_VERSION},
        {
            "model": model_id,
            "max_tokens": 8,
            "messages": [{"role": "user", "content": SMOKE_TEST_PROMPT}],
        },
    )


def smoke_test_google_model(model_id: str) -> None:
    api_key = clean(os.environ.get("GEMINI_API_KEY"))
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not set.")
    model_path = urllib.parse.quote(model_id, safe="")
    url = (
        f"{GEMINI_MODELS_URL}/{model_path}:generateContent"
        f"?key={urllib.parse.quote(api_key, safe='')}"
    )
    request_json(
        url,
        payload={
            "contents": [
                {"role": "user", "parts": [{"text": SMOKE_TEST_PROMPT}]},
            ],
            "generationConfig": {"maxOutputTokens": 8},
        },
    )


def smoke_test_model(entry: dict[str, Any], model_id: str) -> None:
    provider = clean(entry.get("provider")).lower()
    if provider == "anthropic":
        smoke_test_anthropic_model(model_id)
        return
    if provider == "google":
        smoke_test_google_model(model_id)
        return
    smoke_test_openai_model(model_id)


def select_usable_latest_candidate(
    entry: dict[str, Any],
    candidates: list[str],
    *,
    smoke_test: bool,
) -> str:
    fallback = clean(entry.get("fallback"))
    candidate_ids = dedupe_preserve_order(candidates + ([fallback] if fallback else []))
    if not candidate_ids:
        return fallback
    if not smoke_test:
        return candidate_ids[0]
    last_error: Exception | None = None
    for candidate in candidate_ids:
        try:
            smoke_test_model(entry, candidate)
            return candidate
        except Exception as exc:  # noqa: BLE001
            last_error = exc
    if last_error is not None:
        raise last_error
    return fallback


def resolve_openai_latest(entry: dict[str, Any], *, smoke_test: bool) -> str:
    api_key = clean(os.environ.get("OPENAI_API_KEY"))
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set.")
    payload = request_json(OPENAI_MODELS_URL, {"Authorization": f"Bearer {api_key}"})
    candidates = []
    for model in payload.get("data", []):
        if not isinstance(model, dict):
            continue
        model_id = clean(model.get("id"))
        if not is_openai_frontier_candidate(model_id):
            continue
        candidates.append((openai_frontier_score(model_id.lower()) or 0, model_id))
    candidates.sort(reverse=True)
    return select_usable_latest_candidate(
        entry,
        [model_id for _score, model_id in candidates],
        smoke_test=smoke_test,
    )


def resolve_anthropic_latest(entry: dict[str, Any], *, smoke_test: bool) -> str:
    api_key = clean(os.environ.get("ANTHROPIC_API_KEY"))
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set.")
    payload = request_json(
        ANTHROPIC_MODELS_URL,
        {"x-api-key": api_key, "anthropic-version": ANTHROPIC_VERSION},
    )
    family = clean(entry.get("family")).lower()
    prefix = (
        "claude-opus-"
        if family == "opus"
        else "claude-sonnet-"
        if family == "sonnet"
        else "claude-"
    )
    candidates: list[str] = []
    for model in payload.get("data", []):
        if not isinstance(model, dict):
            continue
        model_id = clean(model.get("id"))
        if model_id.lower().startswith(prefix):
            candidates.append(model_id)
    return select_usable_latest_candidate(entry, candidates, smoke_test=smoke_test)


def normalize_google_model_id(value: Any) -> str:
    return clean(value).removeprefix("models/")


def google_version_score(model_id: str) -> float:
    match = re.search(r"gemini-(\d+)(?:\.(\d+))?", model_id)
    if not match:
        return 0
    return int(match.group(1)) * 1000 + int(match.group(2) or 0)


def is_google_flash_candidate(model: dict[str, Any]) -> bool:
    model_id = normalize_google_model_id(model.get("name") or model.get("id")).lower()
    methods = model.get("supportedGenerationMethods") or []
    if "generateContent" not in methods:
        return False
    if "gemini" not in model_id or "flash" not in model_id:
        return False
    excluded = (
        "flash-lite",
        "live",
        "tts",
        "image",
        "embedding",
        "imagen",
        "veo",
        "nano",
        "banana",
    )
    return not any(token in model_id for token in excluded)


def resolve_google_latest(entry: dict[str, Any], *, smoke_test: bool) -> str:
    api_key = clean(os.environ.get("GEMINI_API_KEY"))
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not set.")
    url = f"{GEMINI_MODELS_URL}?key={urllib.parse.quote(api_key, safe='')}"
    payload = request_json(url)
    candidates = []
    for model in payload.get("models", []):
        if not isinstance(model, dict) or not is_google_flash_candidate(model):
            continue
        model_id = normalize_google_model_id(model.get("name") or model.get("id"))
        score = google_version_score(model_id.lower())
        if "preview" in model_id.lower():
            score -= 0.01
        candidates.append((score, model_id))
    candidates.sort(reverse=True)
    return select_usable_latest_candidate(
        entry,
        [model_id for _score, model_id in candidates],
        smoke_test=smoke_test,
    )


def resolve_latest(entry: dict[str, Any], *, smoke_test: bool) -> str:
    provider = clean(entry.get("provider")).lower()
    if provider == "anthropic":
        return resolve_anthropic_latest(entry, smoke_test=smoke_test)
    if provider == "google":
        return resolve_google_latest(entry, smoke_test=smoke_test)
    return resolve_openai_latest(entry, smoke_test=smoke_test)


def resolve_model_id(
    model_id: str,
    catalog: dict[str, Any],
    *,
    use_live: bool,
    smoke_test: bool,
) -> tuple[str, str | None]:
    normalized = normalize_alias(model_id, catalog)
    entry_by_id = {
        clean(entry.get("id")).lower(): entry for entry in catalog_entries(catalog)
    }
    entry = entry_by_id.get(normalized.lower())
    if not entry or entry.get("kind") != "latest":
        return normalized, None
    fallback = clean(entry.get("fallback")) or normalized
    if not use_live:
        return fallback, "live-disabled"
    try:
        return resolve_latest(entry, smoke_test=smoke_test) or fallback, None
    except Exception as exc:
        return fallback, str(exc)


def resolve_model_ids(
    model_ids: list[str],
    catalog: dict[str, Any],
    *,
    use_live: bool,
    smoke_test: bool = True,
) -> tuple[list[str], list[dict[str, str]]]:
    resolved: list[str] = []
    warnings: list[dict[str, str]] = []
    seen: set[str] = set()
    for model_id in model_ids:
        concrete, warning = resolve_model_id(
            model_id,
            catalog,
            use_live=use_live,
            smoke_test=smoke_test,
        )
        if warning:
            warnings.append({"model": model_id, "warning": warning, "fallback": concrete})
        key = concrete.lower()
        if concrete and key not in seen:
            seen.add(key)
            resolved.append(concrete)
    return resolved, warnings


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    catalog = load_catalog(args.config)
    requested = (
        parse_csv(args.models)
        if args.models.strip()
        else all_model_ids(catalog)
        if args.set == "all"
        else default_model_ids(catalog)
    )
    resolved, warnings = resolve_model_ids(
        requested,
        catalog,
        use_live=not args.no_live,
        smoke_test=not args.no_smoke_test,
    )
    if args.format == "json":
        print(
            json.dumps(
                {"models": resolved, "requestedModels": requested, "warnings": warnings},
                indent=2,
            )
        )
    else:
        for warning in warnings:
            print(
                "resolve_benchmark_models.py: "
                f"{warning['model']} -> {warning['fallback']} ({warning['warning']})",
                file=sys.stderr,
            )
        print(",".join(resolved))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
