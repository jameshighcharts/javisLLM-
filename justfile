install:
    pnpm install
    uv sync

dev:
    pnpm run dev

dev-web:
    pnpm run dev:web

dev-api:
    pnpm run dev:api

dev-worker:
    uv run python -m worker.benchmark_worker

test:
    pnpm run test

verify:
    pnpm run verify
