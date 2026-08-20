'use strict';

const { isCron } = require('../lib/review-automation/auth');
const { getSupabase } = require('../lib/review-automation/clients');
const { json, requireMethod } = require('../lib/review-automation/http');

async function accessToken() {
  const form = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || '',
    client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || '',
    refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN || '',
    grant_type: 'refresh_token'
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error(`GOOGLE_OAUTH_FAILED:${data.error || response.status}`);
  return data.access_token;
}

function numericRating(starRating) {
  return { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 }[starRating] || null;
}

export default async function handler(req, res) {
  if (!requireMethod(req, res, ['GET', 'POST'])) return;
  if (!isCron(req)) return json(res, 401, { error: 'UNAUTHORIZED' });

  try {
    const account = process.env.GOOGLE_BUSINESS_ACCOUNT_ID;
    const location = process.env.GOOGLE_BUSINESS_LOCATION_ID;
    if (!account || !location) {
      return json(res, 503, { error: 'GOOGLE_BUSINESS_PROFILE_NOT_CONFIGURED' });
    }
    const token = await accessToken();
    const endpoint = new URL(`https://mybusiness.googleapis.com/v4/accounts/${encodeURIComponent(account)}/locations/${encodeURIComponent(location)}/reviews`);
    endpoint.searchParams.set('pageSize', '50');
    endpoint.searchParams.set('orderBy', 'updateTime desc');
    const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } });
    const payload = await response.json();
    if (!response.ok) throw new Error(`GOOGLE_REVIEWS_FAILED:${payload.error?.message || response.status}`);

    const rows = (payload.reviews || []).map(review => ({
      review_source: 'google',
      external_review_id: review.reviewId,
      external_reviewer_name: review.reviewer?.displayName || null,
      external_rating: numericRating(review.starRating),
      external_review_text: review.comment || null,
      external_created_at: review.createTime || null,
      external_updated_at: review.updateTime || null,
      match_status: 'pending_verification',
      raw_payload: review,
      last_seen_at: new Date().toISOString()
    })).filter(row => row.external_review_id && row.external_rating);

    if (rows.length) {
      const { error } = await getSupabase().from('external_reviews').upsert(rows, {
        onConflict: 'review_source,external_review_id', ignoreDuplicates: true
      });
      if (error) throw error;
    }
    return json(res, 200, {
      ok: true, observed: rows.length, pendingManualVerification: rows.length,
      note: 'Reviewer names are never treated as verified customer identity; no coupon is issued.'
    });
  } catch (error) {
    console.error('Google review sync failed:', error);
    return json(res, 500, { error: 'GOOGLE_REVIEW_SYNC_FAILED' });
  }
}
