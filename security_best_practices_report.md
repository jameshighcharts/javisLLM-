# Security Best Practices Review Report

Date: 2026-03-03  
Repository: `/Users/jamesm/projects/easy_llm_benchmarker`

## Scope and assumptions

### In scope
- Serverless API (`/Users/jamesm/projects/easy_llm_benchmarker/api/**/*.js`)
- Local Express API server (`/Users/jamesm/projects/easy_llm_benchmarker/ui/server/index.ts`)
- Frontend auth/data access paths (`/Users/jamesm/projects/easy_llm_benchmarker/ui/src/**`)
- Supabase schema/policies/functions (`/Users/jamesm/projects/easy_llm_benchmarker/supabase/sql/*.sql`)
- Worker and automation scripts (`/Users/jamesm/projects/easy_llm_benchmarker/worker/**`, `/Users/jamesm/projects/easy_llm_benchmarker/scripts/**`)
- CI workflow (`/Users/jamesm/projects/easy_llm_benchmarker/.github/workflows/run-benchmark.yml`)

### Out of scope / missing context
- Live cloud account posture (AWS/GCP/Vercel org settings, IAM roles, network ACLs, WAF)
- Supabase project runtime configuration (Auth signup policy, JWT claims customizations, key rotation, IP restrictions)
- Branch protection, CODEOWNERS enforcement, deployment approval rules in Git hosting UI
- External third-party service configurations (Stripe dashboard restrictions, OpenAI org controls)

### Explicit assumptions that could change conclusions
1. This platform is intended to operate as SaaS (not purely single-tenant internal tooling).
2. At least one deployment mode exposes API routes beyond localhost.
3. Supabase `authenticated` can include more than a tiny trusted admin set unless explicitly restricted in Supabase Auth.
4. Prompt/benchmark/research data is considered non-public business data.

---

# Part 1: Concise Security Report

## Overall risk summary
The current security posture has multiple structural authorization weaknesses centered in database policy design, token model, and public attack surface. The highest risk issue is broad Supabase RLS policy/grant configuration that allows global read and write behavior (`using (true)`, `with check (true)`) for `authenticated`, plus broad `anon` read grants on multiple operational datasets and views. Several externally callable endpoints are intentionally unauthenticated (notably Prompt Lab), which creates direct cost-abuse and service exhaustion risk. Rate limiting is process-local and can be bypassed under distributed/serverless execution or spoofed client IP headers. Multi-tenant isolation is not implemented at schema/policy level, so any expansion beyond single trusted tenant materially increases breach likelihood. Positive controls exist (secure headers, pinned GH Actions SHAs, token checks on many mutation paths), but they do not sufficiently offset current authz and exposure gaps.

## Top 10 findings (prioritized)

