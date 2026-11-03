import { withApiAccess } from "../_lib/api-access.js";
import Anthropic from '@anthropic-ai/sdk';
import { GAME_GENERATION_SYSTEM_PROMPT } from '../../src/lib/gamePrompts.js';

 async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { code, error: errorMsg, errors: errorsArray, mode } = req.body;
    
    if (!code) {
      return res.status(400).json({ error: 'Missing code to repair' });
    }

    // Support both singular error and errors array
    const errorToFix = errorMsg || (errorsArray && errorsArray.length > 0 ? errorsArray.join('; ') : 'Code validation failed');
    console.log('[game.repair] Attempting to fix code error:', errorToFix);

    const claudeKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
    if (!claudeKey) {
      return res.status(500).json({ error: 'Claude API key not configured' });
    }

    const anthropic = new Anthropic({ apiKey: claudeKey });

    const normalizedMode = typeof mode === 'string' ? mode.toLowerCase() : 'repair';
    const isRewrite = normalizedMode === 'rewrite';
    const instructions = isRewrite
      ? `REWRITE SPECIFIC INSTRUCTIONS:
- The previous attempt failed with: ${errorToFix}.
- Start fresh with completely new code that still fulfills the user's game request (WASD movement, score HUD, etc.).
- Do NOT reuse the prior structure; build a clean, production-ready version.
- Return ONLY the final JavaScript code, no explanations.`
      : `REPAIR SPECIFIC INSTRUCTIONS:
- You are repairing broken code. Fix the error while keeping the same game concept.
- Return ONLY the fixed JavaScript code, no explanations.
- The error to fix is: ${errorToFix}`;

    // Use the same prompt as generation to ensure consistency
    const systemPrompt = `${GAME_GENERATION_SYSTEM_PROMPT}

${instructions}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4000,  // Increased to match generation
      temperature: 0.3,
      // CACHED SYSTEM PROMPT
      system: [
        {
          type: "text",
          text: systemPrompt,
          cache_control: { type: "ephemeral" }
        }
      ],
      messages: [{
        role: 'user',
        content: `Fix this broken Three.js game code.

ERROR: ${errorToFix || 'Code execution failed'}

BROKEN CODE:
\`\`\`javascript
${code}
\`\`\`

FIXED CODE:`
      }]
    });
    
    // Log cache usage
    if (response.usage) {
      const usage = response.usage;
      console.log(`[game.repair] Cache stats: created=${usage.cache_creation_input_tokens || 0} read=${usage.cache_read_input_tokens || 0} hit=${usage.cache_read_input_tokens > 0 ? 'YES' : 'NO'}`);
    }

    let fixedCode = response.content[0].text.trim();
    
    // Clean markdown
    fixedCode = fixedCode.replace(/^```(?:javascript)?\n?/gm, '');
    fixedCode = fixedCode.replace(/\n?```$/gm, '');
    fixedCode = fixedCode.trim();

      console.log('[game.repair] Repair complete, mode=%s code length: %d', normalizedMode, fixedCode.length);

    return res.status(200).json({ 
      gameCode: fixedCode,
      success: true
    });

  } catch (error) {
    console.error('[game.repair] Repair failed:', error);
    return res.status(500).json({ 
      error: 'Repair failed',
      success: false
    });
  }
}

export default withApiAccess(handler, "/api/game/repair");
