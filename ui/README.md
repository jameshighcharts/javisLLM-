# easy_llm_benchmarker UI

React + `shadcn/ui` dashboard/admin app for benchmark visibility data.

## Modes

- Local full mode (`npm run dev`):
  - Uses local API (`/api/*`)
  - Reads `/Users/jamesm/projects/easy_llm_benchmarker/output/*`
  - Writes `/Users/jamesm/projects/easy_llm_benchmarker/config/benchmark_config.json`
- Hosted snapshot mode (Vercel):
  - Uses bundled files in `/Users/jamesm/projects/easy_llm_benchmarker/ui/public/data`
  - Admin saves to browser local storage
  - Config can be exported via Download JSON

## Local dev

```bash
cd /Users/jamesm/projects/easy_llm_benchmarker/ui
npm install
npm run dev
```

- UI: `http://localhost:5173`
- API: `http://localhost:8787`

## Refresh snapshot data (for deployment)

Run this before deploying so Vercel has latest benchmark outputs/config:

```bash
cd /Users/jamesm/projects/easy_llm_benchmarker/ui
npm run sync:data
```

This regenerates:

- `/Users/jamesm/projects/easy_llm_benchmarker/ui/public/data/config.json`
- `/Users/jamesm/projects/easy_llm_benchmarker/ui/public/data/dashboard.json`

## Build

```bash
cd /Users/jamesm/projects/easy_llm_benchmarker/ui
npm run build
```
