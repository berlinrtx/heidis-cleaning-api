'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { cleanText } = require('./http');
const { createFeedbackShareUrl } = require('./share-links');

let cachedCouponHeaderAttachment;

async function sendEmail({ to, subject, html, text, attachments }) {
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
      text,
      attachments: attachments?.length ? attachments : undefined
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

function couponHeaderAttachment() {
  if (cachedCouponHeaderAttachment !== undefined) return cachedCouponHeaderAttachment;
  try {
    cachedCouponHeaderAttachment = {
      filename: 'heidis-review-coupon-header.png',
      content: fs.readFileSync(
        path.join(process.cwd(), 'assets', 'gift-card-email-header.png')
      ).toString('base64'),
      content_type: 'image/png',
      content_id: 'review-coupon-header'
    };
  } catch (error) {
    console.error('Review coupon header image unavailable:', error.message);
    cachedCouponHeaderAttachment = null;
  }
  return cachedCouponHeaderAttachment;
}

function buildCouponEmail(reward, { expires, shareUrl, includeHeaderImage = true }) {
  const name = escapeHtml(reward.customer_name || 'there');
  const code = escapeHtml(reward.coupon_code);
  const safeExpires = escapeHtml(expires);
  const safeShareUrl = escapeHtml(shareUrl);
  const scheduleSubject = encodeURIComponent(`Use my Heidi's Cleaning coupon - ${reward.coupon_code}`);
  const header = includeHeaderImage
    ? '<img src="cid:review-coupon-header" width="640" alt="Heidi\'s Inc. Cleaning &amp; Maintenance" style="display:block;width:100%;max-width:640px;height:auto;border:0;border-radius:17px 17px 0 0;">'
    : `<div style="padding:26px 20px;font-family:Poppins,Arial,Helvetica,sans-serif;color:#ffffff;text-align:center;">
         <div style="font-size:28px;line-height:1.2;font-weight:700;">Heidi's Inc.</div>
         <div style="margin-top:5px;font-size:12px;line-height:1.4;letter-spacing:1.4px;text-transform:uppercase;">Cleaning &amp; Maintenance</div>
       </div>`;

  return `
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Your $40 Heidi's Cleaning coupon code is ${code}.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#edf6fc;border-collapse:collapse;font-family:Poppins,Arial,Helvetica,sans-serif;color:#12243b;">
      <tr>
        <td align="center" style="padding:32px 14px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:640px;background:#ffffff;border:1px solid #d7e7f3;border-radius:18px;border-collapse:separate;overflow:hidden;">
            <tr>
              <td align="center" bgcolor="#33a8dc" style="padding:0;background:#33a8dc;border-radius:17px 17px 0 0;overflow:hidden;">
                ${header}
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:30px 24px 34px;">
                <p style="margin:0 0 6px;font-family:Poppins,Arial,Helvetica,sans-serif;font-size:18px;line-height:1.5;color:#12243b;">Hi ${name},</p>
                <h1 style="margin:0 0 10px;font-family:Poppins,Arial,Helvetica,sans-serif;font-size:28px;line-height:1.25;color:#214e78;font-weight:700;">Thank you for your feedback!</h1>
                <p style="margin:0 auto 24px;max-width:510px;font-family:Poppins,Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#52677d;">We appreciate you taking the time to complete our private service survey. Here is your one-time thank-you coupon.</p>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#edf6fc" style="width:100%;max-width:530px;background:#edf6fc;border:1px solid #c7e2f3;border-radius:18px;border-collapse:separate;overflow:hidden;">
                  <tr>
                    <td align="center" style="padding:26px 20px 8px;">
                      <span style="display:inline-block;padding:6px 13px;background:#f693bd;border-radius:999px;font-family:Poppins,Arial,Helvetica,sans-serif;font-size:11px;line-height:1.2;color:#12243b;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;">Thank-you coupon</span>
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="padding:0 20px;">
                      <p style="margin:0;font-family:Poppins,Arial,Helvetica,sans-serif;font-size:58px;line-height:1.05;color:#33a8dc;font-weight:700;letter-spacing:-2px;">$40</p>
                      <p style="margin:3px 0 0;font-family:Poppins,Arial,Helvetica,sans-serif;font-size:13px;line-height:1.4;color:#214e78;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;">One-time coupon</p>
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="padding:22px 18px 7px;">
                      <p style="margin:0;font-family:Poppins,Arial,Helvetica,sans-serif;font-size:11px;line-height:1.4;color:#214e78;letter-spacing:1.8px;text-transform:uppercase;font-weight:600;">Coupon code · Select to copy</p>
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="padding:0 18px 9px;">
                      <p style="margin:0;font-family:Poppins,Arial,Helvetica,sans-serif;font-size:22px;line-height:1.3;color:#12243b;font-weight:700;letter-spacing:1px;overflow-wrap:anywhere;word-break:break-word;user-select:all;">${code}</p>
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="padding:0 18px 25px;">
                      <p style="margin:0;font-family:Poppins,Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#52677d;">Use it before <strong>${safeExpires}</strong>.</p>
                    </td>
                  </tr>
                </table>

                <h2 style="margin:28px 0 8px;font-family:Poppins,Arial,Helvetica,sans-serif;font-size:22px;line-height:1.35;color:#214e78;font-weight:700;">Ready to use your coupon?</h2>
                <p style="margin:0 auto;max-width:500px;font-family:Poppins,Arial,Helvetica,sans-serif;font-size:14px;line-height:1.65;color:#52677d;">Contact Heidi's and include your coupon code when scheduling your next eligible cleaning service.</p>

                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px auto 0;border-collapse:separate;">
                  <tr>
                    <td align="center" bgcolor="#12243b" style="background:#12243b;border-radius:999px;">
                      <a href="mailto:service@heidis.inc?subject=${scheduleSubject}" style="display:inline-block;padding:14px 22px;font-family:Poppins,Arial,Helvetica,sans-serif;color:#ffffff;text-decoration:none;font-size:14px;line-height:1.2;font-weight:600;border-radius:999px;">Email to schedule</a>
                    </td>
                  </tr>
                  <tr>
                    <td height="10" style="height:10px;font-size:1px;line-height:1px;">&nbsp;</td>
                  </tr>
                  <tr>
                    <td align="center" bgcolor="#12243b" style="background:#12243b;border-radius:999px;">
                      <a href="tel:+16502484146" style="display:inline-block;padding:14px 22px;font-family:Poppins,Arial,Helvetica,sans-serif;color:#ffffff;text-decoration:none;font-size:14px;line-height:1.2;font-weight:600;border-radius:999px;">Call 650-248-4146</a>
                    </td>
                  </tr>
                </table>

                <p style="margin:22px 0 0;font-family:Poppins,Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:#52677d;">If you would independently like to revisit, edit, or copy your feedback, <a href="${safeShareUrl}" style="color:#214e78;font-weight:600;">open your private feedback page</a>.</p>
                <p style="margin:18px auto 0;max-width:520px;padding-top:18px;border-top:1px solid #d7e7f3;font-family:Poppins,Arial,Helvetica,sans-serif;font-size:11px;line-height:1.6;color:#6a7f92;">This coupon is provided for completing our private service survey. It does not depend on posting, editing, or keeping any public review.</p>
                <p style="margin:12px 0 0;font-family:Poppins,Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#6a7f92;">Email: service@heidis.inc &nbsp;·&nbsp; Phone: 650-248-4146</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;
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
  const rawShareUrl = createFeedbackShareUrl(reward.id);
  const headerAttachment = couponHeaderAttachment();
  return sendEmail({
    to: reward.email,
    subject: "Your $40 Heidi's Cleaning thank-you coupon",
    html: buildCouponEmail(reward, {
      expires,
      shareUrl: rawShareUrl,
      includeHeaderImage: Boolean(headerAttachment)
    }),
    text: `Hi ${reward.customer_name || 'there'},\n\nThank you for completing our private service survey. Your one-time $40 Heidi's Cleaning coupon code is ${reward.coupon_code}. Use it before ${expires}.\n\nTo schedule, email service@heidis.inc or call 650-248-4146.\n\nYou can revisit your private feedback at ${rawShareUrl}.\n\nThis coupon is provided for completing our private survey and does not depend on any public review.`,
    attachments: headerAttachment ? [headerAttachment] : undefined
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

module.exports = {
  buildCouponEmail,
  couponHeaderAttachment,
  sendCoupon,
  sendFeedbackShareLink,
  sendReviewRequest
};
