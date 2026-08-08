alter table public.gift_cards
  add column if not exists payment_intent_id text,
  add column if not exists code text,
  add column if not exists sender_name text,
  add column if not exists sender_email text,
  add column if not exists recipient_name text,
  add column if not exists recipient_email text,
  add column if not exists recipient_phone text default '',
  add column if not exists personal_message text default '',
  add column if not exists original_amount numeric(10, 2),
  add column if not exists discount_amount numeric(10, 2) default 0,
  add column if not exists paid_amount numeric(10, 2),
  add column if not exists balance numeric(10, 2),
  add column if not exists currency text default 'usd',
  add column if not exists status text default 'active',
  add column if not exists email_sent_at timestamptz,
  add column if not exists resend_email_id text,
  add column if not exists sms_sent_at timestamptz,
  add column if not exists ringcentral_message_id text,
  add column if not exists internal_record_email_sent_at timestamptz,
  add column if not exists internal_record_resend_email_id text,
  add column if not exists redeemed_at timestamptz,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create unique index if not exists gift_cards_payment_intent_id_key
  on public.gift_cards (payment_intent_id)
  where payment_intent_id is not null;

create unique index if not exists gift_cards_code_key
  on public.gift_cards (code)
  where code is not null;

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
