#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Optional env file for launchd/non-interactive runs.
if [[ -f "${ROOT_DIR}/.env.monthly" ]]; then
  # shellcheck disable=SC1091
  set -a
  source "${ROOT_DIR}/.env.monthly"
  set +a
fi

: "${GSHEET_WEBAPP_URL:?GSHEET_WEBAPP_URL is required}"
: "${GSHEET_WEBAPP_SECRET:?GSHEET_WEBAPP_SECRET is required}"

OUTPUT_DIR="${OUTPUT_DIR:-${ROOT_DIR}/output}"
LOG_DIR="${LOG_DIR:-${OUTPUT_DIR}/logs}"
OUR_TERMS="${OUR_TERMS:-Highcharts}"
MODEL="${MODEL:-gpt-4o-mini}"
RUNS="${RUNS:-3}"
TEMPERATURE="${TEMPERATURE:-0.7}"
WEB_SEARCH="${WEB_SEARCH:-1}"
GSHEET_TAB_NAME="${GSHEET_TAB_NAME:-Sheet1}"
GSHEET_COMPETITOR_TAB_NAME="${GSHEET_COMPETITOR_TAB_NAME:-CompetitorMetrics}"
BENCHMARK_CONFIG_PATH="${BENCHMARK_CONFIG_PATH:-${ROOT_DIR}/config/benchmark_config.json}"
SUPABASE_SYNC="${SUPABASE_SYNC:-0}"

MODEL_LOWER="$(echo "${MODEL}" | tr '[:upper:]' '[:lower:]')"
if [[ "${MODEL_LOWER}" == claude* || "${MODEL_LOWER}" == anthropic/* ]]; then
  : "${ANTHROPIC_API_KEY:?ANTHROPIC_API_KEY is required when MODEL is Claude}"
elif [[ "${MODEL_LOWER}" == gemini* || "${MODEL_LOWER}" == google/* ]]; then
  : "${GEMINI_API_KEY:?GEMINI_API_KEY is required when MODEL is Gemini}"
else
  : "${OPENAI_API_KEY:?OPENAI_API_KEY is required}"
fi

mkdir -p "${OUTPUT_DIR}" "${LOG_DIR}"

RUN_MONTH="${RUN_MONTH:-$(date +%Y-%m)}"
RUN_ID="${RUN_ID:-$(python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)}"

LOG_FILE="${LOG_DIR}/monthly_${RUN_MONTH}_${RUN_ID}.log"
exec > >(tee -a "${LOG_FILE}") 2>&1

echo "== easy_llm_benchmarker monthly run =="
echo "root_dir=${ROOT_DIR}"
echo "output_dir=${OUTPUT_DIR}"
echo "run_month=${RUN_MONTH}"
echo "run_id=${RUN_ID}"
echo "log_file=${LOG_FILE}"

BENCH_CMD=(
  python3
  "${ROOT_DIR}/llm_mention_benchmark.py"
  --our-terms "${OUR_TERMS}"
  --model "${MODEL}"
  --runs "${RUNS}"
  --temperature "${TEMPERATURE}"
  --output-dir "${OUTPUT_DIR}"
  --config "${BENCHMARK_CONFIG_PATH}"
)
if [[ "${WEB_SEARCH}" == "1" || "${WEB_SEARCH}" == "true" || "${WEB_SEARCH}" == "yes" ]]; then
  BENCH_CMD+=(--web-search)
fi

echo "Running benchmark..."
"${BENCH_CMD[@]}"

echo "Building canonical Looker dataset..."
python3 "${ROOT_DIR}/scripts/build_looker_dataset.py" \
  --output-dir "${OUTPUT_DIR}" \
  --run-month "${RUN_MONTH}" \
  --run-id "${RUN_ID}"

echo "Pushing rows to Google Sheets Apps Script web app..."
python3 "${ROOT_DIR}/scripts/push_to_sheets_webapp.py" \
  --csv "${OUTPUT_DIR}/looker_studio_table_paste.csv" \
  --sheet-name "${GSHEET_TAB_NAME}" \
  --url "${GSHEET_WEBAPP_URL}" \
  --secret "${GSHEET_WEBAPP_SECRET}" \
  --run-month "${RUN_MONTH}" \
  --run-id "${RUN_ID}"

echo "Pushing competitor chart rows to Google Sheets Apps Script web app..."
python3 "${ROOT_DIR}/scripts/push_to_sheets_webapp.py" \
  --csv "${OUTPUT_DIR}/looker_competitor_chart.csv" \
  --sheet-name "${GSHEET_COMPETITOR_TAB_NAME}" \
  --url "${GSHEET_WEBAPP_URL}" \
  --secret "${GSHEET_WEBAPP_SECRET}" \
  --run-month "${RUN_MONTH}" \
  --run-id "${RUN_ID}"

if [[ "${SUPABASE_SYNC}" == "1" || "${SUPABASE_SYNC}" == "true" || "${SUPABASE_SYNC}" == "yes" ]]; then
  : "${SUPABASE_URL:?SUPABASE_URL is required when SUPABASE_SYNC=1}"
  : "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY is required when SUPABASE_SYNC=1}"

  echo "Syncing config + run artifacts to Supabase..."
  python3 "${ROOT_DIR}/scripts/push_to_supabase.py" \
    --config "${BENCHMARK_CONFIG_PATH}" \
    --output-dir "${OUTPUT_DIR}" \
    --run-month "${RUN_MONTH}" \
    --run-id "${RUN_ID}"
fi

echo "Monthly run completed successfully."
