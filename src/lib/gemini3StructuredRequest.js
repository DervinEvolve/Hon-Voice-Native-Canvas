import { GEMINI3_SYSTEM_PROMPT, generateGemini3Prompt } from './gemini3GamePrompts.js';
import { extractGeminiGameSpec, buildGeminiGameCodeFromSpec } from './gemini3GameBuilder.js';

export async function requestStructuredGeminiGame({
  description,
  customAssets = {},
  temperature = 0.75,
  maxTokens = 4096,
  requestId = 'unknown',
  maxAttempts = 2,
  onAttempt,
  onChunk
}) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      onAttempt?.(attempt);
      const prompt = generateGemini3Prompt(description, customAssets);
      const noncePrompt = `${prompt}\n\n[request_id:${requestId}-attempt:${attempt}-ts:${Date.now()}]`;
      const rawResponse = await generateGemini3Content(noncePrompt, GEMINI3_SYSTEM_PROMPT, {
        thinking_level: 'high',
        temperature,
        max_tokens: maxTokens
      }, onChunk);
      const sliced = extractBalancedJson(rawResponse);
      const spec = extractGeminiGameSpec(sliced);
      if (spec.thought_process) {
        const preview = String(spec.thought_process).slice(0, 280).replace(/\s+/g, ' ').trim();
        console.log(`[gemini structured][${requestId}] thought_process: ${preview}`);
        delete spec.thought_process;
      }
      const code = buildGeminiGameCodeFromSpec(spec);
      return { code, spec };
    } catch (error) {
      lastError = error;
      console.error(`[gemini structured][${requestId}] Attempt ${attempt} failed:`, error?.message || error);
      if (attempt === maxAttempts) break;
    }
  }
  throw lastError || new Error('Gemini structured generation failed');
}

const GEMINI_REQUEST_TIMEOUT_MS = 300000;

const fetchWithTimeout = async (url, options = {}, timeoutMs = GEMINI_REQUEST_TIMEOUT_MS) => {
  const controller = new AbortController();
  const userSignal = options?.signal;

  if (userSignal) {
    if (userSignal.aborted) {
      controller.abort(userSignal.reason);
    } else {
      userSignal.addEventListener(
        'abort',
        (event) => controller.abort(event?.currentTarget?.reason),
        { once: true }
      );
    }
  }

  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error(`Gemini fetch aborted after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
};

async function generateGemini3Content(prompt, systemInstruction, options = {}, onChunk) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable not set');
  }

  const {
    thinking_level = 'high',
    temperature = 0.4,
    max_tokens = 4000,
    request_timeout_ms = GEMINI_REQUEST_TIMEOUT_MS
  } = options;

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent';

  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      maxOutputTokens: max_tokens
    }
  };

  if (thinking_level === 'high') {
    requestBody.generationConfig.thinkingConfig = { thinkingLevel: 'HIGH' };
  }

  if (systemInstruction) {
    requestBody.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  const response = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify(requestBody)
    },
    request_timeout_ms
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini 3 API error: ${response.status} - ${errorText}`);
  }

  if (!response.body) {
    throw new Error('Gemini 3 API returned empty body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (value) {
      const chunkText = decoder.decode(value, { stream: !done });
      buffer += chunkText;
      if (chunkText.length) {
        try { onChunk?.(chunkText); } catch {}
      }
    }
    if (done) break;
  }

  const balancedBuffer = extractBalancedJson(buffer);
  let data;
  try {
    data = JSON.parse(balancedBuffer);
  } catch (err) {
    const preview = balancedBuffer.slice(0, 200).replace(/\s+/g, ' ');
    throw new Error(`Gemini 3 API returned non-JSON response (preview="${preview}"): ${(err && err.message) || err}`);
  }

  if (data.error) {
    throw new Error(data.error.message || 'Unknown error');
  }

  if (Array.isArray(data.candidates) && data.candidates.length > 0) {
    const candidate = data.candidates[0];
    if (candidate?.content?.parts) {
      const joined = candidate.content.parts.map((part) => part.text || '').join('');
      return extractBalancedJson(joined);
    }
  }

  throw new Error('Gemini 3 API returned no text');
}

function extractBalancedJson(text = '') {
  if (!text) return text;
  const start = text.indexOf('{');
  if (start === -1) return text;
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (char === '\\') {
        escapeNext = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return text.slice(start);
}
