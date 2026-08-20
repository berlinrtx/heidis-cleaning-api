'use strict';

const { getSupabase } = require('../clients');
const { cleanText, requireMethod } = require('../http');
const { createFeedbackClickUrl, verifyFeedbackShareLink } = require('../share-links');

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char]);
}

function commentFrom(reward) {
  return cleanText(reward?.raw_form_payload?.comments, 3000) || '';
}

function renderPage(reward) {
  const name = escapeHtml(reward.customer_name || 'there');
  const comment = escapeHtml(commentFrom(reward));
  const googleUrl = escapeHtml(createFeedbackClickUrl(reward.id, 'google'));
  const yelpUrl = escapeHtml(createFeedbackClickUrl(reward.id, 'yelp'));
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Share your experience | Heidi's Cleaning</title>
  <style>
    :root{color-scheme:light;--red:#b5252b;--navy:#17324d;--muted:#5c6f82;--line:#dce4eb}
    *{box-sizing:border-box}body{margin:0;background:#f5f8fa;color:var(--navy);font-family:Arial,Helvetica,sans-serif}
    main{max-width:680px;margin:0 auto;padding:40px 20px 64px}.card{background:#fff;border:1px solid var(--line);border-radius:18px;padding:30px;box-shadow:0 12px 36px rgba(23,50,77,.09)}
    .eyebrow{color:var(--red);font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:12px}h1{font-size:30px;line-height:1.15;margin:10px 0 12px}p{line-height:1.6;color:var(--muted)}
    textarea{width:100%;min-height:150px;border:1px solid var(--line);border-radius:12px;padding:14px;font:16px/1.5 Arial,Helvetica,sans-serif;color:var(--navy);resize:vertical;background:#fbfcfd}
    .actions{display:grid;gap:12px;margin-top:18px}.button{appearance:none;border:0;border-radius:10px;padding:14px 18px;font-size:16px;font-weight:700;text-align:center;text-decoration:none;cursor:pointer}
    .primary{background:var(--red);color:#fff}.secondary{background:var(--navy);color:#fff}.copy{background:#eef3f6;color:var(--navy)}.status{min-height:24px;margin:10px 0 0;color:#237a45;font-weight:700}
    .fine{font-size:13px;margin-top:24px;border-top:1px solid var(--line);padding-top:18px}@media(max-width:520px){main{padding:22px 14px}.card{padding:22px}h1{font-size:26px}}
  </style>
</head>
<body>
  <main><section class="card">
    <div class="eyebrow">Heidi's Commercial Cleaning</div>
    <h1>Thank you, ${name}.</h1>
    <p>Your private feedback is below. You can edit it, copy it, and—only if you choose—share your honest experience publicly.</p>
    <textarea id="comment" aria-label="Your feedback" placeholder="Write your experience in your own words">${comment}</textarea>
    <div class="actions">
      <button class="button copy" id="copy" type="button">Copy my comment</button>
      <a class="button primary" id="google" href="${googleUrl}" target="_blank" rel="noopener noreferrer">Copy and open Google</a>
      <a class="button secondary" href="${yelpUrl}" target="_blank" rel="noopener noreferrer">Find us on Yelp</a>
    </div>
    <div class="status" id="status" aria-live="polite"></div>
    <p class="fine">Posting is optional. Edit the text however you like and publish it yourself from your own account. No coupon, discount, purchase, or service depends on whether you post or what rating you choose.</p>
  </section></main>
  <script>
    const text = () => document.getElementById('comment').value;
    async function copyComment() {
      const value = text();
      if (!value) { document.getElementById('status').textContent = 'Add a comment first.'; return false; }
      try { await navigator.clipboard.writeText(value); }
      catch { const field=document.getElementById('comment');field.focus();field.select();document.execCommand('copy'); }
      document.getElementById('status').textContent = 'Comment copied. You can paste and edit it before publishing.';
      return true;
    }
    document.getElementById('copy').addEventListener('click', copyComment);
    document.getElementById('google').addEventListener('click', () => { void copyComment(); });
  </script>
</body>
</html>`;
}

async function handler(req, res) {
  if (!requireMethod(req, res, ['GET'])) return;
  const url = new URL(req.url, 'https://local.invalid');
  const link = {
    id: url.searchParams.get('id'),
    expires: url.searchParams.get('expires'),
    signature: url.searchParams.get('signature')
  };
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (!verifyFeedbackShareLink(link)) {
    return res.status(403).send('This private feedback link is invalid or has expired.');
  }
  try {
    const { data, error } = await getSupabase().from('review_rewards')
      .select('id,customer_name,raw_form_payload')
      .eq('id', link.id)
      .single();
    if (error || !data) return res.status(404).send('Feedback not found.');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(renderPage(data));
  } catch (error) {
    console.error('Feedback share page failed:', error);
    return res.status(500).send('Unable to load feedback right now.');
  }
}

module.exports = handler;
module.exports.commentFrom = commentFrom;
module.exports.renderPage = renderPage;
