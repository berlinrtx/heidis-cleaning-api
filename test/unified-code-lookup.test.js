'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  formatReviewCoupon,
  maskEmail,
  maskPhone,
  reviewCouponStatus
} = require('../lib/unified-code-lookup');

const now = Date.parse('2026-08-28T12:00:00.000Z');
const reward = {
  coupon_code: 'THANKS-ABCD234567',
  customer_name: 'Maria Customer',
  email: 'maria@example.com',
  phone: '+1 (650) 555-4146',
  discount_amount: 2500,
  review_status: 'coupon_sent',
  created_at: '2026-08-20T12:00:00.000Z',
  expires_at: '2026-11-20T12:00:00.000Z',
  redeemed: false,
  redeemed_at: null,
  coupon_cancelled_at: null,
  coupon_reserved_at: null
};

test('review coupon lookup formats dollars and masks customer contact data', () => {
  assert.deepEqual(formatReviewCoupon(reward, now), {
    code: 'THANKS-ABCD234567',
    customerName: 'Maria Customer',
    customerEmail: 'm***@example.com',
    customerPhone: '***4146',
    discountAmount: 25,
    status: 'active',
    reviewStatus: 'coupon_sent',
    createdAt: '2026-08-20T12:00:00.000Z',
    expiresAt: '2026-11-20T12:00:00.000Z',
    redeemedAt: null
  });
});

test('review coupon lookup reports terminal and temporary states', () => {
  assert.equal(reviewCouponStatus({ ...reward, redeemed: true }, now), 'redeemed');
  assert.equal(reviewCouponStatus({ ...reward, coupon_cancelled_at: '2026-08-21T12:00:00Z' }, now), 'cancelled');
  assert.equal(reviewCouponStatus({ ...reward, expires_at: '2026-08-27T12:00:00Z' }, now), 'expired');
  assert.equal(reviewCouponStatus({ ...reward, coupon_reserved_at: '2026-08-28T11:50:00Z' }, now), 'reserved');
});

test('contact masking never exposes full review coupon contact values', () => {
  assert.equal(maskEmail('customer@example.com'), 'c***@example.com');
  assert.equal(maskPhone('+1 650 555 0100'), '***0100');
  assert.equal(maskEmail('invalid'), '');
  assert.equal(maskPhone(''), '');
});
