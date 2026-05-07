## Ops repo template

Copy this tree into the matching HS ops repo, usually `hs-platform-ops-<team>`.

What to replace before syncing:

- `ghcr.io/highsoft-corp/...` image names if your registry path differs
- `marketing/easy-llm-benchmarker/...` AWS secret prefix if your team/app naming differs
- `replace-with-team-cluster-issuer` in the certificate manifest
- default hostnames in each environment overlay if the public URL should use a different slug

Important behavior:

- `web` is static and expects environment-specific images because `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are compiled into the build.
- `api` and `worker` read runtime secrets from `ExternalSecret` generated Kubernetes secrets.
- path routing is intentional so the frontend can keep using relative `/api` URLs.
- queue mode is enabled in the API scaffold, so GitHub workflow dispatch is intentionally not wired here
- these manifests deploy only the product app. They do not deploy Supabase itself.
- `SUPABASE_URL` may point either to managed Supabase or to your own self-hosted Supabase gateway.

Required AWS secret values for the current scaffold:

- API secret bundle:
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `OPENAI_API_KEY`
  - `ANTHROPIC_API_KEY`
  - `GEMINI_API_KEY`
  - `BENCHMARK_TRIGGER_TOKEN`
- Worker secret bundle:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `OPENAI_API_KEY`
  - `ANTHROPIC_API_KEY`
  - `GEMINI_API_KEY`

Smoke tests after Argo sync:

- `https://<env-host>/api/health`
- `https://<env-host>/`
- `https://<env-host>/runs`
- `https://<env-host>/prompts`

Auth-specific checks:

- the Supabase project or self-hosted auth config must allow redirects back to each HS app hostname
- if using self-hosted Supabase auth, make sure `SITE_URL`, `ADDITIONAL_REDIRECT_URLS`, and the public `API_EXTERNAL_URL` are already correct before debugging the app

Self-hosted Supabase note:

- if the team is also hosting Supabase on its own infrastructure, use the separate pack in `../self-hosted-supabase/` first, then feed the resulting public URL and keys back into these app manifests

If your team standard uses `Ingress` instead of `HTTPProxy`, keep the service split and same-host `/api` routing, then swap only the route object.
