# Security Best Practices Audit - easy_llm_benchmarker

Audit date: 2026-02-23  
Reviewer: Codex security review (code-based verification)

## Executive summary

Most urgent risks are:
1) public unauthenticated writes to Supabase config tables, and  
2) GitHub Actions command injection that can become internet-exploitable if `BENCHMARK_TRIGGER_TOKEN` is unset.

These two together can lead to benchmark tampering, workflow abuse, and potential CI secret exfiltration.

## Highest-priority findings

### C01 - Public unauthenticated writes to config tables (Critical)
- Locations:
  - `supabase/sql/001_init_schema.sql` lines 125-136
  - `supabase/sql/002_allow_anon_config_writes.sql` lines 10-21
- Evidence: `for all to anon, authenticated using (true) with check (true)` on `prompt_queries`, `competitors`, `competitor_aliases`.
- Impact: Any internet user with the public anon key can modify benchmark config and corrupt dashboard inputs.
- Fix:
  - Replace public write policies with authenticated-only policies.
  - Gate config mutations behind auth.

### C02 - Trigger auth optional + workflow input injection chain (Critical, conditional)
- Locations:
  - `api/_github.js` lines 32-36
  - `.github/workflows/run-benchmark.yml` lines 63, 82-87
- Evidence:
  - Trigger token check silently no-ops when env var is missing.
  - GitHub input values are interpolated directly into shell script source (`${{ github.event.inputs.* }}` inside `run:` blocks).
- Impact:
  - If `BENCHMARK_TRIGGER_TOKEN` is unset in Vercel, unauthenticated callers can send crafted input to execute shell commands in CI and access workflow secrets.
- Fix:
  - Make trigger token mandatory (fail closed when missing).
  - Move all workflow inputs to `env:` and reference shell vars only (`"$MODEL"`, `"$OUR_TERMS"`, etc.).

## High findings

### H01 - Workflow script injection via direct expression interpolation (High)
- Location: `.github/workflows/run-benchmark.yml` lines 63-66 and 82-87.
- Impact: Users who can invoke `workflow_dispatch` (or the public trigger path if auth is weak) can break quoting and run arbitrary commands.
- Fix: Use `env:` mapping for all inputs; do not inline `${{ github.event.inputs.* }}` in shell source.

### H02 - `BENCHMARK_TRIGGER_TOKEN` silently optional (High)
- Location: `api/_github.js` lines 32-36.
- Impact: Missing env var disables endpoint protection for `/api/benchmark/trigger` and `/api/benchmark/runs`.
- Fix: Throw startup/runtime error if token is unset; reject all requests until configured.

### H03 - Model parameter not allowlisted (High)
- Location: `api/benchmark/trigger.js` lines 69-72.
- Impact: Caller can force expensive models and increase spend unpredictably.
- Fix: Validate against explicit allowlist and reject unknown models.

### H04 - Benchmark data is world-readable through anon policies (High if data is internal)
- Locations:
  - `supabase/sql/001_init_schema.sql` lines 109-119 (anon `select` on benchmark tables)
  - `supabase/sql/001_init_schema.sql` line 55 (`response_text` stored)
- Impact: Anyone with anon key can read run outputs and response text. If this data is internal/sensitive, this is a direct confidentiality issue.
- Fix: Restrict read policies to authenticated role (or publish a sanitized read model).

