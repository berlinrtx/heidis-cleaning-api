const { createClient } = require('@supabase/supabase-js');

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function getSupabaseClient() {
  const supabaseUrlValue = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrlValue || !supabaseServiceRoleKey) {
    throw new Error('Missing Supabase environment variables');
  }

  const parsedUrl = new URL(supabaseUrlValue.trim().replace(/^['"]|['"]$/g, ''));

  return createClient(parsedUrl.origin, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase();
}

function toNumber(value) {
  return Number.parseFloat(value || 0);
}

function formatGiftCard(giftCard) {
  return {
    id: giftCard.id,
    code: giftCard.code,
    senderName: giftCard.sender_name,
    senderEmail: giftCard.sender_email,
    recipientName: giftCard.recipient_name,
    recipientEmail: giftCard.recipient_email,
    originalAmount: toNumber(giftCard.original_amount),
    discountAmount: toNumber(giftCard.discount_amount),
    paidAmount: toNumber(giftCard.paid_amount),
    balance: toNumber(giftCard.balance),
    currency: giftCard.currency,
    status: giftCard.status,
    createdAt: giftCard.created_at,
    redeemedAt: giftCard.redeemed_at
  };
}

function formatRedemption(redemption) {
  return {
    id: redemption.id,
    amount: toNumber(redemption.amount),
    balanceBefore: toNumber(redemption.balance_before),
    balanceAfter: toNumber(redemption.balance_after),
    operatorName: redemption.operator_name,
    serviceNote: redemption.service_note,
    reference: redemption.reference,
    createdAt: redemption.created_at
  };
}

function isMissingRedemptionsSchema(error) {
  const message = error?.message || '';
  const code = error?.code || '';

  return code === 'PGRST205'
    || /gift_card_redemptions/i.test(message) && /schema cache|could not find|does not exist/i.test(message);
}

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const code = normalizeCode(req.body?.code);

    if (!code) {
      return res.status(400).json({ error: 'Gift card code is required' });
    }

    const supabase = getSupabaseClient();
    const { data: giftCard, error } = await supabase
      .from('gift_cards')
      .select('*')
      .eq('code', code)
      .maybeSingle();

    if (error) {
      throw new Error(`Unable to lookup Gift Card: ${error.message}`);
    }

    if (!giftCard) {
      return res.status(404).json({ error: 'Gift card not found' });
    }

    const { data: redemptions, error: redemptionsError } = await supabase
      .from('gift_card_redemptions')
      .select('*')
      .eq('gift_card_id', giftCard.id)
      .order('created_at', { ascending: false });

    if (redemptionsError && !isMissingRedemptionsSchema(redemptionsError)) {
      throw new Error(`Unable to lookup redemptions: ${redemptionsError.message}`);
    }

    return res.status(200).json({
      giftCard: formatGiftCard(giftCard),
      redemptions: redemptionsError ? [] : (redemptions || []).map(formatRedemption),
      redemptionsSetupRequired: Boolean(redemptionsError)
    });
  } catch (error) {
    console.error('Gift card lookup error:', error);
    return res.status(500).json({ error: error.message || 'Unable to lookup gift card' });
  }
}
