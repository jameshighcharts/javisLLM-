alter table if exists public.prompt_queries
add column if not exists tags text[] not null default '{}'::text[];

update public.prompt_queries
set tags = case
  when lower(query_text) like '%react%' then array['react']::text[]
  when lower(query_text) like '%javascript%' then array['javascript']::text[]
  else array['generic']::text[]
end
where coalesce(array_length(tags, 1), 0) = 0;
