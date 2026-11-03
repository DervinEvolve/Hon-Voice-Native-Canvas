import { withApiAccess } from '../_lib/api-access.js';
import { approvedAssetList, fetchApprovedAsset } from '../_lib/asset-source.js';
import JSZip from 'jszip';

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  let items;
  try { items = approvedAssetList(req.body?.items); }
  catch { return res.status(400).json({ error: 'Export requires 1 to 8 approved HTTPS assets' }); }
  const safeName = String(req.body?.zipName || 'hon-export').replace(/[^a-z0-9-_]/gi, '-').slice(0, 100);
  const zip = new JSZip();
  try {
    // Eight entries of at most 32 MiB; no redirects, local files or credentials.
    // Validate/download before starting the response so failures remain explicit.
    const assets = [];
    for (const item of items) {
      const response = await fetchApprovedAsset(item.url);
      const ext = new URL(item.url).pathname.match(/\.(png|jpe?g|webp|gif|avif|mp4|webm|mov|mp3|wav|ogg|glb|gltf|ply|splat|zip)$/i)?.[0] || '';
      assets.push({ bytes: Buffer.from(await response.arrayBuffer()), name: item.name.endsWith(ext) ? item.name : item.name + ext });
    }
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.zip"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    assets.forEach((asset, index) => zip.file(`${index + 1}-${asset.name}`, asset.bytes));
    const archive = zip.generateNodeStream({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    await new Promise((resolve, reject) => {
      archive.once('error', reject).once('end', resolve);
      archive.pipe(res);
    });
  } catch {
    if (!res.headersSent) return res.status(400).json({ error: 'An export source could not be downloaded safely' });
    res.end();
  }
}
export default withApiAccess(handler, '/api/export/zip');
