"""Entity and mention-detection helpers."""

from .legacy import (
    EntitySpec,
    alias_to_pattern,
    build_entity_specs,
    compile_entity_patterns,
    detect_mentions,
)

__all__ = [
    "EntitySpec",
    "alias_to_pattern",
    "build_entity_specs",
    "compile_entity_patterns",
    "detect_mentions",
]
