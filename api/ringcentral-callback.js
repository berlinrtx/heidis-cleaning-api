const { createClient } = require('@supabase/supabase-js');

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function buildHtml({ title, message, details = [] }) {
  const detailItems = details
    .map((detail) => `<li>${escapeHtml(detail)}</li>`)
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #f7f4ee;
      color: #22362d;
      font-family: Arial, sans-serif;
    }

    main {
      width: min(560px, calc(100vw - 32px));
      padding: 32px;
      border: 1px solid #ded7cb;
      border-radius: 12px;
      background: #fff;
      box-shadow: 0 16px 40px rgba(34, 54, 45, 0.08);
    }

    h1 {
      margin: 0 0 12px;
      font-size: 26px;
    }

    p, li {
      color: #5a645f;
      font-size: 15px;
      line-height: 1.6;
    }

    ul {
      margin: 18px 0 0;
      padding-left: 20px;
    }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    ${detailItems ? `<ul>${detailItems}</ul>` : ''}
  </main>
</body>
</html>`;
}

function getSupabaseClient() {
  const supabaseUrlValue = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrlValue || !supabaseServiceRoleKey) {
    throw new Error('Missing Supabase environment variables.');
  }

  const parsedUrl = new URL(supabaseUrlValue.trim().replace(/^['"]|['"]$/g, ''));

  return createClient(parsedUrl.origin, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function getRingCentralConfig() {
  const serverUrl = process.env.RINGCENTRAL_SERVER_URL || 'https://platform.ringcentral.com';
  const clientId = process.env.RINGCENTRAL_CLIENT_ID;
  const clientSecret = process.env.RINGCENTRAL_CLIENT_SECRET;
  const redirectUri = process.env.RINGCENTRAL_REDIRECT_URI || 'https://heidis-cleaning-api.vercel.app/api/ringcentral-callback';

  if (!clientId || !clientSecret) {
    throw new Error('Missing RingCentral client credentials in Vercel.');
  }

  return {
    serverUrl: serverUrl.replace(/\/$/, ''),
    clientId,
    clientSecret,
    redirectUri
  };
}

async function saveRingCentralToken(tokenData) {
  const supabase = getSupabaseClient();
  const expiresAt = new Date(Date.now() + Number(tokenData.expires_in || 3600) * 1000).toISOString();
  const refreshTokenExpiresAt = tokenData.refresh_token_expires_in
    ? new Date(Date.now() + Number(tokenData.refresh_token_expires_in) * 1000).toISOString()
    : null;

  const { error } = await supabase
    .from('ringcentral_tokens')
    .upsert({
      key: 'default',
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      token_type: tokenData.token_type || 'bearer',
      scope: tokenData.scope || '',
      expires_at: expiresAt,
      refresh_token_expires_at: refreshTokenExpiresAt,
      updated_at: new Date().toISOString()
    }, { onConflict: 'key' });

  if (error) {
    throw new Error(`Unable to save RingCentral token in Supabase: ${error.message}`);
  }
}

async function exchangeAuthorizationCode(code) {
  const config = getRingCentralConfig();
  const tokenUrl = `${config.serverUrl}/restapi/oauth/token`;
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    },
    body
  });

  const responseText = await response.text();
  let data = null;

  try {
    data = responseText ? JSON.parse(responseText) : null;
  } catch (error) {
    throw new Error('RingCentral returned an invalid token response.');
  }

  if (!response.ok) {
    const message = data?.error_description || data?.message || data?.error || 'Unable to exchange RingCentral authorization code.';
    throw new Error(message);
  }

  return data;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, error, error_description: errorDescription, state } = req.query || {};

  if (error) {
    return res
      .status(400)
      .setHeader('Content-Type', 'text/html; charset=utf-8')
      .send(buildHtml({
        title: 'RingCentral authorization failed',
        message: errorDescription || error,
        details: state ? [`State: ${state}`] : []
      }));
  }

  if (!code) {
    return res
      .status(400)
      .setHeader('Content-Type', 'text/html; charset=utf-8')
      .send(buildHtml({
        title: 'Missing authorization code',
        message: 'RingCentral did not send an authorization code. Please restart the RingCentral connection flow.'
      }));
  }

  let tokenData;

  try {
    tokenData = await exchangeAuthorizationCode(code);
  } catch (exchangeError) {
    console.error('RingCentral token exchange failed:', exchangeError.message);

    return res
      .status(502)
      .setHeader('Content-Type', 'text/html; charset=utf-8')
      .send(buildHtml({
        title: 'RingCentral token exchange failed',
        message: exchangeError.message,
        details: [
          'Confirm the Redirect URI in RingCentral exactly matches the Vercel callback URL.',
          'Confirm the app credentials are from the same RingCentral environment.'
        ]
      }));
  }

  console.log('RingCentral connected', {
    state: state || '',
    tokenType: tokenData.token_type || '',
    expiresIn: tokenData.expires_in || null,
    hasRefreshToken: Boolean(tokenData.refresh_token)
  });

  try {
    await saveRingCentralToken(tokenData);
  } catch (saveError) {
    console.error('RingCentral token save failed:', saveError.message);

    return res
      .status(500)
      .setHeader('Content-Type', 'text/html; charset=utf-8')
      .send(buildHtml({
        title: 'RingCentral connected, but token was not saved',
        message: saveError.message,
        details: [
          'Run supabase/ringcentral_tokens.sql in Supabase.',
          'Then open /api/ringcentral-authorize again.'
        ]
      }));
  }

  return res
    .status(200)
    .setHeader('Content-Type', 'text/html; charset=utf-8')
    .send(buildHtml({
      title: 'RingCentral connected',
      message: 'Authorization was completed successfully. You can close this window.',
      details: [
        `Token type: ${tokenData.token_type || 'Bearer'}`,
        `Access token expires in: ${tokenData.expires_in || 'unknown'} seconds`,
        tokenData.refresh_token ? 'Refresh token received.' : 'No refresh token was returned.'
      ]
    }));
}