| Id | Severity | Category | Affected components | One-line description | Likelihood / Impact | One-line fix recommendation |
|---|---|---|---|---|---|---|
| F-001 | Critical | Authorization / RLS | Supabase core + research tables | `authenticated` policies allow unrestricted global CRUD (`using true` + `with check true`) on key tables. | High / Critical | Replace broad policies with claim-scoped RLS (`tenant_id`, role claims), least-privilege grants, and explicit column/operation constraints. |
| F-002 | Critical | Data exposure | Supabase views/tables + research GET APIs | `anon` and broad `authenticated` read access exposes internal analytics and research datasets. | High / High | Remove `anon` grants for non-public data; create explicit public-safe projections only; require authenticated API authorization for sensitive reads. |
| F-003 | Critical | API abuse / cost | `/api/prompt-lab/run` (serverless + local) | Prompt Lab executes paid upstream LLM calls without trigger token auth. | High / High | Gate Prompt Lab with authz (signed user session + RBAC or server token), per-user quotas, and hard spend caps. |
| F-004 | High | AuthN bypass (deployment-mode specific) | Local Express proxy route wrapper | Proxy auto-injects fallback trigger token, effectively bypassing upstream trigger-token checks in proxied routes. | Medium / High | Remove fallback token auto-injection in non-dev; fail-closed when trigger token missing; require explicit client-provided auth. |
| F-005 | High | Abuse resistance | Shared rate-limit helpers | In-memory/IP-based limiter is bypassable in distributed/serverless environments and trusts spoofable headers. | High / Medium | Move to centralized rate limit store (Redis/KV), trust proxy chain explicitly, and bind limits to auth identity + IP. |
| F-006 | High | Secrets/token handling | Frontend Runs/PromptResearch token flow | Static bearer token is stored in browser `sessionStorage` and reused for privileged actions. | Medium / High | Replace shared static token with short-lived scoped tokens tied to authenticated users and rotate automatically. |
| F-007 | High | SSRF / egress control | Research sitemap sync pipeline | Sitemap URLs from DB are fetched with redirect-follow and no host allowlist, enabling server-side network probing. | Medium / High | Enforce strict URL allowlist, block RFC1918/link-local/metadata ranges, restrict redirects, and isolate fetch worker egress. |
| F-008 | High | Multi-tenancy | Schema + policy model | No tenant keying or tenant-aware RLS; data model is globally shared. | Medium / Critical (if multi-tenant) | Add `tenant_id` to all tenant-owned entities, enforce tenant-scoped RLS everywhere, and test cross-tenant denial paths. |
| F-009 | Medium (Inferred) | Authentication governance | Magic-link signup flow | Email-domain restriction is implemented client-side only; backend enforcement not visible in codebase. | Medium / High | Enforce allowed domains and invite-only policy in Supabase Auth and/or backend checks; log denied attempts. |
| F-010 | Medium | Privileged function surface | Supabase SECURITY DEFINER RPC + queue tables | Authenticated users can execute enqueue RPC and mutate queue tables under broad grants, enabling workload/cost abuse. | Medium / Medium-High | Restrict execute/mutation rights to service role or narrow internal role; route all job creation through hardened backend only. |

## Threat model notes and key assumptions
- Crown jewels: benchmark/query corpus, competitor research outputs, operational run metadata, API keys/service role credentials, queue integrity.
- Primary threat actors: external unauthenticated internet users, low-privileged authenticated users, token-leak attackers, malicious insiders.
- High-risk flows: benchmark triggering, prompt lab requests, research crawl/sync, direct client Supabase writes, queue/RPC paths.
- Assumed regulatory concerns: confidentiality/integrity of proprietary analytics; no evidence of explicit HIPAA/PCI scope in repository.

## Existing strengths and positive controls
- Security headers are configured in Vercel deployment config (`/Users/jamesm/projects/easy_llm_benchmarker/vercel.json:6-18`).
- Many mutating serverless endpoints enforce trigger token and rate limiting (e.g., `/Users/jamesm/projects/easy_llm_benchmarker/api/benchmark/trigger.js:501-508`).
- GitHub Actions workflow uses SHA-pinned actions and minimal workflow permissions (`contents: read`) (`/Users/jamesm/projects/easy_llm_benchmarker/.github/workflows/run-benchmark.yml:46-61`).
- A view hardening migration sets `security_invoker = true` on `vw_job_progress` (`/Users/jamesm/projects/easy_llm_benchmarker/supabase/sql/014_vw_job_progress_security_invoker.sql:1-3`).
- Dependency quick scan result during this review: no known vulnerabilities from `npm audit` (`ui`) and `pip-audit` (`requirements.txt`) at review time.

---

# Part 2: Action Plan

## 0-72 hours: stop the bleeding

1. Lock down public and broad DB access (Owner: Platform + Security)
- Remove `anon` selects from non-public tables/views and disable broad `authenticated` write policies.
- Immediate targets: `app_settings`, `research_runs`, `content_gap_items`, `prompt_research_cohorts`, `benchmark_jobs`, summary/materialized views.
- Expected reduction: sharply lowers unauthenticated reconnaissance and authenticated mass-tampering blast radius.

