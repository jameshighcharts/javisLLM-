# UI

Vite + React dashboard/admin app.

## Supabase env

Create `/Users/jamesm/projects/easy_llm_benchmarker/ui/.env.local`:

```bash
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-or-publishable-key
OPENAI_API_KEY=required-for-local-query-lab
ANTHROPIC_API_KEY=required-for-claude-query-lab
GEMINI_API_KEY=required-for-gemini-query-lab
# Optional local-only ChatGPT web UI scraping for Query Lab:
ENABLE_CHATGPT_WEB_SCRAPER=true
CHATGPT_SESSION_COOKIE=name=value; other=value
# Optional:
# CHATGPT_WEB_HEADLESS=true
# CHATGPT_WEB_TIMEOUT_MS=90000
# CHATGPT_WEB_SLOW_MO_MS=0
```

When these vars are set, the UI reads/writes prompts/competitors directly in Supabase.
If missing, it falls back to `/api/*`.
Run trigger auth uses a token field in the UI and stores it in browser session storage.

Compliance note: the ChatGPT web scraper is for internal/local benchmarking only and may violate OpenAI Terms of Service.

## Local run

```bash
cd /Users/jamesm/projects/easy_llm_benchmarker/ui
npm run dev
```

This starts both:
- UI (`http://localhost:5173`)
- local API (`http://localhost:8787`)
