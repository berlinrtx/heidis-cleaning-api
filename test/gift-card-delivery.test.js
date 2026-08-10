const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildGiftCardSms,
  generateGiftCardCode,
  normalizeDeliveryMethod,
  shouldDeliverBy
} = require('../lib/gift-card-delivery');

test('SMS delivery contains the persisted redemption code', () => {
  const sms = buildGiftCardSms({
    code: 'HC-GC-AB12-CD34',
    original_amount: '250.00',
    sender_name: 'Jane',
    recipient_name: 'Alex',
    created_at: '2026-08-10T12:00:00.000Z'
  });

  assert.match(sms, /Redemption code: HC-GC-AB12-CD34/);
  assert.match(sms, /Amount: \$250\.00/);
});

test('SMS delivery fails closed when a redemption code is missing', () => {
  assert.throws(
    () => buildGiftCardSms({ original_amount: '100.00' }),
    /redemption code is required/i
  );
});

test('test SMS is clearly non-redeemable', () => {
  const sms = buildGiftCardSms({
    is_test: true,
    code: 'HC-GC-TEST-0001',
    original_amount: '10.00'
  });

  assert.match(sms, /^TEST —/);
  assert.match(sms, /cannot be redeemed/i);
});

test('generated redemption codes use the production format', () => {
  assert.match(generateGiftCardCode(), /^HC-GC-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
});

test('delivery method selects only the requested notification channels', () => {
  assert.equal(shouldDeliverBy('sms', 'sms'), true);
  assert.equal(shouldDeliverBy('sms', 'email'), false);
  assert.equal(shouldDeliverBy('email', 'email'), true);
  assert.equal(shouldDeliverBy('email', 'sms'), false);
  assert.equal(shouldDeliverBy('both', 'email'), true);
  assert.equal(shouldDeliverBy('both', 'sms'), true);
  assert.equal(normalizeDeliveryMethod('invalid'), 'both');
});
