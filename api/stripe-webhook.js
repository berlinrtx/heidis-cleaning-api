const crypto = require('crypto');
const path = require('path');
const sharp = require('sharp');
const Stripe = require('stripe');
const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const config = {
  api: {
    bodyParser: false
  }
};

function generateGiftCardCode() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';

  for (let i = 0; i < 8; i += 1) {
    const randomIndex = crypto.randomInt(0, alphabet.length);
    code += alphabet[randomIndex];
  }

  return `HC-GC-${code.slice(0, 4)}-${code.slice(4)}`;
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeXml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function getServices() {
  const supabaseUrlValue = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendApiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.GIFT_CARD_FROM_EMAIL;
  const supportEmail = process.env.GIFT_CARD_SUPPORT_EMAIL || 'service@heidis.inc';

  if (!supabaseUrlValue || !supabaseServiceRoleKey || !resendApiKey || !fromEmail) {
    throw new Error('Missing Gift Card service environment variables');
  }

  let supabaseUrl;

  try {
    const parsedUrl = new URL(supabaseUrlValue.trim().replace(/^['"]|['"]$/g, ''));
    supabaseUrl = parsedUrl.origin;
  } catch (error) {
    throw new Error('SUPABASE_URL must be a valid HTTPS project URL');
  }

  return {
    supabase: createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    }),
    resend: new Resend(resendApiKey),
    fromEmail,
    supportEmail
  };
}

function getRingCentralConfig() {
  const serverUrl = process.env.RINGCENTRAL_SERVER_URL || 'https://platform.ringcentral.com';
  const clientId = process.env.RINGCENTRAL_CLIENT_ID;
  const clientSecret = process.env.RINGCENTRAL_CLIENT_SECRET;
  const smsFromNumber = process.env.RINGCENTRAL_SMS_FROM_NUMBER;

  if (!clientId || !clientSecret) {
    throw new Error('Missing RingCentral client credentials in Vercel.');
  }

  if (!smsFromNumber) {
    throw new Error('Missing RINGCENTRAL_SMS_FROM_NUMBER in Vercel.');
  }

  return {
    serverUrl: serverUrl.replace(/\/$/, ''),
    clientId,
    clientSecret,
    smsFromNumber
  };
}

function toMoney(value, fallback = 0) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number.toFixed(2) : fallback.toFixed(2);
}

function isMissingLegacyAmountColumn(error) {
  const message = error?.message || '';
  const code = error?.code || '';

  return code === 'PGRST204'
    || /amount/i.test(message) && /schema cache|could not find|column/i.test(message);
}

function isMissingColumn(error, columnName) {
  const message = error?.message || '';
  const code = error?.code || '';

  return code === 'PGRST204'
    || new RegExp(columnName, 'i').test(message) && /schema cache|could not find|column/i.test(message);
}

function normalizePhone(value) {
  return String(value || '').replace(/[^\d+]/g, '').trim();
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const normalized = String(value || '').trim();

    if (normalized) {
      return normalized;
    }
  }

  return '';
}

function firstPositiveMoney(...values) {
  for (const value of values) {
    const number = Number.parseFloat(value);

    if (Number.isFinite(number) && number > 0) {
      return number.toFixed(2);
    }
  }

  return '0.00';
}

function hydrateGiftCardForNotifications(giftCard, metadata, paymentIntent) {
  return {
    ...giftCard,
    sender_name: firstNonEmpty(giftCard.sender_name, metadata.senderName, 'Sender'),
    sender_email: firstNonEmpty(giftCard.sender_email, metadata.senderEmail),
    recipient_name: firstNonEmpty(giftCard.recipient_name, metadata.recipientName, 'Recipient'),
    recipient_email: firstNonEmpty(
      giftCard.recipient_email,
      metadata.recipientEmail,
      metadata.senderEmail
    ),
    recipient_phone: firstNonEmpty(
      giftCard.recipient_phone,
      normalizePhone(metadata.recipientPhone || metadata.billingPhone || metadata.phone || '')
    ),
    original_amount: firstPositiveMoney(
      giftCard.original_amount,
      giftCard.amount,
      giftCard.balance,
      metadata.giftCardAmount,
      paymentIntent.amount_received ? paymentIntent.amount_received / 100 : 0
    ),
    code: firstNonEmpty(giftCard.code, 'Code unavailable')
  };
}

