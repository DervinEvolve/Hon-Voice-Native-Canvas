/**
 * SAM3 Mask Generation Service
 * Generates segmentation masks for precise object editing
 * Includes caching to prevent duplicate expensive API calls
 */

export interface SAM3MaskResult {
  success: boolean;
  mask_url?: string | null;
  mask_data?: {
    index: number;
    score: number;
    box: number[]; // [x_min, y_min, x_max, y_max]
    rle?: any; // Run-Length Encoding data
  };
  error?: string;
}

export type SAM3MaskRequestMode = 'visual' | 'editing';

export interface GenerateMaskOptions {
  mode?: SAM3MaskRequestMode;
}

// Cache to prevent duplicate mask generation calls
const maskCache = new Map<string, { result: SAM3MaskResult; timestamp: number }>();
const MASK_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const pendingMasks = new Set<string>(); // Track in-flight requests

/**
 * Generate a segmentation mask for a specific object in an image
 * @param imageUrl - URL of the image
 * @param textPrompt - Object to segment (e.g., "car", "person")
 * @param detectionThreshold - Confidence threshold (0.0-1.0)
 * @returns Mask result with mask_url or mask_data
 */
export async function generateMask(
  imageUrl: string,
  textPrompt: string,
  detectionThreshold: number = 0.3,
  options?: GenerateMaskOptions
): Promise<SAM3MaskResult> {
  if (!imageUrl || !textPrompt) {
    return {
      success: false,
      error: 'Missing required parameters'
    };
  }

  const mode: SAM3MaskRequestMode = options?.mode || 'editing';

  // Create cache key: imageUrl + textPrompt + threshold
  const cacheKey = `${imageUrl}|${textPrompt}|${detectionThreshold}|${mode}`;

  // Check cache first
  const cached = maskCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < MASK_CACHE_TTL) {
    console.log(`[SAM3] Using cached mask for "${textPrompt}"`);
    return cached.result;
  }

  // Prevent duplicate concurrent requests
  if (pendingMasks.has(cacheKey)) {
    console.log(`[SAM3] Mask request already in flight for "${textPrompt}", waiting...`);
    // Wait for existing request to complete
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const cached = maskCache.get(cacheKey);
        if (cached) {
          clearInterval(checkInterval);
          pendingMasks.delete(cacheKey);
          resolve(cached.result);
        } else if (!pendingMasks.has(cacheKey)) {
          // Request failed or was cancelled
          clearInterval(checkInterval);
          resolve({
            success: false,
            error: 'Mask generation request was cancelled or failed'
          });
        }
      }, 100);
      
      // Timeout after 30 seconds
      setTimeout(() => {
        clearInterval(checkInterval);
        pendingMasks.delete(cacheKey);
        resolve({
          success: false,
          error: 'Mask generation timeout'
        });
      }, 30000);
    });
  }

  pendingMasks.add(cacheKey);

  try {
    const response = await fetch('/api/fal/sam3-mask', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        imageUrl,
        text_prompt: textPrompt,
        detection_threshold: detectionThreshold,
        mode
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn('[SAM3] Mask generation failed:', response.status, errorText);
      pendingMasks.delete(cacheKey);
      return {
        success: false,
        error: errorText || 'Mask generation failed'
      };
    }

    const data = await response.json();
    
    // Cache successful results
    if (data.success) {
      maskCache.set(cacheKey, { result: data, timestamp: Date.now() });
      console.log(`[SAM3] Cached mask for "${textPrompt}"`);
    }
    
    pendingMasks.delete(cacheKey);
    return data;
  } catch (error) {
    console.error('[SAM3] Mask generation error:', error);
    pendingMasks.delete(cacheKey);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Helper function to edit an image with SAM3 mask targeting
 * Generates mask and passes to Seedream for precise editing
 */
export async function editWithMask(
  imageUrl: string,
  editPrompt: string,
  targetObject: string,
  options?: {
    detectionThreshold?: number;
    negativePrompt?: string;
    strength?: number;
  }
): Promise<string> {
  // 1. Generate mask for target object
  const maskResult = await generateMask(
    imageUrl,
    targetObject,
    options?.detectionThreshold || 0.3,
    { mode: 'editing' }
  );

  if (!maskResult.success || !maskResult.mask_url) {
    throw new Error(`Failed to generate mask for "${targetObject}": ${maskResult.error || 'Unknown error'}`);
  }

  // 2. Edit with Seedream using mask
  const { seedreamService } = await import('./seedreamService');
  return seedreamService.editImage(editPrompt, {
    image_url: imageUrl,
    mask_url: maskResult.mask_url,
    negative_prompt: options?.negativePrompt,
    strength: options?.strength
  });
}

