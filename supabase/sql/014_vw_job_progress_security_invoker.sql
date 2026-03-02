-- Resolve SECURITY DEFINER view finding: evaluate permissions/RLS as querying role.
alter view if exists public.vw_job_progress
  set (security_invoker = true);
