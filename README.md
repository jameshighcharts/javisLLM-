# easy_llm_benchmarker

Benchmark LLM mention visibility for Highcharts vs competitors across a query set, then export CSV + Looker + Google Sheets-ready datasets.

## Project structure

- `/Users/jamesm/projects/easy_llm_benchmarker/llm_mention_benchmark.py`: main benchmark runner (OpenAI + Anthropic + Gemini support).
- `/Users/jamesm/projects/easy_llm_benchmarker/config/benchmark/config.json`: editable queries, competitors, aliases.
- `/Users/jamesm/projects/easy_llm_benchmarker/scripts/build_looker_dataset.py`: builds canonical Looker dataset + KPI CSV (includes model owner metadata fields).
- `/Users/jamesm/projects/easy_llm_benchmarker/scripts/push_to_sheets_webapp.py`: pushes Looker CSV rows to Apps Script web app.
- `/Users/jamesm/projects/easy_llm_benchmarker/scripts/monthly_run.sh`: full monthly pipeline (benchmark -> dataset -> sheet append).
- `/Users/jamesm/projects/easy_llm_benchmarker/automation/apps_script/Code.gs`: Apps Script endpoint code.
- `/Users/jamesm/projects/easy_llm_benchmarker/automation/launchd/com.jamesm.easy_llm_benchmarker.monthly.plist`: macOS scheduler template.
- `/Users/jamesm/projects/easy_llm_benchmarker/dashboard/dashboard.html`: live dashboard template.
- `/Users/jamesm/projects/easy_llm_benchmarker/dashboard/export_standalone_dashboard.py`: exports standalone shareable dashboard HTML.
- `/Users/jamesm/projects/easy_llm_benchmarker/ui/`: React + shadcn dashboard/admin interface.
- `/Users/jamesm/projects/easy_llm_benchmarker/output/`: generated artifacts.

## React dashboard + admin UI

```bash
cd /Users/jamesm/projects/easy_llm_benchmarker/ui
npm install
npm run dev
```

This starts:

- UI: `http://localhost:5173`
- Local API: `http://localhost:8787`

The admin panel can save prompt/competitor changes directly into:
- `/Users/jamesm/projects/easy_llm_benchmarker/config/benchmark/config.json`

For Vercel deployment (snapshot mode), refresh bundled data first:

```bash
cd /Users/jamesm/projects/easy_llm_benchmarker/ui
npm run sync:data
```

### Vercel (GitHub deploy) setup

This repo includes root `/Users/jamesm/projects/easy_llm_benchmarker/vercel.json` so Vercel builds `ui/` automatically.

In Vercel Project Settings -> Environment Variables, set:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- Optional: `VITE_SUPABASE_REDIRECT_URL` (exact magic-link landing page, for example `https://javis-llm.vercel.app/login`)
- `OPENAI_API_KEY` (required for GPT models in Prompt Query Lab on `/prompts`)
- `ANTHROPIC_API_KEY` (required for Claude models in Prompt Query Lab on `/prompts`)
- `GEMINI_API_KEY` (required for Gemini models in Prompt Query Lab on `/prompts`)
- `GITHUB_TOKEN` (PAT with `repo` + `workflow` access to this repo)
- `GITHUB_OWNER` (e.g. `jameshighcharts`)
- `GITHUB_REPO` (e.g. `javisLLM-`)
- `BENCHMARK_TRIGGER_TOKEN` (required; bearer token for `/api/benchmark/*`)
- Optional: `GITHUB_WORKFLOW_FILE` (default: `run-benchmark.yml`)
- Optional: `GITHUB_WORKFLOW_REF` (default: `main`)
- Optional hardening:
  - `BENCHMARK_ALLOWED_MODELS` (comma-separated model allowlist; default `gpt-4o-mini,gpt-4o,gpt-5.2,claude-sonnet-4-5-20250929,claude-opus-4-5-20251101,gemini-2.5-flash`)
  - `BENCHMARK_TRIGGER_RATE_MAX` (default `5` requests)
  - `BENCHMARK_TRIGGER_RATE_WINDOW_MS` (default `60000` ms)
  - `BENCHMARK_RUNS_RATE_MAX` (default `30` requests)
  - `BENCHMARK_RUNS_RATE_WINDOW_MS` (default `60000` ms)
  - `PROMPT_LAB_RATE_MAX` (default `15` requests)
  - `PROMPT_LAB_RATE_WINDOW_MS` (default `60000` ms)

