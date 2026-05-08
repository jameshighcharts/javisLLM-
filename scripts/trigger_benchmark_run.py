#!/usr/bin/env python3
"""Trigger a queued benchmark run from a short-lived cron process."""

from __future__ import annotations

import json
import os
import sys
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen


DEFAULT_ENDPOINT = "/api/benchmark/trigger"
DEFAULT_TIMEOUT_SECONDS = 60


def getenv(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def parse_bool(value: str) -> bool | None:
    normalized = value.strip().lower()
    if not normalized:
        return None
    if normalized in {"1", "true", "yes", "y", "on"}:
        return True
    if normalized in {"0", "false", "no", "n", "off"}:
        return False
    raise ValueError(f"{value!r} is not a valid boolean")


def parse_int(value: str, field: str) -> int | None:
    if not value:
        return None
    try:
        return int(value)
    except ValueError as exc:
        raise ValueError(f"{field} must be an integer") from exc


def parse_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def build_trigger_payload() -> dict[str, Any]:
    payload: dict[str, Any] = {}

    our_terms = getenv("BENCHMARK_CRON_OUR_TERMS")
    model = getenv("BENCHMARK_CRON_MODEL")
    models = parse_csv(getenv("BENCHMARK_CRON_MODELS"))
    runs = parse_int(getenv("BENCHMARK_CRON_RUNS"), "BENCHMARK_CRON_RUNS")
    web_search = parse_bool(getenv("BENCHMARK_CRON_WEB_SEARCH"))
    run_month = getenv("BENCHMARK_CRON_RUN_MONTH")
    prompt_limit = parse_int(
        getenv("BENCHMARK_CRON_PROMPT_LIMIT"),
        "BENCHMARK_CRON_PROMPT_LIMIT",
    )
    prompt_order = getenv("BENCHMARK_CRON_PROMPT_ORDER")
    cohort_tag = getenv("BENCHMARK_CRON_COHORT_TAG")
    select_all_models = parse_bool(getenv("BENCHMARK_CRON_SELECT_ALL_MODELS"))

    if our_terms:
        payload["ourTerms"] = our_terms
    if select_all_models is not None:
        payload["selectAllModels"] = select_all_models
    if models:
        payload["models"] = models
    elif model:
        payload["model"] = model
    if runs is not None:
        payload["runs"] = runs
    if web_search is not None:
        payload["webSearch"] = web_search
    if run_month:
        payload["runMonth"] = run_month
    if prompt_limit is not None:
        payload["promptLimit"] = prompt_limit
    if prompt_order:
        payload["promptOrder"] = prompt_order
    if cohort_tag:
        payload["cohortTag"] = cohort_tag

    return payload


def build_trigger_url() -> str:
    api_base_url = getenv("BENCHMARK_API_BASE_URL")
    if not api_base_url:
        raise ValueError("BENCHMARK_API_BASE_URL is required")
    if not api_base_url.startswith(("http://", "https://")):
        raise ValueError("BENCHMARK_API_BASE_URL must start with http:// or https://")

    endpoint = getenv("BENCHMARK_TRIGGER_ENDPOINT", DEFAULT_ENDPOINT)
    return urljoin(api_base_url.rstrip("/") + "/", endpoint.lstrip("/"))


def main() -> int:
    token = getenv("BENCHMARK_TRIGGER_TOKEN")
    if not token:
        print("BENCHMARK_TRIGGER_TOKEN is required", file=sys.stderr)
        return 2

    try:
        trigger_url = build_trigger_url()
        payload = build_trigger_payload()
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    request_body = json.dumps(payload).encode("utf-8")
    request = Request(
        trigger_url,
        data=request_body,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "easy-llm-benchmarker-cron/1.0",
        },
    )

    try:
        timeout = parse_int(
            getenv("BENCHMARK_CRON_TIMEOUT_SECONDS", str(DEFAULT_TIMEOUT_SECONDS)),
            "BENCHMARK_CRON_TIMEOUT_SECONDS",
        )
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    if timeout is None or timeout < 1:
        print("BENCHMARK_CRON_TIMEOUT_SECONDS must be at least 1", file=sys.stderr)
        return 2

    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
            status = response.status
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        print(
            f"Benchmark trigger failed with HTTP {exc.code}: {body}",
            file=sys.stderr,
        )
        return 1
    except URLError as exc:
        print(f"Benchmark trigger request failed: {exc.reason}", file=sys.stderr)
        return 1

    try:
        parsed = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        print(f"Benchmark trigger returned non-JSON response: {raw}", file=sys.stderr)
        return 1

    if status < 200 or status >= 300 or not parsed.get("ok"):
        print(
            f"Benchmark trigger returned unsuccessful response: {parsed}",
            file=sys.stderr,
        )
        return 1

    run_id = parsed.get("runId") or parsed.get("triggerId") or "unknown"
    jobs_enqueued = parsed.get("jobsEnqueued", "unknown")
    print(
        "Benchmark run triggered "
        f"(run_id={run_id}, jobs_enqueued={jobs_enqueued})."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
