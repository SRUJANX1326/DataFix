-- DataFix run history and Knowledge Discovery feedback store.
-- Run in Supabase SQL Editor. Backend service-role key is used only server-side.
create table if not exists public.datafix_runs (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  dataset_name text not null,
  rows_before int, rows_after int,
  score_before numeric, score_after numeric,
  report jsonb not null default '{}'::jsonb,
  change_log jsonb not null default '[]'::jsonb
);

alter table public.datafix_runs enable row level security;


create table if not exists public.datafix_learning (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  dataset_name text,
  schema_fingerprint text,
  knowledge jsonb not null default '{}'::jsonb,
  score_delta numeric,
  issue_patterns jsonb not null default '{}'::jsonb,
  repair_patterns jsonb not null default '[]'::jsonb
);
alter table public.datafix_learning enable row level security;
-- No public policies: API service-role credentials exclusively access these tables.