Without these vars, the deployed frontend may fail at runtime because `/api` fallback is local-only.

After deploy, open `/diagnostics` in the app to run runtime diagnostics from Vercel:
- Supabase connectivity
- Required table checks (`prompt_queries`, `competitors`, `competitor_aliases`, `benchmark_runs`, `benchmark_responses`, `response_mentions`)
- Highcharts primary-competitor check
- Latest run readiness check

Note: `/diagnostics` runs app-level diagnostics, not `pytest` execution.

To run real prompt/scoring runs from the app, open `/runs`:
- Trigger benchmark workflow from UI
- Pull active queries/competitors from Supabase before each run
- Monitor run state (queued/running/success/failure)
- Open GitHub Actions logs directly
- Dashboard updates after workflow syncs to Supabase
- Paste `BENCHMARK_TRIGGER_TOKEN` into the token field (stored in browser session storage only)

To run a one-off prompt test in Query Lab, open `/prompts`:
- Uses `/api/prompt-lab/run` (OpenAI Responses API, Anthropic Messages API, Gemini GenerateContent API, or local ChatGPT web scraper)
- Uses selected model + web search toggle (web search currently applies to OpenAI models)
- Displays mention detection across tracked entities
- No trigger token required

Local-only ChatGPT web scraper setup (not available on Vercel):
- `ENABLE_CHATGPT_WEB_SCRAPER=true`
- `CHATGPT_SESSION_COOKIE=...` (semicolon-separated cookie header copied from a logged-in `chatgpt.com` browser session)
- Optional: `CHATGPT_WEB_HEADLESS=true` (default true)
- Optional: `CHATGPT_WEB_TIMEOUT_MS=90000`
- Optional: `CHATGPT_WEB_SLOW_MO_MS=0`
- Supports model id `chatgpt-web` in Query Lab and `/api/prompt-lab/run`.
- Debug endpoint: `POST /api/prompt-lab/chatgpt-web` with `{ \"query\": \"...\", \"includeRawHtml\": true }`.
- Compliance note: automating ChatGPT web UI may violate OpenAI Terms of Service. Keep this internal and low-volume only.

### GitHub Actions secrets (required for `/runs`)

In GitHub repo settings -> Secrets and variables -> Actions, add:
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY` (required when running Claude models)
- `GEMINI_API_KEY` (required when running Gemini models)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Workflow file used by `/runs` trigger:
- `/Users/jamesm/projects/easy_llm_benchmarker/.github/workflows/run-benchmark.yml`
- Helper script used by workflow:
  - `/Users/jamesm/projects/easy_llm_benchmarker/scripts/pull_config_from_supabase.py`

### Railway worker deployment

The queue worker is intended to run on Railway from the repo root. This repo now includes:
- `/Users/jamesm/projects/easy_llm_benchmarker/Dockerfile` -> explicit worker image so Railway uses Dockerfile builds instead of guessing with Railpack
- `/Users/jamesm/projects/easy_llm_benchmarker/Procfile` -> `worker: python -m worker.benchmark_worker`
- `/Users/jamesm/projects/easy_llm_benchmarker/.python-version` -> `3.11`
- `/Users/jamesm/projects/easy_llm_benchmarker/main.py` -> fallback entrypoint to the same worker if a shell-based start command is used

If the Railway service was pointed at the repo root, this Dockerfile is the safest fix for the "Error creating build plan with Railpack" failure. If you keep using a subdirectory service, set the root directory to `/Users/jamesm/projects/easy_llm_benchmarker/apps/worker` and Railway will use `/Users/jamesm/projects/easy_llm_benchmarker/apps/worker/Dockerfile` instead.

Required Railway env vars:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`

Optional worker tuning:
- `WORKER_QUEUE_NAME`
- `WORKER_VT_SECONDS`
- `WORKER_POLL_QTY`
- `WORKER_EMPTY_SLEEP_SECONDS`
- `WORKER_IDLE_EXIT_SECONDS`

### Railway scheduled benchmark trigger

For production scheduled runs, use a separate Railway cron service that triggers the
API enqueue path and exits. Keep the benchmark worker service as the always-on queue
consumer.

Railway cron service settings:
- Start command: `python scripts/trigger_benchmark_run.py`
- Cron schedule: `0 7 1,15 * *` (Railway evaluates cron in UTC)

