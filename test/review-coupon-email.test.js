'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildFeedbackShareEmail,
  buildCouponEmail,
  couponHeaderAttachment,
  sendCoupon,
  sendFeedbackShareLink
} = require('../lib/review-automation/messaging');

const reward = {
  customer_name: '<Alex>',
  coupon_code: 'THANKS-ABCD234567',
  discount_amount: 2500,
  id: '85f1d563-3ad9-4e06-9c07-b2161a3116f8'
};

test('review coupon email matches the gift-card visual system and contains essential details', () => {
  const html = buildCouponEmail(reward, {
    expires: 'November 25, 2026',
    shareUrl: 'https://heidis-cleaning-api.vercel.app/private-feedback',
    includeHeaderImage: true
  });

  assert.match(html, /cid:review-coupon-header/);
  assert.match(html, /background:#edf6fc/);
  assert.match(html, /#33a8dc/);
  assert.match(html, /#f693bd/);
  assert.match(html, /\$25/);
  assert.match(html, /THANKS-ABCD234567/);
  assert.match(html, /November 25, 2026/);
  assert.match(html, /Email to schedule/);
  assert.match(html, /Call 650-248-4146/);
  assert.match(html, /private service survey/);
  assert.match(html, /font-size:26px[^>]*>Hi &lt;Alex&gt;,<\/p>/);
  assert.doesNotMatch(html, /revisit, edit, or copy your feedback/i);
  assert.doesNotMatch(html, /open your private feedback page/i);
  assert.doesNotMatch(html, /<Alex>/);
  assert.match(html, /&lt;Alex&gt;/);
});

test('review coupon email has a branded fallback when the header image is unavailable', () => {
  const html = buildCouponEmail(reward, {
    expires: 'November 25, 2026',
    shareUrl: 'https://heidis-cleaning-api.vercel.app/private-feedback',
    includeHeaderImage: false
  });

  assert.doesNotMatch(html, /cid:review-coupon-header/);
  assert.match(html, /Heidi's Inc\./);
  assert.match(html, /Cleaning &amp; Maintenance/);
});

test('a previously issued $40 coupon keeps its original value when resent', () => {
  const html = buildCouponEmail({ ...reward, discount_amount: 4000 }, {
    expires: 'November 25, 2026',
    shareUrl: 'https://heidis-cleaning-api.vercel.app/private-feedback',
    includeHeaderImage: false
  });
  assert.match(html, /\$40/);
  assert.doesNotMatch(html, /\$25/);
});

test('second feedback email reuses the branded visual system without coupon content', () => {
  const html = buildFeedbackShareEmail(reward, {
    shareUrl: 'https://heidis-cleaning-api.vercel.app/private-feedback',
    includeHeaderImage: true
  });

  assert.match(html, /cid:review-coupon-header/);
  assert.match(html, /background:#edf6fc/);
  assert.match(html, /#33a8dc/);
  assert.match(html, /#f693bd/);
  assert.match(html, /font-size:26px[^>]*>Hi &lt;Alex&gt;,<\/p>/);
  assert.match(html, /Would you like to share it publicly\?/);
  assert.match(html, /Open my feedback/);
  assert.match(html, /Google or Yelp/);
  assert.doesNotMatch(html, /THANKS-ABCD234567/);
  assert.doesNotMatch(html, /\$25/);
});

test('review coupon header reuses the production gift-card brand asset', () => {
  const attachment = couponHeaderAttachment();
  assert.ok(attachment);
  assert.equal(attachment.content_id, 'review-coupon-header');
  assert.equal(attachment.content_type, 'image/png');
  assert.ok(attachment.content.length > 1000);
});

test('coupon delivery sends the branded HTML, plain text, and inline header attachment', async () => {
  const originalFetch = global.fetch;
  const originalFrom = process.env.REVIEW_FROM_EMAIL;
  const originalKey = process.env.RESEND_API_KEY;
  const originalSecret = process.env.REVIEW_FORM_WEBHOOK_SECRET;
  let request;

  process.env.REVIEW_FROM_EMAIL = 'Heidi\'s Cleaning <service@heidis.inc>';
  process.env.RESEND_API_KEY = 're_test';
  process.env.REVIEW_FORM_WEBHOOK_SECRET = 'test-secret-that-is-long-enough-for-hmac';
  global.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ id: 'email_test' }) };
  };

  try {
    const result = await sendCoupon({
      ...reward,
      email: 'alex@example.com',
      expires_at: '2026-11-25T00:00:00.000Z'
    });
    const payload = JSON.parse(request.options.body);

    assert.equal(result.id, 'email_test');
    assert.equal(request.url, 'https://api.resend.com/emails');
    assert.deepEqual(payload.to, ['alex@example.com']);
    assert.equal(payload.subject, "Your $25 Heidi's Cleaning thank-you coupon");
    assert.match(payload.html, /Thank you for your feedback!/);
    assert.doesNotMatch(payload.html, /open your private feedback page/i);
    assert.match(payload.text, /THANKS-ABCD234567/);
    assert.doesNotMatch(payload.text, /revisit your private feedback/i);
    assert.equal(payload.attachments[0].content_id, 'review-coupon-header');
    assert.equal(payload.attachments[0].content_type, 'image/png');
  } finally {
    global.fetch = originalFetch;
    if (originalFrom === undefined) delete process.env.REVIEW_FROM_EMAIL;
    else process.env.REVIEW_FROM_EMAIL = originalFrom;
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
    if (originalSecret === undefined) delete process.env.REVIEW_FORM_WEBHOOK_SECRET;
    else process.env.REVIEW_FORM_WEBHOOK_SECRET = originalSecret;
  }
});

test('second feedback delivery sends branded HTML and the inline header attachment', async () => {
  const originalFetch = global.fetch;
  const originalFrom = process.env.REVIEW_FROM_EMAIL;
  const originalKey = process.env.RESEND_API_KEY;
  const originalSecret = process.env.REVIEW_FORM_WEBHOOK_SECRET;
  let request;

  process.env.REVIEW_FROM_EMAIL = 'Heidi\'s Cleaning <service@heidis.inc>';
  process.env.RESEND_API_KEY = 're_test';
  process.env.REVIEW_FORM_WEBHOOK_SECRET = 'test-secret-that-is-long-enough-for-hmac';
  global.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ id: 'email_feedback_test' }) };
  };

  try {
    const result = await sendFeedbackShareLink({
      ...reward,
      email: 'alex@example.com'
    });
    const payload = JSON.parse(request.options.body);

    assert.equal(result.id, 'email_feedback_test');
    assert.equal(payload.subject, 'Would you like to share your Heidi’s Cleaning feedback?');
    assert.match(payload.html, /Open my feedback/);
    assert.match(payload.text, /Google or Yelp/);
    assert.equal(payload.attachments[0].content_id, 'review-coupon-header');
  } finally {
    global.fetch = originalFetch;
    if (originalFrom === undefined) delete process.env.REVIEW_FROM_EMAIL;
    else process.env.REVIEW_FROM_EMAIL = originalFrom;
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
    if (originalSecret === undefined) delete process.env.REVIEW_FORM_WEBHOOK_SECRET;
    else process.env.REVIEW_FORM_WEBHOOK_SECRET = originalSecret;
  }
});
