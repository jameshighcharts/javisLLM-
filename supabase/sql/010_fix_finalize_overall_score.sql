-- Fix finalize_benchmark_run AI visibility denominator and backfill historical run scores.
-- Root cause: response_count was counted after joining response_mentions, which inflated
-- the denominator by competitor-row multiplicity and depressed overall_score.

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

-- Backfill overall_score and run rollups for existing historical runs using corrected math.
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

select public.refresh_benchmark_views();
