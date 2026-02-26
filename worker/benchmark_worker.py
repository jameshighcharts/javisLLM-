#!/usr/bin/env python3
"""Queue worker for benchmark jobs backed by Supabase pgmq RPC wrappers."""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Sequence, Tuple

from supabase import Client, create_client

from llm_mention_benchmark import (
    build_entity_specs,
    compile_entity_patterns,
    create_llm_client,
    detect_mentions,
    generate_with_optional_retry,
    infer_model_owner,
    infer_provider_from_model,
    normalize_api_key,
    resolve_api_key_env,
)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "y", "on"}:
        return True
    if normalized in {"0", "false", "no", "n", "off"}:
        return False
    return default


@dataclass
class CompetitorContext:
    competitors: List[str]
    aliases_by_name: Dict[str, List[str]]
    competitor_id_by_name: Dict[str, str]


class BenchmarkWorker:
    def __init__(self) -> None:
        self.supabase_url = self.require_env("SUPABASE_URL")
        self.service_role_key = self.require_env("SUPABASE_SERVICE_ROLE_KEY")
        self.api_key_env_override = os.getenv("API_KEY_ENV_OVERRIDE", "").strip()
        self.queue_name = os.getenv("WORKER_QUEUE_NAME", "benchmark_jobs").strip() or "benchmark_jobs"
        self.vt_seconds = max(15, int(os.getenv("WORKER_VT_SECONDS", "120")))
        self.poll_qty = max(1, min(10, int(os.getenv("WORKER_POLL_QTY", "1"))))
        self.empty_sleep_seconds = max(1.0, float(os.getenv("WORKER_EMPTY_SLEEP_SECONDS", "2")))
        self.idle_exit_seconds = max(30, int(os.getenv("WORKER_IDLE_EXIT_SECONDS", "300")))

        self.supabase: Client = create_client(self.supabase_url, self.service_role_key)
        self.provider_clients: Dict[str, Any] = {}
        self.entity_context = self.load_competitor_context()
        self.spec_cache: Dict[Tuple[str, ...], Sequence[Any]] = {}
        self.pattern_cache: Dict[Tuple[str, ...], Dict[str, Any]] = {}

    @staticmethod
    def require_env(name: str) -> str:
        value = os.getenv(name, "").strip()
        if not value:
            raise RuntimeError(f"Missing required env var: {name}")
        return value

    @staticmethod
    def _result_data(result: Any) -> Any:
        return getattr(result, "data", None)

    @staticmethod
    def _result_error(result: Any) -> Any:
        return getattr(result, "error", None)

    def _expect_ok(self, result: Any, context: str) -> Any:
        error = self._result_error(result)
        if error:
            raise RuntimeError(f"{context}: {error}")
        return self._result_data(result)

    def load_competitor_context(self) -> CompetitorContext:
        competitors_result = self.supabase.table("competitors").select(
            "id,name,is_active,sort_order"
        ).eq("is_active", True).order("sort_order", desc=False).execute()
        competitor_rows = self._expect_ok(competitors_result, "Failed to load competitors") or []

        if not competitor_rows:
            raise RuntimeError("No active competitors found. Populate competitors before running worker.")

        competitor_id_by_name: Dict[str, str] = {}
        aliases_by_name: Dict[str, List[str]] = {}
        competitors: List[str] = []

        for row in competitor_rows:
            name = str(row.get("name") or "").strip()
            competitor_id = str(row.get("id") or "").strip()
            if not name or not competitor_id:
                continue
            competitors.append(name)
            competitor_id_by_name[name.lower()] = competitor_id
            aliases_by_name[name] = [name]

        aliases_result = self.supabase.table("competitor_aliases").select(
            "competitor_id,alias"
        ).execute()
        alias_rows = self._expect_ok(aliases_result, "Failed to load competitor aliases") or []
        name_by_id = {v: k for k, v in competitor_id_by_name.items()}

        for row in alias_rows:
            competitor_id = str(row.get("competitor_id") or "").strip()
            alias = str(row.get("alias") or "").strip()
            if not competitor_id or not alias:
                continue
            competitor_name_lower = name_by_id.get(competitor_id)
            if not competitor_name_lower:
                continue
            # Keep original case key from competitors list.
            competitor_name = next(
                (name for name in aliases_by_name if name.lower() == competitor_name_lower),
                None,
            )
            if not competitor_name:
                continue
            existing = aliases_by_name[competitor_name]
            lowered = {value.lower() for value in existing}
            if alias.lower() not in lowered:
                existing.append(alias)

        return CompetitorContext(
            competitors=competitors,
            aliases_by_name=aliases_by_name,
            competitor_id_by_name=competitor_id_by_name,
        )

    def _normalize_terms(self, raw_terms: Any) -> List[str]:
        if isinstance(raw_terms, list):
            values = [str(item).strip() for item in raw_terms]
        elif isinstance(raw_terms, str):
            values = [part.strip() for part in raw_terms.split(",")]
        else:
            values = []

        normalized: List[str] = []
        seen = set()
        for value in values:
            if not value:
                continue
            key = value.lower()
            if key in seen:
                continue
            seen.add(key)
            normalized.append(value)

        return normalized or ["Highcharts"]

    def _build_detection_context(
        self, our_terms: Sequence[str]
    ) -> Tuple[Sequence[Any], Dict[str, Any]]:
        key = tuple(term.lower() for term in our_terms)
        cached_specs = self.spec_cache.get(key)
        cached_patterns = self.pattern_cache.get(key)
        if cached_specs is not None and cached_patterns is not None:
            return cached_specs, cached_patterns

        specs = build_entity_specs(
            our_terms=list(our_terms),
            competitors=self.entity_context.competitors,
            competitor_aliases=self.entity_context.aliases_by_name,
        )
        compiled = compile_entity_patterns(specs)
        self.spec_cache[key] = specs
        self.pattern_cache[key] = compiled
        return specs, compiled

    def _get_provider_client(self, provider: str) -> Any:
        cached = self.provider_clients.get(provider)
        if cached is not None:
            return cached

        api_key_env = resolve_api_key_env(provider, self.api_key_env_override)
        api_key = normalize_api_key(os.getenv(api_key_env))
        if not api_key:
            raise RuntimeError(
                f'Missing API key env var "{api_key_env}" for provider "{provider}"'
            )

        client = create_llm_client(provider, api_key)
        self.provider_clients[provider] = client
        return client

    def _read_queue(self) -> List[Dict[str, Any]]:
        result = self.supabase.rpc(
            "rpc_pgmq_read",
            {
                "p_queue": self.queue_name,
                "p_vt": self.vt_seconds,
                "p_qty": self.poll_qty,
            },
        ).execute()
        rows = self._expect_ok(result, "Failed to read queue")
        if rows is None:
            return []
        if isinstance(rows, dict):
            return [rows]
        if isinstance(rows, list):
            return [row for row in rows if isinstance(row, dict)]
        return []

    def _archive_message(self, msg_id: int) -> None:
        result = self.supabase.rpc(
            "rpc_pgmq_archive",
            {"p_queue": self.queue_name, "p_msg_id": msg_id},
        ).execute()
        self._expect_ok(result, f"Failed to archive queue message {msg_id}")

    def _fetch_job(self, job_id: int) -> Dict[str, Any] | None:
        result = self.supabase.table("benchmark_jobs").select(
            "id,run_id,query_id,query_text,model,run_iteration,provider,temperature,"
            "web_search_enabled,our_terms,status,attempt_count,max_attempts,response_id"
        ).eq("id", job_id).limit(1).execute()
        rows = self._expect_ok(result, f"Failed to load benchmark_jobs row {job_id}") or []
        if not rows:
            return None
        return rows[0]

    def _update_job(self, job_id: int, payload: Dict[str, Any]) -> None:
        result = self.supabase.table("benchmark_jobs").update(payload).eq("id", job_id).execute()
        self._expect_ok(result, f"Failed to update benchmark_jobs row {job_id}")

    def _upsert_response(
        self,
        job: Dict[str, Any],
        provider: str,
        model_owner: str,
        web_search_enabled: bool,
        duration_ms: int,
        prompt_tokens: int,
        completion_tokens: int,
        total_tokens: int,
        response_text: str,
        citations: List[Dict[str, str]],
        error: str | None,
    ) -> int:
        payload = {
            "run_id": job["run_id"],
            "query_id": job["query_id"],
            "run_iteration": int(job.get("run_iteration") or 1),
            "model": str(job.get("model") or "").strip(),
            "model_run_id": int(job.get("run_iteration") or 1),
            "provider": provider,
            "model_owner": model_owner,
            "web_search_enabled": bool(web_search_enabled),
            "duration_ms": max(0, int(duration_ms)),
            "prompt_tokens": max(0, int(prompt_tokens)),
            "completion_tokens": max(0, int(completion_tokens)),
            "total_tokens": max(0, int(total_tokens)),
            "response_text": response_text,
            "citations": citations,
            "error": error,
        }

        result = self.supabase.table("benchmark_responses").upsert(
            payload,
            on_conflict="run_id,query_id,run_iteration,model",
        ).execute()
        rows = self._expect_ok(result, "Failed to upsert benchmark_responses") or []

        response_id: int | None = None
        if isinstance(rows, list) and rows:
            first = rows[0]
            maybe_id = first.get("id") if isinstance(first, dict) else None
            if isinstance(maybe_id, int):
                response_id = maybe_id
            elif isinstance(maybe_id, str) and maybe_id.isdigit():
                response_id = int(maybe_id)

        if response_id is None:
            lookup = self.supabase.table("benchmark_responses").select("id").eq(
                "run_id", payload["run_id"]
            ).eq("query_id", payload["query_id"]).eq("run_iteration", payload["run_iteration"]).eq(
                "model", payload["model"]
            ).limit(
                1
            ).execute()
            lookup_rows = self._expect_ok(lookup, "Failed to resolve benchmark_responses.id") or []
            if lookup_rows:
                raw_id = lookup_rows[0].get("id")
                if isinstance(raw_id, int):
                    response_id = raw_id
                elif isinstance(raw_id, str) and raw_id.isdigit():
                    response_id = int(raw_id)

        if response_id is None:
            raise RuntimeError("Unable to resolve benchmark_responses.id after upsert")

        return response_id

    def _upsert_mentions(
        self,
        response_id: int,
        specs: Sequence[Any],
        mentions_map: Dict[str, bool],
    ) -> None:
        mention_payload: List[Dict[str, Any]] = []
        for spec in specs:
            if not getattr(spec, "is_competitor", False):
                continue
            label = str(getattr(spec, "label", "")).strip()
            if not label:
                continue
            competitor_id = self.entity_context.competitor_id_by_name.get(label.lower())
            if not competitor_id:
                continue
            key = str(getattr(spec, "key", "")).strip()
            mention_payload.append(
                {
                    "response_id": response_id,
                    "competitor_id": competitor_id,
                    "mentioned": bool(mentions_map.get(key, False)),
                }
            )

        if not mention_payload:
            return

        result = self.supabase.table("response_mentions").upsert(
            mention_payload,
            on_conflict="response_id,competitor_id",
        ).execute()
        self._expect_ok(result, f"Failed to upsert response_mentions for response {response_id}")

    def _maybe_finalize_run(self, run_id: str | None) -> None:
        if not run_id:
            return

        progress_result = self.supabase.table("vw_job_progress").select(
            "total_jobs,completed_jobs,processing_jobs,pending_jobs,failed_jobs,dead_letter_jobs"
        ).eq("run_id", run_id).limit(1).execute()
        rows = self._expect_ok(progress_result, f"Failed to read vw_job_progress for run {run_id}") or []
        if not rows:
            return

        progress = rows[0]
        total_jobs = int(progress.get("total_jobs") or 0)
        completed_jobs = int(progress.get("completed_jobs") or 0)
        processing_jobs = int(progress.get("processing_jobs") or 0)
        pending_jobs = int(progress.get("pending_jobs") or 0)
        failed_jobs = int(progress.get("failed_jobs") or 0)
        dead_letter_jobs = int(progress.get("dead_letter_jobs") or 0)

        all_terminal = (
            total_jobs > 0
            and completed_jobs + dead_letter_jobs == total_jobs
            and processing_jobs == 0
            and pending_jobs == 0
            and failed_jobs == 0
        )
        if not all_terminal:
            return

        finalize_result = self.supabase.rpc(
            "finalize_benchmark_run",
            {"p_run_id": run_id},
        ).execute()
        finalized = self._expect_ok(finalize_result, f"Failed to finalize run {run_id}")
        if finalized:
            print(f"[worker] finalized benchmark run {run_id}")

    @staticmethod
    def _parse_queue_payload(raw_payload: Any) -> Dict[str, Any]:
        if isinstance(raw_payload, dict):
            return raw_payload
        if isinstance(raw_payload, str):
            try:
                decoded = json.loads(raw_payload)
                if isinstance(decoded, dict):
                    return decoded
            except json.JSONDecodeError:
                return {}
        return {}

    def _process_job_execution(self, job: Dict[str, Any]) -> int:
        model = str(job.get("model") or "").strip()
        if not model:
            raise RuntimeError("benchmark_jobs row is missing model")

        query_text = str(job.get("query_text") or "").strip()
        if not query_text:
            raise RuntimeError("benchmark_jobs row is missing query_text")

        provider = str(job.get("provider") or "").strip().lower() or infer_provider_from_model(model)
        model_owner = infer_model_owner(provider)
        web_search_enabled = bool(job.get("web_search_enabled")) if provider == "openai" else False
        temperature = float(job.get("temperature") or 0.7)
        our_terms = self._normalize_terms(job.get("our_terms"))

        specs, compiled_patterns = self._build_detection_context(our_terms)
        llm_client = self._get_provider_client(provider)

        started_at = time.perf_counter()
        response_text, citations, usage = generate_with_optional_retry(
            client=llm_client,
            provider=provider,
            model=model,
            query=query_text,
            temperature=temperature,
            web_search=web_search_enabled,
        )
        duration_ms = int(round((time.perf_counter() - started_at) * 1000))

        mentions = detect_mentions(response_text, compiled_patterns)
        prompt_tokens = int(usage.get("prompt_tokens") or 0)
        completion_tokens = int(usage.get("completion_tokens") or 0)
        total_tokens = int(usage.get("total_tokens") or (prompt_tokens + completion_tokens))

        response_id = self._upsert_response(
            job=job,
            provider=provider,
            model_owner=model_owner,
            web_search_enabled=web_search_enabled,
            duration_ms=duration_ms,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            response_text=response_text,
            citations=citations,
            error=None,
        )
        self._upsert_mentions(response_id=response_id, specs=specs, mentions_map=mentions)
        return response_id

    def process_queue_message(self, queue_message: Dict[str, Any]) -> None:
        msg_id_raw = queue_message.get("msg_id")
        msg_id = int(msg_id_raw) if isinstance(msg_id_raw, int) or str(msg_id_raw).isdigit() else 0
        if msg_id <= 0:
            raise RuntimeError(f"Queue message missing valid msg_id: {queue_message}")

        payload = self._parse_queue_payload(queue_message.get("message"))
        job_id_raw = payload.get("job_id")
        job_id = int(job_id_raw) if isinstance(job_id_raw, int) or str(job_id_raw).isdigit() else 0
        if job_id <= 0:
            print(f"[worker] skipping malformed queue payload for msg_id={msg_id}: {payload}")
            self._archive_message(msg_id)
            return

        job = self._fetch_job(job_id)
        if not job:
            print(f"[worker] job {job_id} missing, archiving msg_id={msg_id}")
            self._archive_message(msg_id)
            return

        status = str(job.get("status") or "").strip().lower()
        run_id = str(job.get("run_id") or "").strip()
        if status in {"completed", "dead_letter"}:
            self._archive_message(msg_id)
            self._maybe_finalize_run(run_id)
            return

        attempt_count = int(job.get("attempt_count") or 0) + 1
        max_attempts = max(1, int(job.get("max_attempts") or 3))

        self._update_job(
            job_id,
            {
                "status": "processing",
                "attempt_count": attempt_count,
                "started_at": utc_now_iso(),
                "last_error": None,
            },
        )

        try:
            response_id = self._process_job_execution(job)
        except Exception as exc:  # noqa: BLE001
            error_text = f"{exc.__class__.__name__}: {exc}"
            terminal = attempt_count >= max_attempts
            update_payload: Dict[str, Any] = {
                "status": "dead_letter" if terminal else "failed",
                "last_error": error_text,
            }
            if terminal:
                update_payload["completed_at"] = utc_now_iso()
            self._update_job(job_id, update_payload)

            print(
                f"[worker] job {job_id} failed (attempt {attempt_count}/{max_attempts}): {error_text}"
            )

            if terminal:
                # Persist final failure as a benchmark response row so analytics stay consistent.
                provider = str(job.get("provider") or "").strip().lower() or infer_provider_from_model(
                    str(job.get("model") or "")
                )
                model_owner = infer_model_owner(provider)
                response_id = self._upsert_response(
                    job=job,
                    provider=provider,
                    model_owner=model_owner,
                    web_search_enabled=bool(job.get("web_search_enabled")) if provider == "openai" else False,
                    duration_ms=0,
                    prompt_tokens=0,
                    completion_tokens=0,
                    total_tokens=0,
                    response_text="",
                    citations=[],
                    error=error_text,
                )
                self._update_job(job_id, {"response_id": response_id})
                self._archive_message(msg_id)
                self._maybe_finalize_run(run_id)

            return

        self._update_job(
            job_id,
            {
                "status": "completed",
                "response_id": response_id,
                "completed_at": utc_now_iso(),
                "last_error": None,
            },
        )
        self._archive_message(msg_id)
        self._maybe_finalize_run(run_id)
        print(f"[worker] completed job {job_id} (response_id={response_id})")

    def run(self) -> int:
        print(
            "[worker] starting benchmark worker "
            f"queue={self.queue_name} vt={self.vt_seconds}s qty={self.poll_qty} "
            f"idle_exit={self.idle_exit_seconds}s"
        )
        last_activity = time.monotonic()

        while True:
            messages = self._read_queue()
            if not messages:
                idle_for = time.monotonic() - last_activity
                if idle_for >= self.idle_exit_seconds:
                    print(f"[worker] idle for {int(idle_for)}s; exiting")
                    return 0
                time.sleep(self.empty_sleep_seconds)
                continue

            last_activity = time.monotonic()
            for message in messages:
                self.process_queue_message(message)


def main() -> int:
    worker = BenchmarkWorker()
    return worker.run()


if __name__ == "__main__":
    raise SystemExit(main())
