'use strict';

const { isAdmin } = require('../auth');
const { getSupabase } = require('../clients');
const { issueCoupon } = require('../coupons');
const { cleanText, json, readJson, requireMethod } = require('../http');
const { sendCoupon } = require('../messaging');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function getReward(supabase, id) {
  const { data, error } = await supabase.from('review_rewards').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

async function sendAndMark(supabase, reward) {
  const result = await sendCoupon(reward);
  if (result.skipped) throw new Error(result.reason);
  const { data, error } = await supabase.from('review_rewards').update({
    review_status: 'coupon_sent', coupon_sent_at: new Date().toISOString(), last_error: null
  }).eq('id', reward.id).select('*').single();
  if (error) throw error;
  return data;
}

async function handler(req, res) {
  if (!requireMethod(req, res, ['POST'])) return;
  if (!isAdmin(req)) return json(res, 401, { error: 'UNAUTHORIZED' });

  try {
    const body = await readJson(req);
    const id = cleanText(body.id, 50);
    const action = cleanText(body.action, 50);
    if (!UUID_PATTERN.test(id || '') || !action) return json(res, 400, { error: 'INVALID_ACTION' });
    const supabase = getSupabase();
    let reward = await getReward(supabase, id);

    if (action === 'observe_external_review') {
      const source = ['google', 'yelp'].includes(body.source) ? body.source : null;
      const externalId = cleanText(body.externalReviewId, 300);
      const rating = Number(body.externalReviewRating);
      const confidence = Number(body.matchConfidence);
      if (!source || !externalId || !Number.isInteger(rating) || rating < 1 || rating > 5) {
        return json(res, 400, { error: 'EXTERNAL_REVIEW_DETAILS_REQUIRED' });
      }
      const { data, error } = await supabase.from('review_rewards').update({
        review_source: source,
        review_status: 'review_verified',
        external_review_id: externalId,
        external_review_url: cleanText(body.externalReviewUrl, 1000),
        external_review_rating: rating,
        external_review_created_at: cleanText(body.externalReviewCreatedAt, 50),
        external_match_confidence: Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? confidence : null,
        last_error: null
      }).eq('id', id).select('*').single();
      if (error) throw error;
      reward = data;
      await supabase.from('external_reviews').update({
        match_status: 'manually_linked', matched_reward_id: id, last_seen_at: new Date().toISOString()
      }).eq('review_source', source).eq('external_review_id', externalId);
    } else if (action === 'issue_feedback_coupon') {
      const minimum = Math.max(1, Math.min(5, Number(process.env.REVIEW_INTERNAL_FEEDBACK_MIN_RATING || 1)));
      if (reward.internal_rating < minimum && !body.force) {
        return json(res, 409, { error: 'INTERNAL_FEEDBACK_NOT_ELIGIBLE' });
      }
      reward = await issueCoupon(supabase, id, {
        reason: body.reason || 'internal_feedback', force: Boolean(body.force)
      });
      if (body.send === true) reward = await sendAndMark(supabase, reward);
    } else if (action === 'resend_coupon') {
      if (!reward.coupon_code || reward.redeemed || reward.coupon_cancelled_at) {
        return json(res, 409, { error: 'COUPON_NOT_SENDABLE' });
      }
      reward = await sendAndMark(supabase, reward);
    } else if (action === 'cancel_coupon') {
      if (reward.redeemed) return json(res, 409, { error: 'COUPON_ALREADY_REDEEMED' });
      const { data, error } = await supabase.from('review_rewards').update({
        coupon_cancelled_at: new Date().toISOString(), coupon_reserved_at: null,
        coupon_reservation_token: null, stripe_payment_intent_id: null,
        review_status: 'form_received'
      }).eq('id', id).select('*').single();
      if (error) throw error;
      reward = data;
    } else {
      return json(res, 400, { error: 'UNKNOWN_ACTION' });
    }

    return json(res, 200, { ok: true, item: reward });
  } catch (error) {
    console.error('Review admin action failed:', error);
    const code = error.code === '23505' ? 'EXTERNAL_REVIEW_ALREADY_LINKED' : 'ADMIN_ACTION_FAILED';
    return json(res, error.code === '23505' ? 409 : 500, { error: code });
  }
}

module.exports = handler;
