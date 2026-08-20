'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { safeEqual } = require('../lib/review-automation/auth');
const { safeIdentifier } = require('../lib/review-automation/booking-match');
const {
  contactMatches, createCouponCode, paymentContactMatches, validateCouponRecord
} = require('../lib/review-automation/coupons');

test('review secrets use constant-time equality semantics', () => {
  assert.equal(safeEqual('same-secret', 'same-secret'), true);
  assert.equal(safeEqual('same-secret', 'wrong-secret'), false);
  assert.equal(safeEqual('', ''), false);
});

test('review coupon codes are unique and omit ambiguous characters', () => {
  const codes = new Set(Array.from({ length: 500 }, createCouponCode));
  assert.equal(codes.size, 500);
  for (const code of codes) assert.match(code, /^THANKS-[A-HJ-NP-Z2-9]{10}$/);
});

test('review coupon contact matching accepts normalized email or US phone, never name', () => {
  const reward = { email: 'Customer@Example.com', phone: '+1 (650) 555-0100' };
  assert.equal(contactMatches(reward, 'customer@example.com', ''), true);
  assert.equal(contactMatches(reward, '', '650-555-0100'), true);
  assert.equal(contactMatches(reward, 'other@example.com', '650-555-9999'), false);
});

test('payment contact must be present in trusted PaymentIntent metadata', () => {
  const paymentIntent = { metadata: { email: 'buyer@example.com', phone: '6505550100' } };
  assert.equal(paymentContactMatches(paymentIntent, 'buyer@example.com', ''), true);
  assert.equal(paymentContactMatches(paymentIntent, '', '+1 650 555 0100'), true);
  assert.equal(paymentContactMatches({ metadata: {} }, 'buyer@example.com', ''), false);
});

test('coupon validation rejects terminal and reserved states', () => {
  const active = {
    email: null, phone: null, redeemed: false, coupon_cancelled_at: null,
    expires_at: new Date(Date.now() + 60000).toISOString(), coupon_reserved_at: null
  };
  assert.equal(validateCouponRecord(active), null);
  assert.equal(validateCouponRecord({ ...active, redeemed: true }), 'COUPON_REDEEMED');
  assert.equal(validateCouponRecord({ ...active, coupon_cancelled_at: new Date().toISOString() }), 'COUPON_CANCELLED');
  assert.equal(validateCouponRecord({ ...active, expires_at: new Date(Date.now() - 1).toISOString() }), 'COUPON_EXPIRED');
  assert.equal(validateCouponRecord({ ...active, coupon_reserved_at: new Date().toISOString() }), 'COUPON_RESERVED');
});

test('booking identifiers reject PostgREST expression injection', () => {
  assert.equal(safeIdentifier('bookings'), 'bookings');
  assert.equal(safeIdentifier('booking_id'), 'booking_id');
  assert.equal(safeIdentifier('bookings;drop table users'), null);
  assert.equal(safeIdentifier('email.eq.admin@example.com'), null);
});

test('review schema revokes public roles and binds release to PaymentIntent', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/review_automation.sql'), 'utf8');
  assert.match(sql, /enable row level security/);
  assert.match(sql, /from public, anon, authenticated/);
  assert.match(sql, /where stripe_payment_intent_id = p_payment_intent_id\s+and coupon_reservation_token = p_reservation_token/);
});
