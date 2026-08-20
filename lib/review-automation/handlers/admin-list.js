'use strict';

const { isAdmin } = require('../auth');
const { getSupabase } = require('../clients');
const { cleanText, json, requireMethod } = require('../http');

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

async function handler(req, res) {
  if (!requireMethod(req, res, ['GET'])) return;
  if (!isAdmin(req)) return json(res, 401, { error: 'UNAUTHORIZED' });

  try {
    const url = new URL(req.url, 'https://local.invalid');
    const page = boundedInteger(url.searchParams.get('page'), 0, 0, 100000);
    const pageSize = boundedInteger(url.searchParams.get('pageSize'), 50, 1, 100);
    const status = cleanText(url.searchParams.get('status'), 50);
    const search = cleanText(url.searchParams.get('search'), 200);
    let query = getSupabase()
      .from('review_rewards')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(page * pageSize, page * pageSize + pageSize - 1);
    if (status) query = query.eq('review_status', status);
    if (search) {
      const escaped = search.replace(/[%_,()]/g, '');
      query = query.or(`customer_name.ilike.%${escaped}%,email.ilike.%${escaped}%,phone.ilike.%${escaped}%,booking_id.ilike.%${escaped}%,coupon_code.ilike.%${escaped}%`);
    }
    const { data, error, count } = await query;
    if (error) throw error;
    return json(res, 200, { items: data, count, page, pageSize });
  } catch (error) {
    console.error('Review admin list failed:', error);
    return json(res, 500, { error: 'ADMIN_LIST_FAILED' });
  }
}

module.exports = handler;
