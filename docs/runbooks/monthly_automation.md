# Monthly Automation Setup (Mac `launchd` + Apps Script)

## 1) Configure environment
```bash
cd /Users/jamesm/projects/easy_llm_benchmarker
cp .env.monthly.example .env.monthly
```

Update `/Users/jamesm/projects/easy_llm_benchmarker/.env.monthly` with real values:
- `OPENAI_API_KEY`
- `GSHEET_WEBAPP_URL`
- `GSHEET_WEBAPP_SECRET`
- `GSHEET_TAB_NAME`
- `GSHEET_COMPETITOR_TAB_NAME` (tab for competitor mention-rate/share-of-voice dataset)
- `BENCHMARK_CONFIG_PATH` (optional, defaults to `config/benchmark_config.json`)
- `SUPABASE_URL` (optional)
- `SUPABASE_SERVICE_ROLE_KEY` (optional)
- `SUPABASE_SYNC=1` to push each monthly run to Supabase

Benchmark inputs now live in:
- `/Users/jamesm/projects/easy_llm_benchmarker/config/benchmark_config.json`
  - `queries`
  - `competitors`
  - `aliases`

## 2) Deploy Apps Script web app
1. Open your target Google Sheet.
2. Extensions -> Apps Script.
3. Paste `/Users/jamesm/projects/easy_llm_benchmarker/automation/apps_script/Code.gs` into `Code.gs`.
4. In Apps Script:
   - Project Settings -> Script properties.
   - Add key `WEBAPP_SECRET` with the same value as `GSHEET_WEBAPP_SECRET`.
5. Deploy -> New deployment -> Web app:
   - Execute as: `Me`
   - Who has access: as restrictive as possible for your workflow.
6. Copy deployed web app URL into `GSHEET_WEBAPP_URL`.

## 3) Validate push payload (no write)
```bash
python3 /Users/jamesm/projects/easy_llm_benchmarker/scripts/build_looker_dataset.py
python3 /Users/jamesm/projects/easy_llm_benchmarker/scripts/push_to_sheets_webapp.py --dry-run
python3 /Users/jamesm/projects/easy_llm_benchmarker/scripts/push_to_sheets_webapp.py --csv /Users/jamesm/projects/easy_llm_benchmarker/output/looker_competitor_chart.csv --sheet-name CompetitorMetrics --dry-run
```

## 4) Run full flow once manually
```bash
/Users/jamesm/projects/easy_llm_benchmarker/scripts/monthly_run.sh
```

Expected push status:
- `appended` for each new run (append-only)
- `skipped_duplicate` only if the same `run_id` is pushed again

Optional Supabase sync only (manual):
```bash
python3 /Users/jamesm/projects/easy_llm_benchmarker/scripts/push_to_supabase.py
```

## 5) Install monthly scheduler (day 1, 09:00 local)
```bash
/Users/jamesm/projects/easy_llm_benchmarker/scripts/install_launch_agent.sh
```

Manual trigger:
```bash
launchctl kickstart -k gui/$(id -u)/com.jamesm.easy_llm_benchmarker.monthly
```

## Logs
- Launchd stdout: `/Users/jamesm/projects/easy_llm_benchmarker/output/logs/launchd.out.log`
- Launchd stderr: `/Users/jamesm/projects/easy_llm_benchmarker/output/logs/launchd.err.log`
- Monthly run logs: `/Users/jamesm/projects/easy_llm_benchmarker/output/logs/monthly_<run_month>_<run_id>.log`
