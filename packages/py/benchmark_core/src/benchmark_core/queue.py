"""Queue-facing helpers used by the worker."""

from .legacy import (
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

__all__ = [
    "build_entity_specs",
    "compile_entity_patterns",
    "create_llm_client",
    "detect_mentions",
    "generate_with_optional_retry",
    "infer_model_owner",
    "infer_provider_from_model",
    "normalize_api_key",
    "resolve_api_key_env",
]
