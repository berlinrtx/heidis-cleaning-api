'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createFeedbackClickUrl, createFeedbackShareUrl,
  verifyFeedbackClickLink, verifyFeedbackShareLink
} = require('../lib/review-automation/share-links');
const { commentFrom, renderPage } = require('../lib/review-automation/handlers/share-feedback');
const { safeDestination } = require('../lib/review-automation/handlers/track-share-click');

const ORIGINAL_SECRET = process.env.REVIEW_FORM_WEBHOOK_SECRET;

test.before(() => {
  process.env.REVIEW_FORM_WEBHOOK_SECRET = 'test-secret-that-is-long-enough-for-hmac';
});

test.after(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.REVIEW_FORM_WEBHOOK_SECRET;
  else process.env.REVIEW_FORM_WEBHOOK_SECRET = ORIGINAL_SECRET;
});

test('feedback share links are signed, expire, and reject tampering', () => {
  const now = Date.UTC(2026, 7, 20);
  const id = '85f1d563-3ad9-4e06-9c07-b2161a3116f8';
  const url = new URL(createFeedbackShareUrl(id, now));
  const link = Object.fromEntries(url.searchParams);
  assert.equal(link.action, 'share-feedback');
  assert.equal(verifyFeedbackShareLink(link, now), true);
  assert.equal(verifyFeedbackShareLink({ ...link, id: '75f1d563-3ad9-4e06-9c07-b2161a3116f8' }, now), false);
  assert.equal(verifyFeedbackShareLink(link, Number(link.expires) * 1000), false);
});

test('destination click links bind the respondent, platform, and expiry', () => {
  const now = Date.UTC(2026, 7, 20);
  const id = '85f1d563-3ad9-4e06-9c07-b2161a3116f8';
  const url = new URL(createFeedbackClickUrl(id, 'google', now));
  const link = Object.fromEntries(url.searchParams);
  assert.equal(link.action, 'track-share-click');
  assert.equal(verifyFeedbackClickLink(link, now), true);
  assert.equal(verifyFeedbackClickLink({ ...link, platform: 'yelp' }, now), false);
  assert.equal(verifyFeedbackClickLink(link, Number(link.expires) * 1000), false);
  assert.throws(() => createFeedbackClickUrl(id, 'other', now), /INVALID_FEEDBACK_PLATFORM/);
});

test('share page escapes private feedback and keeps publishing optional', () => {
  const reward = {
    id: '85f1d563-3ad9-4e06-9c07-b2161a3116f8',
    customer_name: '<Heidi>',
    raw_form_payload: { comments: '<script>alert(1)</script> Great service.' }
  };
  const html = renderPage(reward);
  assert.equal(commentFrom(reward), '<script>alert(1)</script> Great service.');
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; Great service\./);
  assert.match(html, /Posting is optional/);
  assert.match(html, /No coupon, discount, purchase, or service depends/);
  assert.match(html, /Find us on Yelp/);
  assert.match(html, /action=track-share-click&amp;id=/);
  assert.match(html, /platform=google/);
  assert.match(html, /platform=yelp/);
});

test('tracked destinations only allow configured HTTPS URLs', () => {
  const original = process.env.GOOGLE_REVIEW_URL;
  process.env.GOOGLE_REVIEW_URL = 'javascript:alert(1)';
  assert.match(safeDestination('google'), /^https:\/\/www\.google\.com\//);
  if (original === undefined) delete process.env.GOOGLE_REVIEW_URL;
  else process.env.GOOGLE_REVIEW_URL = original;
});
