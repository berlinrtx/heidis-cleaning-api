'use strict';

function json(res, status, payload) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(payload);
}

function requireMethod(req, res, methods) {
  if (methods.includes(req.method)) return true;
  res.setHeader('Allow', methods.join(', '));
  json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  return false;
}

function handleCors(req, res, methods = ['POST']) {
  const origin = String(req.headers.origin || '');
  const allowed = String(process.env.REVIEW_ALLOWED_ORIGINS || '')
    .split(',').map(value => value.trim()).filter(Boolean);
  if (origin && !allowed.includes(origin)) {
    json(res, 403, { error: 'ORIGIN_NOT_ALLOWED' });
    return true;
  }
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', [...methods, 'OPTIONS'].join(', '));
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch {
      const error = new Error('INVALID_JSON');
      error.statusCode = 400;
      throw error;
    }
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch {
    const error = new Error('INVALID_JSON');
    error.statusCode = 400;
    throw error;
  }
}

function cleanText(value, maxLength = 500) {
  if (value === undefined || value === null) return null;
  const cleaned = String(value).trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function normalizeEmail(value) {
  return cleanText(value, 320)?.toLowerCase() || null;
}

function normalizePhone(value) {
  let digits = cleanText(value, 50)?.replace(/\D/g, '') || '';
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  return digits.length >= 7 ? digits : null;
}

function publicError(error, fallback = 'REQUEST_FAILED') {
  const message = String(error?.message || '');
  const known = [
    'INVALID_COUPON', 'COUPON_REDEEMED', 'COUPON_CANCELLED', 'COUPON_EXPIRED',
    'COUPON_CUSTOMER_MISMATCH', 'COUPON_RESERVED', 'PAYMENT_INTENT_NOT_EDITABLE',
    'PAYMENT_INTENT_ALREADY_DISCOUNTED', 'PAYMENT_CUSTOMER_MISMATCH',
    'DISCOUNT_EXCEEDS_AMOUNT', 'INVALID_PAYMENT_INTENT', 'INVALID_RESERVATION_TOKEN'
  ];
  return known.find(code => message.includes(code)) || fallback;
}

module.exports = {
  cleanText, handleCors, json, normalizeEmail, normalizePhone,
  publicError, readJson, requireMethod
};
