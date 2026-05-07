from __future__ import annotations

import importlib.util
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "resolve_benchmark_models.py"
spec = importlib.util.spec_from_file_location("resolve_benchmark_models", SCRIPT_PATH)
assert spec is not None
resolver = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(resolver)


def test_default_catalog_resolves_latest_fallbacks_without_live_calls() -> None:
    catalog = resolver.load_catalog(str(Path("config/benchmark/models.json")))

    resolved, warnings = resolver.resolve_model_ids(
        resolver.default_model_ids(catalog),
        catalog,
        use_live=False,
    )

    assert resolved[:4] == [
        "gpt-5.5",
        "claude-opus-4-7",
        "claude-sonnet-4-6",
        "gemini-3-flash-preview",
    ]
    assert "gpt-4o-mini" in resolved
    assert "gpt-5.2" in resolved
    assert len(resolved) == len(set(model.lower() for model in resolved))
    assert {warning["warning"] for warning in warnings} == {"live-disabled"}


def test_legacy_aliases_resolve_to_latest_slots() -> None:
    catalog = resolver.load_catalog(str(Path("config/benchmark/models.json")))

    resolved, _warnings = resolver.resolve_model_ids(
        ["claude-4-6-sonnet-latest", "gemini-3.0-flash"],
        catalog,
        use_live=False,
    )

    assert resolved == ["claude-sonnet-4-6", "gemini-3-flash-preview"]


def test_live_resolution_skips_latest_candidate_when_smoke_test_fails(
    monkeypatch,
) -> None:
    catalog = resolver.load_catalog(str(Path("config/benchmark/models.json")))
    smoke_attempts: list[str] = []

    monkeypatch.setenv("OPENAI_API_KEY", "test-key")

    def fake_request_json(url, headers=None, payload=None):
        if url == resolver.OPENAI_MODELS_URL:
            return {"data": [{"id": "gpt-5.6"}, {"id": "gpt-5.5"}]}
        if url == resolver.OPENAI_RESPONSES_API_URL:
            smoke_attempts.append(payload["model"])
            if payload["model"] == "gpt-5.6":
                raise RuntimeError("model is listed but not enabled for this API key")
            return {"output_text": "OK"}
        raise AssertionError(f"unexpected request: {url}")

    monkeypatch.setattr(resolver, "request_json", fake_request_json)

    resolved, warnings = resolver.resolve_model_ids(
        ["openai:gpt:latest"],
        catalog,
        use_live=True,
        smoke_test=True,
    )

    assert resolved == ["gpt-5.5"]
    assert warnings == []
    assert smoke_attempts == ["gpt-5.6", "gpt-5.5"]


def test_live_resolution_can_skip_smoke_test(monkeypatch) -> None:
    catalog = resolver.load_catalog(str(Path("config/benchmark/models.json")))

    monkeypatch.setenv("OPENAI_API_KEY", "test-key")

    def fake_request_json(url, headers=None, payload=None):
        assert payload is None
        assert url == resolver.OPENAI_MODELS_URL
        return {"data": [{"id": "gpt-5.6"}, {"id": "gpt-5.5"}]}

    monkeypatch.setattr(resolver, "request_json", fake_request_json)

    resolved, warnings = resolver.resolve_model_ids(
        ["openai:gpt:latest"],
        catalog,
        use_live=True,
        smoke_test=False,
    )

    assert resolved == ["gpt-5.6"]
    assert warnings == []
