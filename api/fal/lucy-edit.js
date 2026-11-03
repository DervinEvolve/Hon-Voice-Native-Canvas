import { withApiAccess } from "../_lib/api-access.js";
import { jobTokenIssuer, sendJobOwnershipError } from "../_lib/job-ownership.js";
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
      console.log(`[AI] lucy-edit retry ${attempt + 1}/${maxRetries} after ${delay}ms`);
      await sleep(delay);
    }
  }
  throw lastError;
}

 async function handler(req, res, context) {
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

  // Check job ownership signing before any provider call.
  let issueJobToken;
  try { issueJobToken = jobTokenIssuer(context?.actor, 'fal/lucy-edit'); }
  catch (error) { return sendJobOwnershipError(res, error); }

  try {
    const falApiKey = process.env.FAL_API_KEY;
    if (!falApiKey) {
      console.error('FAL_API_KEY environment variable not set');
      return res.status(500).json({ error: 'Service configuration error' });
    }
    fal.config({ credentials: falApiKey });

    const { video_url, prompt } = req.body || {};
    if (!video_url || typeof video_url !== 'string') {
      return res.status(400).json({ error: 'Missing required field: video_url' });
    }
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Missing required field: prompt' });
    }

    console.log('[AI] lucy-edit submit', { video_url: video_url.substring(0, 50), prompt: prompt.substring(0, 100) });

    // Submit to fal queue
    const submit = await withRetry(async () => {
      return await fal.queue.submit("decart/lucy-edit/fast", {
        input: {
          video_url,
          prompt
        }
      });
    });

    const requestId = submit?.request_id;
    if (!requestId) {
      throw new Error('Submit failed: no request_id returned');
    }

    console.log('[AI] lucy-edit queued', { requestId });

    // Return request ID for polling - the frontend will poll for status
    return res.status(200).json({
      success: true,
      id: issueJobToken(requestId),
      status: 'processing'
    });
  } catch (error) {
    const status = (error && error.status) || 500;
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[AI] lucy-edit error:', { status, message });

    let userMessage = message;
    if (status === 504 || message.includes('timeout')) {
      userMessage = 'Video editing service is currently busy. Please try again in a moment.';
    } else if (status === 503 || status === 502) {
      userMessage = 'Video editing service is temporarily unavailable. Please try again.';
    }

    return res.status(status === 504 ? 504 : 500).json({ success: false, error: userMessage });
  }
}

export default withApiAccess(handler, "/api/fal/lucy-edit");
