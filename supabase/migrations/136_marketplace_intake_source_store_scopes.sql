create table if not exists public.marketplace_intake_source_store_scopes (
  id bigserial primary key,
  source_key text not null,
  business_id bigint null,
  business_code text not null,
  platform text not null,
  store_name text not null,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_key, store_name)
);

create index if not exists marketplace_intake_source_store_scopes_source_key_idx
  on public.marketplace_intake_source_store_scopes (source_key);

drop trigger if exists trg_marketplace_intake_source_store_scopes_updated_at
  on public.marketplace_intake_source_store_scopes;

create trigger trg_marketplace_intake_source_store_scopes_updated_at
before update on public.marketplace_intake_source_store_scopes
for each row execute function public.trg_set_updated_at();