Required cron service env vars:
- `BENCHMARK_API_BASE_URL` (for example the hosted API URL, or a Railway private URL for the API service)
- `BENCHMARK_TRIGGER_TOKEN`

Optional cron service env vars:
- `BENCHMARK_CRON_MODEL` (defaults to the API default when omitted)
- `BENCHMARK_CRON_MODELS` (comma-separated; overrides `BENCHMARK_CRON_MODEL`)
- `BENCHMARK_CRON_SELECT_ALL_MODELS=true`
- `BENCHMARK_CRON_RUNS`
- `BENCHMARK_CRON_TEMPERATURE`
- `BENCHMARK_CRON_WEB_SEARCH`
- `BENCHMARK_CRON_OUR_TERMS`
- `BENCHMARK_CRON_RUN_MONTH`
- `BENCHMARK_CRON_PROMPT_ORDER`
- `BENCHMARK_CRON_COHORT_TAG`

Leave `BENCHMARK_CRON_PROMPT_LIMIT` unset for the normal twice-monthly full run
across all tracked prompts.

## Configure inputs (no code edits needed)

Edit `/Users/jamesm/projects/easy_llm_benchmarker/config/benchmark/config.json`:

- `queries`: list of query strings.
- `queryTags` (optional): per-query tags map (example tags: `javascript`, `react`, `general`).
- `competitors`: list of entities to track (keep `Highcharts` included).
- `aliases`: optional mention variants per competitor.

## Exact commands

```bash
cd /Users/jamesm/projects/easy_llm_benchmarker
cp .env.monthly.example .env.monthly
```

Edit `/Users/jamesm/projects/easy_llm_benchmarker/.env.monthly` and set:
- `OPENAI_API_KEY` (required for GPT models)
- `ANTHROPIC_API_KEY` (required for Claude models)
- `GEMINI_API_KEY` (required for Gemini models)
- `GSHEET_WEBAPP_URL`
- `GSHEET_WEBAPP_SECRET`
- `GSHEET_TAB_NAME`
- `GSHEET_COMPETITOR_TAB_NAME`
- Optional: `SF_TARGET_ORG` (Salesforce org alias for SOQL helper script)

Run benchmark only:
```bash
cd /Users/jamesm/projects/easy_llm_benchmarker
python3 /Users/jamesm/projects/easy_llm_benchmarker/llm_mention_benchmark.py --our-terms "Highcharts" --web-search
```

Build Looker CSV/KPI only:
```bash
cd /Users/jamesm/projects/easy_llm_benchmarker
python3 /Users/jamesm/projects/easy_llm_benchmarker/scripts/build_looker_dataset.py
```

Push current Looker CSV to Google Sheets only:
```bash
cd /Users/jamesm/projects/easy_llm_benchmarker
python3 /Users/jamesm/projects/easy_llm_benchmarker/scripts/push_to_sheets_webapp.py --csv /Users/jamesm/projects/easy_llm_benchmarker/output/looker_studio_table_paste.csv
```

Push competitor chart CSV (mention rate + share of voice) only:
```bash
cd /Users/jamesm/projects/easy_llm_benchmarker
python3 /Users/jamesm/projects/easy_llm_benchmarker/scripts/push_to_sheets_webapp.py --csv /Users/jamesm/projects/easy_llm_benchmarker/output/looker_competitor_chart.csv --sheet-name "CompetitorMetrics"
```

Run full pipeline (benchmark -> build -> append to sheet):
```bash
cd /Users/jamesm/projects/easy_llm_benchmarker
bash /Users/jamesm/projects/easy_llm_benchmarker/scripts/monthly_run.sh
```

Install monthly scheduler (day 1, 09:00 local) and test trigger:
```bash
cd /Users/jamesm/projects/easy_llm_benchmarker
bash /Users/jamesm/projects/easy_llm_benchmarker/scripts/install_launch_agent.sh
launchctl kickstart -k gui/$(id -u)/com.jamesm.easy_llm_benchmarker.monthly
```

Outputs:

- `/Users/jamesm/projects/easy_llm_benchmarker/output/llm_outputs.jsonl`
- `/Users/jamesm/projects/easy_llm_benchmarker/output/comparison_table.csv`
- `/Users/jamesm/projects/easy_llm_benchmarker/output/viability_index.csv`
- `/Users/jamesm/projects/easy_llm_benchmarker/output/looker_studio_table_paste.csv`
- `/Users/jamesm/projects/easy_llm_benchmarker/output/looker_kpi.csv`
- `/Users/jamesm/projects/easy_llm_benchmarker/output/looker_competitor_chart.csv`

