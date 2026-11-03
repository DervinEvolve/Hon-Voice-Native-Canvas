import { withApiAccess } from "../_lib/api-access.js";
import { ownedApiCall } from '../_lib/api-access.js';
/**
 * FAL.ai SAM3 Mask Generation API
 * Generates segmentation masks for objects in images using SAM3 via FAL.ai
 * 
 * Endpoint: POST /api/fal/sam3-mask
 * Body: { imageUrl: string, text_prompt: string, detection_threshold?: number }
 * Returns: { success: true, mask_url: string, mask_data?: object }
 * 
 * Documentation: https://fal.ai/models/fal-ai/sam-3/image-rle
 */

const clamp = (value, min = 0, max = 1) => Math.min(Math.max(value, min), max);

function normalizeBoxArray(box) {
  if (!Array.isArray(box) || box.length < 4) {
    return null;
  }
  const numericBox = box.map(val => (typeof val === 'number' && !Number.isNaN(val) ? val : Number(val)));
  if (numericBox.some(val => Number.isNaN(val))) {
    return null;
  }
  const [v0, v1, v2, v3] = numericBox;

  // If already in [x_min, y_min, x_max, y_max] order
  if (v0 <= v2 && v1 <= v3) {
    const xMin = clamp(v0);
    const yMin = clamp(v1);
    const xMax = clamp(v2);
    const yMax = clamp(v3);
    if (xMax > xMin && yMax > yMin) {
      return [xMin, yMin, xMax, yMax];
    }
  }

  // Otherwise treat as [cx, cy, width, height]
  const width = v2;
  const height = v3;
  const cx = v0;
  const cy = v1;

  if (typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0) {
    const halfW = width / 2;
    const halfH = height / 2;
    const xMin = clamp(cx - halfW);
    const yMin = clamp(cy - halfH);
    const xMax = clamp(cx + halfW);
    const yMax = clamp(cy + halfH);
    if (xMax > xMin && yMax > yMin) {
      return [xMin, yMin, xMax, yMax];
    }
  }

  return null;
}

 async function handler(req, res) {
  // CORS headers
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
    const {
      imageUrl,
      text_prompt,
      detection_threshold = 0.2,
      mode = 'editing'
    } = req.body || {}; // Lower threshold to match detection endpoint
    
    const isVisualMode = mode === 'visual';
    
    if (!imageUrl) {
      return res.status(400).json({ error: 'Missing imageUrl parameter' });
    }

    if (!text_prompt) {
      return res.status(400).json({ error: 'Missing text_prompt parameter (e.g., "car", "person")' });
    }

    const falApiKey = process.env.FAL_API_KEY;
    if (!falApiKey) {
      console.warn('[SAM3] FAL_API_KEY not configured');
      return res.status(500).json({ error: 'FAL_API_KEY not configured' });
    }

    // FAL.ai SAM3 endpoints:
    // - /image: Returns boxes and masks (better for visualization)
    // - /image-rle: Returns RLE masks (better for editing)
    // 
    // For visualization, try /image first to get boxes
    // If we need RLE for editing, we'll call /image-rle
    
    console.log('[SAM3] Generating mask for:', text_prompt, 'in image:', imageUrl.substring(0, 50) + '...');

    const basePayload = {
      image_url: imageUrl,
      text_prompt: text_prompt,
      detection_threshold: detection_threshold,
      include_boxes: true,
      include_scores: true,
      return_multiple_masks: false,
      max_masks: 1,
      apply_mask: !isVisualMode,
      output_format: 'png',
      sync_mode: false
    };

    // Try /image endpoint first (returns boxes for visualization)
    let response = await fetch('https://fal.run/fal-ai/sam-3/image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Key ${falApiKey}`
      },
      body: JSON.stringify(basePayload)
    });

    let data = null;
    let hasUsableData = false;
    let dataHasBoxes = false;
    let dataHasMaskPayload = false;

    // Check if /image endpoint returned usable data
    if (response.ok) {
      try {
        data = await response.json();
        // Check if we have metadata with at least one entry that has a box
        if (data.metadata && Array.isArray(data.metadata) && data.metadata.length > 0) {
          // Check if any entry has a valid box
          dataHasBoxes = data.metadata.some(m => 
            (m.box && Array.isArray(m.box) && m.box.length >= 4) ||
            (m.bbox && Array.isArray(m.bbox) && m.bbox.length >= 4) ||
            (m.bounding_box && Array.isArray(m.bounding_box) && m.bounding_box.length >= 4)
          );
          dataHasMaskPayload = data.metadata.some(m => m.rle || m.mask);
          hasUsableData = isVisualMode ? dataHasBoxes : (dataHasBoxes || dataHasMaskPayload);
        }
      } catch (e) {
        console.warn('[SAM3] Failed to parse /image response:', e);
      }
    }

    // If /image didn't return usable data, try /image-rle
    if (!hasUsableData && !isVisualMode) {
      console.log('[SAM3] /image endpoint did not return usable data, trying /image-rle...');
      response = await fetch('https://fal.run/fal-ai/sam-3/image-rle', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Key ${falApiKey}`
        },
        body: JSON.stringify({
          ...basePayload,
          apply_mask: true // ensure we get RLE/mask data
        })
      });

      if (response.ok) {
        try {
          data = await response.json();
          if (data.metadata && Array.isArray(data.metadata) && data.metadata.length > 0) {
            dataHasBoxes = data.metadata.some(m => 
              (m.box && Array.isArray(m.box) && m.box.length >= 4) ||
              (m.bbox && Array.isArray(m.bbox) && m.bbox.length >= 4) ||
              (m.bounding_box && Array.isArray(m.bounding_box) && m.bounding_box.length >= 4)
            );
            dataHasMaskPayload = data.metadata.some(m => m.rle || m.mask);
            hasUsableData = dataHasBoxes || dataHasMaskPayload;
          }
        } catch (e) {
          console.warn('[SAM3] Failed to parse /image-rle response:', e);
        }
      }
    }

    if (!response.ok || !hasUsableData) {
      const errorText = response.ok 
        ? `No usable mask data returned. Metadata length: ${data?.metadata?.length || 0}, hasMetadata: ${!!data?.metadata}`
        : await response.text().catch(() => 'Unknown error');
      console.error('[SAM3] FAL.ai mask generation error:', {
        status: response.status,
        error: errorText,
        responseData: data ? {
          hasMetadata: !!data.metadata,
          metadataLength: data.metadata?.length || 0,
          firstItem: data.metadata?.[0] ? {
            keys: Object.keys(data.metadata[0]),
            hasBox: !!data.metadata[0].box,
            hasRle: !!data.metadata[0].rle,
            hasMask: !!data.metadata[0].mask
          } : null
        } : null
      });
      return res.status(200).json({ 
        error: `SAM3 mask generation failed: ${errorText}`,
        success: false,
        mask_url: null,
        box: null
      });
    }
    
    // FAL SAM3 response format (both /image and /image-rle):
    // Returns metadata array with:
    // - index: mask index
    // - score: confidence score (may be null)
    // - box: bounding box [x_min, y_min, x_max, y_max] (normalized 0-1)
    // - rle: Run-Length Encoding mask data (only in /image-rle endpoint)
    // - mask: mask data (in /image endpoint)
    
    console.log('[SAM3] Full API response structure:', {
      hasMetadata: !!data.metadata,
      metadataLength: data.metadata?.length || 0,
      firstItemKeys: data.metadata?.[0] ? Object.keys(data.metadata[0]) : [],
      firstItemFull: data.metadata?.[0] ? JSON.stringify(data.metadata[0], null, 2) : null,
      allMetadataEntries: data.metadata?.map((m, i) => ({
        index: i,
        keys: Object.keys(m),
        hasBox: !!m.box,
        boxValue: m.box,
        hasRle: !!m.rle,
        hasMask: !!m.mask,
        hasBbox: !!m.bbox,
        hasBoundingBox: !!m.bounding_box
      })) || []
    });
    
    if (!data.metadata || !Array.isArray(data.metadata) || data.metadata.length === 0) {
      console.warn('[SAM3] No masks detected for prompt:', text_prompt);
      return res.status(200).json({ 
        success: false,
        error: `No objects detected matching "${text_prompt}"`,
        mask_url: null
      });
    }

    // Find the best mask with a valid box (try all entries if first doesn't have box)
    let bestMask = data.metadata[0];
    let bestMaskIndex = 0;
    
    // If first mask doesn't have a box, try to find one that does
    if (!bestMask.box || !Array.isArray(bestMask.box) || bestMask.box.length < 4) {
      console.log('[SAM3] First mask has no box, searching other entries...');
      for (let i = 0; i < data.metadata.length; i++) {
        const mask = data.metadata[i];
        const hasBox = (mask.box && Array.isArray(mask.box) && mask.box.length >= 4) ||
                       (mask.bbox && Array.isArray(mask.bbox) && mask.bbox.length >= 4) ||
                       (mask.bounding_box && Array.isArray(mask.bounding_box) && mask.bounding_box.length >= 4);
        if (hasBox) {
          bestMask = mask;
          bestMaskIndex = i;
          console.log(`[SAM3] Found mask with box at index ${i}`);
          break;
        }
      }
    }
    
    console.log('[SAM3] Using mask at index:', bestMaskIndex, 'score:', bestMask.score, 'for:', text_prompt);
    console.log('[SAM3] Best mask box:', bestMask.box, 'type:', typeof bestMask.box, 'isArray:', Array.isArray(bestMask.box));
    console.log('[SAM3] Full bestMask structure:', JSON.stringify({
      index: bestMask.index,
      score: bestMask.score,
      box: bestMask.box,
      bbox: bestMask.bbox,
      bounding_box: bestMask.bounding_box,
      hasRle: !!bestMask.rle,
      hasMask: !!bestMask.mask,
      size: bestMask.size,
      allKeys: Object.keys(bestMask)
    }, null, 2));
    
    // Helper function to calculate bounding box from mask data
    function calculateBoxFromMask(mask, width, height) {
      let minX = width, minY = height, maxX = 0, maxY = 0;
      let foundPixel = false;
      
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = y * width + x;
          const pixelValue = Array.isArray(mask) ? mask[idx] : mask[idx];
          if (pixelValue > 0) {
            foundPixel = true;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
          }
        }
      }
      
      if (foundPixel) {
        // Normalize to 0-1 range
        return [
          minX / width,
          minY / height,
          maxX / width,
          maxY / height
        ];
      }
      return null;
    }
    
    // Extract box from various possible fields
    let extractedBox = null;
    if (bestMask.box && Array.isArray(bestMask.box) && bestMask.box.length >= 4) {
      extractedBox = normalizeBoxArray(bestMask.box);
    } else if (bestMask.bbox && Array.isArray(bestMask.bbox) && bestMask.bbox.length >= 4) {
      extractedBox = normalizeBoxArray(bestMask.bbox);
    } else if (bestMask.bounding_box && Array.isArray(bestMask.bounding_box) && bestMask.bounding_box.length >= 4) {
      extractedBox = normalizeBoxArray(bestMask.bounding_box);
    } else if (bestMask.box && typeof bestMask.box === 'object' && bestMask.box.x_min !== undefined) {
      // Box might be an object with x_min, y_min, x_max, y_max
      extractedBox = normalizeBoxArray([
        bestMask.box.x_min,
        bestMask.box.y_min,
        bestMask.box.x_max,
        bestMask.box.y_max
      ]);
    }
    
    // If box is still null, try to calculate from mask data (RLE or mask)
    if (!extractedBox) {
      if (bestMask.rle) {
        console.warn('[SAM3] Box not found in response, calculating from RLE mask');
        try {
          // Get image dimensions
          const imageWidth = bestMask.size?.[0] || data.size?.[0] || 1024;
          const imageHeight = bestMask.size?.[1] || data.size?.[1] || 1024;
          
          // Import RLE decode function
          const { decodeRLE } = await import('./sam3-rle-to-png-utils.js');
          const mask = decodeRLE(bestMask.rle, imageWidth, imageHeight);
          
          if (mask) {
            extractedBox = calculateBoxFromMask(mask, imageWidth, imageHeight);
            if (extractedBox) {
              console.log('[SAM3] Calculated box from RLE:', extractedBox);
            }
          }
        } catch (calcError) {
          console.warn('[SAM3] Failed to calculate box from RLE:', calcError);
        }
      } else if (bestMask.mask) {
        // Try to calculate from mask data (from /image endpoint)
        console.warn('[SAM3] Box not found in response, calculating from mask data');
        try {
          const imageWidth = bestMask.size?.[0] || data.size?.[0] || 1024;
          const imageHeight = bestMask.size?.[1] || data.size?.[1] || 1024;
          
          // Mask might be base64 encoded or raw array
          let maskData = bestMask.mask;
          if (typeof maskData === 'string') {
            // Try to decode base64 mask
            try {
              const buffer = Buffer.from(maskData, 'base64');
              maskData = new Uint8Array(buffer);
            } catch (e) {
              console.warn('[SAM3] Failed to decode base64 mask');
            }
          }
          
          if (Array.isArray(maskData) || maskData instanceof Uint8Array) {
            extractedBox = calculateBoxFromMask(maskData, imageWidth, imageHeight);
            if (extractedBox) {
              console.log('[SAM3] Calculated box from mask:', extractedBox);
            }
          }
        } catch (calcError) {
          console.warn('[SAM3] Failed to calculate box from mask:', calcError);
        }
      }
    }

    // Convert RLE to PNG and upload to Cloudinary
    let maskUrl = null;
    
    if (bestMask.rle) {
      try {
        // Get image dimensions from size array or from box
        let imageWidth = bestMask.size?.[0];
        let imageHeight = bestMask.size?.[1];
        
        // If size not provided, try to infer from box or use defaults
        if (!imageWidth || !imageHeight) {
          if (bestMask.box && Array.isArray(bestMask.box) && bestMask.box.length >= 4) {
            // Estimate from bounding box (add padding)
            imageWidth = Math.ceil(bestMask.box[2] * 1.2); // x_max * 1.2
            imageHeight = Math.ceil(bestMask.box[3] * 1.2); // y_max * 1.2
          } else {
            // Default dimensions (will need actual image dimensions)
            // For now, we'll need to fetch the original image to get dimensions
            console.warn('[SAM3] Image dimensions not available, mask conversion may fail');
            imageWidth = 1024; // Default fallback
            imageHeight = 1024;
          }
        }
        
        // Import RLE conversion function directly (server-side)
        let convertRLEToPNG = null;
        try {
          const utils = await import('./sam3-rle-to-png-utils.js');
          convertRLEToPNG = utils.convertRLEToPNG || null;
        } catch (error) {
          // Fallback: Call endpoint if utils not available
          console.warn('[SAM3] Failed to import RLE utils, using endpoint fallback:', error?.message);
        }
        
        if (convertRLEToPNG) {
          // Use direct function call (faster)
          maskUrl = await convertRLEToPNG(bestMask.rle, imageWidth, imageHeight);
        } else {
          // Fallback: Call endpoint
          const internalCall = ownedApiCall(req, '/api/fal/sam3-rle-to-png');
          const conversionResponse = await fetch(internalCall.url, {
            method: 'POST',
            ...internalCall.options,
            body: JSON.stringify({
              rle: bestMask.rle,
              size: [imageWidth, imageHeight],
              image_width: imageWidth,
              image_height: imageHeight
            })
          });
          
          if (conversionResponse.ok) {
            const conversionData = await conversionResponse.json();
            maskUrl = conversionData.mask_url;
          } else {
            const errorText = await conversionResponse.text();
            console.warn('[SAM3] RLE to PNG conversion failed:', errorText);
          }
        }
        
        if (maskUrl) {
          console.log('[SAM3] RLE converted to PNG:', maskUrl.substring(0, 50) + '...');
        }
      } catch (conversionError) {
        console.warn('[SAM3] RLE to PNG conversion error:', conversionError);
        // Continue without mask URL - will fall back to regular edit
      }
    }
    
    // Check if we have usable mask data (box, RLE, or mask URL)
    const hasVisualData = !!extractedBox;
    const hasEditingData = !!(bestMask.rle || maskUrl);
    const finalHasUsableData = isVisualMode ? hasVisualData : (hasVisualData || hasEditingData);
    
    if (!finalHasUsableData) {
      console.warn('[SAM3] No usable mask data found for prompt:', text_prompt);
      return res.status(200).json({ 
        success: false,
        error: `Mask detected but no usable mask data (no box, RLE, or mask URL) for "${text_prompt}"`,
        mask_url: null,
        box: null
      });
    }
    
    return res.status(200).json({ 
      success: true,
      mask_data: {
        ...bestMask,
        box: extractedBox || bestMask.box // Use extracted box or fallback to original
      },
      score: bestMask.score,
      box: extractedBox || bestMask.box, // Ensure box is always an array or null
      mask_url: maskUrl, // PNG image URL for Seedream
      metadata: data.metadata
    });

  } catch (error) {
    console.error('[SAM3] Mask generation error:', error);
    return res.status(500).json({ 
      success: false,
      error: error?.message || 'Unknown error',
      mask_url: null
    });
  }
}

export default withApiAccess(handler, "/api/fal/sam3-mask");
