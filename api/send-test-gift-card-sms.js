const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { generateGiftCardCode } = require('../lib/gift-card-delivery');
const {
  getGiftCardSmsStatus,
  normalizeUsPhone,
  sendGiftCardSms
} = require('../lib/ringcentral-sms');

function isAuthorized(req) {
  const expectedKey = String(process.env.GIFT_CARD_TEST_API_KEY || '');
  const providedKey = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');

  if (!expectedKey || expectedKey.length < 32 || providedKey.length !== expectedKey.length) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(providedKey), Buffer.from(expectedKey));
}

function getSupabase() {
  const supabaseUrl = new URL(process.env.SUPABASE_URL).origin;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error('Missing Supabase server credentials.');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function maskPhone(phone) {
  return `***-***-${phone.slice(-4)}`;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabase = getSupabase();

    if (req.method === 'GET') {
      const status = await getGiftCardSmsStatus(supabase, req.query.messageId);
      return res.status(200).json({
        messageId: String(status.id || req.query.messageId),
        messageStatus: status.messageStatus || 'Unknown'
      });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const recipientPhone = normalizeUsPhone(req.body?.phone);
    const amount = Number.parseFloat(req.body?.amount);

    if (!recipientPhone) {
      return res.status(400).json({ error: 'A valid US phone number is required.' });
    }

    if (!Number.isFinite(amount) || amount < 0.5 || amount > 1200) {
      return res.status(400).json({ error: 'Amount must be between $0.50 and $1,200.' });
    }

    const code = generateGiftCardCode();
    const sms = await sendGiftCardSms(supabase, {
      is_test: true,
      code,
      original_amount: amount.toFixed(2),
      sender_name: "Heidi's Cleaning",
      recipient_name: 'SMS Test Recipient',
      recipient_phone: recipientPhone,
      created_at: new Date().toISOString()
    });

    return res.status(200).json({
      sent: true,
      testOnly: true,
      redeemable: false,
      recipient: maskPhone(recipientPhone),
      amount: amount.toFixed(2),
      code,
      messageId: String(sms.id || ''),
      messageStatus: sms.messageStatus || 'Queued'
    });
  } catch (error) {
    console.error('Test Gift Card SMS failed:', error.message);
    return res.status(500).json({ error: error.message || 'Unable to send test SMS.' });
  }
}
