'use strict';

const { getSupabase } = require('../clients');
const { validateCouponRecord } = require('../coupons');
const {
  cleanText, handleCors, json, readJson, requireMethod
} = require('../http');

async function handler(req, res) {
  if (handleCors(req, res, ['POST'])) return;
  if (!requireMethod(req, res, ['POST'])) return;
  try {
    const body = await readJson(req);
    const couponCode = cleanText(body.couponCode, 40)?.toUpperCase();
    if (!couponCode) return json(res, 400, { valid: false, error: 'INVALID_COUPON' });
    const { data, error } = await getSupabase().from('review_rewards')
      .select('id,email,phone,expires_at,redeemed,coupon_cancelled_at,coupon_reserved_at,discount_amount')
      .eq('coupon_code', couponCode)
      .maybeSingle();
    if (error) throw error;
    const invalid = validateCouponRecord(data, { email: body.email, phone: body.phone });
    if (invalid) return json(res, 200, { valid: false, error: invalid });
    return json(res, 200, {
      valid: true, discountAmount: data.discount_amount, expiresAt: data.expires_at
    });
  } catch (error) {
    console.error('Review coupon validation failed:', error);
    return json(res, 500, { valid: false, error: 'COUPON_VALIDATION_FAILED' });
  }
}

module.exports = handler;
