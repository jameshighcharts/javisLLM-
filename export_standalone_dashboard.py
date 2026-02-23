#!/usr/bin/env python3
"""Compatibility wrapper for dashboard/export_standalone_dashboard.py."""

from __future__ import annotations

import runpy
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "dashboard" / "export_standalone_dashboard.py"
runpy.run_path(str(SCRIPT), run_name="__main__")
