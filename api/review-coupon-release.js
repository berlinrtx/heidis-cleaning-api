'use strict';

const { getStripe, getSupabase } = require('../lib/review-automation/clients');
const { cleanText, handleCors, json, readJson, requireMethod } = require('../lib/review-automation/http');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PI_PATTERN = /^pi_[A-Za-z0-9]+$/;

export default async function handler(req, res) {
  if (handleCors(req, res, ['POST'])) return;
  if (!requireMethod(req, res, ['POST'])) return;
  try {
    const body = await readJson(req);
    const paymentIntentId = cleanText(body.paymentIntentId, 100);
    const reservationToken = cleanText(body.reservationToken, 50);
    if (!PI_PATTERN.test(paymentIntentId || '') || !UUID_PATTERN.test(reservationToken || '')) {
      return json(res, 400, { error: 'INVALID_RELEASE' });
    }

    const stripe = getStripe();
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (paymentIntent.metadata?.review_coupon_reservation_token !== reservationToken) {
      return json(res, 409, { error: 'RESERVATION_MISMATCH' });
    }
    if (paymentIntent.status === 'succeeded') {
      return json(res, 409, { error: 'PAYMENT_ALREADY_SUCCEEDED' });
    }
    if (paymentIntent.status !== 'canceled') await stripe.paymentIntents.cancel(paymentIntentId);

    const { data, error } = await getSupabase().rpc('release_review_coupon', {
      p_payment_intent_id: paymentIntentId, p_reservation_token: reservationToken
    });
    if (error) throw error;
    if (!data) return json(res, 409, { error: 'RESERVATION_MISMATCH' });
    return json(res, 200, { ok: true });
  } catch (error) {
    console.error('Review coupon release failed:', error);
    return json(res, 500, { error: 'COUPON_RELEASE_FAILED' });
  }
}
