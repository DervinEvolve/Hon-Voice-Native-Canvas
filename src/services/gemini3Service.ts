/**
 * Gemini 3 Pro Service for game generation
 * Uses Google's Gemini API directly (not Replicate) for better control and features
 */

export interface Gemini3Options {
  thinking_level?: 'low' | 'high';
  temperature?: number;
  max_tokens?: number;
}

export interface Gemini3StreamChunk {
  text?: string;
  done?: boolean;
  error?: string;
}

/**
 * Generate content with Gemini 3 Pro
 * @param prompt - The prompt to send
 * @param systemInstruction - Optional system instruction
 * @param options - Generation options
 * @returns Async generator yielding text chunks
 */
export async function* generateWithGemini3(
  prompt: string,
  systemInstruction?: string,
  options: Gemini3Options = {}
): AsyncGenerator<Gemini3StreamChunk, void, unknown> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable not set');
  }

  const {
    thinking_level = 'high', // Use high thinking for complex game generation
    temperature = 0.4,
    max_tokens = 4000
  } = options;

  // Use header for API key (recommended by Google docs)
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:streamGenerateContent`;

  const requestBody: any = {
    contents: [{
      parts: [{ text: prompt }]
    }],
    generationConfig: {
      temperature,
      maxOutputTokens: max_tokens
    }
  };

  // Add thinking config if high thinking is requested
  // Note: If thinking_level is not specified, Gemini 3 defaults to 'high'
  if (thinking_level === 'high') {
    requestBody.generationConfig.thinkingConfig = {
      thinkingLevel: 'HIGH'
    };
  }

  if (systemInstruction) {
    requestBody.systemInstruction = {
      parts: [{ text: systemInstruction }]
    };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini 3 API error: ${response.status} - ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body reader available');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let chunkBuffer = '';
  let loggedFirstChunk = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        yield { done: true };
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        if (line.startsWith('data:')) {
          line = line.slice(5).trim();
          if (!line || line === '[DONE]') {
            continue;
          }
        }

        if (chunkBuffer) {
          chunkBuffer += '\n';
        }
        chunkBuffer += line;

        let parsed: any = null;
        try {
          parsed = JSON.parse(chunkBuffer);
          chunkBuffer = '';
        } catch (parseErr) {
          // Wait for more data before attempting to parse again
          if (chunkBuffer.length > 500000) {
            console.warn('[gemini.stream] dropping oversized partial chunk');
            chunkBuffer = '';
          }
          continue;
        }

        if (!loggedFirstChunk) {
          console.debug('[gemini.stream] first chunk', JSON.stringify(parsed).slice(0, 200));
          loggedFirstChunk = true;
        }

        if (Array.isArray(parsed?.candidates)) {
          for (const candidate of parsed.candidates) {
            const contentNodes: any[] = Array.isArray(candidate?.content)
              ? candidate.content
              : (candidate?.content ? [candidate.content] : []);

            for (const node of contentNodes) {
              const parts: any[] = Array.isArray(node?.parts) ? node.parts : [];
              for (const part of parts) {
                if (typeof part?.text === 'string' && part.text.length > 0) {
                  yield { text: part.text };
                }
              }
            }
          }
        }

        if (parsed?.error) {
          yield { error: parsed.error.message || 'Unknown error' };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Generate content with Gemini 3 Pro (non-streaming)
 */
export async function generateWithGemini3NonStream(
  prompt: string,
  systemInstruction?: string,
  options: Gemini3Options = {}
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable not set');
  }

  const {
    thinking_level = 'high',
    temperature = 0.4,
    max_tokens = 4000
  } = options;

  // Use header for API key (recommended by Google docs)
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent`;

  const requestBody: any = {
    contents: [{
      parts: [{ text: prompt }]
    }],
    generationConfig: {
      temperature,
      maxOutputTokens: max_tokens
    }
  };

  // Add thinking config if high thinking is requested
  // Note: If thinking_level is not specified, Gemini 3 defaults to 'high'
  if (thinking_level === 'high') {
    requestBody.generationConfig.thinkingConfig = {
      thinkingLevel: 'HIGH'
    };
  }

  if (systemInstruction) {
    requestBody.systemInstruction = {
      parts: [{ text: systemInstruction }]
    };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini 3 API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  
  if (data.error) {
    throw new Error(data.error.message || 'Unknown error');
  }

  // Extract text from response
  if (data.candidates && data.candidates.length > 0) {
    const candidate = data.candidates[0];
    if (candidate.content?.parts) {
      return candidate.content.parts
        .map((part: any) => part.text || '')
        .join('');
    }
  }

  throw new Error('No text content in Gemini 3 response');
}

