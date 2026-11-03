import { uploadedMediaData } from './_lib/asset-source.js';
import { withApiAccess } from "./_lib/api-access.js";
import { v2 as cloudinary } from 'cloudinary';

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.VITE_CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export const config = { api: { bodyParser: { sizeLimit: '28mb' } } };

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
    console.log('Cloudinary upload request received');
    
    // Support multipart form-data (binary) and JSON base64
    let fileData;
    if (req.headers['content-type']?.includes('multipart/form-data')) {
      const buffers = [];
      let bytes = 0;
      for await (const chunk of req) { bytes += chunk.length; if (bytes > 20 * 1024 * 1024) return res.status(413).json({ error: 'Media upload is too large' }); buffers.push(chunk); }
      const boundary = req.headers['content-type'].split('boundary=')[1];
      const body = Buffer.concat(buffers).toString('binary');
      const match = body.match(/\r\n\r\n([\s\S]*)\r\n--/);
      fileData = match ? `data:application/octet-stream;base64,${Buffer.from(match[1], 'binary').toString('base64')}` : null;
    } else {
      const { file } = req.body || {};
      fileData = file;
    }

    if (!fileData) {
      return res.status(400).json({ error: 'No file provided' });
    }

    try { fileData = uploadedMediaData(fileData); } catch { return res.status(400).json({ error: 'A bounded base64 media file is required' }); }

    // Upload to Cloudinary
    const result = await cloudinary.uploader.upload(fileData, {
      upload_preset: process.env.CLOUDINARY_UPLOAD_PRESET || 'hon_comics',
      resource_type: 'auto',
      folder: 'hon-comics',
      public_id: `hon-${Date.now()}`, // Unique identifier
    });

    console.log('Cloudinary upload successful:', result.secure_url);

    return res.status(200).json({
      url: result.secure_url,
      public_id: result.public_id,
      success: true
    });
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    return res.status(500).json({ 
      error: 'Media upload failed'
    });
  }
}

export default withApiAccess(handler, "/api/cloudinary-upload");
