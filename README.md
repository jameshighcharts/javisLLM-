# easy_llm_benchmarker

Benchmark LLM mention visibility for Highcharts vs competitors across a query set, then export CSV + Looker + Google Sheets-ready datasets.

## Project structure

- `/Users/jamesm/projects/easy_llm_benchmarker/llm_mention_benchmark.py`: main benchmark runner (OpenAI Responses API).
- `/Users/jamesm/projects/easy_llm_benchmarker/config/benchmark_config.json`: editable queries, competitors, aliases.
- `/Users/jamesm/projects/easy_llm_benchmarker/scripts/build_looker_dataset.py`: builds canonical Looker dataset + KPI CSV.
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
- `/Users/jamesm/projects/easy_llm_benchmarker/config/benchmark_config.json`

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
- `GITHUB_TOKEN` (PAT with `repo` + `workflow` access to this repo)
- `GITHUB_OWNER` (e.g. `jameshighcharts`)
- `GITHUB_REPO` (e.g. `javisLLM-`)
- Optional: `GITHUB_WORKFLOW_FILE` (default: `run-benchmark.yml`)
- Optional: `GITHUB_WORKFLOW_REF` (default: `main`)
- Optional hardening: `BENCHMARK_TRIGGER_TOKEN`

Without these vars, the deployed frontend may fail at runtime because `/api` fallback is local-only.

After deploy, open `/diagnostics` in the app to run runtime diagnostics from Vercel:
- Supabase connectivity
- Required table checks (`prompt_queries`, `competitors`, `competitor_aliases`, `benchmark_runs`, `benchmark_responses`, `response_mentions`)
- Highcharts primary-competitor check
- Latest run readiness check

Note: `/diagnostics` runs app-level diagnostics, not `pytest` execution.

To run real prompt/scoring runs from the app, open `/runs`:
- Trigger benchmark workflow from UI
- Monitor run state (queued/running/success/failure)
- Open GitHub Actions logs directly
- Dashboard updates after workflow syncs to Supabase

### GitHub Actions secrets (required for `/runs`)

In GitHub repo settings -> Secrets and variables -> Actions, add:
- `OPENAI_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Workflow file used by `/runs` trigger:
- `/Users/jamesm/projects/easy_llm_benchmarker/.github/workflows/run-benchmark.yml`

## Configure inputs (no code edits needed)

Edit `/Users/jamesm/projects/easy_llm_benchmarker/config/benchmark_config.json`:

- `queries`: list of query strings.
- `competitors`: list of entities to track (keep `Highcharts` included).
- `aliases`: optional mention variants per competitor.

## Exact commands

```bash
cd /Users/jamesm/projects/easy_llm_benchmarker
cp .env.monthly.example .env.monthly
```

Edit `/Users/jamesm/projects/easy_llm_benchmarker/.env.monthly` and set:
- `OPENAI_API_KEY`
- `GSHEET_WEBAPP_URL`
- `GSHEET_WEBAPP_SECRET`
- `GSHEET_TAB_NAME`
- `GSHEET_COMPETITOR_TAB_NAME`

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

## Monthly automation

See `/Users/jamesm/projects/easy_llm_benchmarker/docs/monthly_automation.md`.

## Supabase (optional backend)

Schema SQL:
- `/Users/jamesm/projects/easy_llm_benchmarker/supabase/sql/001_init_schema.sql`
- Optional policy patch (frontend anon writes for config tables):
  - `/Users/jamesm/projects/easy_llm_benchmarker/supabase/sql/002_allow_anon_config_writes.sql`

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

Frontend local env (for direct Supabase reads/writes in UI):
- `/Users/jamesm/projects/easy_llm_benchmarker/ui/.env.local`
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY` (or `VITE_SUPABASE_PUBLISHABLE_KEY`)
