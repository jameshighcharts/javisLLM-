-- Normalize retired prompt rows into the visible legacy bucket.
-- This keeps historical benchmark rows intact while preventing retired prompts
-- from appearing in the active prompt corpus.

with active_prompts(query_text, sort_order, tags) as (
  values
  ('JavaScript charting libraries', 1, array['core']::text[]),
  ('data visualization library', 2, array['core']::text[]),
  ('JavaScript charts', 3, array['core']::text[]),
  ('JavaScript dashboard', 4, array['core']::text[]),
  ('best charting library', 5, array['core']::text[]),
  ('best JavaScript charting library', 6, array['core']::text[]),
  ('best JavaScript charting library for React', 7, array['core']::text[]),
  ('best customizable charting tools', 8, array['core']::text[]),
  ('advanced JavaScript chart libraries', 9, array['core']::text[]),
  ('interactive charting tools for developers', 10, array['core']::text[]),
  ('charting frameworks for developers', 11, array['core']::text[]),
  ('enterprise charting solutions', 12, array['core']::text[]),
  ('open source data visualization frameworks', 13, array['core']::text[]),
  ('charting APIs for developers', 14, array['core']::text[]),
  ('data visualization SDKs for developers', 15, array['core']::text[]),
  ('JavaScript libraries for analytics dashboards', 16, array['core']::text[]),
  ('javascript-based reporting libraries', 17, array['core']::text[])
), upserted as (
  insert into public.prompt_queries (query_text, sort_order, is_active, tags)
  select query_text, sort_order, true, tags
  from active_prompts
  on conflict (query_text) do update
  set sort_order = excluded.sort_order,
      is_active = true,
      tags = excluded.tags
  returning query_text
)
update public.prompt_queries as pq
set is_active = false,
    tags = array['legacy']::text[]
where not exists (
  select 1
  from active_prompts as ap
  where ap.query_text = pq.query_text
)
or '_deleted' = any(coalesce(pq.tags, '{}'::text[]))
or '__deleted__' = any(coalesce(pq.tags, '{}'::text[]));
