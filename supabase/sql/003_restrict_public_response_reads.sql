-- Restrict raw benchmark response data to authenticated users only.
-- Apply this in existing Supabase projects where 001_init_schema.sql was already run.

alter table public.benchmark_responses enable row level security;
alter table public.response_mentions enable row level security;

drop policy if exists benchmark_responses_read on public.benchmark_responses;
create policy benchmark_responses_read on public.benchmark_responses
for select to authenticated using (true);

drop policy if exists response_mentions_read on public.response_mentions;
create policy response_mentions_read on public.response_mentions
for select to authenticated using (true);
