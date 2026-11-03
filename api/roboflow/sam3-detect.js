import { withApiAccess } from "../_lib/api-access.js";
/**
 * Roboflow SAM3 Object Detection API
 * Detects objects in images using SAM3 model via Roboflow
 * 
 * Endpoint: POST /api/roboflow/sam3-detect
 * Body: { imageUrl: string }
 * Returns: { success: true, objects: string[] }
 */

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

    const roboflowApiKey = process.env.ROBOFLOW_API_KEY;
    if (!roboflowApiKey) {
      console.warn('[SAM3] Roboflow API key not configured');
      return res.status(503).json({ success: false, objects: [], error: 'Object detection through Roboflow is not configured (ROBOFLOW_API_KEY is not set).' });
    }

    // Roboflow SAM3 Concept Segmentation endpoint
    // Documentation: https://inference.roboflow.com/foundation/sam3/
    // This endpoint uses text prompts to detect and segment objects
    // For cloud API: https://inference.roboflow.com/sam3/concept_segment
    // For local inference: http://localhost:9001/sam3/concept_segment
    
    // Roboflow SAM3 endpoint - API key in query param is standard for Roboflow
    // The 405 error suggests the endpoint might not be available or requires different format
    // Try with API key in query param (Roboflow standard)
    const endpointUrl = `https://inference.roboflow.com/sam3/concept_segment?api_key=${roboflowApiKey}`;
    
    console.log('[SAM3] Calling Roboflow endpoint:', endpointUrl);

    // SAM3 Concept Segmentation request format (from Roboflow docs):
    // - image: { type: "url", value: "..." } or { type: "base64", value: "..." }
    // - prompts: [{ type: "text", text: "object name" }]
    // 
    // For detecting multiple common objects, we use a generic prompt
    // that SAM3 can use to identify various objects in the image
    // Note: SAM3 detects objects matching the prompt, so we use common object categories
    
    const commonObjectPrompts = [
      'person', 'people', 'human',
      'vehicle', 'car', 'truck', 'bus', 'motorcycle', 'bicycle',
      'animal', 'dog', 'cat', 'bird', 'horse',
      'building', 'house', 'structure',
      'furniture', 'chair', 'table', 'sofa', 'bed',
      'food', 'fruit', 'vegetable',
      'electronic', 'phone', 'computer', 'laptop', 'television',
      'clothing', 'shirt', 'pants', 'shoe',
      'bag', 'backpack', 'purse',
      'plant', 'tree', 'flower',
      'sky', 'cloud', 'sun',
      'water', 'ocean', 'lake', 'river',
      'ground', 'grass', 'road', 'sidewalk'
    ];

    // Use a generic prompt that should detect most objects
    // SAM3 will return all instances matching these concepts
    // Note: If 405 error persists, SAM3 endpoint may not be available on Roboflow cloud yet
    const response = await fetch(endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        image: {
          type: 'url',
          value: imageUrl
        },
        prompts: commonObjectPrompts.map(text => ({
          type: 'text',
          text: text
        }))
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[SAM3] Roboflow API error:', response.status, errorText);
      
      // Report the failure instead of answering "no objects found".
      return res.status(502).json({
        success: false,
        objects: [],
        error: response.status === 404
          ? 'The Roboflow SAM3 endpoint was not found; object detection through Roboflow is not available.'
          : `Roboflow object detection failed (HTTP ${response.status}).`
      });
    }

    const data = await response.json();
    
    // SAM3 Concept Segmentation response format (from Roboflow docs):
    // Returns segmentation masks with associated concepts/prompts
    // Response structure may include:
    // - predictions: Array of detection objects
    // - Each prediction has: class/label, confidence, mask, etc.
    
    let objects = [];
    
    // Extract detected object labels from SAM3 response
    if (data.predictions && Array.isArray(data.predictions)) {
      // SAM3 returns predictions with class labels matching the prompts
      objects = data.predictions
        .map(pred => {
          // Extract class/label from prediction
          return pred.class || pred.label || pred.name || pred.concept;
        })
        .filter(Boolean)
        .filter((label, index, self) => self.indexOf(label) === index); // Remove duplicates
    } else if (Array.isArray(data)) {
      // If response is directly an array
      objects = data
        .map(item => typeof item === 'string' ? item : (item.class || item.label || item.name))
        .filter(Boolean);
    } else if (data.results && Array.isArray(data.results)) {
      // Alternative response format
      objects = data.results
        .map(r => r.class || r.label || r.name)
        .filter(Boolean);
    } else if (typeof data === 'object' && data !== null) {
      // Try to find any array containing detection results
      const keys = Object.keys(data);
      for (const key of keys) {
        if (Array.isArray(data[key]) && data[key].length > 0) {
          const firstItem = data[key][0];
          if (typeof firstItem === 'object' && (firstItem.class || firstItem.label || firstItem.name)) {
            objects = data[key]
              .map(item => item.class || item.label || item.name)
              .filter(Boolean);
            break;
          }
        }
      }
    }

    // Remove duplicates and sort
    objects = [...new Set(objects)].sort();

    console.log('[SAM3] Detected objects:', objects.length, objects.slice(0, 5));

    return res.status(200).json({ 
      success: true, 
      objects: objects,
      count: objects.length
    });

  } catch (error) {
    console.error('[SAM3] detect error:', error);
    return res.status(500).json({ success: false, objects: [], error: 'Roboflow object detection failed.' });
  }
}

export default withApiAccess(handler, "/api/roboflow/sam3-detect");
