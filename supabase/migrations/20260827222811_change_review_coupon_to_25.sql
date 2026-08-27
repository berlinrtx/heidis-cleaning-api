begin;

alter table public.review_rewards
  alter column discount_amount set default 2500;

alter table public.review_rewards
  drop constraint if exists review_rewards_discount_amount_check;

alter table public.review_rewards
  add constraint review_rewards_discount_amount_check
  check (discount_amount in (2500, 4000));

comment on column public.review_rewards.discount_amount is
  'USD cents. New coupons are 2500. Historical issued coupons may remain 4000.';

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
      discount_amount = 2500,
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

revoke all on function public.issue_internal_feedback_coupon(uuid, text, timestamptz, text, boolean)
  from public, anon, authenticated;
grant execute on function public.issue_internal_feedback_coupon(uuid, text, timestamptz, text, boolean)
  to service_role;

notify pgrst, 'reload schema';

commit;
