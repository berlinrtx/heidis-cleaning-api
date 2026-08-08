const DEFAULT_REDIRECT_URI = 'https://heidis-cleaning-api.vercel.app/api/ringcentral-callback';

function getRingCentralConfig() {
  const serverUrl = process.env.RINGCENTRAL_SERVER_URL || 'https://platform.ringcentral.com';
  const clientId = process.env.RINGCENTRAL_CLIENT_ID;
  const redirectUri = process.env.RINGCENTRAL_REDIRECT_URI || DEFAULT_REDIRECT_URI;

  if (!clientId) {
    throw new Error('Missing RingCentral client ID in Vercel.');
  }

  return {
    serverUrl: serverUrl.replace(/\/$/, ''),
    clientId,
    redirectUri
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const config = getRingCentralConfig();
    const state = String(req.query?.state || `heidis-${Date.now()}`);
    const authorizeUrl = new URL(`${config.serverUrl}/restapi/oauth/authorize`);

    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', config.clientId);
    authorizeUrl.searchParams.set('redirect_uri', config.redirectUri);
    authorizeUrl.searchParams.set('state', state);

    return res.redirect(302, authorizeUrl.toString());
  } catch (error) {
    console.error('RingCentral authorize error:', error);
    return res.status(500).json({ error: error.message || 'Unable to start RingCentral authorization.' });
  }
}
