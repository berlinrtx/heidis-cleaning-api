begin;

create extension if not exists pgcrypto;

create table if not exists public.review_rewards (
  id uuid primary key default gen_random_uuid(),
  form_response_id text not null,
  customer_id text,
  booking_id text,
  customer_name text,
  email text,
  phone text,
  service_date date,
  internal_rating smallint not null check (internal_rating between 1 and 5),
  review_source text not null default 'internal_form'
    check (review_source in ('internal_form', 'google', 'yelp', 'google_yelp')),
  review_status text not null default 'form_received'
    check (review_status in (
      'form_received', 'not_eligible', 'review_requested',
      'pending_verification', 'review_verified', 'coupon_generated',
      'coupon_sent', 'coupon_redeemed'
    )),
  coupon_code text,
  discount_amount integer not null default 4000 check (discount_amount = 4000),
  coupon_reason text check (coupon_reason in ('internal_feedback', 'customer_care', 'admin_courtesy')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz,
  redeemed boolean not null default false,
  redeemed_at timestamptz,
  coupon_cancelled_at timestamptz,
  coupon_reserved_at timestamptz,
  coupon_reservation_token uuid,
  stripe_payment_intent_id text,
  external_review_id text,
  external_review_url text,
  external_review_rating smallint check (external_review_rating between 1 and 5),
  external_review_created_at timestamptz,
  external_match_confidence numeric(4,3) check (external_match_confidence between 0 and 1),
  request_sent_at timestamptz,
  coupon_sent_at timestamptz,
  last_error text,
  raw_form_payload jsonb not null default '{}'::jsonb,
  constraint review_rewards_form_response_id_key unique (form_response_id),
  constraint review_rewards_coupon_code_key unique (coupon_code),
  constraint review_rewards_coupon_code_format check (
    coupon_code is null or coupon_code ~ '^THANKS-[A-HJ-NP-Z2-9]{10}$'
  ),
  constraint review_rewards_redeemed_state check (
    (redeemed = false and redeemed_at is null)
    or (redeemed = true and redeemed_at is not null)
  ),
  constraint review_rewards_coupon_fields check (
    coupon_code is null or (expires_at is not null and coupon_reason is not null)
  )
);

comment on table public.review_rewards is
  'Private service feedback and fixed-value benefits. Public reviews never unlock benefits.';
comment on column public.review_rewards.discount_amount is
  'USD cents. Fixed at 4000; clients never choose this value.';

create unique index if not exists review_rewards_external_review_key
  on public.review_rewards (review_source, external_review_id)
  where external_review_id is not null;
create index if not exists review_rewards_status_created_idx
  on public.review_rewards (review_status, created_at desc);
create index if not exists review_rewards_email_idx
  on public.review_rewards (lower(email)) where email is not null;
create index if not exists review_rewards_phone_idx
  on public.review_rewards (phone) where phone is not null;
create index if not exists review_rewards_booking_idx
  on public.review_rewards (booking_id) where booking_id is not null;

create table if not exists public.review_automation_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  external_event_id text not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz not null default now(),
  constraint review_automation_events_provider_event_key
    unique (provider, external_event_id)
);

create table if not exists public.external_reviews (
  id uuid primary key default gen_random_uuid(),
  review_source text not null check (review_source in ('google', 'yelp')),
  external_review_id text not null,
  external_reviewer_name text,
  external_rating smallint not null check (external_rating between 1 and 5),
  external_review_text text,
  external_review_url text,
  external_created_at timestamptz,
  external_updated_at timestamptz,
  match_status text not null default 'pending_verification'
    check (match_status in ('pending_verification', 'manually_linked', 'ignored')),
  matched_reward_id uuid references public.review_rewards(id) on delete set null,
  raw_payload jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint external_reviews_source_id_key unique (review_source, external_review_id)
);

create index if not exists external_reviews_match_status_seen_idx
  on public.external_reviews (match_status, first_seen_at desc);
create index if not exists external_reviews_matched_reward_idx
  on public.external_reviews (matched_reward_id) where matched_reward_id is not null;

alter table public.review_rewards enable row level security;
alter table public.review_automation_events enable row level security;
alter table public.external_reviews enable row level security;

revoke all on table public.review_rewards from public, anon, authenticated;
revoke all on table public.review_automation_events from public, anon, authenticated;
revoke all on table public.external_reviews from public, anon, authenticated;
grant select, insert, update on table public.review_rewards to service_role;
grant select, insert, update on table public.review_automation_events to service_role;
grant select, insert, update on table public.external_reviews to service_role;

create or replace function public.touch_review_rewards_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists review_rewards_touch_updated_at on public.review_rewards;
create trigger review_rewards_touch_updated_at
before update on public.review_rewards
for each row execute function public.touch_review_rewards_updated_at();

create or replace function public.issue_internal_feedback_coupon(
  p_reward_id uuid,
  p_coupon_code text,
  p_expires_at timestamptz,
  p_reason text default 'internal_feedback',
  p_force_replace boolean default false
)
returns public.review_rewards
language plpgsql
security invoker
set search_path = ''
as $$
declare
  reward public.review_rewards;
