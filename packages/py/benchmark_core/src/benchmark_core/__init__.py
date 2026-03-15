"""Compatibility-friendly Python benchmark core package."""

from .citations import extract_citations
from .config import (
    COMPETITORS,
    COMPETITOR_ALIASES,
    DEFAULT_CONFIG_PATH,
    DEFAULT_OUTPUT_DIR,
    DEFAULT_QUERIES,
    load_benchmark_config,
)
from .entities import (
    EntitySpec,
    alias_to_pattern,
    build_entity_specs,
    compile_entity_patterns,
    detect_mentions,
)
from .providers import (
    GeminiRestClient,
    ProviderRequestError,
    create_anthropic_client,
    create_gemini_client,
    create_llm_client,
    create_openai_client,
    generate_with_optional_retry,
    get_system_prompt_for_provider,
    infer_model_owner,
    infer_provider_from_model,
    normalize_api_key,
    resolve_api_key_env,
)
from .runner import main, parse_args, run_benchmark
from .tokens import extract_token_usage

__all__ = [
    "COMPETITORS",
    "COMPETITOR_ALIASES",
    "DEFAULT_CONFIG_PATH",
    "DEFAULT_OUTPUT_DIR",
    "DEFAULT_QUERIES",
    "EntitySpec",
    "GeminiRestClient",
    "ProviderRequestError",
    "alias_to_pattern",
    "build_entity_specs",
    "compile_entity_patterns",
    "create_anthropic_client",
    "create_gemini_client",
    "create_llm_client",
    "create_openai_client",
    "detect_mentions",
    "extract_citations",
    "extract_token_usage",
    "generate_with_optional_retry",
    "get_system_prompt_for_provider",
    "infer_model_owner",
    "infer_provider_from_model",
    "load_benchmark_config",
    "main",
    "normalize_api_key",
    "parse_args",
    "resolve_api_key_env",
    "run_benchmark",
]
