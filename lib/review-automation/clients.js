'use strict';

const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');

let supabase;
let stripe;

function getSupabase() {
  if (supabase) return supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('SUPABASE_SERVER_ENV_MISSING');

  const parsedUrl = new URL(String(url).trim().replace(/^['"]|['"]$/g, ''));
  if (parsedUrl.protocol !== 'https:') throw new Error('SUPABASE_URL_MUST_USE_HTTPS');
  supabase = createClient(parsedUrl.origin, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
  });
  return supabase;
}

function getStripe() {
  if (stripe) return stripe;
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY_MISSING');
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { maxNetworkRetries: 2 });
  return stripe;
}

module.exports = { getStripe, getSupabase };