2. Require auth on Prompt Lab endpoints (Owner: App)
- Add strict auth middleware (trigger token minimum; preferable user session + RBAC) to `/api/prompt-lab/run` and `/api/prompt-lab/chatgpt-web`.
- Add fail-closed behavior when auth config is missing.
- Expected reduction: removes easiest direct cost-abuse vector.

3. Disable trigger-token fallback injection in local proxy for non-dev (Owner: App)
- Remove/guard fallback token creation in `ensureServerlessTriggerToken`.
- Ensure production startup fails if required token env vars are absent.
- Expected reduction: closes silent auth bypass path in proxy mode.

4. Add temporary spending and rate controls (Owner: SRE + App)
- Reduce per-minute caps and add global request budget guardrails for costly endpoints.
- Add emergency kill-switch env flags per feature (`prompt lab`, `research sync`, queue enqueue).
- Expected reduction: limits abuse impact while structural fixes land.

## 1-2 weeks: hardening and controls

1. Introduce claim-based authorization model (Owner: Platform + Security)
- Define roles (`viewer`, `operator`, `admin`, `service`) and enforce on API + DB layers.
- Replace static shared admin token patterns with user-bound authorization checks.

2. Replace in-process rate limiter with centralized limiter (Owner: App + SRE)
- Use Redis/KV keyed by auth principal + IP + endpoint.
- Add route-specific quotas, sliding windows, and anomaly counters.

3. SSRF hardening for crawler paths (Owner: App + Infra)
- URL validation policy, DNS/IP resolution checks, no private-address fetch, constrained redirects.
- Egress controls (VPC egress policy or outbound proxy deny-by-default).

4. Secrets posture improvements (Owner: Platform)
- Rotate `BENCHMARK_TRIGGER_TOKEN`, Supabase service-role key, and integration secrets.
- Move operational secrets to managed secret store with rotation policy and audit logs.

5. Add security-focused tests (Owner: App + Security)
- RLS unit tests for deny-by-default.
- Endpoint authz tests for every mutating and sensitive-read route.
- Regression test for trigger-token fallback bypass.

## 1-3 months: structural improvements

1. Multi-tenant architecture uplift (Owner: Platform + App)
- Add `tenant_id` columns, tenant-aware indexes, and strict RLS by `auth.jwt()` claims.
- Segregate queue/storage/search artifacts by tenant boundary.

2. Authorization centralization (Owner: App)
- Single policy enforcement layer for API routes, removing ad hoc route-level auth drift.
- Standardized policy decision logging for auditability.

3. Supply-chain and CI security maturation (Owner: SRE + Security)
- Add SAST, secret scanning, dependency monitoring, SBOM generation, and provenance attestations.
- Enforce branch protections and code-owner approvals for security-sensitive files.

4. Operational detection and response (Owner: SRE + Security)
- Build alerts for unusual prompt-lab volume, queue spikes, auth failures, and policy-denied events.
- Define incident runbooks for token leakage and abusive automation.

## Controls and measurement

### Security requirements for Definition of Done
- Every new endpoint declares required authn/authz and has tests for allow + deny paths.
- Any new table must include tenant/ownership model and RLS deny-by-default policy.
- Any external fetch path must include SSRF-safe validation and timeout/egress controls.
- No long-lived admin token in frontend storage.

### Minimum CI security gates
- SAST on JS/TS/Python.
- Secret scanning on commits and PRs.
- Dependency vulnerability checks with severity threshold fail gates.
- SQL policy linting/tests for RLS and grants.
- High-risk file CODEOWNER approval required (`api/**`, `supabase/sql/**`, auth middleware).

### Monitoring and alerts
- Endpoint-level auth failure rate, per-IP and per-user request spikes, prompt-lab spend anomaly alerts.
- DB audit logs for policy denies and privileged role access.
- Queue depth, dead-letter rate, enqueue burst anomalies.

### KPIs
- Time to patch critical findings: target < 7 days.
- % tables with tenant-aware RLS coverage: target 100% before multi-tenant launch.
- % sensitive endpoints with authz tests: target 100%.
- Vulnerability backlog aging: no Critical > 7 days; no High > 30 days.

