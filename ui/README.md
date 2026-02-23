# UI

Vite + React dashboard/admin app.

## Supabase env

Create `/Users/jamesm/projects/easy_llm_benchmarker/ui/.env.local`:

```bash
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-or-publishable-key
```

When these vars are set, the UI reads/writes prompts/competitors directly in Supabase.
If missing, it falls back to `/api/*`.
