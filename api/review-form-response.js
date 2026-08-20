'use strict';

const { isFormWebhook } = require('../lib/review-automation/auth');
const { findBooking } = require('../lib/review-automation/booking-match');
const { getSupabase } = require('../lib/review-automation/clients');
const { issueCoupon } = require('../lib/review-automation/coupons');
const { sendCoupon, sendReviewRequest } = require('../lib/review-automation/messaging');
const {
  cleanText, json, normalizeEmail, readJson, requireMethod
} = require('../lib/review-automation/http');

function parseRating(value) {
  const match = String(value ?? '').match(/(?:^|\s)([1-5])(?:\s*\/\s*5)?(?:\s|$)/);
  return match ? Number(match[1]) : NaN;
}

function parseDate(value) {
  const text = cleanText(value, 40);
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text ? null : text;
}

export default async function handler(req, res) {
  if (!requireMethod(req, res, ['POST'])) return;
  if (!isFormWebhook(req)) return json(res, 401, { error: 'UNAUTHORIZED' });

  try {
    const body = await readJson(req);
    const rating = parseRating(body.rating);
    const formResponseId = cleanText(body.formResponseId, 300);
    if (!formResponseId || !Number.isInteger(rating)) {
      return json(res, 400, { error: 'INVALID_FORM_RESPONSE' });
    }

    const supabase = getSupabase();
    const explicit = {
      bookingId: cleanText(body.bookingId, 200),
      customerId: cleanText(body.customerId, 200),
      serviceDate: parseDate(body.serviceDate)
    };
    const contact = {
      email: normalizeEmail(body.email),
      phone: cleanText(body.phone, 50),
      bookingId: explicit.bookingId
    };
    const booking = await findBooking(supabase, contact).catch(error => {
      console.error('Review booking match failed:', error);
      return null;
    });

    const minimum = Math.max(1, Math.min(5, Number(process.env.REVIEW_INTERNAL_FEEDBACK_MIN_RATING || 1)));
    const couponEligible = rating >= minimum;
    const publicRequests = (process.env.PUBLIC_REVIEW_REQUEST_MODE || 'disabled') === 'all_unincentivized';
    const record = {
      form_response_id: formResponseId,
      customer_id: explicit.customerId || booking?.customerId || null,
      booking_id: explicit.bookingId || booking?.bookingId || null,
      customer_name: cleanText(body.name, 200),
      email: contact.email,
      phone: contact.phone,
      service_date: explicit.serviceDate || booking?.serviceDate || null,
      internal_rating: rating,
      review_source: 'internal_form',
      review_status: couponEligible ? 'form_received' : 'not_eligible',
      raw_form_payload: body
    };

    const { data: inserted, error: insertError } = await supabase
      .from('review_rewards')
      .insert(record)
      .select('*')
      .single();

    if (insertError?.code === '23505') {
      const { data: existing } = await supabase
        .from('review_rewards')
        .select('id,review_status')
        .eq('form_response_id', formResponseId)
        .single();
      return json(res, 200, {
        ok: true, duplicate: true, id: existing?.id, status: existing?.review_status
      });
    }
    if (insertError) throw insertError;

    let reward = inserted;
    if (publicRequests) {
      try {
        const result = await sendReviewRequest(reward);
        if (!result.skipped) {
          const { data } = await supabase.from('review_rewards').update({
            review_status: 'review_requested', request_sent_at: new Date().toISOString(), last_error: null
          }).eq('id', reward.id).select('*').single();
          reward = data || reward;
        }
      } catch (error) {
        await supabase.from('review_rewards').update({
          last_error: String(error.message).slice(0, 1000)
        }).eq('id', reward.id);
        console.error('Neutral review request failed:', error);
      }
    }

    if (couponEligible && (process.env.REVIEW_INTERNAL_FEEDBACK_COUPON_MODE || 'manual') === 'automatic') {
      try {
        reward = await issueCoupon(supabase, reward.id, { reason: 'internal_feedback' });
        const sent = await sendCoupon(reward);
        if (!sent.skipped) {
          const { data } = await supabase.from('review_rewards').update({
            review_status: 'coupon_sent', coupon_sent_at: new Date().toISOString(), last_error: null
          }).eq('id', reward.id).select('*').single();
          reward = data || reward;
        }
      } catch (error) {
        await supabase.from('review_rewards').update({
          last_error: String(error.message).slice(0, 1000)
        }).eq('id', reward.id);
        console.error('Internal feedback coupon failed:', error);
      }
    }

    return json(res, 201, { ok: true, id: reward.id, status: reward.review_status });
  } catch (error) {
    console.error('Review form response failed:', error);
    return json(res, error.statusCode || 500, { error: 'FORM_PROCESSING_FAILED' });
  }
}
