# UI

Vite + React dashboard/admin app.

## Supabase env

Create `/Users/jamesm/projects/easy_llm_benchmarker/ui/.env.local`:

```bash
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-or-publishable-key
OPENAI_API_KEY=required-for-local-query-lab
```

When these vars are set, the UI reads/writes prompts/competitors directly in Supabase.
If missing, it falls back to `/api/*`.
Run/Prompt-Lab trigger auth uses a token field in the UI and stores it in browser session storage.

## Local run

```bash
cd /Users/jamesm/projects/easy_llm_benchmarker/ui
npm run dev
```

This starts both:
- UI (`http://localhost:5173`)
- local API (`http://localhost:8787`)
