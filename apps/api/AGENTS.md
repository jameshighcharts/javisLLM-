# apps/api

- `src/server.ts` is the shared app used by local dev and Vercel wrappers.
- `src/handlers/` contains migrated legacy serverless handlers.
- Add new BFF routes in `src/server.ts` or extracted service modules, then expose them through thin root `api/` wrappers.
- Keep service-role Supabase access server-side only.