---

# Part 3: Appendix (full findings)

## Findings legend
- Confirmation: `Confirmed` = directly evidenced in code/config; `Inferred` = likely but depends on external runtime config.
- Risk dimensions: Likelihood / Impact / Exploitability / Detectability / Blast radius (Low/Med/High/Critical).

---

### F-001: Overly permissive RLS write policies and broad grants
- Severity: Critical
- Confirmation: Confirmed
- Category: Authorization, data integrity
- Affected owners: Platform, App, Security
- Quick win vs architectural: Architectural with immediate quick-win policy tightening

Description
- Multiple tables allow unrestricted authenticated CRUD using `for all ... using (true) with check (true)`, without ownership/tenant checks.

Attack path (high-level)
1. Attacker obtains any `authenticated` Supabase session.
2. Uses Supabase REST/JS client directly to write global tables.
3. Modifies prompt config, competitor data, runs, or research artifacts.
4. Corrupts analytics, injects malicious URLs/data, or triggers downstream abuse.

Evidence references
- `/Users/jamesm/projects/easy_llm_benchmarker/supabase/sql/001_init_schema.sql:134-157`
- `/Users/jamesm/projects/easy_llm_benchmarker/supabase/sql/012_research_features.sql:23-24`
- `/Users/jamesm/projects/easy_llm_benchmarker/supabase/sql/012_research_features.sql:62-63`
- `/Users/jamesm/projects/easy_llm_benchmarker/supabase/sql/012_research_features.sql:97-98`
- `/Users/jamesm/projects/easy_llm_benchmarker/supabase/sql/012_research_features.sql:142-143`
- `/Users/jamesm/projects/easy_llm_benchmarker/supabase/sql/012_research_features.sql:170-171`
- `/Users/jamesm/projects/easy_llm_benchmarker/supabase/sql/007_pgmq_job_queue.sql:124-128`

Recommended fix (defensive pattern)
- Enforce deny-by-default RLS.
- Scope rows by ownership/tenant claim (e.g., `tenant_id = auth.jwt()->>'tenant_id'`).
- Split `service_role` write paths from normal user writes.
- Introduce least-privilege DB roles for application operations.

Verification plan
- Create two authenticated users in separate tenants and assert cross-tenant write/read denied.
- Add automated SQL tests for each table policy (`SELECT/INSERT/UPDATE/DELETE`).

Change risk / rollback
- Risk: Existing workflows relying on broad writes may fail.
- Rollback strategy: Stage policies behind migration flag and deploy with compatibility views/controlled grace period.

Risk profile
- Likelihood: High
- Impact: Critical
- Exploitability: High
- Detectability: Medium
- Blast radius: Critical

---

### F-002: Public/anonymous read exposure of internal analytics/research data
- Severity: Critical
- Confirmation: Confirmed
- Category: Data exposure
- Affected owners: Platform, App
- Quick win vs architectural: Quick win

Description
- Non-public operational and research data is readable by `anon` and broad `authenticated` grants/policies.

Attack path (high-level)
1. Unauthenticated actor queries REST/public views or open read endpoints.
2. Extracts strategy/benchmark/research telemetry.
3. Uses data for intelligence gathering, model poisoning decisions, or competitive advantage.

Evidence references
- `/Users/jamesm/projects/easy_llm_benchmarker/supabase/sql/001_init_schema.sql:107-120`
- `/Users/jamesm/projects/easy_llm_benchmarker/supabase/sql/005_competitor_blog_posts.sql:39-41`
- `/Users/jamesm/projects/easy_llm_benchmarker/supabase/sql/007_pgmq_job_queue.sql:120-121`
- `/Users/jamesm/projects/easy_llm_benchmarker/supabase/sql/008_materialized_views.sql:549-553`
- `/Users/jamesm/projects/easy_llm_benchmarker/supabase/sql/011_exclude_failed_from_visibility.sql:501-503`
- `/Users/jamesm/projects/easy_llm_benchmarker/supabase/sql/012_research_features.sql:466-471`
- `/Users/jamesm/projects/easy_llm_benchmarker/api/research/gaps.js:22-66`
- `/Users/jamesm/projects/easy_llm_benchmarker/api/research/prompt-cohorts.js:91-104`
- `/Users/jamesm/projects/easy_llm_benchmarker/api/research/prompt-cohorts/[id]/progress.js:53-185`

