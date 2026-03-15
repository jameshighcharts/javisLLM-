-- Exclude failed/dead-letter responses from visibility-score denominators.
-- Failed rows are retained for operational reporting but should not depress mention math.

drop materialized view if exists public.mv_run_summary;
drop materialized view if exists public.mv_visibility_scores;
drop materialized view if exists public.mv_competitor_mention_rates;

create materialized view public.mv_competitor_mention_rates as
with active_competitors as (
  select c.id, c.name, c.slug, c.is_primary, c.sort_order
  from public.competitors c
  where c.is_active is true
),
highcharts as (
  select
    coalesce(
      (
        select ac.id
        from active_competitors ac
        where ac.is_primary is true
        order by ac.sort_order asc, ac.name asc
        limit 1
      ),
      (
        select ac.id
        from active_competitors ac
        where ac.slug = 'highcharts'
        order by ac.sort_order asc, ac.name asc
        limit 1
      )
    ) as competitor_id
),
query_snapshot as (
  select bj.run_id, bj.query_id, max(bj.query_text) as query_text
  from public.benchmark_jobs bj
  group by bj.run_id, bj.query_id
),
run_query_totals as (
  select
    br.run_id,
    br.query_id,
    count(*)::int as response_count,
    coalesce(sum(greatest(br.prompt_tokens, 0)), 0)::bigint as input_tokens,
    coalesce(sum(greatest(br.completion_tokens, 0)), 0)::bigint as output_tokens,
    coalesce(
      sum(
        greatest(
          nullif(br.total_tokens, 0),
          greatest(br.prompt_tokens, 0) + greatest(br.completion_tokens, 0)
        )
      ),
      0
    )::bigint as total_tokens,
    coalesce(sum(greatest(br.duration_ms, 0)), 0)::bigint as total_duration_ms
  from public.benchmark_responses br
  where coalesce(trim(br.error), '') = ''
  group by br.run_id, br.query_id
),
run_query_mentions as (
  select
    br.run_id,
    br.query_id,
    rm.competitor_id,
    count(*) filter (where rm.mentioned is true)::int as mentions_count
  from public.benchmark_responses br
  join public.response_mentions rm on rm.response_id = br.id
  where coalesce(trim(br.error), '') = ''
  group by br.run_id, br.query_id, rm.competitor_id
),
run_totals as (
  select
    br.run_id,
    count(*)::int as response_count,
    coalesce(sum(greatest(br.prompt_tokens, 0)), 0)::bigint as input_tokens,
    coalesce(sum(greatest(br.completion_tokens, 0)), 0)::bigint as output_tokens,
    coalesce(
      sum(
        greatest(
          nullif(br.total_tokens, 0),
          greatest(br.prompt_tokens, 0) + greatest(br.completion_tokens, 0)
        )
      ),
      0
    )::bigint as total_tokens,
    coalesce(sum(greatest(br.duration_ms, 0)), 0)::bigint as total_duration_ms
  from public.benchmark_responses br
  where coalesce(trim(br.error), '') = ''
  group by br.run_id
),
run_mentions as (
  select
    br.run_id,
    rm.competitor_id,
    count(*) filter (where rm.mentioned is true)::int as mentions_count
  from public.benchmark_responses br
  join public.response_mentions rm on rm.response_id = br.id
  where coalesce(trim(br.error), '') = ''
  group by br.run_id, rm.competitor_id
),
query_rows as (
  select
    rqt.run_id,
    rqt.query_id,
    coalesce(qs.query_text, pq.query_text) as query_text,
    ac.id as competitor_id,
    ac.name as entity,
    ac.slug as entity_key,
    (ac.id = (select competitor_id from highcharts)) as is_highcharts,
    false as is_overall_row,
    rqt.response_count,
    rqt.input_tokens,
    rqt.output_tokens,
    rqt.total_tokens,
    rqt.total_duration_ms,
    coalesce(rqm.mentions_count, 0)::int as mentions_count,
    r.run_month,
    r.created_at,
    r.started_at,
    r.ended_at,
    r.web_search_enabled
  from run_query_totals rqt
  join public.benchmark_runs r on r.id = rqt.run_id
  join public.prompt_queries pq on pq.id = rqt.query_id
  left join query_snapshot qs on qs.run_id = rqt.run_id and qs.query_id = rqt.query_id
  cross join active_competitors ac
  left join run_query_mentions rqm
    on rqm.run_id = rqt.run_id
   and rqm.query_id = rqt.query_id
   and rqm.competitor_id = ac.id
),
overall_rows as (
  select
    rt.run_id,
    null::uuid as query_id,
    'OVERALL'::text as query_text,
    ac.id as competitor_id,
    ac.name as entity,
    ac.slug as entity_key,
    (ac.id = (select competitor_id from highcharts)) as is_highcharts,
    true as is_overall_row,
    rt.response_count,
    rt.input_tokens,
    rt.output_tokens,
    rt.total_tokens,
    rt.total_duration_ms,
    coalesce(rm.mentions_count, 0)::int as mentions_count,
    r.run_month,
    r.created_at,
    r.started_at,
    r.ended_at,
    r.web_search_enabled
  from run_totals rt
  join public.benchmark_runs r on r.id = rt.run_id
  cross join active_competitors ac
  left join run_mentions rm
    on rm.run_id = rt.run_id
   and rm.competitor_id = ac.id
),
all_rows as (
  select * from query_rows
  union all
  select * from overall_rows
),
with_sov as (
  select
    ar.*,
    sum(ar.mentions_count) over (
      partition by ar.run_id, coalesce(ar.query_id::text, '__overall__')
    )::int as share_of_voice_total_mentions
  from all_rows ar
)
select
  md5(ws.run_id::text || ':' || coalesce(ws.query_id::text, '__overall__') || ':' || ws.competitor_id::text) as row_key,
  ws.run_id,
  ws.query_id,
  coalesce(ws.query_id::text, '__overall__') as query_key,
  ws.query_text,
  ws.competitor_id,
  ws.entity,
  ws.entity_key,
  ws.is_highcharts,
  ws.is_overall_row,
  ws.response_count,
  ws.input_tokens,
  ws.output_tokens,
  ws.total_tokens,
  ws.total_duration_ms,
  ws.mentions_count,
  round((ws.mentions_count::numeric / nullif(ws.response_count, 0)), 6) as mentions_rate,
  round((ws.mentions_count::numeric / nullif(ws.response_count, 0)) * 100, 2) as mentions_rate_pct,
  ws.share_of_voice_total_mentions,
  round((ws.mentions_count::numeric / nullif(ws.share_of_voice_total_mentions, 0)), 6) as share_of_voice_rate,
  round((ws.mentions_count::numeric / nullif(ws.share_of_voice_total_mentions, 0)) * 100, 2) as share_of_voice_rate_pct,
  ws.run_month,
  ws.created_at,
  ws.started_at,
  ws.ended_at,
  ws.web_search_enabled
