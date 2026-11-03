import { withApiAccess } from "../_lib/api-access.js";
import { fal } from "@fal-ai/client";

// Helper to sleep for retry backoff
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Retry wrapper for transient failures (504, 502, 503)
async function withRetry(fn, maxRetries = 2, baseDelay = 2000) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const status = error?.status || error?.statusCode || 0;
      const isRetryable = [502, 503, 504].includes(status) ||
                          error?.message?.includes('timeout') ||
                          error?.message?.includes('ETIMEDOUT');

      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }

      const delay = baseDelay * Math.pow(2, attempt);
      console.log(`[AI] nano-banana-edit retry ${attempt + 1}/${maxRetries} after ${delay}ms`);
      await sleep(delay);
    }
  }
  throw lastError;
}

 async function handler(req, res) {
  // CORS
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
    const falApiKey = process.env.FAL_API_KEY;
    if (!falApiKey) {
      console.error('FAL_API_KEY environment variable not set');
      return res.status(500).json({ error: 'Service configuration error' });
    }
    fal.config({ credentials: falApiKey });

    const { prompt, image_urls, num_images } = req.body || {};
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Missing required field: prompt' });
    }
    if (!Array.isArray(image_urls) || image_urls.length === 0) {
      return res.status(400).json({ error: 'Missing required field: image_urls' });
    }

    // Telemetry: log reference usage (count + small sample)
    try {
      const sample = image_urls.slice(0, 3).map(u => typeof u === 'string' ? `${u.substring(0, 72)}…` : u);
      console.log('[AI] nano-banana-edit submit', { ref_count: image_urls.length, sample });
    } catch {}

    const result = await withRetry(async () => {
      return await fal.subscribe("fal-ai/nano-banana-pro/edit", {
        input: {
          prompt,
          image_urls,
          ...(typeof num_images === 'number' && num_images > 0 ? { num_images } : {})
        },
        logs: true,
        onQueueUpdate: (update) => {
          if (update.status === 'IN_PROGRESS') {
            try {
              const logs = (update.logs || []).map(l => l.message);
              console.log('[AI] image_edit progress', logs);
            } catch {}
          }
        }
      });
    });

    const images = result?.data?.images || [];
    if (!Array.isArray(images) || images.length === 0) {
      return res.status(500).json({ error: 'No images returned' });
    }

    try { console.log('[AI] nano-banana-edit complete', { out_count: images.length }); } catch {}

    return res.status(200).json({ success: true, images, prompt });
  } catch (error) {
    // Surface 504s or upstream errors clearly
    const status = (error && error.status) || 500;
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[AI] image_edit error:', { status, message });

    // Provide user-friendly error messages for common issues
    let userMessage = message;
    if (status === 504 || message.includes('timeout')) {
      userMessage = 'Image editing service is currently busy. Please try again in a moment.';
    } else if (status === 503 || status === 502) {
      userMessage = 'Image editing service is temporarily unavailable. Please try again.';
    }

    return res.status(status === 504 ? 504 : 500).json({ success: false, error: userMessage });
  }
}

export default withApiAccess(handler, "/api/fal/nano-banana-edit");
