function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function parseBody(req) {
  if (!req.body) {
    return {};
  }

  if (typeof req.body === 'string') {
    return JSON.parse(req.body);
  }

  return req.body;
}

function getPropertyAddress(property) {
  if (!property || typeof property !== 'object') {
    return '';
  }

  if (property.formattedAddress) {
    return property.formattedAddress;
  }

  return [
    property.addressLine1,
    property.city,
    property.state,
    property.zipCode
  ].filter(Boolean).join(', ');
}

function getSquareFootage(property) {
  const rawValue = property?.squareFootage;
  const numericValue = Number.parseInt(String(rawValue || '').replace(/[^\d]/g, ''), 10);

  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : null;
}

function normalizePropertyResponse(data) {
  if (Array.isArray(data)) {
    return data[0] || null;
  }

  if (Array.isArray(data?.properties)) {
    return data.properties[0] || null;
  }

  return data || null;
}

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const rentcastApiKey = process.env.RENTCAST_API_KEY;

    if (!rentcastApiKey) {
      return res.status(503).json({
        error: 'Property lookup is not configured yet. Please add RENTCAST_API_KEY in Vercel.'
      });
    }

    const { address } = parseBody(req);
    const cleanAddress = String(address || '').trim();

    if (cleanAddress.length < 10) {
      return res.status(400).json({
        error: 'Please enter the full address: Street, City, State, Zip.'
      });
    }

    const url = new URL('https://api.rentcast.io/v1/properties');
    url.searchParams.set('address', cleanAddress);

    const rentcastResponse = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Api-Key': rentcastApiKey
      }
    });

    const responseText = await rentcastResponse.text();
    let data = null;

    try {
      data = responseText ? JSON.parse(responseText) : null;
    } catch (error) {
      throw new Error('RentCast returned an invalid response.');
    }

    if (!rentcastResponse.ok) {
      const message = data?.message || data?.error || 'Unable to look up this property.';

      if (rentcastResponse.status === 401 || rentcastResponse.status === 403) {
        return res.status(503).json({
          error: 'Address lookup is not active yet. Please activate the RentCast API subscription, then try again.'
        });
      }

      return res.status(rentcastResponse.status).json({ error: message });
    }

    const property = normalizePropertyResponse(data);
    const squareFootage = getSquareFootage(property);

    if (!property || !squareFootage) {
      return res.status(404).json({
        error: 'Square footage was not available for this address. Please use the manual square footage option.'
      });
    }

    return res.status(200).json({
      squareFootage,
      source: 'RentCast',
      property: {
        address: getPropertyAddress(property),
        propertyType: property.propertyType || '',
        bedrooms: property.bedrooms ?? null,
        bathrooms: property.bathrooms ?? null
      }
    });
  } catch (error) {
    console.error('Property lookup error:', error);
    return res.status(500).json({ error: error.message || 'Unable to look up this property.' });
  }
}
