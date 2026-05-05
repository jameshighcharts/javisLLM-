# CLAUDE.md

## What this is

LLM visibility benchmarker — tracks how often Highcharts (and configured competitors) get mentioned across LLM query responses. Runs multi-model benchmarks (OpenAI, Anthropic, Gemini), stores results in Supabase, and exposes a React admin dashboard.

## Repo structure

```
/
├── ui/                  # React + Vite frontend + local Express API server
│   ├── src/
│   │   ├── App.tsx      # routes
│   │   ├── api.ts       # all API/Supabase calls (single file)
│   │   ├── types.ts     # all shared TypeScript types (single file)
│   │   ├── pages/       # one file per route
│   │   ├── components/  # shared UI components
│   │   └── utils/       # modelPricing.ts, citationSources.ts, taskColors.ts
│   └── server/index.ts  # local Express server (mirrors Vercel API for dev)
├── api/                 # Vercel serverless functions (JS)
│   ├── benchmark/       # runs.js, trigger.js
│   ├── prompt-lab/      # run.js
│   └── research/        # gaps, briefs, competitors, sitemap, prompt-cohorts
├── worker/
│   └── benchmark_worker.py  # Python: dequeues PGMQ jobs, runs LLM calls
├── config/
│   └── benchmark/config.json  # editable queries, competitors, aliases
├── supabase/sql/        # migrations 001–012 (apply in order)
├── scripts/             # build_looker_dataset.py, push_to_sheets_webapp.py, monthly_run.sh
└── tests/               # pytest + .mjs test files
```

## Dev workflow

```bash
cd ui
npm install
npm run dev          # UI on :5173, local API on :8787
npm run build        # tsc + vite build (run before committing)
```

`npm run dev` uses `concurrently` to run Vite and `tsx watch server/index.ts` together. The Express server in `server/index.ts` is the local equivalent of the Vercel API functions.

## Key env vars

**`ui/.env.local`** (frontend):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` (also accepts `VITE_SUPABASE_PUBLISHABLE_KEY`)

**Vercel project env** (also needed locally via `.env`):
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`
- `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`
- `BENCHMARK_TRIGGER_TOKEN` — bearer token required for `/api/benchmark/*`
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server-side; different from anon key)

## Architecture

- **UI data flow**: `src/api.ts` → Supabase JS client (direct reads) + `fetch('/api/...')` (mutations/triggers)
- **Local dev**: `/api/*` calls hit `server/index.ts` (Express)
- **Production**: `/api/*` calls hit Vercel serverless functions in `api/`
- **Benchmark jobs**: triggered via `/api/benchmark/trigger` → PGMQ queue in Supabase → `benchmark_worker.py` dequeues and runs
- **Materialized views**: heavy aggregations live in Supabase (`mv_run_summary`, `mv_model_performance`, `mv_competitor_mention_rate`) — refresh after data changes

## Routes

| Path | Page |
|------|------|
| `/dashboard` | Main KPI dashboard |
| `/runs` | Trigger + monitor benchmark runs |
| `/prompts` | Prompt management + Query Lab (one-off LLM test) |
| `/query-lab` | Query Lab only |
| `/prompt-research` | Cohort-based research tracking |
| `/prompt-drilldown` | Per-prompt run history |
| `/competitors` | Competitor mention rates |
| `/competitor-blogs` | Competitor content feed |
| `/citation-links` | Citation source analysis |
| `/under-the-hood` | Token/cost/latency stats |
| `/logics` | Diagnostics + system health |
| `/okr/kr-2-1`, `/okr/kr-2-3` | OKR tracking (lazy-loaded) |

## Code conventions

- All TypeScript types in `src/types.ts` — add new types there, don't create separate type files
- All API/Supabase calls in `src/api.ts` — no inline fetches in components
- Pages are self-contained; shared UI pieces go in `components/`
- Tailwind for styling; inline `style={}` only for dynamic/branded colors (the off-white/green palette)
- Zod used for runtime validation in `server/index.ts`
- No test framework in the UI — tests are in `tests/` (Python pytest + Node .mjs)

## Supabase schema

Apply migrations in order: `supabase/sql/001_*.sql` through `012_*.sql`. Key tables: `prompt_queries`, `competitors`, `competitor_aliases`, `benchmark_runs`, `benchmark_responses`, `response_mentions`. PGMQ queue added in `007`. Materialized views in `008`.

## Config-driven inputs

`config/benchmark/config.json` controls queries, competitors, and aliases. The UI admin panel can write back to this file (local) or update Supabase directly. No code changes needed to add/remove tracked entities.

## Python benchmark runner

```bash
python3 llm_mention_benchmark.py --our-terms "Highcharts" --web-search
```

Outputs to `output/` (JSONL, CSV). Worker (`worker/benchmark_worker.py`) handles the queue-based variant.