function buildGiftCardSms(giftCard) {
  const amount = Number.parseFloat(giftCard.original_amount || 0).toFixed(2);
  const sender = giftCard.sender_name || 'Someone';
  const recipient = giftCard.recipient_name || 'there';
  const purchaseDate = new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    timeZone: 'America/Los_Angeles'
  }).format(new Date(giftCard.created_at || Date.now()));

  return [
    'Purchase completed.',
    `From: ${sender}`,
    `For: ${recipient}`,
    `Amount: $${amount}`,
    `Date: ${purchaseDate}`,
    'This number is not monitored.'
  ].join('\n');
}

async function findGiftCardByPaymentIntent(supabase, paymentIntentId) {
  const { data, error } = await supabase
    .from('gift_cards')
    .select('*')
    .eq('payment_intent_id', paymentIntentId)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to read Gift Card: ${error.message}`);
  }

  return data;
}

async function createOrGetGiftCard(supabase, paymentIntent, metadata) {
  const existingGiftCard = await findGiftCardByPaymentIntent(supabase, paymentIntent.id);

  if (existingGiftCard) {
    return existingGiftCard;
  }

  const originalAmount = toMoney(metadata.giftCardAmount);
  const discountAmount = toMoney(metadata.giftCardDiscount);
  const paidAmount = toMoney(metadata.giftCardFinalAmount);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const giftCardCode = generateGiftCardCode();
    const giftCard = {
      payment_intent_id: paymentIntent.id,
      code: giftCardCode,
      sender_name: metadata.senderName,
      sender_email: metadata.senderEmail,
      recipient_name: metadata.recipientName,
      recipient_email: metadata.recipientEmail || metadata.senderEmail,
      recipient_phone: normalizePhone(
        metadata.recipientPhone || metadata.billingPhone || metadata.phone || ''
      ),
      personal_message: metadata.personalMessage || '',
      original_amount: originalAmount,
      discount_amount: discountAmount,
      paid_amount: paidAmount,
      balance: originalAmount,
      amount: originalAmount,
      currency: paymentIntent.currency || 'usd',
      status: 'active'
    };

    let insertPayload = { ...giftCard };
    let data = null;
    let error = null;

    for (let insertAttempt = 0; insertAttempt < 3; insertAttempt += 1) {
      const insertResult = await supabase
        .from('gift_cards')
        .insert(insertPayload)
        .select('*')
        .single();

      data = insertResult.data;
      error = insertResult.error;

      if (!error) {
        break;
      }

      if (isMissingLegacyAmountColumn(error)) {
        const { amount, ...nextPayload } = insertPayload;
        insertPayload = nextPayload;
        continue;
      }

      if (isMissingColumn(error, 'recipient_phone')) {
        const { recipient_phone: recipientPhone, ...nextPayload } = insertPayload;
        insertPayload = nextPayload;
        continue;
      }

      break;
    }

    if (!error) {
      return data;
    }

    if (error.code === '23505') {
      const concurrentGiftCard = await findGiftCardByPaymentIntent(supabase, paymentIntent.id);

      if (concurrentGiftCard) {
        return concurrentGiftCard;
      }

      continue;
    }

    throw new Error(`Unable to create Gift Card: ${error.message}`);
  }

  throw new Error('Unable to generate a unique Gift Card code');
}

async function getRingCentralToken(supabase) {
  const { data, error } = await supabase
    .from('ringcentral_tokens')
    .select('*')
    .eq('key', 'default')
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to read RingCentral token: ${error.message}`);
  }

  if (!data?.refresh_token && !data?.access_token) {
    throw new Error('RingCentral is not connected. Open /api/ringcentral-authorize first.');
  }

  return data;
}

