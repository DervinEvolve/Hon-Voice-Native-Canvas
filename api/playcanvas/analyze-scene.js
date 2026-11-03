import { withApiAccess } from "../_lib/api-access.js";
/**
 * PlayCanvas Scene Analysis API
 * 
 * Uses Claude's vision capabilities to analyze what's visible in the PlayCanvas scene.
 * This gives Hon "eyes" to see the scene the way the user sees it.
 */

export const config = {
  maxDuration: 30
};

 async function handler(req, res) {
  // CORS
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
    const { intent, screenshot } = req.body;
    
    if (!screenshot) {
      return res.status(400).json({ error: 'Screenshot is required' });
    }

    // Support both CLAUDE_API_KEY and ANTHROPIC_API_KEY for flexibility
    const apiKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'CLAUDE_API_KEY or ANTHROPIC_API_KEY not configured' });
    }

    console.log('[Scene Analysis] Analyzing scene with intent:', intent?.substring(0, 100) || 'general observation');

    // Extract base64 data from data URL
    const base64Data = screenshot.includes(',') ? screenshot.split(',')[1] : screenshot;
    
    // Determine media type from data URL or default to jpeg
    let mediaType = 'image/jpeg';
    if (screenshot.startsWith('data:')) {
      const match = screenshot.match(/^data:([^;]+);/);
      if (match) mediaType = match[1];
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Data
              }
            },
            {
              type: 'text',
              text: `You are Hon, an AI assistant analyzing a 3D scene that the user is currently viewing.
${intent ? `User intent/question: "${intent}"` : 'Describe what you see.'}

Provide a helpful, concise response:
- Describe what objects are visible and their approximate positions (left/right/center, near/far, foreground/background)
- Note colors, materials, and general atmosphere
- If the user asked about something specific, focus on answering that
- If they want to modify something, identify what they're referring to
- Suggest where new objects could be placed if relevant

Keep your response conversational and under 150 words. Speak naturally as if you're looking at the scene with the user.`
            }
          ]
        }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Scene Analysis] Claude API error:', errorText);
      return res.status(500).json({ error: 'Failed to analyze scene', details: errorText });
    }

    const data = await response.json();
    const analysis = data.content?.[0]?.text || '';
    
    console.log('[Scene Analysis] Analysis complete:', analysis.substring(0, 100) + '...');

    return res.status(200).json({
      success: true,
      analysis,
      intent
    });

  } catch (error) {
    console.error('[Scene Analysis] Error:', error);
    return res.status(500).json({ 
      error: 'Internal server error', 
      message: error.message 
    });
  }
}

export default withApiAccess(handler, "/api/playcanvas/analyze-scene");