Recommended fix
- Remove `anon` access except for explicitly public artifacts.
- Split “public reporting” vs “internal operations” datasets.
- Add API authz checks for sensitive GETs.

Verification plan
- Test unauthenticated/anon token requests to each table/view and endpoint; confirm denied for non-public data.

Change risk / rollback
- Risk: public dashboard features may break.
- Rollback: publish sanitized public materialized views and point public UI to those views only.

Risk profile
- Likelihood: High
- Impact: High
- Exploitability: High
- Detectability: Medium
- Blast radius: High

---

### F-003: Unauthenticated Prompt Lab routes enable direct paid API abuse
- Severity: Critical
- Confirmation: Confirmed
- Category: API security / cost abuse
- Affected owners: App, SRE
- Quick win vs architectural: Quick win

Description
- Prompt Lab route executes paid LLM calls with no trigger token/user auth gate.

Attack path
1. Unauthenticated actor repeatedly calls Prompt Lab endpoint.
2. Server fans out calls to OpenAI/Anthropic/Gemini.
3. Cost spikes and service degradation occurs.

Evidence references
- `/Users/jamesm/projects/easy_llm_benchmarker/api/prompt-lab/run.js:844-860`
- `/Users/jamesm/projects/easy_llm_benchmarker/api/prompt-lab/run.js:862-901`
- `/Users/jamesm/projects/easy_llm_benchmarker/ui/server/index.ts:3103-3156`
- `/Users/jamesm/projects/easy_llm_benchmarker/README.md:85-90`

Recommended fix
- Require authenticated principal + authorization policy for prompt-lab execution.
- Add per-user and per-org quotas plus budget breaker.

Verification plan
- Attempt unauthenticated call and expect 401/403.
- Simulate burst with authenticated low-privilege user and verify quota enforcement.

Change risk / rollback
- Risk: onboarding/demo flow friction.
- Rollback: temporary allowlist for trusted internal users while full auth rollout completes.

Risk profile
- Likelihood: High
- Impact: High
- Exploitability: High
- Detectability: High
- Blast radius: High

---

### F-004: Trigger-token bypass via proxy fallback injection (local Express mode)
- Severity: High
- Confirmation: Confirmed
- Category: Authentication
- Affected owners: App
- Quick win vs architectural: Quick win

Description
- Proxy wrapper auto-sets `BENCHMARK_TRIGGER_TOKEN` and injects an Authorization header when missing, weakening/neutralizing intended token controls in proxied handlers.

Attack path
1. Request hits local Express proxy route that sets `requireTriggerToken: true`.
2. Wrapper injects fallback token into request and environment.
3. Downstream token check passes without caller proving knowledge of secret.

Evidence references
- `/Users/jamesm/projects/easy_llm_benchmarker/ui/server/index.ts:357-368`
- `/Users/jamesm/projects/easy_llm_benchmarker/ui/server/index.ts:382-385`
- `/Users/jamesm/projects/easy_llm_benchmarker/ui/server/index.ts:2941-2944`

Recommended fix
- Remove fallback behavior outside explicit local-dev mode.
- Require explicit configured token and explicit caller-provided credential.

Verification plan
- Start server in production mode without token and ensure startup/route fails closed.
- Confirm unauthenticated `/api/benchmark/runs` is denied.

Change risk / rollback
- Risk: local dev convenience decreases.
- Rollback: keep fallback only when `NODE_ENV=development` and `ALLOW_INSECURE_LOCAL_AUTH=true`.

Risk profile
- Likelihood: Medium
- Impact: High
- Exploitability: Medium
- Detectability: Medium
- Blast radius: Medium-High

