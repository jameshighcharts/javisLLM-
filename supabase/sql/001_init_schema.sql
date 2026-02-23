-- Supabase schema for easy_llm_benchmarker

create extension if not exists pgcrypto;

create table if not exists public.prompt_queries (
  id uuid primary key default gen_random_uuid(),
  query_text text not null unique,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.competitors (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  is_primary boolean not null default false,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.competitor_aliases (
  id uuid primary key default gen_random_uuid(),
  competitor_id uuid not null references public.competitors(id) on delete cascade,
  alias text not null,
  created_at timestamptz not null default now(),
  unique (competitor_id, alias)
);

create table if not exists public.benchmark_runs (
  id uuid primary key default gen_random_uuid(),
  run_month text not null,
  model text not null,
  web_search_enabled boolean not null default false,
  started_at timestamptz,
  ended_at timestamptz,
  overall_score numeric(6,2),
  query_count int not null default 0,
  competitor_count int not null default 0,
  total_responses int not null default 0,
  raw_kpi jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.benchmark_responses (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.benchmark_runs(id) on delete cascade,
  query_id uuid not null references public.prompt_queries(id),
  run_iteration int not null,
  model text not null,
  web_search_enabled boolean not null,
  response_text text not null default '',
  citations jsonb not null default '[]'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  unique (run_id, query_id, run_iteration)
);

create table if not exists public.response_mentions (
  response_id bigint not null references public.benchmark_responses(id) on delete cascade,
  competitor_id uuid not null references public.competitors(id) on delete cascade,
  mentioned boolean not null,
  primary key (response_id, competitor_id)
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_prompt_queries_updated_at on public.prompt_queries;
create trigger trg_prompt_queries_updated_at
before update on public.prompt_queries
for each row execute function public.touch_updated_at();

drop trigger if exists trg_competitors_updated_at on public.competitors;
create trigger trg_competitors_updated_at
before update on public.competitors
for each row execute function public.touch_updated_at();

alter table public.prompt_queries enable row level security;
alter table public.competitors enable row level security;
alter table public.competitor_aliases enable row level security;
alter table public.benchmark_runs enable row level security;
alter table public.benchmark_responses enable row level security;
alter table public.response_mentions enable row level security;

-- Read policies for dashboard use
drop policy if exists prompt_queries_read on public.prompt_queries;
create policy prompt_queries_read on public.prompt_queries
for select to anon, authenticated using (true);

drop policy if exists competitors_read on public.competitors;
create policy competitors_read on public.competitors
for select to anon, authenticated using (true);

drop policy if exists competitor_aliases_read on public.competitor_aliases;
create policy competitor_aliases_read on public.competitor_aliases
for select to anon, authenticated using (true);

drop policy if exists benchmark_runs_read on public.benchmark_runs;
create policy benchmark_runs_read on public.benchmark_runs
for select to anon, authenticated using (true);

drop policy if exists benchmark_responses_read on public.benchmark_responses;
create policy benchmark_responses_read on public.benchmark_responses
for select to anon, authenticated using (true);

drop policy if exists response_mentions_read on public.response_mentions;
create policy response_mentions_read on public.response_mentions
for select to anon, authenticated using (true);

-- Write policies: keep restricted to authenticated users.
-- Service role bypasses RLS for server-side sync scripts.
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

drop policy if exists benchmark_runs_write_auth on public.benchmark_runs;
create policy benchmark_runs_write_auth on public.benchmark_runs
for all to authenticated using (true) with check (true);

drop policy if exists benchmark_responses_write_auth on public.benchmark_responses;
create policy benchmark_responses_write_auth on public.benchmark_responses
for all to authenticated using (true) with check (true);

drop policy if exists response_mentions_write_auth on public.response_mentions;
create policy response_mentions_write_auth on public.response_mentions
for all to authenticated using (true) with check (true);
