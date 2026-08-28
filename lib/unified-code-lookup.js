'use strict';

const { rewardDiscountCents } = require('./review-automation/coupons');

function maskEmail(value) {
  const email = String(value || '').trim();
  const separator = email.indexOf('@');
  if (separator <= 0) return '';
  return `${email.slice(0, 1)}***${email.slice(separator)}`;
}

function maskPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits ? `***${digits.slice(-4)}` : '';
}

function reviewCouponStatus(reward, now = Date.now()) {
  if (reward?.coupon_cancelled_at) return 'cancelled';
  if (reward?.redeemed) return 'redeemed';
  if (!reward?.expires_at || new Date(reward.expires_at).getTime() <= now) return 'expired';

  const reservationMinutes = Math.max(
    1,
    Math.min(60, Number(process.env.REVIEW_COUPON_RESERVATION_MINUTES || 20))
  );
  if (
    reward.coupon_reserved_at
    && new Date(reward.coupon_reserved_at).getTime() > now - reservationMinutes * 60000
  ) {
    return 'reserved';
  }
  return 'active';
}

function formatReviewCoupon(reward, now = Date.now()) {
  return {
    code: reward.coupon_code,
    customerName: reward.customer_name || '',
    customerEmail: maskEmail(reward.email),
    customerPhone: maskPhone(reward.phone),
    discountAmount: rewardDiscountCents(reward) / 100,
    status: reviewCouponStatus(reward, now),
    reviewStatus: reward.review_status || '',
    createdAt: reward.created_at,
    expiresAt: reward.expires_at,
    redeemedAt: reward.redeemed_at
  };
}

module.exports = {
  formatReviewCoupon,
  maskEmail,
  maskPhone,
  reviewCouponStatus
};
