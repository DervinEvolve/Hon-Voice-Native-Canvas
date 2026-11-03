import { withApiAccess } from "../_lib/api-access.js";
/**
 * Utility endpoint to convert SAM3 RLE masks to PNG images
 * RLE (Run-Length Encoding) → PNG with transparency
 * 
 * This is a helper endpoint for mask generation
 * FAL.ai SAM3 returns RLE format, but Seedream needs PNG image URLs
 * 
 * RLE Format: Array of numbers representing runs
 * - Even indices: start position (pixel index)
 * - Odd indices: run length
 * OR
 * - Array of [start, length] pairs
 */

 async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed, use POST' });
  }

  try {
    const { rle, image_width, image_height, size } = req.body || {};
    
    // size can be provided as [width, height] or use separate params
    const width = size?.[0] || image_width;
    const height = size?.[1] || image_height;
    
    if (!rle || !width || !height) {
      return res.status(400).json({ 
        error: 'Missing required parameters: rle, image_width/image_height (or size array)' 
      });
    }

    console.log('[SAM3] Converting RLE to PNG:', { width, height, rleLength: Array.isArray(rle) ? rle.length : 'not array' });

    // Decode RLE to binary mask
    const mask = decodeRLE(rle, width, height);
    
    if (!mask) {
      return res.status(400).json({ 
        error: 'Failed to decode RLE format' 
      });
    }

    // Create PNG image from mask
    const pngBuffer = await createPNGFromMask(mask, width, height);
    
    if (!pngBuffer) {
      return res.status(500).json({ 
        error: 'Failed to create PNG from mask' 
      });
    }

    // Upload to Cloudinary
    const maskUrl = await uploadMaskToCloudinary(pngBuffer);
    
    if (!maskUrl) {
      return res.status(500).json({ 
        error: 'Failed to upload mask to Cloudinary' 
      });
    }

    console.log('[SAM3] RLE to PNG conversion successful:', maskUrl.substring(0, 50) + '...');

    return res.status(200).json({ 
      success: true,
      mask_url: maskUrl,
      width,
      height
    });

  } catch (error) {
    console.error('[SAM3] RLE to PNG conversion error:', error);
    return res.status(500).json({ 
      error: error?.message || 'Unknown error'
    });
  }
}

/**
 * Decode RLE format to binary mask array
 * RLE can be in different formats:
 * 1. Array of numbers: [start1, length1, start2, length2, ...]
 * 2. Array of pairs: [[start1, length1], [start2, length2], ...]
 * 3. Object with counts: { counts: [start1, length1, ...], size: [width, height] }
 */
function decodeRLE(rle, width, height) {
  try {
    const totalPixels = width * height;
    const mask = new Uint8Array(totalPixels).fill(0); // Initialize with zeros (transparent)
    
    let runs = [];
    
    // Handle different RLE formats
    if (Array.isArray(rle)) {
      if (rle.length === 0) {
        return mask;
      }
      
      // Check if it's array of pairs
      if (Array.isArray(rle[0])) {
        runs = rle;
      } else {
        // Array of numbers: [start1, length1, start2, length2, ...]
        runs = [];
        for (let i = 0; i < rle.length; i += 2) {
          if (i + 1 < rle.length) {
            runs.push([rle[i], rle[i + 1]]);
          }
        }
      }
    } else if (rle.counts && Array.isArray(rle.counts)) {
      // Object format with counts array
      runs = [];
      for (let i = 0; i < rle.counts.length; i += 2) {
        if (i + 1 < rle.counts.length) {
          runs.push([rle.counts[i], rle.counts[i + 1]]);
        }
      }
    } else {
      console.warn('[SAM3] Unknown RLE format:', typeof rle);
      return null;
    }
    
    // Decode runs to mask
    for (const [start, length] of runs) {
      const startIdx = Math.floor(start);
      const endIdx = Math.min(startIdx + Math.floor(length), totalPixels);
      
      for (let i = startIdx; i < endIdx; i++) {
        if (i >= 0 && i < totalPixels) {
          mask[i] = 255; // White (opaque) for mask
        }
      }
    }
    
    return mask;
  } catch (error) {
    console.error('[SAM3] RLE decode error:', error);
    return null;
  }
}

