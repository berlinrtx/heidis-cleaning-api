begin;

create table if not exists public.system_heartbeats (
  heartbeat_date date primary key default ((now() at time zone 'utc')::date),
  ran_at timestamptz not null default now(),
  source text not null default 'vercel_cron'
    check (char_length(source) between 1 and 80)
);

comment on table public.system_heartbeats is
  'Small server-side heartbeat history used to produce regular database activity.';

alter table public.system_heartbeats enable row level security;
revoke all on table public.system_heartbeats from anon, authenticated;
grant select, insert, update on table public.system_heartbeats to service_role;

commit;
