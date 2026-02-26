-- Queue foundation for benchmark execution using pgmq.

create extension if not exists pgmq;

-- Create the benchmark queue once.
do $$
begin
  perform pgmq.create('benchmark_jobs');
exception
  when duplicate_table then
    null;
  when others then
    if position('already exists' in lower(sqlerrm)) > 0 then
      null;
    else
      raise;
    end if;
end
$$;

create or replace function public.rpc_pgmq_send(
  p_queue text,
  p_message jsonb,
  p_delay int default 0
)
returns bigint
language plpgsql
security definer
set search_path = public, pgmq
as $$
begin
  return (select pgmq.send(p_queue, p_message, p_delay));
end;
$$;

create or replace function public.rpc_pgmq_read(
  p_queue text,
  p_vt int default 120,
  p_qty int default 1
)
returns setof pgmq.message_record
language plpgsql
security definer
set search_path = public, pgmq
as $$
begin
  return query select * from pgmq.read(p_queue, p_vt, p_qty);
end;
$$;

create or replace function public.rpc_pgmq_archive(
  p_queue text,
  p_msg_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = public, pgmq
as $$
begin
  return (select pgmq.archive(p_queue, p_msg_id));
end;
$$;

revoke all on function public.rpc_pgmq_send(text, jsonb, int) from public;
revoke all on function public.rpc_pgmq_read(text, int, int) from public;
revoke all on function public.rpc_pgmq_archive(text, bigint) from public;

grant execute on function public.rpc_pgmq_send(text, jsonb, int) to authenticated, service_role;
grant execute on function public.rpc_pgmq_read(text, int, int) to authenticated, service_role;
grant execute on function public.rpc_pgmq_archive(text, bigint) to authenticated, service_role;

create table if not exists public.benchmark_jobs (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.benchmark_runs(id) on delete cascade,
  query_id uuid not null references public.prompt_queries(id),
  query_text text not null,
  model text not null,
  run_iteration int not null,
  provider text not null,
  temperature numeric(4,2) not null default 0.70,
  web_search_enabled boolean not null default false,
  our_terms text[] not null default '{}'::text[],
  status text not null default 'pending' check (
    status in ('pending', 'processing', 'completed', 'failed', 'dead_letter')
  ),
  pgmq_msg_id bigint,
  attempt_count int not null default 0,
  max_attempts int not null default 3,
  started_at timestamptz,
  completed_at timestamptz,
  last_error text,
  response_id bigint references public.benchmark_responses(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, query_id, run_iteration, model)
);

create index if not exists benchmark_jobs_run_id_idx
  on public.benchmark_jobs (run_id);

create index if not exists benchmark_jobs_status_idx
  on public.benchmark_jobs (status);

create index if not exists benchmark_jobs_pgmq_msg_id_idx
  on public.benchmark_jobs (pgmq_msg_id);

create index if not exists benchmark_jobs_run_status_idx
  on public.benchmark_jobs (run_id, status);

-- Keep updated_at in sync for operational debugging.
drop trigger if exists trg_benchmark_jobs_updated_at on public.benchmark_jobs;
create trigger trg_benchmark_jobs_updated_at
before update on public.benchmark_jobs
for each row execute function public.touch_updated_at();

alter table public.benchmark_jobs enable row level security;

drop policy if exists benchmark_jobs_read on public.benchmark_jobs;
create policy benchmark_jobs_read on public.benchmark_jobs
for select to anon, authenticated using (true);

drop policy if exists benchmark_jobs_write_auth on public.benchmark_jobs;
create policy benchmark_jobs_write_auth on public.benchmark_jobs
for all to authenticated using (true) with check (true);

grant select on public.benchmark_jobs to anon, authenticated;
grant insert, update, delete on public.benchmark_jobs to authenticated;