begin
  select * into reward
  from public.review_rewards
  where id = p_reward_id
  for update;

  if reward.id is null then raise exception 'REWARD_NOT_FOUND'; end if;
  if reward.redeemed then raise exception 'COUPON_ALREADY_REDEEMED'; end if;
  if p_reason not in ('internal_feedback', 'customer_care', 'admin_courtesy') then
    raise exception 'INVALID_COUPON_REASON';
  end if;
  if reward.coupon_reserved_at is not null
     and reward.coupon_reserved_at > now() - interval '60 minutes'
     and p_force_replace then
    raise exception 'COUPON_RESERVED';
  end if;
  if reward.coupon_code is not null
     and reward.coupon_cancelled_at is null
     and reward.expires_at > now()
     and not p_force_replace then
    return reward;
  end if;

  update public.review_rewards
  set coupon_code = upper(trim(p_coupon_code)),
      discount_amount = 4000,
      coupon_reason = p_reason,
      expires_at = p_expires_at,
      coupon_cancelled_at = null,
      coupon_reserved_at = null,
      coupon_reservation_token = null,
      stripe_payment_intent_id = null,
      review_status = 'coupon_generated',
      last_error = null
  where id = p_reward_id
  returning * into reward;

  return reward;
end;
$$;

create or replace function public.reserve_review_coupon(
  p_coupon_code text,
  p_email text,
  p_phone text,
  p_reservation_token uuid,
  p_reservation_minutes integer default 20
)
returns table (reward_id uuid, discount_amount integer, previous_payment_intent_id text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  reward public.review_rewards;
  normalized_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  select * into reward
  from public.review_rewards r
  where r.coupon_code = upper(trim(p_coupon_code))
  for update;

  if reward.id is null then raise exception 'INVALID_COUPON'; end if;
  if reward.redeemed then raise exception 'COUPON_REDEEMED'; end if;
  if reward.coupon_cancelled_at is not null then raise exception 'COUPON_CANCELLED'; end if;
  if reward.expires_at is null or reward.expires_at <= now() then raise exception 'COUPON_EXPIRED'; end if;
  if not (
    (reward.email is null and reward.phone is null)
    or (p_email is not null and lower(trim(reward.email)) = lower(trim(p_email)))
    or (
      length(normalized_phone) >= 10
      and length(regexp_replace(coalesce(reward.phone, ''), '\D', '', 'g')) >= 10
      and right(regexp_replace(coalesce(reward.phone, ''), '\D', '', 'g'), 10) = right(normalized_phone, 10)
    )
  ) then
    raise exception 'COUPON_CUSTOMER_MISMATCH';
  end if;
  if reward.coupon_reserved_at is not null
     and reward.coupon_reserved_at > now() - make_interval(mins => greatest(1, least(p_reservation_minutes, 60)))
     and reward.coupon_reservation_token is distinct from p_reservation_token then
    raise exception 'COUPON_RESERVED';
  end if;

  update public.review_rewards
  set coupon_reserved_at = now(), coupon_reservation_token = p_reservation_token, last_error = null
  where id = reward.id;

  return query select reward.id, reward.discount_amount, reward.stripe_payment_intent_id;
end;
$$;

create or replace function public.attach_review_coupon_payment_intent(
  p_reward_id uuid,
  p_reservation_token uuid,
  p_payment_intent_id text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.review_rewards
  set stripe_payment_intent_id = p_payment_intent_id
  where id = p_reward_id
    and coupon_reservation_token = p_reservation_token
    and redeemed = false;
  return found;
end;
$$;

create or replace function public.release_review_coupon(
  p_payment_intent_id text,
  p_reservation_token uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.review_rewards
  set coupon_reserved_at = null,
      coupon_reservation_token = null,
      stripe_payment_intent_id = null
  where stripe_payment_intent_id = p_payment_intent_id
    and coupon_reservation_token = p_reservation_token
    and redeemed = false;
  return found;
end;
$$;

create or replace function public.redeem_review_coupon_verified(
  p_reward_id uuid,
  p_payment_intent_id text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.review_rewards
  set redeemed = true,
      redeemed_at = now(),
      review_status = 'coupon_redeemed',
      coupon_reserved_at = null,
      coupon_reservation_token = null
  where id = p_reward_id
    and stripe_payment_intent_id = p_payment_intent_id
    and redeemed = false;
  return found;
end;
$$;

revoke all on function public.touch_review_rewards_updated_at() from public, anon, authenticated;
revoke all on function public.issue_internal_feedback_coupon(uuid, text, timestamptz, text, boolean) from public, anon, authenticated;
revoke all on function public.reserve_review_coupon(text, text, text, uuid, integer) from public, anon, authenticated;
revoke all on function public.attach_review_coupon_payment_intent(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.release_review_coupon(text, uuid) from public, anon, authenticated;
revoke all on function public.redeem_review_coupon_verified(uuid, text) from public, anon, authenticated;

grant execute on function public.issue_internal_feedback_coupon(uuid, text, timestamptz, text, boolean) to service_role;
grant execute on function public.reserve_review_coupon(text, text, text, uuid, integer) to service_role;
grant execute on function public.attach_review_coupon_payment_intent(uuid, uuid, text) to service_role;
grant execute on function public.release_review_coupon(text, uuid) to service_role;
grant execute on function public.redeem_review_coupon_verified(uuid, text) to service_role;

notify pgrst, 'reload schema';

commit;
