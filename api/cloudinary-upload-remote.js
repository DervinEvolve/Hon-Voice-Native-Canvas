import { fetchApprovedAsset } from './_lib/asset-source.js';
import { withApiAccess } from "./_lib/api-access.js";
import { v2 as cloudinary } from 'cloudinary';

// Configure Cloudinary for server-side usage
cloudinary.config({
  cloud_name: process.env.VITE_CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

 async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { url } = req.body || {};
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Missing url' });
    }

    const file = await fetchApprovedAsset(url);
    const bytes = Buffer.from(await file.arrayBuffer());
    const type = file.headers.get('content-type');
    const result = await new Promise((resolve, reject) => {
      const upload = cloudinary.uploader.upload_stream({
        resource_type: type.startsWith('image/') ? 'image' : 'video',
        folder: 'hon-comics', public_id: `hon-remote-${Date.now()}`,
      }, (error, value) => error ? reject(error) : resolve(value));
      upload.end(bytes);
    });

    return res.status(200).json({
      url: result.secure_url,
      public_id: result.public_id,
      resource_type: result.resource_type,
      success: true,
    });
  } catch (error) {
    console.error('Cloudinary remote upload error:', error);
    return res.status(500).json({
      error: 'Remote media upload failed',
    });
  }
}

export default withApiAccess(handler, "/api/cloudinary-upload-remote");
