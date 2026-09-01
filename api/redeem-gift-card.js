const { createClient } = require('@supabase/supabase-js');
const { formatReviewCoupon } = require('../lib/unified-code-lookup');
const { isAdmin } = require('../lib/review-automation/auth');

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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

function formatCouponRedemption(redemption) {
  return {
    id: redemption.id,
    amount: toNumber(redemption.amount_cents) / 100,
    operatorName: redemption.operator_name,
    serviceNote: redemption.service_note,
    reference: redemption.reference,
    createdAt: redemption.created_at
  };
}

function isMissingRedemptionSetup(error) {
  const message = error?.message || '';
  const code = error?.code || '';

  return code === 'PGRST202'
    || /redeem_gift_card|gift_card_redemptions/i.test(message) && /schema cache|could not find|does not exist|function/i.test(message);
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
    const operatorName = String(req.body?.operatorName || '').trim();
    const serviceNote = String(req.body?.serviceNote || '').trim();
    const reference = String(req.body?.reference || '').trim();

    if (!code) {
      return res.status(400).json({ error: 'Gift card code is required' });
    }

    if (!operatorName) {
      return res.status(400).json({ error: 'Operator name is required' });
    }

    if (!isAdmin(req)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const supabase = getSupabaseClient();
    if (code.startsWith('THANKS-')) {
      const { data, error } = await supabase.rpc('redeem_review_coupon_by_code', {
        p_coupon_code: code,
        p_operator_name: operatorName,
        p_service_note: serviceNote,
        p_reference: reference
      });

      if (error) {
        const message = error.message || 'Unable to redeem review coupon';
        const status = /not found/i.test(message)
          ? 404
          : /already|cancelled|expired|reserved/i.test(message)
            ? 400
            : 500;
        return res.status(status).json({ error: message });
      }

      return res.status(200).json({
        codeType: 'review_coupon',
        reviewCoupon: formatReviewCoupon({
          ...data.review_coupon,
          coupon_code: data.review_coupon.code
        }),
        redemption: formatCouponRedemption(data.redemption)
      });
    }

    const amount = Number.parseFloat(req.body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Redemption amount must be greater than 0' });
    }

    const { data, error } = await supabase.rpc('redeem_gift_card', {
      p_code: code,
      p_amount: amount,
      p_operator_name: operatorName,
      p_service_note: serviceNote,
      p_reference: reference
    });

    if (error) {
      if (isMissingRedemptionSetup(error)) {
        return res.status(500).json({
          error: 'Gift card redemption database setup is missing. Run supabase/gift_card_redemptions.sql in Supabase, then retry.'
        });
      }

      const message = error.message || 'Unable to redeem gift card';
      const status = /not found/i.test(message)
        ? 404
        : /insufficient|not active|greater than 0/i.test(message)
          ? 400
          : 500;

      return res.status(status).json({ error: message });
    }

    return res.status(200).json({
      codeType: 'gift_card',
      giftCard: formatGiftCard(data.gift_card),
      redemption: formatRedemption(data.redemption)
    });
  } catch (error) {
    console.error('Gift card redemption error:', error);
    return res.status(500).json({ error: error.message || 'Unable to redeem gift card' });
  }
}