async function refreshRingCentralTokenIfNeeded(supabase, tokenRecord, forceRefresh = false) {
  const expiresAtMs = tokenRecord.expires_at ? Date.parse(tokenRecord.expires_at) : 0;

  if (!forceRefresh && tokenRecord.access_token && expiresAtMs > Date.now() + 120000) {
    return tokenRecord.access_token;
  }

  if (!tokenRecord.refresh_token) {
    throw new Error('RingCentral refresh token is missing. Reconnect RingCentral.');
  }

  const config = getRingCentralConfig();
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokenRecord.refresh_token
  });

  const response = await fetch(`${config.serverUrl}/restapi/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    },
    body
  });
  const responseText = await response.text();
  const data = responseText ? JSON.parse(responseText) : {};

  if (!response.ok) {
    throw new Error(data.error_description || data.message || data.error || 'Unable to refresh RingCentral token.');
  }

  const expiresAt = new Date(Date.now() + Number(data.expires_in || 3600) * 1000).toISOString();
  const refreshTokenExpiresAt = data.refresh_token_expires_in
    ? new Date(Date.now() + Number(data.refresh_token_expires_in) * 1000).toISOString()
    : tokenRecord.refresh_token_expires_at;

  const { error } = await supabase
    .from('ringcentral_tokens')
    .upsert({
      key: 'default',
      access_token: data.access_token,
      refresh_token: data.refresh_token || tokenRecord.refresh_token,
      token_type: data.token_type || tokenRecord.token_type || 'bearer',
      scope: data.scope || tokenRecord.scope || '',
      expires_at: expiresAt,
      refresh_token_expires_at: refreshTokenExpiresAt,
      updated_at: new Date().toISOString()
    }, { onConflict: 'key' });

  if (error) {
    throw new Error(`Unable to save RingCentral token: ${error.message}`);
  }

  return data.access_token;
}

async function sendGiftCardSms(supabase, giftCard) {
  const config = getRingCentralConfig();
  const tokenRecord = await getRingCentralToken(supabase);
  let accessToken = await refreshRingCentralTokenIfNeeded(supabase, tokenRecord);
  const recipientPhone = normalizePhone(giftCard.recipient_phone);

  if (!recipientPhone) {
    throw new Error('Recipient phone is required for SMS delivery.');
  }

  const requestSms = (token) => fetch(`${config.serverUrl}/restapi/v1.0/account/~/extension/~/sms`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        from: { phoneNumber: config.smsFromNumber },
        to: [{ phoneNumber: recipientPhone }],
        text: buildGiftCardSms(giftCard)
      })
    });

  let response = await requestSms(accessToken);
  let responseText = await response.text();
  let data = responseText ? JSON.parse(responseText) : {};

  if (response.status === 401) {
    const latestTokenRecord = await getRingCentralToken(supabase);
    accessToken = await refreshRingCentralTokenIfNeeded(supabase, latestTokenRecord, true);
    response = await requestSms(accessToken);
    responseText = await response.text();
    data = responseText ? JSON.parse(responseText) : {};
  }

  if (!response.ok) {
    throw new Error(data.message || data.error_description || data.error || 'Unable to send RingCentral SMS.');
  }

  return data;
}

async function buildGiftCardPreviewImage(giftCard) {
  const templatePath = path.join(process.cwd(), 'assets', 'gift-card-template.png');
  const fontPath = path.join(process.cwd(), 'assets', 'Poppins-Bold.ttf');
  const giftCardCode = escapeXml(giftCard.code || 'Code unavailable');
  const codePanel = Buffer.from(`
    <svg width="445" height="118" xmlns="http://www.w3.org/2000/svg">
      <rect width="445" height="118" rx="24" fill="#12243B" fill-opacity="0.96"/>
    </svg>
  `);
  const redemptionLabel = await sharp({
    text: {
      text: '<span foreground="#F693BD" font_desc="Poppins Bold 12" letter_spacing="2200">REDEMPTION CODE</span>',
      font: 'Poppins',
      fontfile: fontPath,
      width: 445,
      height: 32,
      align: 'centre',
      rgba: true
    }
  }).png().toBuffer();
  const redemptionCode = await sharp({
    text: {
      text: `<span foreground="#FFFFFF" font_desc="Poppins Bold 23" letter_spacing="500">${giftCardCode}</span>`,
      font: 'Poppins',
      fontfile: fontPath,
      width: 445,
      height: 51,
      align: 'centre',
      rgba: true
    }
  }).png().toBuffer();

  return sharp(templatePath)
    .resize(1100, 618, { fit: 'fill' })
    .composite([
      { input: codePanel, top: 432, left: 575 },
      { input: redemptionLabel, top: 449, left: 575 },
      { input: redemptionCode, top: 493, left: 575 }
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

function buildGiftCardEmail(giftCard) {
  const senderName = escapeHtml(giftCard.sender_name);
  const recipientName = escapeHtml(giftCard.recipient_name);
  const giftCardCode = escapeHtml(giftCard.code);
  const amount = escapeHtml(firstPositiveMoney(
    giftCard.original_amount,
    giftCard.amount,
    giftCard.balance,
    giftCard.paid_amount
  ));
  const message = giftCard.personal_message
    ? `
          <div style="margin:24px 0 0;padding:18px 20px;background:#fff7fb;border-left:4px solid #f693bd;border-radius:10px;text-align:left;">
            <p style="margin:0 0 8px;font-family:Poppins,Arial,Helvetica,sans-serif;font-size:12px;line-height:1.4;color:#214e78;text-transform:uppercase;letter-spacing:1.2px;font-weight:600;">Personal message</p>
            <p style="margin:0;font-family:Poppins,Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#12243b;font-style:italic;">&ldquo;${escapeHtml(giftCard.personal_message)}&rdquo;</p>
          </div>`
    : '';

  return `
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Your Heidi's Cleaning gift card code is ${giftCardCode}.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#edf6fc;border-collapse:collapse;font-family:Poppins,Arial,Helvetica,sans-serif;color:#12243b;">
      <tr>
        <td align="center" style="padding:32px 14px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:640px;background:#ffffff;border:1px solid #d7e7f3;border-radius:18px;border-collapse:separate;overflow:hidden;">
            <tr>
              <td align="center" bgcolor="#33a8dc" style="padding:0;background:#33a8dc;border-radius:17px 17px 0 0;overflow:hidden;">
                <img src="cid:gift-card-header" width="640" alt="Heidi's Inc. Cleaning &amp; Maintenance" style="display:block;width:100%;max-width:640px;height:auto;border:0;border-radius:17px 17px 0 0;">
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:30px 24px 34px;">
                <p style="margin:0 0 6px;font-family:Poppins,Arial,Helvetica,sans-serif;font-size:18px;line-height:1.5;color:#12243b;">Hi ${recipientName},</p>
                <p style="margin:0 0 24px;font-family:Poppins,Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#214e78;">${senderName} sent you the gift card below.</p>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:530px;border-collapse:separate;">
                  <tr>
                    <td align="center">
                      <img src="cid:gift-card-preview" width="530" alt="Personalized Heidi's Cleaning gift card" style="display:block;width:100%;max-width:530px;height:auto;border:0;border-radius:18px;box-shadow:0 14px 28px rgba(36,72,59,0.22);">
                    </td>
                  </tr>
                </table>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#edf6fc" style="width:100%;max-width:530px;margin:18px auto 0;background:#edf6fc;border:1px solid #c7e2f3;border-radius:14px;border-collapse:separate;text-align:left;">
                  <tr>
                    <td style="padding:16px 18px 7px;font-family:Poppins,Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#12243b;"><strong>From:</strong> ${senderName}</td>
                  </tr>
                  <tr>
                    <td style="padding:0 18px 7px;font-family:Poppins,Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#12243b;"><strong>To:</strong> ${recipientName}</td>
                  </tr>
                  <tr>
                    <td style="padding:0 18px 16px;font-family:Poppins,Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#12243b;"><strong>Gift card value:</strong> $${amount}</td>
                  </tr>
                </table>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:530px;margin:18px auto 0;background:#ffffff;border:2px solid #54b6e8;border-radius:14px;border-collapse:separate;">
                  <tr>
                    <td align="center" style="padding:17px 12px 5px;">
                      <p style="margin:0;font-family:Poppins,Arial,Helvetica,sans-serif;font-size:11px;line-height:1.4;color:#214e78;letter-spacing:1.8px;text-transform:uppercase;font-weight:600;">Redemption code · Select to copy</p>
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="padding:0 10px 18px;">
                      <p style="margin:0;font-family:Poppins,Arial,Helvetica,sans-serif;font-size:28px;line-height:1.25;color:#12243b;font-weight:700;letter-spacing:1.5px;word-break:break-word;user-select:all;">${giftCardCode}</p>
                    </td>
                  </tr>
                </table>

                ${message}

                <h2 style="margin:28px 0 8px;font-family:Poppins,Arial,Helvetica,sans-serif;font-size:22px;line-height:1.35;color:#214e78;font-weight:700;">Schedule your cleaning</h2>
                <p style="margin:0 auto;max-width:500px;font-family:Poppins,Arial,Helvetica,sans-serif;font-size:14px;line-height:1.65;color:#52677d;">Contact Heidi's to schedule your appointment. On a computer, choose email. On a mobile phone, you can email or call.</p>

                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px auto 0;border-collapse:separate;">
                  <tr>
                    <td align="center" bgcolor="#12243b" style="background:#12243b;border-radius:999px;">
                      <a href="mailto:service@heidis.inc?subject=Schedule%20my%20Heidi's%20Gift%20Card%20service%20-%20${giftCardCode}" style="display:inline-block;padding:14px 22px;font-family:Poppins,Arial,Helvetica,sans-serif;color:#ffffff;text-decoration:none;font-size:14px;line-height:1.2;font-weight:600;border-radius:999px;">Email to schedule</a>
                    </td>
                    <td width="12" style="width:12px;font-size:1px;line-height:1px;">&nbsp;</td>
                    <td align="center" bgcolor="#12243b" style="background:#12243b;border-radius:999px;">
                      <a href="tel:+16502484146" style="display:inline-block;padding:14px 22px;font-family:Poppins,Arial,Helvetica,sans-serif;color:#ffffff;text-decoration:none;font-size:14px;line-height:1.2;font-weight:600;border-radius:999px;">Call 650-248-4146</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:16px 0 0;font-family:Poppins,Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#6a7f92;">Email: service@heidis.inc &nbsp;·&nbsp; Phone: 650-248-4146</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;
}