## Salesforce SOQL via `sf` CLI (optional)

Yes, you can query Salesforce directly from this project with SOQL.

1) Install Salesforce CLI (`sf`) if not already installed:
- macOS (Homebrew): `brew install sf`
- Or installer: https://developer.salesforce.com/tools/salesforcecli

2) Authenticate your org and set alias:
```bash
sf org login web --alias my-sandbox --set-default
```

3) Add alias to local env (optional but recommended):
```bash
# in /Users/jamesm/projects/easy_llm_benchmarker/.env.monthly
SF_TARGET_ORG=my-sandbox
```

4) Run a SOQL query through the repo helper:
```bash
cd /Users/jamesm/projects/easy_llm_benchmarker
python3 /Users/jamesm/projects/easy_llm_benchmarker/scripts/fetch_salesforce_soql.py \
  --query "SELECT Id, Name FROM Account LIMIT 20"
```

5) Save output JSON under `output/`:
```bash
cd /Users/jamesm/projects/easy_llm_benchmarker
python3 /Users/jamesm/projects/easy_llm_benchmarker/scripts/fetch_salesforce_soql.py \
  --query "SELECT Id, Name FROM Account LIMIT 20" \
  --output salesforce/accounts.json
```

Useful flags:
- `--target-org my-org` to override `SF_TARGET_ORG`
- `--query-file /path/to/query.soql` to keep long SOQL in a file
- `--use-tooling-api` for metadata/object model queries
- `--bulk --wait 10` for larger result sets
- `--raw` to print full raw `sf --json` payload

Direct CLI equivalent (without helper script):
```bash
sf data query \
  --target-org my-sandbox \
  --query "SELECT Id, Name FROM Account LIMIT 20" \
  --result-format json
```

## Monthly automation

See `/Users/jamesm/projects/easy_llm_benchmarker/docs/monthly_automation.md`.

## Supabase (optional backend)

Schema SQL:
- `/Users/jamesm/projects/easy_llm_benchmarker/supabase/sql/001_init_schema.sql`
- `/Users/jamesm/projects/easy_llm_benchmarker/supabase/sql/002_allow_anon_config_writes.sql`
- `/Users/jamesm/projects/easy_llm_benchmarker/supabase/sql/003_restrict_public_response_reads.sql`
- `/Users/jamesm/projects/easy_llm_benchmarker/supabase/sql/004_prompt_query_tags.sql`
- `/Users/jamesm/projects/easy_llm_benchmarker/supabase/sql/005_competitor_blog_posts.sql`
- `/Users/jamesm/projects/easy_llm_benchmarker/supabase/sql/006_benchmark_response_model_metrics.sql`
- `/Users/jamesm/projects/easy_llm_benchmarker/supabase/sql/007_pgmq_job_queue.sql`
- `/Users/jamesm/projects/easy_llm_benchmarker/supabase/sql/008_materialized_views.sql`
- `/Users/jamesm/projects/easy_llm_benchmarker/supabase/sql/009_enqueue_benchmark_run.sql`
- `/Users/jamesm/projects/easy_llm_benchmarker/supabase/sql/010_fix_finalize_overall_score.sql`
- `/Users/jamesm/projects/easy_llm_benchmarker/supabase/sql/011_exclude_failed_from_visibility.sql`
Apply in numeric order when provisioning a new project.

Environment variables:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_SYNC=1` (optional: auto-sync after monthly run)

Manual sync to Supabase:
```bash
cd /Users/jamesm/projects/easy_llm_benchmarker
python3 -m pip install -r requirements.txt
python3 /Users/jamesm/projects/easy_llm_benchmarker/scripts/push_to_supabase.py
```

Push competitor blog feed output to Supabase:
```bash
cd /Users/jamesm/projects/easy_llm_benchmarker
python3 /Users/jamesm/projects/easy_llm_benchmarker/scripts/push_competitor_blogs_to_supabase.py --input /path/to/competitor_blog_posts.json
```

Frontend local env (for direct Supabase reads/writes in UI):
- `/Users/jamesm/projects/easy_llm_benchmarker/ui/.env.local`
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY` (or `VITE_SUPABASE_PUBLISHABLE_KEY`)
