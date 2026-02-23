#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

SOURCE_PLIST="${ROOT_DIR}/automation/launchd/com.jamesm.easy_llm_benchmarker.monthly.plist"
TARGET_PLIST="${HOME}/Library/LaunchAgents/com.jamesm.easy_llm_benchmarker.monthly.plist"

if [[ ! -f "${SOURCE_PLIST}" ]]; then
  echo "Missing source plist: ${SOURCE_PLIST}" >&2
  exit 1
fi

mkdir -p "${HOME}/Library/LaunchAgents"
cp "${SOURCE_PLIST}" "${TARGET_PLIST}"

# Reload launch agent with latest file.
launchctl unload "${TARGET_PLIST}" >/dev/null 2>&1 || true
launchctl load "${TARGET_PLIST}"

echo "Installed and loaded: ${TARGET_PLIST}"
echo "To run now:"
echo "launchctl kickstart -k gui/$(id -u)/com.jamesm.easy_llm_benchmarker.monthly"
