'use strict';

const crypto = require('node:crypto');
const { normalizeEmail, normalizePhone } = require('./http');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CURRENT_REVIEW_COUPON_DISCOUNT_CENTS = 2500;
const SUPPORTED_REVIEW_COUPON_DISCOUNT_CENTS = new Set([2500, 4000]);

function isSupportedReviewCouponDiscount(value) {
  return SUPPORTED_REVIEW_COUPON_DISCOUNT_CENTS.has(Number(value));
}

function rewardDiscountCents(reward) {
  return isSupportedReviewCouponDiscount(reward?.discount_amount)
    ? Number(reward.discount_amount)
    : CURRENT_REVIEW_COUPON_DISCOUNT_CENTS;
}

function createCouponCode() {
  const bytes = crypto.randomBytes(12);
  let suffix = '';
  for (let index = 0; index < 10; index += 1) suffix += ALPHABET[bytes[index] % ALPHABET.length];
  return `THANKS-${suffix}`;
}

function couponExpiry() {
  const days = Math.max(1, Math.min(365, Number(process.env.REVIEW_COUPON_TTL_DAYS || 90)));
  return new Date(Date.now() + days * 86400000).toISOString();
}

function contactMatches(reward, email, phone) {
  const storedEmail = normalizeEmail(reward.email);
  const storedPhone = normalizePhone(reward.phone);
  if (!storedEmail && !storedPhone) return true;
  return Boolean(
    (storedEmail && storedEmail === normalizeEmail(email))
    || (storedPhone && storedPhone === normalizePhone(phone))
  );
}

function paymentContactMatches(paymentIntent, email, phone) {
  const stored = paymentIntent?.metadata || {};
  const storedEmail = normalizeEmail(stored.email || stored.billingEmail || stored.senderEmail);
  const storedPhone = normalizePhone(stored.phone || stored.billingPhone);
  if (!storedEmail && !storedPhone) return false;
  return Boolean(
    (storedEmail && storedEmail === normalizeEmail(email))
    || (storedPhone && storedPhone === normalizePhone(phone))
  );
}

function validateCouponRecord(reward, contact = {}) {
  if (!reward) return 'INVALID_COUPON';
  if (!isSupportedReviewCouponDiscount(reward.discount_amount)) return 'INVALID_COUPON';
  if (reward.redeemed) return 'COUPON_REDEEMED';
  if (reward.coupon_cancelled_at) return 'COUPON_CANCELLED';
  if (!reward.expires_at || new Date(reward.expires_at).getTime() <= Date.now()) return 'COUPON_EXPIRED';
  if (!contactMatches(reward, contact.email, contact.phone)) return 'COUPON_CUSTOMER_MISMATCH';
  const ttl = Math.max(1, Math.min(60, Number(process.env.REVIEW_COUPON_RESERVATION_MINUTES || 20)));
  if (reward.coupon_reserved_at && new Date(reward.coupon_reserved_at).getTime() > Date.now() - ttl * 60000) {
    return 'COUPON_RESERVED';
  }
  return null;
}

async function issueCoupon(supabase, rewardId, options = {}) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await supabase.rpc('issue_internal_feedback_coupon', {
      p_reward_id: rewardId,
      p_coupon_code: createCouponCode(),
      p_expires_at: couponExpiry(),
      p_reason: options.reason || 'internal_feedback',
      p_force_replace: Boolean(options.force)
    });
    if (!error) return data;
    if (error.code !== '23505') throw error;
  }
  throw new Error('COUPON_CODE_GENERATION_FAILED');
}

module.exports = {
  CURRENT_REVIEW_COUPON_DISCOUNT_CENTS,
  contactMatches,
  createCouponCode,
  isSupportedReviewCouponDiscount,
  issueCoupon,
  paymentContactMatches,
  rewardDiscountCents,
  validateCouponRecord
};
