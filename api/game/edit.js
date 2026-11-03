import { withApiAccess } from "../_lib/api-access.js";
import { checkedModelName } from "../_lib/model-names.js";
/**
 * Game code editing endpoint - non-streaming fallback
 * Returns edited game code based on existing code + edit prompt
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

  const systemPrompt = `You are an expert Three.js game developer. You will receive existing game code and instructions to modify it.

CRITICAL RULES:
1. Return ONLY the complete modified JavaScript code - no markdown, no explanations, no code fences
2. Preserve all working functionality from the original code unless explicitly asked to change it
3. The code runs inside a sandbox with these globals: THREE, scene, camera, controls
4. Animation must use scene.userData.update = (ctx) => { /* per-frame logic */ }
5. ctx contains: { deltaTime, dt, time, input, inputs, scene, camera, THREE }
6. IMPORTANT: Do NOT declare 'deltaTime' or 'dt' - they are already provided in ctx. Use ctx.deltaTime or ctx.dt
7. Never import modules, never call renderer.render(), never use DOM APIs
8. Keep the code clean and well-structured
9. If adding features, integrate them smoothly with existing code

EXISTING CODE:
\`\`\`javascript
${existingCode}
\`\`\`

EDIT INSTRUCTIONS: ${editPrompt}

Return the complete modified game code:`;

  try {
    let gameCode = '';

    if (provider === 'claude') {
      const anthropicKey = process.env.ANTHROPIC_API_KEY;
      if (!anthropicKey) {
        return res.status(500).json({ error: 'Claude API key not configured' });
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
          max_tokens: 8192,
          messages: [{ role: 'user', content: systemPrompt }],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[game/edit] Claude error:', errorText);
        return res.status(500).json({ error: 'Claude API error' });
      }

      const data = await response.json();
      gameCode = data?.content?.[0]?.text || '';
    } else {
      // Gemini
      const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
      if (!geminiKey) {
        return res.status(500).json({ error: 'Gemini API key not configured' });
      }

      const geminiModel = checkedModelName('gemini', model, 'gemini-3-pro-preview');
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: systemPrompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 8192,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[game/edit] Gemini error:', errorText);
        return res.status(500).json({ error: 'Gemini API error' });
      }

      const data = await response.json();
      gameCode = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }

    // Clean up the code - remove markdown fences if present
    gameCode = gameCode
      .replace(/^```javascript\s*/i, '')
      .replace(/^```js\s*/i, '')
      .replace(/^```\s*/, '')
      .replace(/\s*```$/, '')
      .trim();

    return res.status(200).json({ gameCode });
  } catch (error) {
    console.error('[game/edit] Error:', error);
    return res.status(500).json({ error: error.message || 'Unknown error' });
  }
}

export default withApiAccess(handler, "/api/game/edit");
