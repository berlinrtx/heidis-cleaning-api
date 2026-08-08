create table if not exists public.ringcentral_tokens (
  key text primary key,
  access_token text not null,
  refresh_token text not null,
  token_type text not null default 'bearer',
  scope text not null default '',
  expires_at timestamptz not null,
  refresh_token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ringcentral_tokens enable row level security;

revoke all on table public.ringcentral_tokens from anon, authenticated;
grant all on table public.ringcentral_tokens to service_role;

create or replace function public.set_ringcentral_tokens_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ringcentral_tokens_set_updated_at on public.ringcentral_tokens;
create trigger ringcentral_tokens_set_updated_at
before update on public.ringcentral_tokens
for each row execute function public.set_ringcentral_tokens_updated_at();
