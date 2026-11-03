import { withApiAccess } from "../_lib/api-access.js";
/**
 * FAL.ai SAM3 Object Detection API
 * Detects objects in images using SAM3 model via FAL.ai
 * 
 * Endpoint: POST /api/fal/sam3-detect
 * Body: { imageUrl: string }
 * Returns: { success: true, objects: string[] }
 * 
 * Documentation: https://fal.ai/models/fal-ai/sam-3/image/api
 */

const detectionCache = new Map(); // imageUrl -> { timestamp, result }
const DETECTION_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const MAX_DETECTION_PROMPTS = 5;

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
    const { imageUrl } = req.body || {};
    if (!imageUrl) {
      return res.status(400).json({ error: 'Missing imageUrl parameter' });
    }

    const cacheEntry = detectionCache.get(imageUrl);
    if (cacheEntry && Date.now() - cacheEntry.timestamp < DETECTION_CACHE_TTL) {
      return res.status(200).json(cacheEntry.result);
    }

    const falApiKey = process.env.FAL_API_KEY;
    if (!falApiKey) {
      console.warn('[SAM3] FAL_API_KEY not configured');
      // Graceful fallback: return empty array
      return res.status(200).json({ success: true, objects: [] });
    }

    // FAL.ai SAM3 Image Segmentation endpoint
    // Model: fal-ai/sam-3/image
    // Documentation: https://fal.ai/models/fal-ai/sam-3/image/api
    // 
    // Input: image_url (string), text_prompt (string), detection_threshold (float)
    // Output: metadata array with detected objects and masks
    
    console.log('[SAM3] Calling FAL.ai SAM3 endpoint for:', imageUrl.substring(0, 50) + '...');

    // Smart approach: Use Moondream3 to understand the image first, then use those objects as SAM3 prompts
    // Moondream is faster and better at identifying objects than generic prompts
    let detectionPrompts = [];
    
    try {
      // Use Moondream3 to get a caption/description of the image
      // Call Moondream API directly (server-side) instead of going through HTTP endpoint
      // This avoids authentication issues and is more efficient
      const { fal } = await import('@fal-ai/client');
      const falApiKeyForMoondream = process.env.FAL_API_KEY;
      if (!falApiKeyForMoondream) {
        console.warn('[SAM3] FAL_API_KEY not configured, skipping Moondream pre-analysis');
      } else {
        fal.config({ credentials: falApiKeyForMoondream });
        
        try {
          const moondreamResult = await fal.subscribe("fal-ai/moondream3-preview/caption", {
            input: {
              image_url: imageUrl,
              response_format: "json"
            }
          });
          
          const caption = moondreamResult.data?.output || (typeof moondreamResult.data === 'string' ? moondreamResult.data : null);
          
          if (caption) {
            console.log(`[Moondream] ✅ Caption generated for SAM3 detection: "${caption.substring(0, 100)}${caption.length > 100 ? '...' : ''}"`);
            
            // Extract object names from Moondream's caption
            // Moondream captions are usually concise and list objects directly
            // Better extraction: look for nouns and common object words
            const commonObjects = [
              // Animals
              'kangaroo', 'penguin', 'panda', 'zebra', 'koala', 'rabbit', 'dog', 'cat', 'bird', 'horse', 'elephant', 'lion', 'tiger', 'bear', 'deer', 'fox', 'wolf', 'cow', 'pig', 'sheep', 'goat', 'chicken', 'duck', 'swan', 'eagle', 'owl',
              // People
              'person', 'people', 'human', 'man', 'woman', 'child', 'boy', 'girl', 'baby',
              // Vehicles
              'car', 'vehicle', 'truck', 'bus', 'motorcycle', 'bicycle', 'bike', 'train', 'plane', 'airplane', 'boat', 'ship',
              // Buildings
              'building', 'house', 'structure', 'tower', 'bridge', 'wall', 'fence',
              // Furniture
              'chair', 'table', 'furniture', 'sofa', 'couch', 'bed', 'desk', 'shelf', 'cabinet',
              // Electronics
              'phone', 'computer', 'laptop', 'electronic', 'television', 'tv', 'screen', 'monitor', 'camera',
              // Food
              'food', 'fruit', 'vegetable', 'apple', 'banana', 'orange', 'bread', 'cake',
              // Clothing
              'shirt', 'pants', 'shoe', 'clothing', 'hat', 'jacket', 'dress',
              // Nature
              'tree', 'plant', 'flower', 'grass', 'leaf', 'branch', 'sky', 'cloud', 'sun', 'moon', 'star', 'water', 'ocean', 'lake', 'river', 'sea', 'ground', 'road', 'path', 'rock', 'stone',
              // Other
              'bag', 'backpack', 'purse', 'book', 'paper', 'pen', 'pencil', 'box', 'bottle', 'cup', 'glass', 'plate', 'bowl'
            ];
            
            const extractedObjects = new Set();
            const captionLower = caption.toLowerCase();
            
            // First, check for exact matches of common objects
            for (const obj of commonObjects) {
              if (captionLower.includes(obj)) {
                extractedObjects.add(obj);
              }
            }
            
            // Also extract nouns using patterns
            const nounPatterns = [
              /\b(a|an|the)\s+([a-z]{3,15})\b/gi,  // "a dog", "the cat"
              /\b([A-Z][a-z]{2,15})\b/g,            // Proper nouns like "Kangaroo", "Penguin"
            ];
            
            for (const pattern of nounPatterns) {
              const matches = caption.matchAll(pattern);
              for (const match of matches) {
                const obj = (match[2] || match[1]).toLowerCase();
                if (obj && obj.length >= 3 && obj.length <= 15) {
                  // Filter out common words
                  const skipWords = ['the', 'and', 'or', 'but', 'with', 'this', 'that', 'there', 'where', 'when', 'what', 'which', 'who', 'how', 'are', 'is', 'was', 'were', 'been', 'have', 'has', 'had', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'cannot', 'image', 'picture', 'photo', 'photograph', 'shows', 'showing', 'visible', 'seen', 'appears', 'appearing', 'standing', 'sitting', 'lying', 'walking', 'running', 'flying', 'looking', 'wearing', 'holding', 'sitting', 'standing', 'lying', 'on', 'in', 'at', 'to', 'for', 'of', 'from', 'by', 'about', 'into', 'onto', 'upon', 'within', 'without', 'through', 'during', 'before', 'after', 'above', 'below', 'over', 'under', 'beside', 'between', 'among', 'around', 'near', 'far', 'left', 'right', 'front', 'back', 'top', 'bottom', 'side', 'center', 'middle', 'end', 'start', 'begin', 'part', 'piece', 'section', 'area', 'place', 'location', 'position', 'point', 'line', 'edge', 'corner', 'surface', 'face', 'side', 'front', 'back', 'top', 'bottom'];
                  if (!skipWords.includes(obj) && !obj.endsWith('ing') && !obj.endsWith('ed') && !obj.endsWith('ly')) {
                    extractedObjects.add(obj);
                  }
                }
              }
            }
            
            if (extractedObjects.size > 0) {
              // Filter out non-object words (adjectives, descriptors, abstract concepts)
              const nonObjectWords = new Set([
                'long', 'short', 'wide', 'narrow', 'tall', 'small', 'large', 'big', 'little', 'huge', 'tiny',
                'scene', 'background', 'foreground', 'view', 'image', 'picture', 'photo', 'photograph',
                'light', 'dark', 'bright', 'dim', 'colorful', 'color', 'colored',
                'empty', 'full', 'open', 'closed', 'clear', 'blurry', 'sharp', 'focused',
                'beautiful', 'nice', 'pretty', 'ugly', 'good', 'bad', 'great', 'amazing',
                'outdoor', 'indoor', 'outside', 'inside', 'urban', 'rural', 'natural', 'artificial',
                'modern', 'old', 'new', 'ancient', 'vintage', 'contemporary',
                'sunny', 'cloudy', 'rainy', 'snowy', 'windy', 'foggy',
                'busy', 'quiet', 'peaceful', 'noisy', 'crowded', 'empty',
                'distant', 'close', 'near', 'far', 'away', 'nearby'
              ]);
              
              const filteredObjects = Array.from(extractedObjects).filter(obj => {
                // Remove if it's a non-object word
                if (nonObjectWords.has(obj)) return false;
                // Remove if it's too short or too long
                if (obj.length < 3 || obj.length > 20) return false;
                // Remove if it's a verb form (ends with -ing, -ed, -ly)
                if (obj.endsWith('ing') || obj.endsWith('ed') || obj.endsWith('ly')) return false;
                return true;
              });
              
              detectionPrompts = filteredObjects.slice(0, MAX_DETECTION_PROMPTS); // Limit to top prompts
              console.log('[SAM3] Extracted', detectionPrompts.length, 'prompts from Moondream:', detectionPrompts);
              if (filteredObjects.length < extractedObjects.size) {
                console.log('[SAM3] Filtered out', extractedObjects.size - filteredObjects.length, 'non-object words');
              }
            } else {
              console.warn('[SAM3] No objects extracted from Moondream caption:', caption.substring(0, 100));
            }
          }
        } catch (moondreamError) {
          console.warn('[SAM3] Moondream analysis failed (non-critical):', moondreamError?.message || moondreamError);
          // Continue without Moondream - fallback to generic prompts
        }
      }
    } catch (moondreamImportError) {
      console.warn('[SAM3] Failed to import Moondream client (non-critical):', moondreamImportError?.message || moondreamImportError);
      // Continue without Moondream - fallback to generic prompts
    }
    
    // Fallback to common prompts if Moondream didn't provide good results
    if (detectionPrompts.length === 0) {
      detectionPrompts = [
        // High-priority common objects
        'person', 'people', 'human',
        'car', 'vehicle', 'train',
        'dog', 'cat', 'animal',
        'building', 'house',
        'bag', 'phone',
        'cup', 'table',
        'tree', 'sky'
      ];
      detectionPrompts = detectionPrompts.slice(0, MAX_DETECTION_PROMPTS);
    }
    
    const detectedObjects = new Map(); // Map of object -> confidence score
    
    // Try each prompt and collect detections with confidence scores
    // Limit concurrent requests to avoid rate limits
    const maxConcurrent = 5;
    let successfulDetections = 0;
    let failedDetections = 0;
    
    console.log(`[SAM3] Testing ${detectionPrompts.length} prompts against SAM3...`);
    
    for (let i = 0; i < detectionPrompts.length; i += maxConcurrent) {
      const batch = detectionPrompts.slice(i, i + maxConcurrent);
      await Promise.all(batch.map(async (prompt) => {
        try {
          // Use image endpoint for cheaper detection (only need metadata)
          const response = await fetch('https://fal.run/fal-ai/sam-3/image', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Key ${falApiKey}`
            },
            body: JSON.stringify({
              image_url: imageUrl,
              text_prompt: prompt,
              detection_threshold: 0.2, // Lower threshold for more detections
              include_scores: true,
              include_boxes: false,
              return_multiple_masks: false,
              max_masks: 1,
              apply_mask: false,
              output_format: 'png',
              sync_mode: false
            })
          });

          if (response.ok) {
            const data = await response.json();
            
            // Debug: Log the full response structure for first prompt to understand format
            if (detectionPrompts.indexOf(prompt) === 0) {
              console.log(`[SAM3] 🔍 Response structure for "${prompt}":`, JSON.stringify(data).substring(0, 500));
            }
            
            // Log what we got back
            if (data.metadata && Array.isArray(data.metadata) && data.metadata.length > 0) {
              console.log(`[SAM3] ✅ Found ${data.metadata.length} instances of "${prompt}"`);
              // Debug: Log first metadata entry structure
              if (data.metadata[0]) {
                console.log(`[SAM3] 🔍 Metadata structure:`, JSON.stringify(data.metadata[0]).substring(0, 300));
              }
              
              // Use the highest confidence score from all detected instances
              // Check multiple possible score fields
              const scores = data.metadata.map(m => {
                return m.score || m.confidence || m.conf || (m.bbox ? 0.5 : 0) || 0;
              }).filter(s => s > 0);
              
              if (scores.length > 0) {
                const maxScore = Math.max(...scores);
                if (maxScore > 0.2) {
                  // Store with confidence score for ranking
                  const currentScore = detectedObjects.get(prompt) || 0;
                  detectedObjects.set(prompt, Math.max(currentScore, maxScore));
                  successfulDetections++;
                  console.log(`[SAM3] ✅ Added "${prompt}" with confidence ${maxScore.toFixed(2)}`);
                } else {
                  console.log(`[SAM3] ⚠️ "${prompt}" found but confidence too low: ${maxScore.toFixed(2)}`);
                }
              } else {
                // No scores found - still add the object if metadata exists (means it was detected)
                console.log(`[SAM3] ⚠️ "${prompt}" detected but no score field found, adding anyway`);
                detectedObjects.set(prompt, 0.5); // Default confidence
                successfulDetections++;
              }
            } else {
              // No metadata means no detection
              failedDetections++;
              if (detectionPrompts.indexOf(prompt) === 0) {
                console.log(`[SAM3] ⚠️ No metadata in response for "${prompt}". Response keys:`, Object.keys(data));
              }
            }
          } else if (response.status === 422) {
            // 422 means no masks found for this prompt - this is expected and not an error
            failedDetections++;
            // Only log occasionally to reduce noise
            if (Math.random() < 0.1) { // Log 10% of 422s
              console.log(`[SAM3] ⚠️ No detection for "${prompt}" (422 - expected)`);
            }
          } else {
            // Log other errors
            failedDetections++;
            const errorText = await response.text().catch(() => 'Unknown error');
            console.warn(`[SAM3] ❌ API returned ${response.status} for prompt "${prompt}":`, errorText.substring(0, 200));
          }
        } catch (err) {
          // Continue with next prompt if one fails
          failedDetections++;
          console.warn(`[SAM3] ❌ Failed to detect with prompt "${prompt}":`, err?.message || String(err));
        }
      }));
    }
    
    console.log(`[SAM3] Detection summary: ${successfulDetections} successful, ${failedDetections} failed/no-match`);
    
    // Convert to array, sorted by confidence score (highest first)
    let objects = Array.from(detectedObjects.entries())
      .sort((a, b) => b[1] - a[1]) // Sort by confidence descending
      .map(([object]) => object); // Extract just the object names

    // Remove duplicates and sort
    objects = [...new Set(objects)].sort();

    console.log('[SAM3] Detected objects:', objects.length, objects.slice(0, 5));

    const resultPayload = { 
      success: true, 
      objects: objects,
      count: objects.length
    };

    detectionCache.set(imageUrl, { timestamp: Date.now(), result: resultPayload });

    return res.status(200).json(resultPayload);

  } catch (error) {
    const errorMessage = error?.message || String(error) || 'Unknown error';
    console.error('[SAM3] detect error:', errorMessage);
    // Graceful fallback - return empty array so UI doesn't break
    // Always return 200 status to prevent UI errors
    try {
      return res.status(200).json({ 
        success: true, 
        objects: [],
        error: errorMessage
      });
    } catch (resError) {
      // If response already sent, log and return
      const resErrorMessage = resError?.message || String(resError) || 'Unknown response error';
      console.error('[SAM3] Failed to send error response:', resErrorMessage);
      return;
    }
  }
}

export default withApiAccess(handler, "/api/fal/sam3-detect");
