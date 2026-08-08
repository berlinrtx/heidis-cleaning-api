create extension if not exists pgcrypto;

create table if not exists public.gift_card_redemptions (
  id uuid primary key default gen_random_uuid(),
  gift_card_id uuid not null references public.gift_cards(id) on delete cascade,
  code text not null,
  amount numeric(10, 2) not null check (amount > 0),
  balance_before numeric(10, 2) not null check (balance_before >= 0),
  balance_after numeric(10, 2) not null check (balance_after >= 0),
  operator_name text not null,
  service_note text not null default '',
  reference text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists gift_card_redemptions_gift_card_id_idx
  on public.gift_card_redemptions (gift_card_id);

create index if not exists gift_card_redemptions_code_idx
  on public.gift_card_redemptions (code);

alter table public.gift_card_redemptions enable row level security;

revoke all on table public.gift_card_redemptions from anon, authenticated;
grant all on table public.gift_card_redemptions to service_role;

create or replace function public.redeem_gift_card(
  p_code text,
  p_amount numeric,
  p_operator_name text,
  p_service_note text default '',
  p_reference text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card public.gift_cards%rowtype;
  v_updated_card public.gift_cards%rowtype;
  v_redemption public.gift_card_redemptions%rowtype;
  v_code text;
  v_amount numeric(10, 2);
  v_balance_after numeric(10, 2);
begin
  v_code := upper(trim(coalesce(p_code, '')));
  v_amount := round(coalesce(p_amount, 0)::numeric, 2);

  if v_code = '' then
    raise exception 'Gift card code is required';
  end if;

  if v_amount <= 0 then
    raise exception 'Redemption amount must be greater than 0';
  end if;

  if trim(coalesce(p_operator_name, '')) = '' then
    raise exception 'Operator name is required';
  end if;

  select *
    into v_card
    from public.gift_cards
    where code = v_code
    for update;

  if not found then
    raise exception 'Gift card not found';
  end if;

  if v_card.status <> 'active' then
    raise exception 'Gift card is not active';
  end if;

  if v_card.balance < v_amount then
    raise exception 'Insufficient gift card balance. Available balance: $%', v_card.balance;
  end if;

  v_balance_after := round((v_card.balance - v_amount)::numeric, 2);

  insert into public.gift_card_redemptions (
    gift_card_id,
    code,
    amount,
    balance_before,
    balance_after,
    operator_name,
    service_note,
    reference
  )
  values (
    v_card.id,
    v_card.code,
    v_amount,
    v_card.balance,
    v_balance_after,
    trim(p_operator_name),
    trim(coalesce(p_service_note, '')),
    trim(coalesce(p_reference, ''))
  )
  returning * into v_redemption;

  update public.gift_cards
    set balance = v_balance_after,
        status = case when v_balance_after = 0 then 'redeemed' else 'active' end,
        redeemed_at = case when v_balance_after = 0 then now() else redeemed_at end
    where id = v_card.id
    returning * into v_updated_card;

  return jsonb_build_object(
    'gift_card', to_jsonb(v_updated_card),
    'redemption', to_jsonb(v_redemption)
  );
end;
$$;

revoke all on function public.redeem_gift_card(text, numeric, text, text, text) from public;
grant execute on function public.redeem_gift_card(text, numeric, text, text, text) to service_role;