from with_sov ws;

create unique index if not exists mv_competitor_mention_rates_row_key_idx
  on public.mv_competitor_mention_rates (row_key);
create index if not exists mv_competitor_mention_rates_run_query_idx
  on public.mv_competitor_mention_rates (run_id, query_key);

create materialized view public.mv_visibility_scores as
select
  md5(mcmr.run_id::text || ':' || mcmr.query_key) as row_key,
  mcmr.run_id,
  mcmr.query_id,
  mcmr.query_key,
  mcmr.query_text,
  mcmr.is_overall_row,
  mcmr.response_count,
  mcmr.mentions_count as highcharts_mentions_count,
  round((mcmr.mentions_count::numeric / nullif(mcmr.response_count, 0)), 6) as presence_rate,
  round((mcmr.mentions_count::numeric / nullif(mcmr.share_of_voice_total_mentions, 0)), 6) as share_of_voice_rate,
  round(
    (
      (0.7 * (mcmr.mentions_count::numeric / nullif(mcmr.response_count, 0))) +
      (0.3 * (mcmr.mentions_count::numeric / nullif(mcmr.share_of_voice_total_mentions, 0)))
    ) * 100,
    2
  ) as ai_visibility_score,
  mcmr.run_month,
  mcmr.created_at,
  mcmr.started_at,
  mcmr.ended_at,
  mcmr.web_search_enabled
from public.mv_competitor_mention_rates mcmr
where mcmr.is_highcharts is true;

create unique index if not exists mv_visibility_scores_row_key_idx
  on public.mv_visibility_scores (row_key);
create index if not exists mv_visibility_scores_run_idx
  on public.mv_visibility_scores (run_id);

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