---

### F-005: Rate limiting is weak in distributed/serverless reality and trusts spoofable IP headers
- Severity: High
- Confirmation: Confirmed
- Category: Availability abuse / API security
- Affected owners: App, SRE
- Quick win vs architectural: Architectural (with short-term quick wins)

Description
- Limiter uses process-local `Map`, resets per instance/cold start, and identity can be influenced via `x-real-ip` header precedence.

Attack path
1. Attacker distributes requests across instances or regions.
2. Avoids true global throttling.
3. Optionally spoofs headers to fragment buckets.
4. Sustained abuse reaches expensive downstream actions.

Evidence references
- `/Users/jamesm/projects/easy_llm_benchmarker/api/_rate-limit.js:1-3`
- `/Users/jamesm/projects/easy_llm_benchmarker/api/_rate-limit.js:19-23`
- `/Users/jamesm/projects/easy_llm_benchmarker/api/_rate-limit.js:34-45`
- `/Users/jamesm/projects/easy_llm_benchmarker/api/_rate-limit.js:99-110`

Recommended fix
- Centralized limiter (Redis/KV) keyed by auth principal + verified client IP.
- Trust proxy only when source is known reverse proxy.

Verification plan
- Load test from multiple source IPs/instances; confirm limits hold globally.
- Header spoof tests should not alter effective client identity.

Change risk / rollback
- Risk: accidental blocking of legitimate burst traffic.
- Rollback: use shadow mode metrics first, then enforce with progressive thresholds.

Risk profile
- Likelihood: High
- Impact: Medium
- Exploitability: High
- Detectability: Medium
- Blast radius: Medium

---

### F-006: Shared static bearer token model and browser session storage for privileged actions
- Severity: High
- Confirmation: Confirmed
- Category: AuthN/token hygiene
- Affected owners: App, Security
- Quick win vs architectural: Architectural

Description
- A single long-lived secret is entered in UI and reused as bearer token; token is stored in browser `sessionStorage`.

Attack path
1. Token is exposed via browser compromise/XSS/session theft/user mishandling.
2. Attacker uses token to trigger protected operations.
3. Full operator-level action set is available until rotation.

Evidence references
- `/Users/jamesm/projects/easy_llm_benchmarker/ui/src/pages/Runs.tsx:9-33`
- `/Users/jamesm/projects/easy_llm_benchmarker/ui/src/pages/PromptResearch.tsx:7-25`
- `/Users/jamesm/projects/easy_llm_benchmarker/ui/src/api.ts:1381-1389`
- `/Users/jamesm/projects/easy_llm_benchmarker/api/_rate-limit.js:68-81`

Recommended fix
- Replace static token with short-lived, scoped tokens bound to authenticated user/session and route scope.
- Add rotation + revocation workflows.

Verification plan
- Validate privilege is denied after token expiry/revocation.
- Validate different roles cannot execute admin endpoints.

Change risk / rollback
- Risk: UI flows require auth refactor.
- Rollback: temporary dual-auth support (legacy token + scoped tokens) with rapid deprecation window.

Risk profile
- Likelihood: Medium
- Impact: High
- Exploitability: Medium
- Detectability: Low-Medium
- Blast radius: High

---

### F-007: SSRF risk in sitemap sync crawler path
- Severity: High
- Confirmation: Confirmed
- Category: Input handling / network security
- Affected owners: App, Infra
- Quick win vs architectural: Quick win + infra control

Description
- Sitemap sync fetches URLs from DB-controlled settings and follows redirects without destination allowlist/network denylist.

Attack path
1. Attacker influences `app_settings.brand_sitemap_urls`.
2. Triggers sitemap sync endpoint.
3. Server performs outbound fetches to attacker-chosen targets (including redirected targets).
4. Internal service probing or sensitive endpoint access may occur.

