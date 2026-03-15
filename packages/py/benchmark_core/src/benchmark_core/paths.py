"""Repo-root path helpers for the benchmark core package."""

from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = PACKAGE_ROOT.parents[2]
ARTIFACTS_DIR = REPO_ROOT / "artifacts"
CONFIG_DIR = REPO_ROOT / "config" / "benchmark"

__all__ = ["ARTIFACTS_DIR", "CONFIG_DIR", "PACKAGE_ROOT", "REPO_ROOT"]