create or replace function public.finalize_benchmark_run(p_run_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_highcharts_id uuid;
  v_query_count int := 0;
  v_total_responses int := 0;
  v_competitor_count int := 0;
  v_overall_score numeric(6,2) := 0;
begin
  perform pg_advisory_xact_lock(hashtext(p_run_id::text));

  if (
    select br.ended_at
    from public.benchmark_runs br
    where br.id = p_run_id
  ) is not null then
    return false;
  end if;

  select
    coalesce(
      (select c.id from public.competitors c where c.is_primary is true order by c.sort_order asc, c.name asc limit 1),
      (select c.id from public.competitors c where c.slug = 'highcharts' order by c.sort_order asc, c.name asc limit 1)
    )
  into v_highcharts_id;

  select
    count(distinct br.query_id)::int,
    count(*)::int
  into
    v_query_count,
    v_total_responses
  from public.benchmark_responses br
  where br.run_id = p_run_id;

  select count(*)::int
  into v_competitor_count
  from public.competitors c
  where c.is_active is true;

  with query_stats as (
    select
      br.query_id,
      count(distinct br.id)::numeric as response_count,
      coalesce(
        sum(
          case
            when rm.competitor_id = v_highcharts_id and rm.mentioned is true then 1
            else 0
          end
        ),
        0
      )::numeric as highcharts_mentions,
      coalesce(
        sum(
          case
            when rm.mentioned is true then 1
            else 0
          end
        ),
        0
      )::numeric as total_mentions
    from public.benchmark_responses br
    left join public.response_mentions rm on rm.response_id = br.id
    where br.run_id = p_run_id
      and coalesce(trim(br.error), '') = ''
    group by br.query_id
  ),
  query_scores as (
    select
      (
        (
          0.7 * case when qs.response_count > 0 then (qs.highcharts_mentions / qs.response_count) else 0 end
        ) +
        (
          0.3 * case when qs.total_mentions > 0 then (qs.highcharts_mentions / qs.total_mentions) else 0 end
        )
      ) * 100 as score
    from query_stats qs
  )
  select coalesce(round(avg(score)::numeric, 2), 0)::numeric(6,2)
  into v_overall_score
  from query_scores;

  update public.benchmark_runs br
  set
    started_at = coalesce(br.started_at, now()),
    ended_at = now(),
    overall_score = v_overall_score,
    query_count = coalesce(v_query_count, 0),
    competitor_count = coalesce(v_competitor_count, 0),
    total_responses = coalesce(v_total_responses, 0)
  where br.id = p_run_id
    and br.ended_at is null;

  if not found then
    return false;
  end if;

  perform public.refresh_benchmark_views();
  return true;
end;
$$;

revoke all on function public.finalize_benchmark_run(uuid) from public;
grant execute on function public.finalize_benchmark_run(uuid) to authenticated, service_role;

-- Backfill historical scores with successful-response-only denominators.
with highcharts as (
  select coalesce(
    (select c.id from public.competitors c where c.is_primary is true order by c.sort_order asc, c.name asc limit 1),
    (select c.id from public.competitors c where c.slug = 'highcharts' order by c.sort_order asc, c.name asc limit 1)
  ) as competitor_id
),
per_run_counts as (
  select
    br.run_id,
    count(distinct br.query_id)::int as query_count,
    count(*)::int as total_responses
  from public.benchmark_responses br
  group by br.run_id
),
per_run_query_stats as (
  select
    br.run_id,
    br.query_id,
    count(distinct br.id)::numeric as response_count,
    coalesce(
      sum(
        case
          when rm.competitor_id = (select competitor_id from highcharts) and rm.mentioned is true then 1
          else 0
        end
      ),
      0
    )::numeric as highcharts_mentions,
    coalesce(
      sum(
        case
          when rm.mentioned is true then 1
          else 0
        end
      ),
      0
    )::numeric as total_mentions
  from public.benchmark_responses br
  left join public.response_mentions rm on rm.response_id = br.id
  where coalesce(trim(br.error), '') = ''
  group by br.run_id, br.query_id
),
per_run_scores as (
  select
    prs.run_id,
    coalesce(
      round(
        avg(
          (
            (0.7 * case when prs.response_count > 0 then (prs.highcharts_mentions / prs.response_count) else 0 end) +
            (0.3 * case when prs.total_mentions > 0 then (prs.highcharts_mentions / prs.total_mentions) else 0 end)
          ) * 100
        )::numeric,
        2
      ),
      0
    )::numeric(6,2) as overall_score
  from per_run_query_stats prs
  group by prs.run_id
),
active_competitor_count as (
  select count(*)::int as competitor_count
  from public.competitors c
  where c.is_active is true
)
update public.benchmark_runs br
set
  overall_score = coalesce(prs.overall_score, 0),
  query_count = coalesce(prc.query_count, 0),
  total_responses = coalesce(prc.total_responses, 0),
  competitor_count = coalesce((select competitor_count from active_competitor_count), 0)
from per_run_counts prc
left join per_run_scores prs on prs.run_id = prc.run_id
where br.id = prc.run_id;

grant select on public.mv_run_summary to anon, authenticated;
grant select on public.mv_competitor_mention_rates to anon, authenticated;
grant select on public.mv_visibility_scores to anon, authenticated;

select public.refresh_benchmark_views();
