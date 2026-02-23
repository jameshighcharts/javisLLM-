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
