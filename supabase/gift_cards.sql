create extension if not exists pgcrypto;

create table if not exists public.gift_cards (
  id uuid primary key default gen_random_uuid(),
  payment_intent_id text not null unique,
  code text not null unique,
  sender_name text not null,
  sender_email text not null,
  recipient_name text not null,
  recipient_email text not null,
  recipient_phone text not null default '',
  personal_message text not null default '',
  original_amount numeric(10, 2) not null check (original_amount > 0),
  discount_amount numeric(10, 2) not null default 0 check (discount_amount >= 0),
  paid_amount numeric(10, 2) not null check (paid_amount >= 0),
  balance numeric(10, 2) not null check (balance >= 0),
  currency text not null default 'usd',
  status text not null default 'active' check (status in ('active', 'redeemed', 'disabled')),
  email_sent_at timestamptz,
  resend_email_id text,
  sms_sent_at timestamptz,
  ringcentral_message_id text,
  internal_record_email_sent_at timestamptz,
  internal_record_resend_email_id text,
  redeemed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.gift_cards enable row level security;

revoke all on table public.gift_cards from anon, authenticated;
grant all on table public.gift_cards to service_role;

create or replace function public.set_gift_cards_updated_at()
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

drop trigger if exists gift_cards_set_updated_at on public.gift_cards;
create trigger gift_cards_set_updated_at
before update on public.gift_cards
for each row execute function public.set_gift_cards_updated_at();
