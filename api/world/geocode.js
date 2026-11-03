import { withApiAccess } from "../_lib/api-access.js";
 async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, DELETE, OPTIONS'
  );
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Requested-With'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed, use GET' });
  }

  const query = (req.query?.query || '').trim();
  if (!query) {
    return res.status(400).json({ error: 'Missing query parameter' });
  }

  const apiKey = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!apiKey) {
    console.error('[world/geocode] Missing GOOGLE_MAPS_SERVER_KEY env');
    return res
      .status(500)
      .json({ error: 'GOOGLE_MAPS_SERVER_KEY is not configured' });
  }

  try {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('address', query);
    url.searchParams.set('key', apiKey);

    const response = await fetch(url.toString());
    if (!response.ok) {
      const text = await response.text();
      console.error(
        '[world/geocode] Google HTTP error',
        response.status,
        text
      );
      return res.status(502).json({
        error: 'GOOGLE_GEOCODE_HTTP_ERROR',
        status: String(response.status),
      });
    }

    const data = await response.json();
    if (data.status !== 'OK' || !data.results?.length) {
      console.warn(
        '[world/geocode] Google error',
        data.status,
        data.error_message
      );
      return res.status(400).json({
        error: data.error_message || data.status || 'ZERO_RESULTS',
        status: data.status,
      });
    }

    const primary = data.results[0];
    const geometry = primary.geometry || {};
    const viewport = geometry.viewport;

    return res.status(200).json({
      location: {
        lat: geometry.location.lat,
        lng: geometry.location.lng,
      },
      formattedAddress: primary.formatted_address,
      types: primary.types || [],
      viewport: viewport
        ? {
            north: viewport.northeast?.lat,
            south: viewport.southwest?.lat,
            east: viewport.northeast?.lng,
            west: viewport.southwest?.lng,
          }
        : undefined,
    });
  } catch (error) {
    console.error('[world/geocode] Unexpected error', error);
    return res
      .status(500)
      .json({ error: 'GEOCODE_REQUEST_FAILED', status: 'ERROR' });
  }
}

export default withApiAccess(handler, "/api/world/geocode");
