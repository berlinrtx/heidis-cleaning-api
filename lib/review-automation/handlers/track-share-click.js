'use strict';

const { getSupabase } = require('../clients');
const { requireMethod } = require('../http');
const { verifyFeedbackClickLink } = require('../share-links');

const DEFAULT_DESTINATIONS = {
  google: 'https://www.google.com/search?q=Heidi%E2%80%99s+Commercial+Cleaning+Reviews',
  yelp: 'https://www.yelp.com/biz/heidis-commercial-cleaning-redwood-city-4'
};

function safeDestination(platform) {
  const configured = platform === 'google'
    ? process.env.GOOGLE_REVIEW_URL
    : process.env.YELP_BUSINESS_URL;
  try {
    const url = new URL(configured || DEFAULT_DESTINATIONS[platform]);
    return url.protocol === 'https:' ? url.toString() : DEFAULT_DESTINATIONS[platform];
  } catch {
    return DEFAULT_DESTINATIONS[platform];
  }
}

async function handler(req, res) {
  if (!requireMethod(req, res, ['GET'])) return;
  const url = new URL(req.url, 'https://local.invalid');
  const link = {
    id: url.searchParams.get('id'),
    platform: url.searchParams.get('platform'),
    expires: url.searchParams.get('expires'),
    signature: url.searchParams.get('signature')
  };

  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!verifyFeedbackClickLink(link)) {
    return res.status(403).send('This feedback destination link is invalid or has expired.');
  }

  try {
    const { error } = await getSupabase().from('review_automation_events').upsert({
      provider: 'feedback_share',
      external_event_id: `${link.id}:${link.platform}`,
      event_type: 'destination_opened',
      payload: { reward_id: link.id, platform: link.platform },
      processed_at: new Date().toISOString()
    }, { onConflict: 'provider,external_event_id' });
    if (error) throw error;
  } catch (error) {
    // Analytics must never block the customer from reaching the optional destination.
    console.error('Feedback destination tracking failed:', error);
  }

  return res.redirect(302, safeDestination(link.platform));
}

module.exports = handler;
module.exports.safeDestination = safeDestination;
