-- Server-side enqueue pipeline: snapshot active prompts into benchmark_jobs and queue messages.

create or replace function public.enqueue_benchmark_run(
  p_run_id uuid,
  p_models text[],
  p_our_terms text,
  p_runs_per_model int default 1,
  p_temperature numeric default 0.7,
  p_web_search boolean default true,
  p_prompt_limit int default null
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

  -- If there are no active prompts, no jobs are created and the worker will never see
  -- this run. Finalize immediately so runs are not left pending forever.
  if v_query_count = 0 then
    perform public.finalize_benchmark_run(p_run_id);
  end if;

  return jsonb_build_object(
    'run_id', p_run_id,
    'jobs_enqueued', v_jobs_enqueued,
    'models', v_models,
    'query_count', v_query_count,
    'competitor_count', v_competitor_count
  );
end;
$$;

revoke all on function public.enqueue_benchmark_run(uuid, text[], text, int, numeric, boolean, int) from public;
grant execute on function public.enqueue_benchmark_run(uuid, text[], text, int, numeric, boolean, int) to authenticated, service_role;
