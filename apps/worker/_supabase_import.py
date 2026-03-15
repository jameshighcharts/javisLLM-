"""Load the installed `supabase` package without shadowing the local `supabase/` SQL dir."""

from __future__ import annotations

import importlib
import sys
from pathlib import Path
from types import ModuleType

PACKAGE_NAME = "supabase"
REPO_ROOT = Path(__file__).resolve().parents[1]


def _entry_points_to_repo_root(entry: str) -> bool:
    if not entry:
        return Path.cwd().resolve() == REPO_ROOT
    try:
        return Path(entry).resolve() == REPO_ROOT
    except OSError:
        return False


def load_installed_supabase() -> ModuleType:
    removed_entries: list[tuple[int, str]] = []
    existing = sys.modules.get(PACKAGE_NAME)
    if existing is not None:
        sys.modules.pop(PACKAGE_NAME, None)

    for index in range(len(sys.path) - 1, -1, -1):
        entry = sys.path[index]
        if _entry_points_to_repo_root(entry):
            removed_entries.append((index, entry))
            sys.path.pop(index)

    try:
        return importlib.import_module(PACKAGE_NAME)
    finally:
        for index, entry in reversed(removed_entries):
            sys.path.insert(index, entry)


_supabase = load_installed_supabase()
Client = _supabase.Client
create_client = _supabase.create_client

