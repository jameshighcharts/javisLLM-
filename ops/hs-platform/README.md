## HS platform starter

This folder starts an HS platform rollout without touching the current Vercel or Railway setup.

It is split into two parts:

- `app-images/`: Dockerfiles for the three runtimes that already exist in this repo.
- `ops-repo-template/`: Kustomize and `ExternalSecret` templates to copy into the team HS ops repo.
- `self-hosted-supabase/`: operator handoff pack if Supabase will also run on your own infrastructure.

First decision:

1. The app consumes managed Supabase.
2. The app consumes an already-running self-hosted Supabase.
3. You are also standing up a self-hosted Supabase stack.

This starter now supports all three, but only the app services are templated as Kubernetes manifests here.
Supabase itself is treated as a separate platform workload and has its own handoff pack.

Deployment shape:

- `easy-llm-benchmarker-web`: static Vite build served on port `8080`
- `easy-llm-benchmarker-api`: Express API served on port `8787`
- `easy-llm-benchmarker-worker`: background queue worker with no public ingress

Routing stays same-host on purpose:

- `/api` goes to the API service
- everything else goes to the web service

That keeps the frontend's relative `/api` calls working without changing legacy app code.

Current assumptions:

- start with HS `dev`, then promote to `staging`, then `prod`
- the web image is environment-specific because Vite bakes `VITE_*` values into the static build
- the ChatGPT Playwright scraper stays disabled on HS for now
- the app uses Supabase for data access and auth, whether managed or self-hosted
- the current repo scan shows app usage of Supabase database APIs plus auth; no storage or realtime usage was found

Suggested next steps:

1. Decide the Supabase mode using `SUPABASE_MODES.md`.
2. Replace placeholder hostnames, GHCR image names, and AWS secret prefixes in `ops-repo-template/`.
3. Build and push three images per environment from the Dockerfiles in `app-images/`.
4. Copy `ops-repo-template/apps/...` into the correct `hs-platform-ops-<team>` repo.
5. Create the referenced AWS secrets in the correct HS account and region for each environment.
6. If Supabase is self-hosted, complete the separate checklist in `self-hosted-supabase/`.
7. Sync the dev Argo app first and smoke test `/api/health`, `/`, `/runs`, `/prompts`, and auth.

Build examples:

```bash
docker build -f ops/hs-platform/app-images/api.Dockerfile -t ghcr.io/highsoft-corp/easy-llm-benchmarker-api:0.1.0-dev .

docker build \
  -f ops/hs-platform/app-images/web.Dockerfile \
  --build-arg VITE_SUPABASE_URL="https://supabase-or-your-own-gateway.example.com" \
  --build-arg VITE_SUPABASE_ANON_KEY="your-publishable-key" \
  -t ghcr.io/highsoft-corp/easy-llm-benchmarker-web:0.1.0-dev \
  .

docker build -f ops/hs-platform/app-images/worker.Dockerfile -t ghcr.io/highsoft-corp/easy-llm-benchmarker-worker:0.1.0-dev .
```

Notes:

- If your team uses `Ingress` instead of `HTTPProxy`, only the route object needs to be adapted.
- Add the HS hostnames to Supabase Auth redirect allowlists before testing sign-in flows.
- For self-hosted Supabase, that means configuring `SITE_URL`, `ADDITIONAL_REDIRECT_URLS`, and the public Supabase gateway URL before app auth testing.
