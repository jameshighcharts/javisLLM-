-- Add per-model runtime/token metadata and make response uniqueness model-aware.

alter table public.benchmark_responses
  add column if not exists model_run_id int,
  add column if not exists model_index int,
  add column if not exists provider text,
  add column if not exists model_owner text,
  add column if not exists duration_ms int not null default 0,
  add column if not exists prompt_tokens int not null default 0,
  add column if not exists completion_tokens int not null default 0,
  add column if not exists total_tokens int not null default 0;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'benchmark_responses_run_id_query_id_run_iteration_key'
  ) then
    alter table public.benchmark_responses
      drop constraint benchmark_responses_run_id_query_id_run_iteration_key;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'benchmark_responses_run_id_query_id_run_iteration_model_key'
  ) then
    alter table public.benchmark_responses
      add constraint benchmark_responses_run_id_query_id_run_iteration_model_key
      unique (run_id, query_id, run_iteration, model);
  end if;
end
$$;

create index if not exists benchmark_responses_model_idx
  on public.benchmark_responses (model);

