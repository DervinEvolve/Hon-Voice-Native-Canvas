import { next } from '@vercel/functions';
import { createClient } from '@supabase/supabase-js';
import { authorizeApiRequest } from './api/_lib/api-access.js';

export const config = { runtime: 'nodejs' };

export default async function proxy(request) {
  const url = new URL(request.url);
  const query = {};
  for (const key of url.searchParams.keys()) {
    const values = url.searchParams.getAll(key); query[key] = values.length === 1 ? values[0] : values;
  }
  let status = 200; let body;
  const headers = new Headers({ 'Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store' });
  const res = { setHeader(k, v) { headers.set(k, v); }, status(value) { status = value; return this; }, json(value) { body = value; } };
  try {
    const context = await authorizeApiRequest({ method: request.method, headers: Object.fromEntries(request.headers), query }, res, createClient, url.pathname, url.origin);
    if (!context) return Response.json(body || { error: 'Unauthorized' }, { status, headers });
    const response = next();
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Vercel-CDN-Cache-Control', 'no-store');
    return response;
  } catch { return Response.json({ error: 'API authorization could not be completed' }, { status: 503, headers }); }
}
