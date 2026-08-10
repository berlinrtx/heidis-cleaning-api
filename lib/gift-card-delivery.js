const crypto = require('crypto');

const VALID_DELIVERY_METHODS = new Set(['email', 'sms', 'both']);

function generateGiftCardCode() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';

  for (let index = 0; index < 8; index += 1) {
    code += alphabet[crypto.randomInt(0, alphabet.length)];
  }

  return `HC-GC-${code.slice(0, 4)}-${code.slice(4)}`;
}

function normalizeDeliveryMethod(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return VALID_DELIVERY_METHODS.has(normalized) ? normalized : 'both';
}

function shouldDeliverBy(deliveryMethod, channel) {
  const normalized = normalizeDeliveryMethod(deliveryMethod);
  return normalized === 'both' || normalized === channel;
}

function buildGiftCardSms(giftCard) {
  const amount = Number.parseFloat(giftCard.original_amount || 0).toFixed(2);
  const sender = giftCard.sender_name || 'Someone';
  const recipient = giftCard.recipient_name || 'there';
  const code = String(giftCard.code || '').trim();
  const isTest = giftCard.is_test === true;

  if (!code || code === 'Code unavailable') {
    throw new Error('Gift card redemption code is required for SMS delivery.');
  }

  const purchaseDate = new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    timeZone: 'America/Los_Angeles'
  }).format(new Date(giftCard.created_at || Date.now()));

  return [
    isTest ? "TEST — Heidi's Cleaning Gift Card" : "Heidi's Cleaning Gift Card",
    `From: ${sender}`,
    `For: ${recipient}`,
    `Amount: $${amount}`,
    `Redemption code: ${code}`,
    `Date: ${purchaseDate}`,
    isTest
      ? 'Delivery test only. This code has no cash value and cannot be redeemed.'
      : 'To redeem, call (650) 248-4146. This number is not monitored.'
  ].join('\n');
}

module.exports = {
  buildGiftCardSms,
  generateGiftCardCode,
  normalizeDeliveryMethod,
  shouldDeliverBy
};