Evidence references
- `/Users/jamesm/projects/easy_llm_benchmarker/api/research/sitemap/sync.js:102-111`
- `/Users/jamesm/projects/easy_llm_benchmarker/api/research/sitemap/sync.js:139-145`
- `/Users/jamesm/projects/easy_llm_benchmarker/api/research/sitemap/sync.js:188-189`
- `/Users/jamesm/projects/easy_llm_benchmarker/api/research/_shared.js:306-317`
- `/Users/jamesm/projects/easy_llm_benchmarker/supabase/sql/012_research_features.sql:23-24`

Recommended fix
- URL allowlist by approved domains, block private/link-local ranges, disable/limit redirects, and run fetches in constrained egress environment.

Verification plan
- Test with disallowed host classes (private IP, metadata IP, loopback) and ensure hard block.
- Validate redirect chain enforcement.

Change risk / rollback
- Risk: legitimate third-party sitemap hosts might be blocked.
- Rollback: maintain explicit approved-domain list managed via controlled admin process.

Risk profile
- Likelihood: Medium
- Impact: High
- Exploitability: Medium
- Detectability: Medium
- Blast radius: Medium-High

---

### F-008: Multi-tenant isolation is not implemented in schema/policies
- Severity: High (Critical if multi-tenant launch)
- Confirmation: Confirmed
- Category: Multi-tenancy / authorization
- Affected owners: Platform, App
- Quick win vs architectural: Architectural

Description
- Core tables have no `tenant_id` and RLS does not enforce tenant ownership; data model is global.

Attack path
1. Multiple organizations/users exist in one Supabase project.
2. Any authenticated principal can query/update shared records.
3. Cross-tenant disclosure/tampering occurs.

Evidence references
- `/Users/jamesm/projects/easy_llm_benchmarker/supabase/sql/001_init_schema.sql:5-76`
- `/Users/jamesm/projects/easy_llm_benchmarker/supabase/sql/001_init_schema.sql:134-157`
- `/Users/jamesm/projects/easy_llm_benchmarker/supabase/sql/012_research_features.sql:23-24`

Recommended fix
- Add tenant ownership columns and mandatory claim-scoped RLS across all tables and materialized view access pathways.

Verification plan
- Automated cross-tenant access tests across read/write paths and RPC functions.

Change risk / rollback
- Risk: large migration and API changes.
- Rollback: phased migration with dual-write + shadow reads before cutover.

Risk profile
- Likelihood: Medium
- Impact: Critical (multi-tenant)
- Exploitability: High
- Detectability: Low
- Blast radius: Critical

---

### F-009: Email domain gating appears client-side only (potential auth bypass)
- Severity: Medium (potentially High)
- Confirmation: Inferred
- Category: Authentication governance
- Affected owners: Platform, App
- Quick win vs architectural: Quick win

Description
- Domain restriction for magic link (`@highsoft`) is enforced in frontend code; backend enforcement was not evident in repository.

Attack path
1. Attacker bypasses frontend checks and calls Supabase auth API directly.
2. If project signup policy permits, obtains authenticated session.
3. Uses broad `authenticated` DB privileges to read/modify data.

Evidence references
- `/Users/jamesm/projects/easy_llm_benchmarker/ui/src/components/AuthProvider.tsx:25-28`
- `/Users/jamesm/projects/easy_llm_benchmarker/ui/src/components/AuthProvider.tsx:64-76`
- `/Users/jamesm/projects/easy_llm_benchmarker/ui/src/pages/Login.tsx:28-34`

Recommended fix
- Enforce domain/invite restrictions in Supabase Auth configuration and/or backend post-auth checks.

Verification plan
- Attempt non-allowed domain signup directly against Supabase Auth API in staging and verify denial.

Change risk / rollback
- Risk: legitimate users from additional domains blocked.
- Rollback: maintain explicit domain allowlist with change control.

Risk profile
- Likelihood: Medium (depends on Supabase settings)
- Impact: High
- Exploitability: Medium
- Detectability: Medium
- Blast radius: High

---

### F-010: Broad execute rights on SECURITY DEFINER enqueue RPC and queue mutation surface
- Severity: Medium
- Confirmation: Confirmed
- Category: Business logic abuse / availability
- Affected owners: Platform, App
- Quick win vs architectural: Quick win

