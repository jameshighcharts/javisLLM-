-- Run this in Supabase SQL Editor if frontend config saves fail with RLS errors.
-- This enables writes from anon/authenticated for config tables only.

alter table public.prompt_queries enable row level security;
alter table public.competitors enable row level security;
alter table public.competitor_aliases enable row level security;

drop policy if exists prompt_queries_write_auth on public.prompt_queries;
drop policy if exists prompt_queries_write_public on public.prompt_queries;
create policy prompt_queries_write_public on public.prompt_queries
for all to anon, authenticated using (true) with check (true);

drop policy if exists competitors_write_auth on public.competitors;
drop policy if exists competitors_write_public on public.competitors;
create policy competitors_write_public on public.competitors
for all to anon, authenticated using (true) with check (true);

drop policy if exists competitor_aliases_write_auth on public.competitor_aliases;
drop policy if exists competitor_aliases_write_public on public.competitor_aliases;
create policy competitor_aliases_write_public on public.competitor_aliases
for all to anon, authenticated using (true) with check (true);