/**
 * Create PNG image from binary mask
 * Returns PNG buffer ready for upload
 * Uses Cloudinary's upload API which accepts raw image data
 */
async function createPNGFromMask(mask, width, height) {
  try {
    // Create RGBA image data
    // Mask pixels: white (255,255,255,255) for object, transparent (0,0,0,0) for background
    const imageData = new Uint8Array(width * height * 4);
    
    for (let i = 0; i < mask.length; i++) {
      const pixelIdx = i * 4;
      const maskValue = mask[i];
      
      if (maskValue > 0) {
        // Object pixel: white with full opacity
        imageData[pixelIdx] = 255;     // R
        imageData[pixelIdx + 1] = 255; // G
        imageData[pixelIdx + 2] = 255; // B
        imageData[pixelIdx + 3] = 255; // A (opaque)
      } else {
        // Background pixel: transparent
        imageData[pixelIdx] = 0;       // R
        imageData[pixelIdx + 1] = 0;   // G
        imageData[pixelIdx + 2] = 0;   // B
        imageData[pixelIdx + 3] = 0;   // A (transparent)
      }
    }
    
    // Try to use sharp if available (best option)
    try {
      const sharp = (await import('sharp')).default;
      const pngBuffer = await sharp(imageData, {
        raw: {
          width,
          height,
          channels: 4
        }
      })
      .png()
      .toBuffer();
      
      return pngBuffer;
    } catch (sharpError) {
      console.warn('[SAM3] Sharp not available, using Cloudinary direct upload:', sharpError.message);
      // Fallback: Return imageData as buffer - Cloudinary can handle raw RGBA
      // We'll upload it as a data URL
      return Buffer.from(imageData);
    }
  } catch (error) {
    console.error('[SAM3] PNG creation error:', error);
    return null;
  }
}

/**
 * Upload PNG mask to Cloudinary
 */
async function uploadMaskToCloudinary(pngBuffer) {
  try {
    // Check if buffer is a valid PNG (starts with PNG signature) or raw RGBA data
    const isPNG = pngBuffer.length > 8 && 
                   pngBuffer[0] === 0x89 && 
                   pngBuffer[1] === 0x50 && 
                   pngBuffer[2] === 0x4E && 
                   pngBuffer[3] === 0x47;
    
    let dataUrl;
    
    if (isPNG) {
      // Valid PNG buffer
      const base64 = pngBuffer.toString('base64');
      dataUrl = `data:image/png;base64,${base64}`;
    } else {
      // Raw RGBA data - convert to base64
      // Note: Cloudinary might not accept raw RGBA, so we'll try
      const base64 = pngBuffer.toString('base64');
      dataUrl = `data:image/png;base64,${base64}`;
    }
    
    // Use Cloudinary SDK
    const { v2: cloudinary } = await import('cloudinary');
    
    cloudinary.config({
      cloud_name: process.env.VITE_CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });

    const result = await cloudinary.uploader.upload(dataUrl, {
      resource_type: 'image',
      folder: 'hon-comics/masks',
      public_id: `sam3-mask-${Date.now()}`,
      format: 'png',
      overwrite: false
    });

    return result.secure_url;
  } catch (error) {
    console.error('[SAM3] Cloudinary upload error:', error);
    
    // Fallback: Try using FormData upload (for raw buffers)
    try {
      // If we have raw RGBA data, we need to convert it to PNG first
      // For now, try uploading as base64 data URL
      const base64 = pngBuffer.toString('base64');
      const dataUrl = `data:image/png;base64,${base64}`;
      
      const cloudName = process.env.VITE_CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_CLOUD_NAME;
      const uploadPreset = process.env.VITE_CLOUDINARY_UPLOAD_PRESET || 'hon_comics';
      
      const response = await fetch(
        `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            file: dataUrl,
            upload_preset: uploadPreset,
            folder: 'hon-comics/masks'
          })
        }
      );
      
      if (response.ok) {
        const data = await response.json();
        return data.secure_url;
      } else {
        const errorText = await response.text();
        console.error('[SAM3] Cloudinary fallback upload failed:', errorText);
      }
    } catch (fallbackError) {
      console.error('[SAM3] Cloudinary fallback upload error:', fallbackError);
    }
    
    return null;
  }
}

export default withApiAccess(handler, "/api/fal/sam3-rle-to-png");
