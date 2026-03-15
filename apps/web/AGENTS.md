# apps/web

- Keep UI code in `src/`.
- Prefer feature-scoped modules under `src/features/` for new work.
- Route URLs must remain stable unless explicitly requested.
- Use `@easy-llm-benchmarker/api-client` or `src/api.ts` compatibility wrappers for HTTP access.
- Do not add new direct Supabase table/view reads from the web app.
