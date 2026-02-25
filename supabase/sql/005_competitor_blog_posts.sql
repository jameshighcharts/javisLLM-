-- Competitor blog post feed storage for dashboard timeline + table views.
-- Run this in Supabase SQL editor after 001_init_schema.sql.

create extension if not exists pgcrypto;

create table if not exists public.competitor_blog_posts (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_slug text not null default 'unknown',
  title text not null,
  content_theme text not null default 'General',
  description text not null default '',
  author text,
  link text not null unique,
  publish_date date,
  published_at timestamptz,
  publish_date_raw text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_competitor_blog_posts_source_slug_date
  on public.competitor_blog_posts (source_slug, publish_date desc);

create index if not exists idx_competitor_blog_posts_publish_date
  on public.competitor_blog_posts (publish_date desc, published_at desc);

create index if not exists idx_competitor_blog_posts_source_ci
  on public.competitor_blog_posts (lower(source));

drop trigger if exists trg_competitor_blog_posts_updated_at on public.competitor_blog_posts;
create trigger trg_competitor_blog_posts_updated_at
before update on public.competitor_blog_posts
for each row execute function public.touch_updated_at();

alter table public.competitor_blog_posts enable row level security;

drop policy if exists competitor_blog_posts_read on public.competitor_blog_posts;
create policy competitor_blog_posts_read on public.competitor_blog_posts
for select to anon, authenticated using (true);

drop policy if exists competitor_blog_posts_write_auth on public.competitor_blog_posts;
create policy competitor_blog_posts_write_auth on public.competitor_blog_posts
for all to authenticated using (true) with check (true);
