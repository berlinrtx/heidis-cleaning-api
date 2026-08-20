'use strict';

const { getStripe, getSupabase } = require('../clients');
const { paymentContactMatches } = require('../coupons');
const {
  cleanText, handleCors, json, publicError, readJson, requireMethod
} = require('../http');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PI_PATTERN = /^pi_[A-Za-z0-9]+$/;

async function restorePaymentIntent(stripe, paymentIntent) {
  await stripe.paymentIntents.update(paymentIntent.id, {
    amount: paymentIntent.amount,
    metadata: {
      review_reward_id: '', review_coupon_code: '', review_coupon_discount_cents: '',
      review_coupon_reservation_token: '', review_original_amount_cents: ''
    }
  }).catch(() => {});
}

async function handler(req, res) {
  if (handleCors(req, res, ['POST'])) return;
  if (!requireMethod(req, res, ['POST'])) return;
  let reservation;
  let paymentIntent;
  let reservationToken;
  try {
    const body = await readJson(req);
    const paymentIntentId = cleanText(body.paymentIntentId, 100);
    const couponCode = cleanText(body.couponCode, 40)?.toUpperCase();
    reservationToken = cleanText(body.reservationToken, 50);
    if (!PI_PATTERN.test(paymentIntentId || '')) throw new Error('INVALID_PAYMENT_INTENT');
    if (!UUID_PATTERN.test(reservationToken || '')) throw new Error('INVALID_RESERVATION_TOKEN');
    if (!couponCode) throw new Error('INVALID_COUPON');

    const stripe = getStripe();
    const supabase = getSupabase();
    paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (!['requires_payment_method', 'requires_confirmation'].includes(paymentIntent.status)) {
      throw new Error('PAYMENT_INTENT_NOT_EDITABLE');
    }
    if (!paymentContactMatches(paymentIntent, body.email, body.phone)) {
      throw new Error('PAYMENT_CUSTOMER_MISMATCH');
    }

    if (paymentIntent.metadata?.review_coupon_reservation_token === reservationToken) {
      return json(res, 200, {
        ok: true, applied: true, paymentIntentId, finalAmount: paymentIntent.amount,
        discountAmount: 4000, idempotent: true
      });
    }
    if (paymentIntent.metadata?.review_reward_id) throw new Error('PAYMENT_INTENT_ALREADY_DISCOUNTED');

    const { data: reservedRows, error: reserveError } = await supabase.rpc('reserve_review_coupon', {
      p_coupon_code: couponCode,
      p_email: cleanText(body.email, 320),
      p_phone: cleanText(body.phone, 50),
      p_reservation_token: reservationToken,
      p_reservation_minutes: Math.max(1, Math.min(60, Number(process.env.REVIEW_COUPON_RESERVATION_MINUTES || 20)))
    });
    if (reserveError) throw reserveError;
    reservation = Array.isArray(reservedRows) ? reservedRows[0] : reservedRows;
    if (!reservation || reservation.discount_amount !== 4000) throw new Error('INVALID_COUPON');
    if (paymentIntent.amount < 4000) throw new Error('DISCOUNT_EXCEEDS_AMOUNT');

    if (reservation.previous_payment_intent_id && reservation.previous_payment_intent_id !== paymentIntentId) {
      const previous = await stripe.paymentIntents.retrieve(reservation.previous_payment_intent_id);
      if (previous.status === 'succeeded') {
        await supabase.rpc('redeem_review_coupon_verified', {
          p_reward_id: reservation.reward_id, p_payment_intent_id: previous.id
        });
        throw new Error('COUPON_REDEEMED');
      }
      if (previous.status !== 'canceled') await stripe.paymentIntents.cancel(previous.id);
    }

    const finalAmount = paymentIntent.amount - 4000;
    await stripe.paymentIntents.update(paymentIntentId, {
      amount: finalAmount,
      metadata: {
        review_reward_id: reservation.reward_id,
        review_coupon_code: couponCode,
        review_coupon_discount_cents: '4000',
        review_coupon_reservation_token: reservationToken,
        review_original_amount_cents: String(paymentIntent.amount)
      }
    }, { idempotencyKey: `review-coupon-${reservation.reward_id}-${reservationToken}` });

    const { data: attached, error: attachError } = await supabase.rpc('attach_review_coupon_payment_intent', {
      p_reward_id: reservation.reward_id,
      p_reservation_token: reservationToken,
      p_payment_intent_id: paymentIntentId
    });
    if (attachError || !attached) {
      await restorePaymentIntent(stripe, paymentIntent);
      throw attachError || new Error('COUPON_ATTACH_FAILED');
    }

    return json(res, 200, {
      ok: true, applied: true, paymentIntentId, originalAmount: paymentIntent.amount,
      discountAmount: 4000, finalAmount
    });
  } catch (error) {
    console.error('Review coupon apply failed:', error);
    if (reservation && paymentIntent) {
      await getSupabase().rpc('release_review_coupon', {
        p_payment_intent_id: paymentIntent.id, p_reservation_token: reservationToken
      }).catch(() => {});
    }
    const code = publicError(error, 'COUPON_APPLY_FAILED');
    return json(res, code === 'COUPON_APPLY_FAILED' ? 500 : 409, { error: code });
  }
}

module.exports = handler;
