import { approvedAssetList, fetchApprovedAsset } from '../_lib/asset-source.js';
import { withApiAccess } from "../_lib/api-access.js";
import { readProviderTokens } from '../_lib/oauth-state.js';
import { ownedApiCall } from '../_lib/api-access.js';
async function refreshToken(refresh_token) {
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
    grant_type: 'refresh_token',
    refresh_token
  });
  const resp = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const json = await resp.json();
  if (!resp.ok) throw new Error(json?.error || 'refresh_failed');
  return json;
}

 async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const tokens = readProviderTokens(req, 'gd_tokens');
    if (!tokens) return res.status(401).json({ error: 'Reconnect Google Drive' });

    let accessToken = tokens.access_token;
    if (!accessToken || Date.now() > Number(tokens.expires_at || 0)) {
      const rt = tokens.refresh_token;
      if (!rt) return res.status(401).json({ error: 'Missing refresh token' });
      const fresh = await refreshToken(rt);
      accessToken = fresh.access_token;
    }

    const { strategy = 'zip', items: rawItems = [], zipName = 'hon-export', folderName, parentFolderId } = req.body || {};
    let items;
    try { items = approvedAssetList(rawItems); } catch { return res.status(400).json({ error: 'Export sources must be 1 to 8 approved media URLs' }); }

    if (strategy === 'zip') {
      const internalCall = ownedApiCall(req, '/api/export/zip');
      const zipResp = await fetch(internalCall.url, {
        method: 'POST', ...internalCall.options, body: JSON.stringify({ items, zipName })
      });
      if (!zipResp.ok) return res.status(500).json({ error: 'ZIP generation failed' });
      const arrayBuf = await zipResp.arrayBuffer();
      const metadata = { name: `${zipName}.zip`, mimeType: 'application/zip' };
      if (parentFolderId) {
        Object.assign(metadata, { parents: [parentFolderId] });
      }

      const boundary = 'hon-' + Math.random().toString(16).slice(2);
      const delimiter = `--${boundary}`;
      const closeDelim = `--${boundary}--`;
      const bodyParts = [
        `${delimiter}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
        `${delimiter}\r\nContent-Type: application/zip\r\n\r\n`,
        Buffer.from(arrayBuf),
        `\r\n${closeDelim}`
      ];
      const multipartBody = Buffer.concat(bodyParts.map(p => typeof p === 'string' ? Buffer.from(p) : p));

      // Upload to 'My Drive' root; to use a specific folder, include parents: [folderId] in metadata
      const upload = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
        body: multipartBody
      });
      const upJson = await upload.json();
      if (!upload.ok) return res.status(500).json({ error: upJson?.error || 'Drive upload failed' });

      // Ensure a webViewLink is available by requesting file metadata with fields
      const metaResp = await fetch(`https://www.googleapis.com/drive/v3/files/${upJson.id}?fields=id,name,webViewLink,owners`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      const meta = await metaResp.json();
      const link = meta?.webViewLink || `https://drive.google.com/file/d/${upJson.id}/view`;
      return res.status(200).json({ success: true, fileId: upJson.id, webViewLink: link, name: meta?.name });
    }

    if (strategy === 'files') {
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'items[] required' });
      }

      // Create a folder for this export
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const defaultFolder = `Hon Assets ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      const targetFolderName = (typeof folderName === 'string' && folderName.trim()) ? folderName.trim() : defaultFolder;

      let folderId = parentFolderId;
      if (!folderId) {
        const folderCreate = await fetch('https://www.googleapis.com/drive/v3/files', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ name: targetFolderName, mimeType: 'application/vnd.google-apps.folder' })
        });
        const folderJson = await folderCreate.json();
        if (!folderCreate.ok) return res.status(500).json({ error: folderJson?.error || 'Failed to create folder' });
        folderId = folderJson.id;
      }

      const uploaded = [];
      // Upload items one by one to avoid high memory pressure
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const url = typeof it === 'string' ? it : it?.url;
        const baseName = (typeof it?.name === 'string' && it.name.trim()) ? it.name.trim() : `asset-${i + 1}`;
        if (!url || !/^https?:\/\//i.test(url)) continue;
        try {
          const fileResp = await fetchApprovedAsset(url);
          if (!fileResp.ok) continue;
          const ct = fileResp.headers.get('content-type') || 'application/octet-stream';
          const metadata = { name: baseName, parents: [folderId], mimeType: ct };

          const boundary = 'hon-' + Math.random().toString(16).slice(2);
          const delimiter = `--${boundary}`;
          const closeDelim = `--${boundary}--`;
          const bodyParts = [
            `${delimiter}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
            `${delimiter}\r\nContent-Type: ${ct}\r\n\r\n`,
            Buffer.from(await fileResp.arrayBuffer()),
            `\r\n${closeDelim}`
          ];
          const multipartBody = Buffer.concat(bodyParts.map(p => typeof p === 'string' ? Buffer.from(p) : p));

          const upload = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
            body: multipartBody
          });
          const upJson = await upload.json();
          if (!upload.ok) continue;
          uploaded.push({ id: upJson.id, name: upJson.name || baseName });
        } catch {
          // skip failed item
        }
      }

      // Retrieve folder link for convenience
      const metaResp = await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name,webViewLink`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      const meta = await metaResp.json();
      const folderLink = meta?.webViewLink || `https://drive.google.com/drive/folders/${folderId}`;
      return res.status(200).json({ success: true, folderId, folderLink, uploadedCount: uploaded.length, files: uploaded, folderName: meta?.name || targetFolderName });
    }

    if (strategy === 'both') {
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'items[] required' });
      }

      // 1) Create folder
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const defaultFolder = `Hon Assets ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      const targetFolderName = (typeof folderName === 'string' && folderName.trim()) ? folderName.trim() : defaultFolder;
      const folderCreate = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: targetFolderName, mimeType: 'application/vnd.google-apps.folder' })
      });
      const folderJson = await folderCreate.json();
      if (!folderCreate.ok) return res.status(500).json({ error: folderJson?.error || 'Failed to create folder' });
      const folderId = folderJson.id;

      // 2) Upload files
      const uploaded = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const url = typeof it === 'string' ? it : it?.url;
        const baseName = (typeof it?.name === 'string' && it.name.trim()) ? it.name.trim() : `asset-${i + 1}`;
        if (!url || !/^https?:\/\//i.test(url)) continue;
        try {
          const fileResp = await fetchApprovedAsset(url);
          if (!fileResp.ok) continue;
          const ct = fileResp.headers.get('content-type') || 'application/octet-stream';
          const metadata = { name: baseName, parents: [folderId], mimeType: ct };
          const boundary = 'hon-' + Math.random().toString(16).slice(2);
          const delimiter = `--${boundary}`;
          const closeDelim = `--${boundary}--`;
          const bodyParts = [
            `${delimiter}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
            `${delimiter}\r\nContent-Type: ${ct}\r\n\r\n`,
            Buffer.from(await fileResp.arrayBuffer()),
            `\r\n${closeDelim}`
          ];
          const multipartBody = Buffer.concat(bodyParts.map(p => typeof p === 'string' ? Buffer.from(p) : p));
          const upload = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
            body: multipartBody
          });
          const upJson = await upload.json();
          if (!upload.ok) continue;
          uploaded.push({ id: upJson.id, name: upJson.name || baseName });
        } catch {}
      }

      // 3) Generate ZIP and upload into same folder
      const internalCall = ownedApiCall(req, '/api/export/zip');
      const zipResp = await fetch(internalCall.url, {
        method: 'POST', ...internalCall.options, body: JSON.stringify({ items, zipName })
      });
      if (!zipResp.ok) return res.status(500).json({ error: 'ZIP generation failed' });
      const zipArrayBuf = await zipResp.arrayBuffer();
      const boundary = 'hon-' + Math.random().toString(16).slice(2);
      const delimiter = `--${boundary}`;
      const closeDelim = `--${boundary}--`;
      const zipMeta = { name: `${zipName}.zip`, parents: [folderId], mimeType: 'application/zip' };
      const bodyParts = [
        `${delimiter}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(zipMeta)}\r\n`,
        `${delimiter}\r\nContent-Type: application/zip\r\n\r\n`,
        Buffer.from(zipArrayBuf),
        `\r\n${closeDelim}`
      ];
      const multipartBody = Buffer.concat(bodyParts.map(p => typeof p === 'string' ? Buffer.from(p) : p));
      const uploadZip = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST', headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipartBody
      });
      const zipJson = await uploadZip.json();
      if (!uploadZip.ok) return res.status(500).json({ error: zipJson?.error || 'Drive ZIP upload failed' });

      // 4) Folder link
      const metaResp = await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name,webViewLink`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      const meta = await metaResp.json();
      const folderLink = meta?.webViewLink || `https://drive.google.com/drive/folders/${folderId}`;
      return res.status(200).json({ success: true, folderId, folderLink, uploadedCount: uploaded.length, zipFileId: zipJson?.id || null, folderName: meta?.name || targetFolderName });
    }

    return res.status(400).json({ error: 'Unsupported strategy' });
  } catch (e) {
    res.status(500).json({ error: e?.message || 'upload_failed' });
  }
}

export default withApiAccess(handler, "/api/google/upload");
