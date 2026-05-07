## Self-Hosted Supabase Handoff

Use this only if the team is running Supabase on its own infrastructure.

This repo's HS app manifests do not deploy Supabase itself. They only consume:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Those values can come from managed Supabase or from a self-hosted Supabase gateway.

### Current App Footprint

From the current repo scan, this app depends on:

- Supabase database and REST access
- Supabase auth from the frontend
- service-role writes from the API and worker

I did not find current usage of:

- Supabase storage
- Supabase realtime

That means a self-hosted rollout may not need the full Supabase optional surface area, but that still requires an operator decision.

### Operator Outputs This App Needs

Before the app can be fully deployed against self-hosted Supabase, the Supabase operator workstream must hand back:

- public Supabase gateway URL
- anon key
- service-role key
- confirmation that auth redirects back to each app hostname work
- confirmation of backup ownership and restore procedure
- confirmation of HTTPS termination and public DNS

### Required Public URLs

For self-hosted Supabase auth, confirm these explicitly:

- `API_EXTERNAL_URL`: public URL of the Supabase instance
- `SUPABASE_PUBLIC_URL`: public URL exposed to clients, if your deployment distinguishes it
- `SITE_URL`: app URL used after successful auth
- `ADDITIONAL_REDIRECT_URLS`: include all HS app hostnames used for dev, staging, and prod

This repo currently sends magic-link auth users back to `window.location.origin`, so each deployed app hostname must be allowed.

### Minimum Capacity Guidance

Based on the skill reference:

- RAM: `4 GB` minimum, `8 GB+` recommended
- CPU: `2 cores` minimum, `4 cores+` recommended
- Disk: `50 GB SSD` minimum, `80 GB+` recommended

### What I Could Not Safely Do Here

I did not generate a fake Kubernetes translation of the full Supabase platform.

Reason:

- the skill guidance treats self-hosted Supabase as a separate platform workload
- official guidance centers on the Supabase Docker deployment
- the correct HS implementation depends on your team's actual infra choice, ingress pattern, storage class, backup tooling, and who owns the database operations

### Operator Checklist

1. Decide whether you are hosting full Supabase or consuming an already-running self-hosted instance.
2. Provision compute, storage, backup ownership, and monitoring for the Supabase platform.
3. Create the secrets listed in `required-secrets.env.example` with real non-placeholder values.
4. Expose the Supabase gateway over HTTPS with a stable public DNS name.
5. Set `API_EXTERNAL_URL`, `SITE_URL`, and `ADDITIONAL_REDIRECT_URLS` correctly.
6. Configure any OAuth providers against the self-hosted callback URLs if provider auth is in use.
7. Validate auth, API health, backups, and restore procedure before cutting the app over.
8. Feed the resulting `SUPABASE_URL`, anon key, and service-role key into the app deployment secrets and web image build.

### App Cutover After Supabase Is Ready

Once the self-hosted instance exists, wire these into the app rollout:

- web build args:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
- app AWS secrets:
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`

Then test:

- `https://<app-host>/api/health`
- login or magic-link flow
- prompt/config reads from the UI
- benchmark queue trigger and worker writes
