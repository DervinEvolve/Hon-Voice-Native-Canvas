import { readBoundedResponse } from './splat-security.js';

export const MAX_MEDIA_BYTES = 64 * 1024 * 1024;

export function allowedMediaUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 8192) throw new Error('Invalid media URL');
  const url = new URL(raw);
  const hosts = (process.env.HON_MEDIA_DOWNLOAD_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean);
  const storage = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  if (storage) {
    const origin = new URL(storage);
    if (url.origin === origin.origin && url.pathname.startsWith('/storage/v1/object/')) hosts.push(origin.hostname);
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash ||
      !hosts.includes(url.hostname) || !/^[a-z0-9.-]+$/.test(url.hostname) ||
      url.hostname === 'localhost' || /^[0-9.]+$/.test(url.hostname) || !url.hostname.includes('.')) {
    throw new Error('Media host is not allowed');
  }
  return url.href;
}

export async function downloadMedia(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  const type = (response.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  if (!/^(image\/(?:png|jpeg|webp|gif|avif)|video\/(?:mp4|webm|quicktime)|audio\/(?:mpeg|wav|ogg)|application\/octet-stream)$/.test(type)) {
    await response.body?.cancel();
    throw new Error('Unsupported media type');
  }
  return { type, bytes: await readBoundedResponse(response, MAX_MEDIA_BYTES) };
}
