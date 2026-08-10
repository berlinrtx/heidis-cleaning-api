const { buildGiftCardSms } = require('./gift-card-delivery');

function getRingCentralConfig() {
  const serverUrl = process.env.RINGCENTRAL_SERVER_URL || 'https://platform.ringcentral.com';
  const clientId = process.env.RINGCENTRAL_CLIENT_ID;
  const clientSecret = process.env.RINGCENTRAL_CLIENT_SECRET;
  const smsFromNumber = process.env.RINGCENTRAL_SMS_FROM_NUMBER;

  if (!clientId || !clientSecret) {
    throw new Error('Missing RingCentral client credentials in Vercel.');
  }

  if (!smsFromNumber) {
    throw new Error('Missing RINGCENTRAL_SMS_FROM_NUMBER in Vercel.');
  }

  return {
    serverUrl: serverUrl.replace(/\/$/, ''),
    clientId,
    clientSecret,
    smsFromNumber
  };
}

function normalizeUsPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');

  if (digits.length === 10) {
    return `+1${digits}`;
  }

  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }

  return '';
}

async function getRingCentralToken(supabase) {
  const { data, error } = await supabase
    .from('ringcentral_tokens')
    .select('*')
    .eq('key', 'default')
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to read RingCentral token: ${error.message}`);
  }

  if (!data?.refresh_token && !data?.access_token) {
    throw new Error('RingCentral is not connected.');
  }

  return data;
}

async function refreshRingCentralTokenIfNeeded(supabase, tokenRecord, forceRefresh = false) {
  const expiresAtMs = tokenRecord.expires_at ? Date.parse(tokenRecord.expires_at) : 0;

  if (!forceRefresh && tokenRecord.access_token && expiresAtMs > Date.now() + 120000) {
    return tokenRecord.access_token;
  }

  if (!tokenRecord.refresh_token) {
    throw new Error('RingCentral refresh token is missing. Reconnect RingCentral.');
  }

  const config = getRingCentralConfig();
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokenRecord.refresh_token
  });
  const response = await fetch(`${config.serverUrl}/restapi/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    },
    body
  });
  const responseText = await response.text();
  const data = responseText ? JSON.parse(responseText) : {};

  if (!response.ok) {
    throw new Error(data.error_description || data.message || data.error || 'Unable to refresh RingCentral token.');
  }

  const expiresAt = new Date(Date.now() + Number(data.expires_in || 3600) * 1000).toISOString();
  const refreshTokenExpiresAt = data.refresh_token_expires_in
    ? new Date(Date.now() + Number(data.refresh_token_expires_in) * 1000).toISOString()
    : tokenRecord.refresh_token_expires_at;
  const { error } = await supabase
    .from('ringcentral_tokens')
    .upsert({
      key: 'default',
      access_token: data.access_token,
      refresh_token: data.refresh_token || tokenRecord.refresh_token,
      token_type: data.token_type || tokenRecord.token_type || 'bearer',
      scope: data.scope || tokenRecord.scope || '',
      expires_at: expiresAt,
      refresh_token_expires_at: refreshTokenExpiresAt,
      updated_at: new Date().toISOString()
    }, { onConflict: 'key' });

  if (error) {
    throw new Error(`Unable to save RingCentral token: ${error.message}`);
  }

  return data.access_token;
}

async function withRingCentralAccessToken(supabase, request) {
  const tokenRecord = await getRingCentralToken(supabase);
  let accessToken = await refreshRingCentralTokenIfNeeded(supabase, tokenRecord);
  let response = await request(accessToken);

  if (response.status === 401) {
    const latestTokenRecord = await getRingCentralToken(supabase);
    accessToken = await refreshRingCentralTokenIfNeeded(supabase, latestTokenRecord, true);
    response = await request(accessToken);
  }

  return response;
}

async function parseRingCentralResponse(response, fallbackMessage) {
  const responseText = await response.text();
  const data = responseText ? JSON.parse(responseText) : {};

  if (!response.ok) {
    throw new Error(data.message || data.error_description || data.error || fallbackMessage);
  }

  return data;
}

async function sendGiftCardSms(supabase, giftCard) {
  const config = getRingCentralConfig();
  const recipientPhone = normalizeUsPhone(giftCard.recipient_phone);

  if (!recipientPhone) {
    throw new Error('A valid US recipient phone is required for SMS delivery.');
  }

  const response = await withRingCentralAccessToken(supabase, (accessToken) => fetch(
    `${config.serverUrl}/restapi/v1.0/account/~/extension/~/sms`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        from: { phoneNumber: config.smsFromNumber },
        to: [{ phoneNumber: recipientPhone }],
        text: buildGiftCardSms(giftCard)
      })
    }
  ));

  return parseRingCentralResponse(response, 'Unable to send RingCentral SMS.');
}

async function getGiftCardSmsStatus(supabase, messageId) {
  const config = getRingCentralConfig();
  const safeMessageId = String(messageId || '').trim();

  if (!/^\d+$/.test(safeMessageId)) {
    throw new Error('A valid RingCentral message ID is required.');
  }

  const response = await withRingCentralAccessToken(supabase, (accessToken) => fetch(
    `${config.serverUrl}/restapi/v1.0/account/~/extension/~/message-store/${safeMessageId}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json'
      }
    }
  ));

  return parseRingCentralResponse(response, 'Unable to read RingCentral SMS status.');
}

module.exports = {
  getGiftCardSmsStatus,
  normalizeUsPhone,
  sendGiftCardSms
};
