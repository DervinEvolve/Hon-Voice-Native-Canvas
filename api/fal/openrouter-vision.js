import { withApiAccess } from "../_lib/api-access.js";
import { fal } from "@fal-ai/client";

/**
 * OpenRouter Vision API endpoint
 * https://fal.ai/models/openrouter/router/vision/api
 * 
 * Run any VLM (Vision Language Model) with fal, powered by OpenRouter.
 * Default model: Qwen VL for rich scene understanding.
 */
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

    const {
      image_urls,
      image_url, // single image fallback
      prompt,
      system_prompt,
      model,
      temperature,
      max_tokens,
      reasoning
    } = req.body || {};

    // Normalize to array
    const urls = Array.isArray(image_urls) 
      ? image_urls 
      : (image_url ? [image_url] : []);

    if (urls.length === 0) {
      return res.status(400).json({ error: 'Missing required field: image_urls or image_url' });
    }

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Missing required field: prompt' });
    }

    // Default to qwen3-vl-235b for best quality scene understanding
    const selectedModel = model || 'qwen/qwen3-vl-235b-a22b-instruct';

    const result = await fal.subscribe("openrouter/router/vision", {
      input: {
        image_urls: urls.filter(u => typeof u === 'string' && u.startsWith('http')),
        prompt,
        model: selectedModel,
        ...(system_prompt && { system_prompt }),
        ...(temperature !== undefined && { temperature }),
        ...(max_tokens && { max_tokens }),
        ...(reasoning !== undefined && { reasoning })
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === 'IN_PROGRESS') {
          try {
            const logs = (update.logs || []).map(l => l.message);
            console.log('[OpenRouter Vision] progress:', logs);
          } catch {}
        }
      }
    });

    const output = result?.data?.output;
    if (!output) {
      return res.status(500).json({ error: 'No output from OpenRouter Vision' });
    }

    return res.status(200).json({
      success: true,
      output,
      usage: result?.data?.usage,
      model: selectedModel
    });
  } catch (error) {
    console.error('[OpenRouter Vision] API error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

export default withApiAccess(handler, "/api/fal/openrouter-vision");
