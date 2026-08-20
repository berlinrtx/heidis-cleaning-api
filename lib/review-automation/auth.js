'use strict';

const crypto = require('node:crypto');

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function bearerToken(req) {
  return String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
}

function isAdmin(req) {
  return Boolean(process.env.REVIEW_ADMIN_API_KEY)
    && safeEqual(bearerToken(req), process.env.REVIEW_ADMIN_API_KEY);
}

function isCron(req) {
  return Boolean(process.env.CRON_SECRET)
    && safeEqual(bearerToken(req), process.env.CRON_SECRET);
}

function isFormWebhook(req) {
  return Boolean(process.env.REVIEW_FORM_WEBHOOK_SECRET)
    && safeEqual(req.headers['x-form-webhook-secret'], process.env.REVIEW_FORM_WEBHOOK_SECRET);
}

module.exports = { isAdmin, isCron, isFormWebhook, safeEqual };
