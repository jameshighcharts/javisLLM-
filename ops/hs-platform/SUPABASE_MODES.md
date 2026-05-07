## Supabase Modes

This repo uses Supabase in three distinct ways:

- frontend direct reads and writes via `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
- frontend auth via `supabase.auth.signInWithOtp(...)`
- backend and worker writes via `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`

Current repo scan:

- used: database and auth
- not found in current code scan: storage and realtime

Choose one mode before promoting the HS app rollout:

### 1. Managed Supabase

Use this when Supabase remains hosted by Supabase.

What changes:

- no Supabase platform rollout is needed
- the HS app consumes the managed Supabase URL and keys through AWS secrets and web build args

What you still must do:

- point `SUPABASE_URL` and `VITE_SUPABASE_URL` at the managed project URL
- populate anon and service-role keys
- add HS app URLs to Supabase auth redirect allowlists

### 2. Existing Self-Hosted Supabase

Use this when some other team or environment already runs Supabase on your own infrastructure.

What changes:

- the HS app still uses the same manifests in `ops-repo-template/`
- the secret values now point at your self-hosted Supabase public gateway instead of `*.supabase.co`

What you still must do:

- confirm the public Supabase gateway URL
- confirm anon and service-role keys
- confirm `SITE_URL` and redirect configuration include the HS app URLs
- verify health and auth against that existing Supabase instance

### 3. New Self-Hosted Supabase Stack

Use this when you are responsible for running Supabase yourself.

What changes:

- the app rollout and the Supabase rollout become two workstreams
- the app manifests in `ops-repo-template/` are still valid, but only after the Supabase platform outputs exist
- you must treat Supabase as a separate platform service with its own secrets, health checks, HTTPS, backups, and monitoring

What you still must do:

- complete the operator checklist in `self-hosted-supabase/README.md`
- create the Supabase platform secrets in your infra
- publish the public gateway URL and keys that the app will consume
- only then wire those outputs into the app secrets and web image build
