-- Research feature foundations: settings, runs, sitemap pages, content gaps, and prompt cohorts.

create extension if not exists pgcrypto;

create table if not exists public.app_settings (
  key text primary key,
  value_json jsonb not null,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_app_settings_updated_at on public.app_settings;
create trigger trg_app_settings_updated_at
before update on public.app_settings
for each row execute function public.touch_updated_at();

alter table public.app_settings enable row level security;

drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings
for select to anon, authenticated using (true);

drop policy if exists app_settings_write_auth on public.app_settings;
create policy app_settings_write_auth on public.app_settings
for all to authenticated using (true) with check (true);

create table if not exists public.research_runs (
  id uuid primary key default gen_random_uuid(),
  run_type text not null check (
    run_type in ('competitor_research', 'sitemap_sync', 'gap_refresh', 'brief_generation')
  ),
  status text not null default 'pending' check (
    status in ('pending', 'running', 'completed', 'failed')
  ),
  model text,
  params jsonb not null default '{}'::jsonb,
  stats jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_research_runs_updated_at on public.research_runs;
create trigger trg_research_runs_updated_at
before update on public.research_runs
for each row execute function public.touch_updated_at();

create index if not exists research_runs_run_type_created_idx
  on public.research_runs (run_type, created_at desc);

create index if not exists research_runs_status_created_idx
  on public.research_runs (status, created_at desc);

alter table public.research_runs enable row level security;

drop policy if exists research_runs_read on public.research_runs;
create policy research_runs_read on public.research_runs
for select to anon, authenticated using (true);

drop policy if exists research_runs_write_auth on public.research_runs;
create policy research_runs_write_auth on public.research_runs
for all to authenticated using (true) with check (true);

create table if not exists public.brand_content_pages (
  id uuid primary key default gen_random_uuid(),
  url text not null unique,
  canonical_url text,
  title text,
  h1 text,
  description text,
  word_count int not null default 0,
  lastmod timestamptz,
  content_hash text,
  crawl_status text not null default 'ok' check (crawl_status in ('ok', 'error')),
  metadata jsonb not null default '{}'::jsonb,
  last_crawled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_brand_content_pages_updated_at on public.brand_content_pages;
create trigger trg_brand_content_pages_updated_at
before update on public.brand_content_pages
for each row execute function public.touch_updated_at();

create index if not exists brand_content_pages_last_crawled_idx
  on public.brand_content_pages (last_crawled_at desc);

alter table public.brand_content_pages enable row level security;

drop policy if exists brand_content_pages_read on public.brand_content_pages;
create policy brand_content_pages_read on public.brand_content_pages
for select to anon, authenticated using (true);

drop policy if exists brand_content_pages_write_auth on public.brand_content_pages;
create policy brand_content_pages_write_auth on public.brand_content_pages
for all to authenticated using (true) with check (true);

create table if not exists public.content_gap_items (
  id uuid primary key default gen_random_uuid(),
  topic_key text not null unique,
  topic_label text not null,
  prompt_query_id uuid references public.prompt_queries(id),
  cohort_tag text,
  mention_deficit_score numeric(5,4) not null,
  competitor_coverage_score numeric(5,4) not null,
  composite_score numeric(5,4) not null,
  evidence_count int not null,
  evidence_citations jsonb not null default '[]'::jsonb,
  status text not null default 'backlog' check (
    status in ('backlog', 'in_progress', 'published', 'verify', 'closed')
  ),
  linked_page_url text,
  brief_markdown text,
  brief_checklist jsonb not null default '[]'::jsonb,
  brief_citations jsonb not null default '[]'::jsonb,
  brief_model text,
  brief_generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_content_gap_items_updated_at on public.content_gap_items;
create trigger trg_content_gap_items_updated_at
before update on public.content_gap_items
for each row execute function public.touch_updated_at();

create index if not exists content_gap_items_status_score_idx
  on public.content_gap_items (status, composite_score desc, updated_at desc);

create index if not exists content_gap_items_cohort_idx
  on public.content_gap_items (cohort_tag);

alter table public.content_gap_items enable row level security;

drop policy if exists content_gap_items_read on public.content_gap_items;
create policy content_gap_items_read on public.content_gap_items
for select to anon, authenticated using (true);

drop policy if exists content_gap_items_write_auth on public.content_gap_items;
create policy content_gap_items_write_auth on public.content_gap_items
for all to authenticated using (true) with check (true);

create table if not exists public.prompt_research_cohorts (
  id uuid primary key default gen_random_uuid(),
  tag text not null unique,
  display_name text not null,
  baseline_run_id uuid not null references public.benchmark_runs(id),
  baseline_locked_at timestamptz not null default now(),
  target_pp numeric(5,2) not null default 5.00,
  target_weeks int not null default 8,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_prompt_research_cohorts_updated_at on public.prompt_research_cohorts;
create trigger trg_prompt_research_cohorts_updated_at
before update on public.prompt_research_cohorts
for each row execute function public.touch_updated_at();

alter table public.prompt_research_cohorts enable row level security;

drop policy if exists prompt_research_cohorts_read on public.prompt_research_cohorts;
create policy prompt_research_cohorts_read on public.prompt_research_cohorts
for select to anon, authenticated using (true);

drop policy if exists prompt_research_cohorts_write_auth on public.prompt_research_cohorts;
create policy prompt_research_cohorts_write_auth on public.prompt_research_cohorts
for all to authenticated using (true) with check (true);

alter table public.benchmark_runs
  add column if not exists run_kind text not null default 'full',
  add column if not exists cohort_tag text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'benchmark_runs_run_kind_check'
      and conrelid = 'public.benchmark_runs'::regclass
  ) then
    alter table public.benchmark_runs
      add constraint benchmark_runs_run_kind_check
      check (run_kind in ('full', 'cohort'));
  end if;
end
$$;

create index if not exists benchmark_runs_kind_cohort_created_idx
  on public.benchmark_runs (run_kind, cohort_tag, created_at desc);

-- Replace enqueue function with cohort tag filter support.
drop function if exists public.enqueue_benchmark_run(uuid, text[], text, int, numeric, boolean, int);

create or replace function public.enqueue_benchmark_run(
  p_run_id uuid,
  p_models text[],
  p_our_terms text,
  p_runs_per_model int default 1,
  p_temperature numeric default 0.7,
  p_web_search boolean default true,
  p_prompt_limit int default null,
  p_prompt_tag text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_model text;
  v_provider text;
  v_job_id bigint;
  v_msg_id bigint;
  v_runs_per_model int := greatest(1, least(coalesce(p_runs_per_model, 1), 10));
  v_temperature numeric(4,2) := greatest(0::numeric, least(coalesce(p_temperature, 0.7), 2::numeric));
  v_web_search boolean := coalesce(p_web_search, true);
  v_prompt_limit int := nullif(coalesce(p_prompt_limit, 0), 0);
  v_prompt_tag text := nullif(lower(trim(coalesce(p_prompt_tag, ''))), '');
  v_jobs_enqueued int := 0;
  v_query_count int := 0;
  v_competitor_count int := 0;
  v_run_iteration int;
  v_models text[];
  v_our_terms text[];
  v_prompt record;
begin
  if p_run_id is null then
    raise exception 'p_run_id is required';
  end if;

  if p_models is null or array_length(p_models, 1) is null then
    raise exception 'p_models must include at least one model';
  end if;

  if not exists (select 1 from public.benchmark_runs br where br.id = p_run_id) then
    raise exception 'benchmark_runs row % does not exist', p_run_id;
  end if;

  v_models := array(
    select distinct trimmed_model
    from (
      select nullif(trim(model_name), '') as trimmed_model
      from unnest(p_models) as model_name
    ) normalized
    where trimmed_model is not null
    order by trimmed_model
  );

  if array_length(v_models, 1) is null then
    raise exception 'p_models must include at least one non-empty model';
  end if;

  v_our_terms := array(
    select term
    from (
      select nullif(trim(raw_term), '') as term
      from unnest(string_to_array(coalesce(p_our_terms, ''), ',')) as raw_term
    ) normalized_terms
    where term is not null
  );
  if array_length(v_our_terms, 1) is null then
    v_our_terms := array['Highcharts'];
  end if;

  select count(*)::int
  into v_competitor_count
  from public.competitors c
  where c.is_active is true;

  for v_prompt in
    select pq.id, pq.query_text
    from public.prompt_queries pq
    where pq.is_active is true
      and (
        v_prompt_tag is null
        or exists (
          select 1
          from unnest(coalesce(pq.tags, '{}'::text[])) as tag
          where lower(tag) = v_prompt_tag
        )
      )
    order by pq.sort_order asc, pq.created_at asc, pq.id asc
    limit coalesce(v_prompt_limit, 2147483647)
  loop
    v_query_count := v_query_count + 1;

    foreach v_model in array v_models
    loop
      v_provider := case
        when lower(v_model) like 'claude%' or lower(v_model) like 'anthropic/%' then 'anthropic'
        when lower(v_model) like 'gemini%' or lower(v_model) like 'google/%' then 'google'
        else 'openai'
      end;

      for v_run_iteration in 1..v_runs_per_model
      loop
        insert into public.benchmark_jobs (
          run_id,
          query_id,
          query_text,
          model,
          run_iteration,
          provider,
          temperature,
          web_search_enabled,
          our_terms,
          status,
          attempt_count,
          max_attempts
        )
        values (
          p_run_id,
          v_prompt.id,
          v_prompt.query_text,
          v_model,
          v_run_iteration,
          v_provider,
          v_temperature,
          case when v_provider = 'openai' then v_web_search else false end,
          v_our_terms,
          'pending',
          0,
          3
        )
        on conflict (run_id, query_id, run_iteration, model)
        do nothing
        returning id into v_job_id;

        if v_job_id is null then
          continue;
        end if;

        v_msg_id := public.rpc_pgmq_send(
          'benchmark_jobs',
          jsonb_build_object(
            'job_id', v_job_id,
            'run_id', p_run_id,
            'query_id', v_prompt.id,
            'query_text', v_prompt.query_text,
            'model', v_model,
            'run_iteration', v_run_iteration
          ),
          0
        );

        update public.benchmark_jobs
        set pgmq_msg_id = v_msg_id
        where id = v_job_id;

        v_jobs_enqueued := v_jobs_enqueued + 1;
      end loop;
    end loop;
  end loop;

  update public.benchmark_runs br
  set
    model = array_to_string(v_models, ','),
    started_at = coalesce(br.started_at, now()),
    query_count = coalesce(v_query_count, 0),
    competitor_count = coalesce(v_competitor_count, 0),
    total_responses = coalesce(br.total_responses, 0)
  where br.id = p_run_id;

  if v_query_count = 0 then
    perform public.finalize_benchmark_run(p_run_id);
  end if;

  return jsonb_build_object(
    'run_id', p_run_id,
    'jobs_enqueued', v_jobs_enqueued,
    'models', v_models,
    'query_count', v_query_count,
    'competitor_count', v_competitor_count,
    'prompt_tag', v_prompt_tag
  );
end;
$$;

revoke all on function public.enqueue_benchmark_run(uuid, text[], text, int, numeric, boolean, int, text) from public;
grant execute on function public.enqueue_benchmark_run(uuid, text[], text, int, numeric, boolean, int, text) to authenticated, service_role;

-- Update run summary materialized view with run_kind/cohort_tag.
drop materialized view if exists public.mv_run_summary;

create materialized view public.mv_run_summary as
with response_rollup as (
  select
    br.run_id,
    count(*)::int as response_count,
    count(distinct br.query_id)::int as response_query_count,
    coalesce(sum(greatest(br.prompt_tokens, 0)), 0)::bigint as input_tokens,
    coalesce(sum(greatest(br.completion_tokens, 0)), 0)::bigint as output_tokens,
    coalesce(sum(greatest(nullif(br.total_tokens, 0), greatest(br.prompt_tokens, 0) + greatest(br.completion_tokens, 0))), 0)::bigint as total_tokens,
    coalesce(sum(greatest(br.duration_ms, 0)), 0)::bigint as total_duration_ms
  from public.benchmark_responses br
  group by br.run_id
),
model_rollup as (
  select
    mmp.run_id,
    array_agg(mmp.model order by mmp.model) as models,
    string_agg(mmp.model, ',' order by mmp.model) as models_csv,
    string_agg(mmp.model || '=>' || mmp.owner, ';' order by mmp.model) as model_owner_map,
    sum(mmp.success_count)::int as success_response_count,
    sum(mmp.failure_count)::int as failure_response_count
  from public.mv_model_performance mmp
  group by mmp.run_id
),
owner_rollup as (
  select
    owner_rows.run_id,
    array_agg(owner_rows.owner order by owner_rows.owner) as model_owners,
    string_agg(owner_rows.owner, ',' order by owner_rows.owner) as model_owners_csv
  from (
    select distinct mmp.run_id, mmp.owner
    from public.mv_model_performance mmp
  ) owner_rows
  group by owner_rows.run_id
),
visibility_rollup as (
  select
    mvs.run_id,
    round(avg(mvs.ai_visibility_score) filter (where mvs.is_overall_row is false), 2) as computed_overall_score,
    round(max(mvs.ai_visibility_score) filter (where mvs.is_overall_row is true), 2) as overall_row_score
  from public.mv_visibility_scores mvs
  group by mvs.run_id
)
select
  r.id as run_id,
  r.run_month,
  r.model,
  r.run_kind,
  r.cohort_tag,
  r.web_search_enabled,
  r.created_at,
  r.started_at,
  r.ended_at,
  coalesce(r.overall_score, vr.computed_overall_score, vr.overall_row_score, 0)::numeric(6,2) as overall_score,
  coalesce(rr.response_count, r.total_responses, 0)::int as response_count,
  coalesce(rr.response_query_count, r.query_count, 0)::int as query_count,
  coalesce(r.competitor_count, (select count(*) from public.competitors c where c.is_active is true), 0)::int as competitor_count,
  coalesce(rr.input_tokens, 0)::bigint as input_tokens,
  coalesce(rr.output_tokens, 0)::bigint as output_tokens,
  coalesce(rr.total_tokens, 0)::bigint as total_tokens,
  coalesce(rr.total_duration_ms, 0)::bigint as total_duration_ms,
  round((coalesce(rr.total_duration_ms, 0)::numeric / nullif(coalesce(rr.response_count, 0), 0)), 2) as avg_duration_ms,
  coalesce(mr.models, '{}'::text[]) as models,
  coalesce(mr.models_csv, coalesce(r.model, '')) as models_csv,
  coalesce(orw.model_owners, '{}'::text[]) as model_owners,
  coalesce(orw.model_owners_csv, '') as model_owners_csv,
  coalesce(mr.model_owner_map, '') as model_owner_map,
  coalesce(mr.success_response_count, 0)::int as success_response_count,
  coalesce(mr.failure_response_count, 0)::int as failure_response_count
from public.benchmark_runs r
left join response_rollup rr on rr.run_id = r.id
left join model_rollup mr on mr.run_id = r.id
left join owner_rollup orw on orw.run_id = r.id
left join visibility_rollup vr on vr.run_id = r.id;

create unique index if not exists mv_run_summary_run_id_idx
  on public.mv_run_summary (run_id);

grant select on public.app_settings to anon, authenticated;
grant select on public.research_runs to anon, authenticated;
grant select on public.brand_content_pages to anon, authenticated;
grant select on public.content_gap_items to anon, authenticated;
grant select on public.prompt_research_cohorts to anon, authenticated;
grant select on public.mv_run_summary to anon, authenticated;

grant insert, update, delete on public.app_settings to authenticated;
grant insert, update, delete on public.research_runs to authenticated;
grant insert, update, delete on public.brand_content_pages to authenticated;
grant insert, update, delete on public.content_gap_items to authenticated;
grant insert, update, delete on public.prompt_research_cohorts to authenticated;

select public.refresh_benchmark_views();
