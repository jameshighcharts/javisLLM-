# easy_llm_benchmarker

## Repo map

- `apps/web`: React/Vite app. UI only.
- `apps/api`: canonical local and hosted API app.
- `apps/worker`: queue worker runtime.
- `apps/benchmark-cli`: thin Python CLI entrypoint.
- `packages/py/benchmark_core`: Python benchmark/export/sync logic.
- `packages/ts/contracts`: shared API schemas and DTO types.
- `packages/ts/api-client`: shared browser HTTP client.
- `supabase/migrations`: schema source of truth.
- `config/benchmark/config.json`: tracked benchmark config.
- `artifacts/`: generated outputs, logs, exports.

## Commands

- `pnpm run dev`: run web + API.
- `pnpm run build`: build workspace packages used by deploys.
- `pnpm run verify`: lint, typecheck, and test.
- `uv run python -m worker.benchmark_worker`: run worker locally.
- `uv run python apps/benchmark-cli/main.py run ...`: benchmark CLI.

## Invariants

- Root `api/` files are wrappers only.
- Web reads product data through `/api/*`, not direct Supabase reads, unless explicitly marked transitional.
- Supabase migrations are append-only. Do not edit historical semantics.
- Keep root Python and script entrypoints as compatibility shims while callers still depend on them.
