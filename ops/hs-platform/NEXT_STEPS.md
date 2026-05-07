## Next Steps

These are the remaining steps after the scaffold I added locally.

### Already Done In Repo

- created isolated HS app deployment starter under `ops/hs-platform/`
- added image builds for `web`, `api`, and `worker`
- added ops-repo Kustomize templates for dev, staging, and prod
- added same-host `/api` routing so legacy app code does not need deployment-specific changes
- added a Supabase decision guide and self-hosted Supabase handoff pack
- validated all three Kustomize overlays with `kubectl kustomize`

### You Need To Decide

1. Pick the Supabase mode:
   - managed Supabase
   - existing self-hosted Supabase
   - new self-hosted Supabase stack
2. Pick the actual HS app hostnames if they should differ from the placeholders.
3. Confirm the real HS ops repo path and team naming.

### You Need Access I Do Not Have

These steps require your external access, not repo-only changes:

1. Create or confirm the AWS Secrets Manager values in the correct HS account and region.
2. Build and push the three container images to the real GHCR path used by your team.
3. Copy the template manifests into the actual `hs-platform-ops-<team>` repo.
4. Set up certificate issuer details and ArgoCD app wiring in that ops repo.
5. If Supabase is self-hosted, stand up or confirm the Supabase platform and produce its public URL and keys.
6. Add the final HS app URLs to Supabase auth redirect configuration.
7. Sync ArgoCD in `dev` and verify live health.

### What To Feed Back To Me

Once you have them, send me:

- chosen Supabase mode
- actual GHCR image names
- actual HS hostnames for dev, staging, and prod
- AWS secret prefix you want in the manifests
- cluster issuer name
- if self-hosted Supabase: public gateway URL, anon key source, service-role key source, and who owns backups

With that, I can finish tailoring the templates to your real environment.
