'use strict';

const handlers = {
  'form-response': require('../lib/review-automation/handlers/form-response'),
  'admin-list': require('../lib/review-automation/handlers/admin-list'),
  'admin-action': require('../lib/review-automation/handlers/admin-action'),
  'coupon-validate': require('../lib/review-automation/handlers/coupon-validate'),
  'coupon-apply': require('../lib/review-automation/handlers/coupon-apply'),
  'coupon-release': require('../lib/review-automation/handlers/coupon-release'),
  'share-feedback': require('../lib/review-automation/handlers/share-feedback'),
  'track-share-click': require('../lib/review-automation/handlers/track-share-click'),
  'google-sync': require('../lib/review-automation/handlers/google-sync')
};

export default async function handler(req, res) {
  const url = new URL(req.url, 'https://local.invalid');
  const action = url.searchParams.get('action');
  const actionHandler = handlers[action];
  if (!actionHandler) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(404).json({ error: 'UNKNOWN_REVIEW_ACTION' });
  }
  return actionHandler(req, res);
}
