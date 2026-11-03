import { withApiAccess } from "../_lib/api-access.js";
import { checkedModelName } from "../_lib/model-names.js";
/**
 * Game code editing endpoint - streams edited game code based on existing code + edit prompt
 * Supports Gemini and Claude models
 */

 async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { existingCode, editPrompt, provider = 'gemini', model } = req.body;
  if (!['gemini', 'claude'].includes(provider) || checkedModelName(provider, model, 'default') === null) {
    return res.status(400).json({ error: 'Unsupported provider or model' });
  }

  if (!existingCode || !editPrompt) {
    return res.status(400).json({ error: 'Missing existingCode or editPrompt' });
  }

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const systemPrompt = `You are an expert Three.js game developer. You will receive existing game code and instructions to modify it.

=== CRITICAL: SANDBOX ENVIRONMENT ===
The code runs in a SANDBOXED iframe with PRE-EXISTING globals:
- THREE, scene, camera, input are ALREADY PROVIDED - do NOT declare them
- Animation uses scene.userData.update = function(ctx) { ... }
- ctx contains: { deltaTime, dt, time, input, inputs, scene, camera, THREE }

FORBIDDEN (will cause errors):
- const scene = new THREE.Scene()
- const camera = new THREE.PerspectiveCamera()
- new THREE.WebGLRenderer()
- renderer.render()
- requestAnimationFrame()
- Declaring deltaTime or dt as variables (use ctx.deltaTime or ctx.dt)

CRITICAL RULES:
1. Return ONLY the complete modified JavaScript code - no markdown, no explanations, no code fences
2. Preserve all working functionality unless explicitly asked to change it
3. Use ctx.deltaTime or ctx.dt for time-based movement (already provided in update context)
4. Use ctx.input.keys for keyboard input (e.g., ctx.input.keys.KeyW, ctx.input.keys.Space)
5. Keep scene.userData.update and scene.userData.cleanup functions
6. VERIFY: Every { has matching }, every ( has matching ), every [ has matching ]
7. NEVER output incomplete code - always complete all statements and blocks

EXISTING CODE:
\`\`\`javascript
${existingCode}
\`\`\`

EDIT INSTRUCTIONS: ${editPrompt}

Return the complete modified game code:`;

  let accumulatedCode = '';

  try {
    if (provider === 'claude') {
      // Use Claude API
      const anthropicKey = process.env.ANTHROPIC_API_KEY;
      if (!anthropicKey) {
        res.write(`data: ${JSON.stringify({ event: 'error', message: 'Claude API key not configured' })}\n\n`);
        res.end();
        return;
      }

      const claudeModel = checkedModelName('claude', model, 'claude-opus-4-5-20251101');
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: claudeModel,
          max_tokens: 16000,
          stream: true,
          messages: [{ role: 'user', content: systemPrompt }],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[game/edit-stream] Claude error:', errorText);
        res.write(`data: ${JSON.stringify({ event: 'error', message: 'Claude API error' })}\n\n`);
        res.end();
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                accumulatedCode += parsed.delta.text;
                res.write(`data: ${JSON.stringify({ event: 'delta', text: parsed.delta.text })}\n\n`);
              }
            } catch {}
          }
        }
      }
    } else {
      // Use Gemini API (default)
      const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
      if (!geminiKey) {
        res.write(`data: ${JSON.stringify({ event: 'error', message: 'Gemini API key not configured' })}\n\n`);
        res.end();
        return;
      }

      const geminiModel = checkedModelName('gemini', model, 'gemini-3-pro-preview');
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:streamGenerateContent?alt=sse`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: systemPrompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 16000,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[game/edit-stream] Gemini error:', errorText);
        res.write(`data: ${JSON.stringify({ event: 'error', message: 'Gemini API error' })}\n\n`);
        res.end();
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            try {
              const parsed = JSON.parse(data);
              const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
              if (text) {
                accumulatedCode += text;
                res.write(`data: ${JSON.stringify({ event: 'delta', text })}\n\n`);
              }
            } catch {}
          }
        }
      }
    }

    // Clean up accumulated code
    let cleanedCode = accumulatedCode
      .replace(/^```javascript\s*/i, '')
      .replace(/^```js\s*/i, '')
      .replace(/^```\s*/, '')
      .replace(/\s*```$/, '')
      .trim();

    // Check for incomplete code (unbalanced braces)
    const openBraces = (cleanedCode.match(/\{/g) || []).length;
    const closeBraces = (cleanedCode.match(/\}/g) || []).length;
    const openParens = (cleanedCode.match(/\(/g) || []).length;
    const closeParens = (cleanedCode.match(/\)/g) || []).length;

    if (openBraces !== closeBraces || openParens !== closeParens) {
      console.warn(`[game/edit-stream] Incomplete code detected! Braces: ${openBraces}/${closeBraces}, Parens: ${openParens}/${closeParens}`);
      // Fall back to original code with a warning
      res.write(`data: ${JSON.stringify({ event: 'warning', message: 'Generated code was incomplete, using original code' })}\n\n`);
      res.write(`data: ${JSON.stringify({ event: 'replace', text: existingCode })}\n\n`);
    } else if (cleanedCode !== accumulatedCode) {
      // Send cleaned code as replacement
      res.write(`data: ${JSON.stringify({ event: 'replace', text: cleanedCode })}\n\n`);
    }

    res.write(`data: ${JSON.stringify({ event: 'done' })}\n\n`);
    res.end();
  } catch (error) {
    console.error('[game/edit-stream] Error:', error);
    res.write(`data: ${JSON.stringify({ event: 'error', message: error.message || 'Unknown error' })}\n\n`);
    res.end();
  }
}

export default withApiAccess(handler, "/api/game/edit-stream");
