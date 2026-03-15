"""Configuration helpers re-exported from the legacy benchmark module."""

from .legacy import (
    COMPETITORS,
    COMPETITOR_ALIASES,
    DEFAULT_CONFIG_PATH,
    DEFAULT_OUTPUT_DIR,
    DEFAULT_QUERIES,
    load_benchmark_config,
)

__all__ = [
    "COMPETITORS",
    "COMPETITOR_ALIASES",
    "DEFAULT_CONFIG_PATH",
    "DEFAULT_OUTPUT_DIR",
    "DEFAULT_QUERIES",
    "load_benchmark_config",
]