Description
- Authenticated users can execute job enqueue RPC and mutate queue-related tables under broad grants/policies.

Attack path
1. Authenticated actor calls enqueue RPC directly or manipulates queue rows.
2. Inflates queue and causes worker churn/cost or alters run outcomes.
3. Operational instability and metric integrity degradation.

Evidence references
- `/Users/jamesm/projects/easy_llm_benchmarker/supabase/sql/013_prompt_order_filter.sql:18-20`
- `/Users/jamesm/projects/easy_llm_benchmarker/supabase/sql/013_prompt_order_filter.sql:207-208`
- `/Users/jamesm/projects/easy_llm_benchmarker/supabase/sql/012_research_features.sql:382-383`
- `/Users/jamesm/projects/easy_llm_benchmarker/supabase/sql/007_pgmq_job_queue.sql:124-128`

Recommended fix
- Restrict RPC execute and queue writes to service role/internal worker role.
- Expose queue operations only via authenticated backend service with policy checks.

Verification plan
- Confirm normal authenticated user cannot call enqueue RPC or queue table writes.

Change risk / rollback
- Risk: existing UI flows that directly rely on DB grants may break.
- Rollback: move functionality behind backend endpoint first, then revoke DB grants.

Risk profile
- Likelihood: Medium
- Impact: Medium-High
- Exploitability: Medium
- Detectability: Medium
- Blast radius: Medium

---

## Additional domain coverage notes (exhaustiveness check)

### Authentication
- Confirmed issues: shared static token model; proxy fallback bypass risk in Express mode.
- Inferred issue: domain allowlist likely client-side only unless Supabase Auth hardened.

### Authorization
- Major gap: RLS policies do not enforce ownership/tenant boundaries; object-level authorization absent in DB.

### Multi-tenancy
- Not implemented in schema/policy; currently single global namespace.

### Input handling
- No critical SQLi/NoSQLi/command injection findings in reviewed API code.
- SSRF risk present in sitemap sync due outbound URL handling.

### API security
- Missing auth on costly Prompt Lab route.
- Partial route auth inconsistency between deployment modes.
- Rate limiting weak under distributed conditions.

### Web security
- Positive headers present in Vercel config.
- CSRF controls are less central because APIs use bearer/header auth, but static token model still risky.

### Cryptography and data protection
- No obvious custom crypto misuse in reviewed code.
- Key management/rotation posture not verifiable from repo alone.

### Secrets and configuration
- No hardcoded live credentials found in reviewed tracked files.
- Long-lived tokens and service-role breadth increase impact of any leakage.

### Dependencies and supply chain
- No known package vulnerabilities observed at review time from local audit commands.
- CI lacks explicit security gates (SAST/secret scanning/SBOM) in repository workflows.

### CI/CD and build
- Positive: pinned action SHAs and minimal workflow permission.
- Missing evidence of mandatory security checks/approval gates.

### Cloud and infrastructure
- Insufficient IaC/runtime configs to conclusively assess IAM/network segmentation.
- SSRF mitigations at network layer not evidenced in repo.

### Storage and caching
- DB access model is primary concern (RLS/grants); no separate cache poisoning vector observed.

### Logging and observability
- Basic error logging present; comprehensive security audit logging and anomaly alerts not evidenced.

### Reliability/availability abuse
- Queue and LLM-call endpoints are susceptible to cost/throughput abuse without stronger identity and centralized throttling.

### Business logic abuse
- Benchmark and research workflows can be manipulated by low-trust authenticated principals under current policy model.

### Admin/support tooling
- No robust break-glass and scoped impersonation framework observed in codebase.

### Secure engineering practices
- Security checks are not yet integrated as hard CI gates; policy regression tests not present.

### Not applicable / not evidenced in current repo
- File upload malware scanning paths not present.
- OAuth/OIDC audience/scope validation not present (magic-link Supabase auth used instead).
- Kubernetes-specific controls not applicable (no k8s manifests).

