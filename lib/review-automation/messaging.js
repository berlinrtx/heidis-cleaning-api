'use strict';

const { cleanText } = require('./http');
const { createFeedbackShareUrl } = require('./share-links');

async function sendEmail({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.REVIEW_FROM_EMAIL || process.env.GIFT_CARD_FROM_EMAIL;
  if (!apiKey || !from) throw new Error('REVIEW_EMAIL_ENV_MISSING');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: process.env.REVIEW_REPLY_TO_EMAIL || process.env.GIFT_CARD_SUPPORT_EMAIL || undefined,
      subject,
      html,
      text
    })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`REVIEW_EMAIL_SEND_FAILED:${result.message || response.status}`);
  return result;
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char]);
}

async function sendReviewRequest(reward) {
  if ((process.env.PUBLIC_REVIEW_REQUEST_MODE || 'disabled') !== 'all_unincentivized') {
    return { skipped: true, reason: 'PUBLIC_REVIEW_REQUESTS_DISABLED' };
  }
  if (!reward.email) return { skipped: true, reason: 'NO_EMAIL' };
  const googleUrl = cleanText(process.env.GOOGLE_REVIEW_URL, 1000);
  if (!googleUrl) throw new Error('GOOGLE_REVIEW_URL_MISSING');
  const name = escapeHtml(reward.customer_name || 'there');
  const link = escapeHtml(googleUrl);
  return sendEmail({
    to: reward.email,
    subject: 'Thank you for your feedback',
    html: `<p>Hi ${name},</p><p>Thank you for sharing your private feedback with Heidi's Cleaning.</p><p>If you would independently like to share your honest experience publicly—positive, neutral, or negative—you can do so on <a href="${link}">Google</a>. No purchase, discount, or benefit depends on whether you post a review or what it says.</p>`,
    text: `Thank you for sharing your private feedback with Heidi's Cleaning. If you independently want to share your honest experience—positive, neutral, or negative—use ${googleUrl}. No purchase, discount, or benefit depends on a public review.`
  });
}

async function sendCoupon(reward) {
  if (!reward.email) return { skipped: true, reason: 'NO_EMAIL' };
  const expires = new Date(reward.expires_at).toLocaleDateString('en-US', { timeZone: 'UTC' });
  const name = escapeHtml(reward.customer_name || 'there');
  const code = escapeHtml(reward.coupon_code);
  const rawShareUrl = createFeedbackShareUrl(reward.id);
  const shareUrl = escapeHtml(rawShareUrl);
  return sendEmail({
    to: reward.email,
    subject: 'Your $40 Heidi’s Cleaning feedback benefit',
    html: `<p>Hi ${name},</p><p>Thank you for completing our private service feedback form. Your one-time $40 benefit code is:</p><p style="font-size:24px;font-weight:700">${code}</p><p>Use it before ${escapeHtml(expires)}.</p><p>If you independently want to share your honest experience publicly, <a href="${shareUrl}">open your private feedback here</a> to copy or edit it first.</p><p>This benefit is for the private feedback event and is not conditioned on posting, editing, or keeping any public review.</p>`,
    text: `Your one-time $40 feedback benefit is ${reward.coupon_code}. Use it before ${expires}. If you independently want to share your honest experience publicly, open ${rawShareUrl}. The benefit is not conditioned on any public review.`
  });
}

async function sendFeedbackShareLink(reward) {
  if (!reward.email) return { skipped: true, reason: 'NO_EMAIL' };
  const name = escapeHtml(reward.customer_name || 'there');
  const rawShareUrl = createFeedbackShareUrl(reward.id);
  const shareUrl = escapeHtml(rawShareUrl);
  return sendEmail({
    to: reward.email,
    subject: 'Your Heidi’s Cleaning feedback',
    html: `<p>Hi ${name},</p><p>Thank you for completing our private service feedback form.</p><p>If you independently want to share your honest experience publicly, <a href="${shareUrl}">open your feedback here</a> to copy or edit it first.</p><p>Posting is optional. No coupon, discount, purchase, or service depends on whether you post or what rating you choose.</p>`,
    text: `Thank you for completing our private feedback form. If you independently want to share your honest experience publicly, open ${rawShareUrl}. Posting is optional and no benefit depends on it.`
  });
}

module.exports = { sendCoupon, sendFeedbackShareLink, sendReviewRequest };
