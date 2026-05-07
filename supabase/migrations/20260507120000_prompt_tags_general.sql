-- Rename the active prompt cohort tag from core to general.
-- This keeps fresh installs and existing databases aligned with the new prompt label
-- without editing historical migration files.

update public.prompt_queries
set tags = array_replace(
  array_replace(coalesce(tags, '{}'::text[]), 'core', 'general'),
  'generic',
  'general'
)
where exists (
  select 1
  from unnest(coalesce(tags, '{}'::text[])) as tag
  where tag in ('core', 'generic')
);
