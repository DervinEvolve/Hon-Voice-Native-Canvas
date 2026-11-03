/**
 * Utility functions for RLE to PNG conversion
 * Can be imported directly by other endpoints for faster processing
 */

import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.VITE_CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Decode RLE format to binary mask array
 */
export function decodeRLE(rle, width, height) {
  try {
    const totalPixels = width * height;
    const mask = new Uint8Array(totalPixels).fill(0);
    
    let runs = [];
    
    if (Array.isArray(rle)) {
      if (rle.length === 0) return mask;
      
      if (Array.isArray(rle[0])) {
        runs = rle;
      } else {
        runs = [];
        for (let i = 0; i < rle.length; i += 2) {
          if (i + 1 < rle.length) {
            runs.push([rle[i], rle[i + 1]]);
          }
        }
      }
    } else if (rle.counts && Array.isArray(rle.counts)) {
      runs = [];
      for (let i = 0; i < rle.counts.length; i += 2) {
        if (i + 1 < rle.counts.length) {
          runs.push([rle.counts[i], rle.counts[i + 1]]);
        }
      }
    } else {
      return null;
    }
    
    for (const [start, length] of runs) {
      const startIdx = Math.floor(start);
      const endIdx = Math.min(startIdx + Math.floor(length), totalPixels);
      
      for (let i = startIdx; i < endIdx; i++) {
        if (i >= 0 && i < totalPixels) {
          mask[i] = 255;
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
 * Create PNG from mask and upload to Cloudinary
 */
export async function convertRLEToPNG(rle, width, height) {
  try {
    const mask = decodeRLE(rle, width, height);
    if (!mask) return null;
    
    // Create RGBA image data
    const imageData = new Uint8Array(width * height * 4);
    
    for (let i = 0; i < mask.length; i++) {
      const pixelIdx = i * 4;
      const maskValue = mask[i];
      
      if (maskValue > 0) {
        imageData[pixelIdx] = 255;
        imageData[pixelIdx + 1] = 255;
        imageData[pixelIdx + 2] = 255;
        imageData[pixelIdx + 3] = 255;
      } else {
        imageData[pixelIdx] = 0;
        imageData[pixelIdx + 1] = 0;
        imageData[pixelIdx + 2] = 0;
        imageData[pixelIdx + 3] = 0;
      }
    }
    
    // Try sharp first, then fallback
    let pngBuffer;
    try {
      const sharp = (await import('sharp')).default;
      pngBuffer = await sharp(imageData, {
        raw: {
          width,
          height,
          channels: 4
        }
      })
      .png()
      .toBuffer();
    } catch {
      // Fallback: use raw buffer (Cloudinary might accept it)
      pngBuffer = Buffer.from(imageData);
    }
    
    // Upload to Cloudinary
    const base64 = pngBuffer.toString('base64');
    const dataUrl = `data:image/png;base64,${base64}`;
    
    const result = await cloudinary.uploader.upload(dataUrl, {
      resource_type: 'image',
      folder: 'hon-comics/masks',
      public_id: `sam3-mask-${Date.now()}`,
      format: 'png'
    });
    
    return result.secure_url;
  } catch (error) {
    console.error('[SAM3] RLE to PNG conversion error:', error);
    return null;
  }
}