function getRawBody(req) {
  if (Buffer.isBuffer(req.body)) {
    return Promise.resolve(req.body);
  }

  if (typeof req.body === 'string') {
    return Promise.resolve(Buffer.from(req.body));
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let chunk;

    while ((chunk = req.read()) !== null) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    if (req.readableEnded) {
      resolve(Buffer.concat(chunks));
      return;
    }

    req.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    req.on('end', () => {
      resolve(Buffer.concat(chunks));
    });

    req.on('error', (error) => {
      reject(error);
    });
  });
}

async function handleGiftCardPurchase(paymentIntent) {
  const metadata = paymentIntent.metadata || {};
  const { supabase, resend, fromEmail, supportEmail } = getServices();
  const storedGiftCard = await createOrGetGiftCard(supabase, paymentIntent, metadata);
  const giftCard = hydrateGiftCardForNotifications(
    storedGiftCard,
    metadata,
    paymentIntent
  );
  const notificationErrors = [];

  if (!giftCard.email_sent_at) {
    const isResendTestRecipient = String(giftCard.recipient_email || '').toLowerCase() === 'it@heidis.inc';
    const cc = isResendTestRecipient
      ? []
      : [giftCard.sender_email, supportEmail].filter(Boolean);

    console.log(`Sending Gift Card email to ${giftCard.recipient_email} with cc ${cc.join(', ') || 'none'}`);

    try {
      const giftCardPreviewImage = await buildGiftCardPreviewImage(giftCard);
      const giftCardHeaderImage = await sharp(
        path.join(process.cwd(), 'assets', 'gift-card-email-header.png')
      ).png({ compressionLevel: 9 }).toBuffer();
      const { data, error } = await resend.emails.send({
        from: fromEmail,
        to: giftCard.recipient_email,
        cc,
        subject: `${giftCard.sender_name} sent you a Heidi's Cleaning Gift Card`,
        html: buildGiftCardEmail(giftCard),
        attachments: [
          {
            filename: 'heidis-gift-card.png',
            content: giftCardPreviewImage,
            contentType: 'image/png',
            contentId: 'gift-card-preview'
          },
          {
            filename: 'heidis-gift-card-header.png',
            content: giftCardHeaderImage,
            contentType: 'image/png',
            contentId: 'gift-card-header'
          }
        ]
      }, {
        idempotencyKey: `gift-card/${paymentIntent.id}`
      });

      if (error) {
        throw new Error(error.message);
      }

      const { error: updateError } = await supabase
        .from('gift_cards')
        .update({
          email_sent_at: new Date().toISOString(),
          resend_email_id: data.id
        })
        .eq('id', giftCard.id);

      if (updateError) {
        throw new Error(`Unable to record send: ${updateError.message}`);
      }
    } catch (error) {
      console.error('Gift Card email failed:', error.message);
      notificationErrors.push(`email: ${error.message}`);
    }
  }

  if (!giftCard.sms_sent_at) {
    try {
      console.log(`Sending Gift Card SMS to ${giftCard.recipient_phone}`);
      const smsData = await sendGiftCardSms(supabase, giftCard);
      const { error: updateError } = await supabase
        .from('gift_cards')
        .update({
          sms_sent_at: new Date().toISOString(),
          ringcentral_message_id: smsData.id || smsData.uri || ''
        })
        .eq('id', giftCard.id);

      if (updateError) {
        throw new Error(`Unable to record send: ${updateError.message}`);
      }
    } catch (error) {
      console.error('Gift Card SMS failed:', error.message);
      notificationErrors.push(`sms: ${error.message}`);
    }
  }

  if (notificationErrors.length > 0) {
    throw new Error(`Gift Card notification failure (${notificationErrors.join('; ')})`);
  }

  console.log('Gift Card Purchase Detected');
  console.log(`PaymentIntent ID: ${paymentIntent.id}`);
  console.log(`Sender: ${giftCard.sender_name} <${giftCard.sender_email}>`);
  console.log(`Recipient: ${giftCard.recipient_name} <${giftCard.recipient_email}>`);
  console.log(`Gift Card Amount: ${giftCard.original_amount}`);
  console.log(`Gift Card Code: ${giftCard.code}`);

  return giftCard;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const webhookSecrets = [
    process.env.STRIPE_WEBHOOK_SECRET,
    process.env.STRIPE_WEBHOOK_SECRET_2
  ].filter(Boolean);

  if (webhookSecrets.length === 0) {
    console.error('Missing Stripe webhook secret');
    return res.status(500).json({ error: 'Webhook configuration error' });
  }

  const signature = req.headers['stripe-signature'];

  if (!signature) {
    console.error('Missing Stripe signature header');
    return res.status(400).json({ error: 'Missing Stripe signature' });
  }

  let event;

  try {
    const rawBody = await getRawBody(req);
    let verificationError;

    for (const webhookSecret of webhookSecrets) {
      try {
        event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
        break;
      } catch (error) {
        verificationError = error;
      }
    }

    if (!event) {
      throw verificationError || new Error('Unable to verify Stripe signature');
    }
  } catch (error) {
    console.error('Stripe webhook signature verification failed:', error.message);
    return res.status(400).json({ error: `Webhook Error: ${error.message}` });
  }

  if (event.type !== 'payment_intent.succeeded') {
    return res.status(200).json({ received: true });
  }

  try {
    const paymentIntent = event.data.object;

    if (!paymentIntent || !paymentIntent.id) {
      throw new Error('PaymentIntent not found in webhook event');
    }

    const metadata = paymentIntent.metadata || {};

    if (metadata.isGiftCard !== 'true') {
      console.log(`Non-gift-card payment received for PaymentIntent ${paymentIntent.id}`);
      return res.status(200).json({ received: true });
    }

    await handleGiftCardPurchase(paymentIntent);

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('Error processing Stripe webhook:', error);
    return res.status(500).json({ error: 'Internal webhook processing error' });
  }
}