### H05 - Secrets exposed to all workflow steps (High, defense in depth)
- Location: `.github/workflows/run-benchmark.yml` lines 41-45.
- Impact: `OPENAI_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are available to every step, including third-party actions.
- Fix: Scope secrets only to the specific Python execution steps that need them.

## Medium findings

### M01 - No rate limiting on trigger/runs endpoints (Medium)
- Locations:
  - `api/benchmark/trigger.js`
  - `api/benchmark/runs.js`
- Impact: Abusive callers can spam workflow dispatches and API polling.
- Fix: Add per-IP + token bucket rate limiting (or managed edge limit in Vercel).

### M02 - Dev API allows unauthenticated config writes with permissive CORS (Medium)
- Location: `ui/server/index.ts` lines 43, 187-238.
- Impact: If the dev server is exposed beyond localhost, config mutation endpoints are open.
- Fix: Restrict CORS origin(s), require a dev auth token, and bind explicitly to loopback-only for local mode.

### M03 - Error/path disclosure in API responses (Medium)
- Locations:
  - `ui/server/index.ts` lines 163-165, 173, 182, 196, 211, 236, 347, 412
- Impact: Leaks absolute filesystem paths and internal error details.
- Fix: Return generic errors in production; keep detailed stack/path logs server-side only.

### M04 - Shared secret sent in JSON body to Apps Script (Medium)
- Locations:
  - `scripts/push_to_sheets_webapp.py` lines 124-131
  - `automation/apps_script/Code.gs` line 34
- Impact: Body logging at intermediaries can expose secret.
- Fix: Move secret to `Authorization: Bearer ...` header and validate header value server-side.

### M05 - Log files tracked in git and not ignored (Medium)
- Locations:
  - `.gitignore` (missing `output/logs/`)
  - Tracked files under `output/logs/*.log`
- Impact: Operational logs can be accidentally shared/committed with sensitive runtime context.
- Fix: Add `output/logs/` to `.gitignore`, remove tracked logs via `git rm --cached`.

### M06 - Missing security headers on Vercel/static app (Medium)
- Location: `vercel.json` (no `headers` section).
- Impact: No baseline hardening (`nosniff`, frame policy, referrer policy, CSP).
- Fix: Add response headers at edge; add CSP after testing frontend compatibility.

### M07 - Trigger token persisted in `localStorage` (Medium)
- Location: `ui/src/pages/Runs.tsx` lines 83-93.
- Impact: Any future XSS can exfiltrate long-lived trigger token.
- Fix: Prefer session memory-only storage; if persistence is required, use short-lived tokens with rotation.

## Low findings

### L01 - Hardcoded absolute output directory path (Low)
- Location: `llm_mention_benchmark.py` line 19.
- Impact: Portability issue and local path disclosure.
- Fix: Use repo-relative default (`Path(__file__).resolve().parent / "output"`).

### L02 - Apps Script secret compare is not constant-time (Low)
- Location: `automation/apps_script/Code.gs` line 34.
- Impact: Mostly theoretical in this context.
- Fix: Acceptable for now; revisit if platform provides constant-time primitive.

### L03 - Action references are tag-pinned, not SHA-pinned (Low/Medium defense in depth)
- Location: `.github/workflows/run-benchmark.yml` lines 48, 51, 118.
- Impact: Tag retarget/supply-chain risk.
- Fix: Pin to full commit SHAs for third-party actions.

## Dependency check results

- `npm audit --prefix ui --json`:
  - `vite`/`esbuild` moderate advisory in dev-server request handling path.
  - Suggested fix is major upgrade (`vite` 7.x).
- `uvx pip-audit -r requirements.txt`:
  - No known Python vulnerabilities reported for current requirements.

## Validation of prior report items

- Confirmed: C2, H1, H2, H3, H4, H5, M1, M3, M4, M5, M6, L1, L2, L4, L5.
- Confirmed with nuance: C1 is real secret concentration risk; local file permissions are currently restrictive (`0600`), so exploitability is primarily local-compromise/backup-leak scenarios.
- False positive: `firebase-debug.log` files are currently ignored and not tracked (`git ls-files` returns none).

## Recommended fix order (implementation)

1. Lock down Supabase write policies to authenticated only (C01).
2. Patch workflow interpolation to `env:` and make trigger token fail-closed (C02/H01/H02).
3. Add model allowlist and rate limiting on trigger endpoint (H03/M01).
4. Scope workflow secrets to only required steps (H05).
5. Restrict anon reads if benchmark outputs are internal (H04).
6. Remove path/error leakage and add security headers (M03/M06).
7. Move Apps Script secret to Authorization header and stop tracking logs (M04/M05).
