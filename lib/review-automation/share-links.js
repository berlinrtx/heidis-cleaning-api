'use strict';

const crypto = require('node:crypto');

const DEFAULT_PUBLIC_BASE_URL = 'https://heidis-cleaning-api.vercel.app';

function signingSecret() {
  const secret = process.env.REVIEW_FORM_WEBHOOK_SECRET;
  if (!secret) throw new Error('REVIEW_SHARE_SIGNING_SECRET_MISSING');
  return secret;
}

function publicBaseUrl() {
  const configured = process.env.REVIEW_PUBLIC_BASE_URL;
  const automatic = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const value = configured || (automatic ? `https://${automatic}` : DEFAULT_PUBLIC_BASE_URL);
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error('REVIEW_PUBLIC_BASE_URL_MUST_USE_HTTPS');
  return url.origin;
}

function signatureFor(payload) {
  return crypto.createHmac('sha256', signingSecret()).update(payload).digest('base64url');
}

function linkExpiry(now) {
  const days = Math.max(1, Math.min(90, Number(process.env.REVIEW_SHARE_LINK_TTL_DAYS || 30)));
  return Math.floor(now / 1000) + days * 86400;
}

function validRewardId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function validSignature(payload, supplied) {
  const expectedBuffer = Buffer.from(signatureFor(payload));
  const suppliedBuffer = Buffer.from(String(supplied || ''));
  return expectedBuffer.length === suppliedBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
}

function createFeedbackShareUrl(rewardId, now = Date.now()) {
  const expires = linkExpiry(now);
  const payload = `${rewardId}.${expires}`;
  const url = new URL('/api/review-automation', publicBaseUrl());
  url.searchParams.set('action', 'share-feedback');
  url.searchParams.set('id', rewardId);
  url.searchParams.set('expires', String(expires));
  url.searchParams.set('signature', signatureFor(payload));
  return url.toString();
}

function verifyFeedbackShareLink({ id, expires, signature }, now = Date.now()) {
  const rewardId = String(id || '');
  const expiry = Number(expires);
  if (!validRewardId(rewardId)) return false;
  if (!Number.isSafeInteger(expiry) || expiry <= Math.floor(now / 1000)) return false;
  return validSignature(`${rewardId}.${expiry}`, signature);
}

function createFeedbackClickUrl(rewardId, platform, now = Date.now()) {
  if (!['google', 'yelp'].includes(platform)) throw new Error('INVALID_FEEDBACK_PLATFORM');
  const expires = linkExpiry(now);
  const payload = `click.${rewardId}.${platform}.${expires}`;
  const url = new URL('/api/review-automation', publicBaseUrl());
  url.searchParams.set('action', 'track-share-click');
  url.searchParams.set('id', rewardId);
  url.searchParams.set('platform', platform);
  url.searchParams.set('expires', String(expires));
  url.searchParams.set('signature', signatureFor(payload));
  return url.toString();
}

function verifyFeedbackClickLink({ id, platform, expires, signature }, now = Date.now()) {
  const rewardId = String(id || '');
  const destination = String(platform || '');
  const expiry = Number(expires);
  if (!validRewardId(rewardId) || !['google', 'yelp'].includes(destination)) return false;
  if (!Number.isSafeInteger(expiry) || expiry <= Math.floor(now / 1000)) return false;
  return validSignature(`click.${rewardId}.${destination}.${expiry}`, signature);
}

module.exports = {
  createFeedbackClickUrl,
  createFeedbackShareUrl,
  verifyFeedbackClickLink,
  verifyFeedbackShareLink
};
