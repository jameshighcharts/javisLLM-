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
MODELS="${MODELS:-}"
RUNS="${RUNS:-3}"
TEMPERATURE="${TEMPERATURE:-0.7}"
WEB_SEARCH="${WEB_SEARCH:-1}"
GSHEET_TAB_NAME="${GSHEET_TAB_NAME:-Sheet1}"
GSHEET_COMPETITOR_TAB_NAME="${GSHEET_COMPETITOR_TAB_NAME:-CompetitorMetrics}"
BENCHMARK_CONFIG_PATH="${BENCHMARK_CONFIG_PATH:-${ROOT_DIR}/config/benchmark_config.json}"
SUPABASE_SYNC="${SUPABASE_SYNC:-0}"

TARGET_MODELS="${MODELS:-${MODEL}}"
IFS=',' read -r -a RAW_MODEL_LIST <<< "${TARGET_MODELS}"
NORMALIZED_MODELS=()
for raw_model in "${RAW_MODEL_LIST[@]}"; do
  trimmed="${raw_model#"${raw_model%%[![:space:]]*}"}"
  trimmed="${trimmed%"${trimmed##*[![:space:]]}"}"
  if [[ -n "${trimmed}" ]]; then
    NORMALIZED_MODELS+=("${trimmed}")
  fi
done
if [[ "${#NORMALIZED_MODELS[@]}" -eq 0 ]]; then
  NORMALIZED_MODELS=("gpt-4o-mini")
fi
TARGET_MODELS="$(IFS=','; echo "${NORMALIZED_MODELS[*]}")"

NEEDS_OPENAI=0
NEEDS_ANTHROPIC=0
NEEDS_GEMINI=0
for model_name in "${NORMALIZED_MODELS[@]}"; do
  model_lower="$(echo "${model_name}" | tr '[:upper:]' '[:lower:]')"
  if [[ "${model_lower}" == claude* || "${model_lower}" == anthropic/* ]]; then
    NEEDS_ANTHROPIC=1
  elif [[ "${model_lower}" == gemini* || "${model_lower}" == google/* ]]; then
    NEEDS_GEMINI=1
  else
    NEEDS_OPENAI=1
  fi
done

if [[ "${NEEDS_OPENAI}" == "1" ]]; then
  : "${OPENAI_API_KEY:?OPENAI_API_KEY is required when any selected model is OpenAI-compatible}"
fi
if [[ "${NEEDS_ANTHROPIC}" == "1" ]]; then
  : "${ANTHROPIC_API_KEY:?ANTHROPIC_API_KEY is required when any selected model is Claude-compatible}"
fi
if [[ "${NEEDS_GEMINI}" == "1" ]]; then
  : "${GEMINI_API_KEY:?GEMINI_API_KEY is required when any selected model is Gemini-compatible}"
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
echo "models=${TARGET_MODELS}"
echo "log_file=${LOG_FILE}"

BENCH_CMD=(
  python3
  "${ROOT_DIR}/llm_mention_benchmark.py"
  --our-terms "${OUR_TERMS}"
  --model "${TARGET_MODELS}"
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
