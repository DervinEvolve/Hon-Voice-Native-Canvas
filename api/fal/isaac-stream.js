import { withApiAccess } from "../_lib/api-access.js";
import { fal } from "@fal-ai/client";

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
    const { imageUrl, prompt, response_style } = req.body || {};
    if (!imageUrl) {
      return res.status(400).json({ error: 'Missing imageUrl parameter' });
    }

    const falApiKey = process.env.FAL_API_KEY;
    if (!falApiKey) {
      console.error('FAL_API_KEY environment variable not set (server-side only)');
      return res.status(500).json({ error: 'Service configuration error' });
    }

    fal.config({ credentials: falApiKey });

    // Prepare SSE
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    const stream = await fal.stream("perceptron/isaac-01", {
      input: {
        image_url: imageUrl,
        prompt: prompt || 'Describe salient objects and relations.',
        response_style: response_style || 'text'
      }
    });

    try {
      let hasAnyOutput = false;
      let eventCount = 0;
      
      // Log the request details for debugging
      console.log(`[Isaac] 👁️ Starting analysis for image: ${imageUrl.substring(0, 80)}...`);
      console.log(`[Isaac] Request params:`, { prompt, response_style });
      
      for await (const event of stream) {
        eventCount++;
        
        // Debug: Log raw event structure
        if (eventCount === 1) {
          console.log(`[Isaac] First event received (raw):`, typeof event, event);
          console.log(`[Isaac] First event (stringified):`, JSON.stringify(event).substring(0, 300));
        }
        
        // Handle streaming events - Isaac streams can be:
        // 1. String chunks (direct text output)
        // 2. Objects with 'output' field
        // 3. Objects with 'text' field
        // 4. Objects with 'delta' field (OpenAI-style)
        let payload;
        let outputText = null;
        
        if (typeof event === 'string') {
          // Direct string chunk
          outputText = event;
          payload = { output: event, partial: true };
        } else if (typeof event === 'object') {
          // Object event - check multiple possible fields
          outputText = event.output || event.text || event.delta?.content || event.content || null;
          payload = {
            ...event,
            output: outputText || event.output || '',
            partial: event.partial !== false // Default to true unless explicitly false
          };
        } else {
          // Fallback: convert to string
          outputText = String(event);
          payload = { output: outputText, partial: true };
        }
        
        // Log Isaac output being sent to Hon
        if (outputText) {
          hasAnyOutput = true;
          console.log(`[Isaac] 📤 Streaming to Hon: "${outputText.substring(0, 200)}${outputText.length > 200 ? '...' : ''}"`);
        }
        
        try {
          const logSummary = {
            kind: 'isaac-partial',
            hasOutput: !!(payload?.output || payload?.text),
            boxes: Array.isArray(payload?.boxes) ? payload.boxes.length : 0,
            points: Array.isArray(payload?.points) ? payload.points.length : 0,
            polygons: Array.isArray(payload?.polygons) ? payload.polygons.length : 0,
          };
          console.log(JSON.stringify(logSummary));
        } catch {}
        res.write(`event: isaac-partial\n`);
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      }
      
      console.log(`[Isaac] Stream completed. Total events: ${eventCount}`);
      const result = await stream.done();
      
      // Debug: Log full result structure
      console.log(`[Isaac] Final result structure:`, JSON.stringify(result).substring(0, 300));
      
      // Check multiple possible output fields
      const finalOutput = result?.data?.output || result?.data?.text || result?.output || result?.text;
      
      // Log final Isaac result
      if (finalOutput) {
        console.log(`[Isaac] ✅ Final analysis sent to Hon: "${finalOutput.substring(0, 200)}${finalOutput.length > 200 ? '...' : ''}"`);
        hasAnyOutput = true;
      } else if (!hasAnyOutput) {
        console.warn(`[Isaac] ⚠️ No output received from Isaac for image: ${imageUrl.substring(0, 50)}...`);
        console.warn(`[Isaac] Full result:`, JSON.stringify(result).substring(0, 500));
      }
      
      try {
        const finalOutput = result?.data?.output || result?.data?.text || result?.output || result?.text;
        const logSummary = {
          kind: 'isaac-final',
          hasOutput: !!finalOutput,
          boxes: Array.isArray(result?.data?.boxes) ? result.data.boxes.length : 0,
          points: Array.isArray(result?.data?.points) ? result.data.points.length : 0,
          polygons: Array.isArray(result?.data?.polygons) ? result.data.polygons.length : 0,
        };
        console.log(JSON.stringify(logSummary));
      } catch {}
      res.write(`event: isaac-final\n`);
      res.write(`data: ${JSON.stringify(result?.data || result || {})}\n\n`);
      res.end();
    } catch (err) {
      res.write(`event: isaac-error\n`);
      res.write(`data: ${JSON.stringify({ error: err?.message || 'stream error' })}\n\n`);
      res.end();
    }
  } catch (error) {
    console.error('[AI] isaac_stream error:', error);
    // Fall back to a standard response so callers can handle errors gracefully
    try {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });
      res.write(`event: isaac-error\n`);
      res.write(`data: ${JSON.stringify({ error: error?.message || 'unknown error' })}\n\n`);
      res.end();
    } catch {
      // If SSE headers already sent failed, send JSON
      if (!res.headersSent) {
        return res.status(500).json({ error: 'isaac_stream failure' });
      }
    }
  }
}

export default withApiAccess(handler, "/api/fal/isaac-stream");
