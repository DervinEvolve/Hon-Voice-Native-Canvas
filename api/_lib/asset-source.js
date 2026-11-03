import { allowedMediaUrl } from './media-download.js';
import { readBoundedResponse } from './splat-security.js';

export const MAX_ASSET_BYTES = 32 * 1024 * 1024;
export const MAX_EXPORT_ITEMS = 8;
export function exportEntryName(value, index) {
  const name = typeof value === 'string' ? value : `asset-${index + 1}`;
  return name.replace(/[^a-zA-Z0-9_.-]/g, '-').replace(/^\.+/, '').slice(0, 100) || `asset-${index + 1}`;
}
export function approvedAssetList(items) {
  if (!Array.isArray(items) || !items.length || items.length > MAX_EXPORT_ITEMS) throw Error('Export requires 1 to 8 assets');
  return items.map((item, index) => ({ url: allowedMediaUrl(typeof item === 'string' ? item : item?.url), name: exportEntryName(item?.name, index) }));
}
export async function fetchApprovedAsset(raw, fetchImpl = fetch) {
  const url = allowedMediaUrl(raw);
  const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  const type = (response.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  if (!/^(image\/(?:png|jpeg|webp|gif|avif)|video\/(?:mp4|webm|quicktime)|audio\/(?:mpeg|wav|ogg)|model\/(?:gltf-binary|gltf\+json)|application\/(?:octet-stream|zip))$/.test(type)) {
    await response.body?.cancel(); throw Error('Unsupported asset type');
  }
  const bytes = await readBoundedResponse(response, MAX_ASSET_BYTES);
  return new Response(bytes, { headers: { 'Content-Type': type } });
}
export function uploadedMediaData(raw) {
  if (typeof raw !== 'string' || raw.length > 28 * 1024 * 1024 || !/^data:(?:image\/(?:png|jpeg|webp|gif|avif)|video\/(?:mp4|webm|quicktime)|audio\/(?:mpeg|wav|ogg)|application\/octet-stream);base64,[A-Za-z0-9+/]+={0,2}$/.test(raw)) throw Error('A bounded base64 media file is required');
  return raw;
}
