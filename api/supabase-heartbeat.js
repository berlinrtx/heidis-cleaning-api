const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function getSupabaseClient() {
  const supabaseUrlValue = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrlValue || !serviceRoleKey) {
    throw new Error('Missing Supabase environment variables');
  }

  const supabaseUrl = new URL(supabaseUrlValue.trim().replace(/^['"]|['"]$/g, ''));
  if (supabaseUrl.protocol !== 'https:') {
    throw new Error('SUPABASE_URL must use HTTPS');
  }

  return createClient(supabaseUrl.origin, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const expectedSecret = process.env.CRON_SECRET;
  const suppliedSecret = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!expectedSecret || !safeEqual(suppliedSecret, expectedSecret)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabase = getSupabaseClient();
    const ranAt = new Date().toISOString();
    const heartbeatDate = ranAt.slice(0, 10);

    const { data, error } = await supabase
      .from('system_heartbeats')
      .upsert({
        heartbeat_date: heartbeatDate,
        ran_at: ranAt,
        source: 'vercel_cron'
      }, { onConflict: 'heartbeat_date' })
      .select('heartbeat_date, ran_at, source')
      .single();

    if (error) throw error;

    const eightDaysAgo = new Date(Date.now() - (8 * 24 * 60 * 60 * 1000))
      .toISOString()
      .slice(0, 10);
    const [history, readback] = await Promise.all([
      supabase
        .from('system_heartbeats')
        .select('heartbeat_date', { count: 'exact', head: true })
        .gte('heartbeat_date', eightDaysAgo),
      supabase
        .from('system_heartbeats')
        .select('heartbeat_date, ran_at')
        .eq('heartbeat_date', heartbeatDate)
        .single()
    ]);

    if (history.error) throw history.error;
    if (readback.error) throw readback.error;

    return res.status(200).json({
      ok: true,
      heartbeat: data,
      heartbeatDaysInWindow: history.count,
      verified: readback.data?.heartbeat_date === heartbeatDate
    });
  } catch (error) {
    console.error('Supabase heartbeat failed:', error);
    return res.status(500).json({ error: 'Supabase heartbeat failed' });
  }
}
