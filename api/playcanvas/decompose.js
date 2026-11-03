import { withApiAccess } from "../_lib/api-access.js";
/**
 * Scene Decomposition API
 *
 * Uses Claude to break complex scene requests into parallel sub-tasks.
 * Part of the "wide build" parallel scene building system.
 */

export const config = {
  maxDuration: 30
};

const DECOMPOSITION_SYSTEM_PROMPT = `You are a scene architect that decomposes complex 3D scene requests into parallel sub-tasks for simultaneous execution by multiple AI agents.

Your job: Analyze the user's scene request and break it into INDEPENDENT, parallelizable sub-tasks.

RULES:
1. Each sub-task must be INDEPENDENT - executable without knowledge of other tasks
2. Assign non-overlapping spatial zones to prevent entity collisions
3. Priority levels: 0 = environment/ground, 1 = major structures, 2 = details/props
4. Keep tasks focused - one area OR one element type per task
5. Minimum 2 tasks, maximum 6 tasks for efficiency
6. Use clear zone boundaries with 5-10 unit buffers between zones

ZONE STRATEGIES:
- Village/Town: quadrant (NW, NE, SW, SE at ±25-50 range)
- Street/Linear: linear (left -40:-10, center -15:15, right 10:40)
- Plaza/Circular: radial (center ±15, cardinal directions ±20-50)
- Forest/Nature: scattered zones with 10+ unit gaps

OUTPUT FORMAT (JSON only, no markdown, no explanation):
{
  "plan": "Brief strategy description",
  "isComplex": true,
  "subTasks": [
    {
      "id": "unique_id",
      "name": "Task Name",
      "description": "What this task creates",
      "zone": {
        "id": "zone_id",
        "name": "Zone Name",
        "bounds": { "minX": -50, "maxX": 0, "minZ": 0, "maxZ": 50 }
      },
      "priority": 0,
      "dependencies": []
    }
  ]
}

For SIMPLE requests (single object, minor addition), return:
{"plan": "Simple request", "isComplex": false, "subTasks": []}`;

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
    const { intent } = req.body;

    if (!intent) {
      return res.status(400).json({ error: 'Intent is required' });
    }

    const apiKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'API key not configured' });
    }

    console.log('[Decompose] Analyzing:', intent.substring(0, 80));

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 2048,
        system: [
          {
            type: 'text',
            text: DECOMPOSITION_SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' }
          }
        ],
        messages: [
          {
            role: 'user',
            content: `Decompose this scene request into parallel sub-tasks:\n\n"${intent}"`
          }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Decompose] API error:', errorText);
      return res.status(500).json({ error: 'Decomposition failed', details: errorText });
    }

    const data = await response.json();
    let jsonText = data.content?.[0]?.text || '';

    // Parse JSON from response
    try {
      // Remove markdown code blocks if present
      jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const decomposition = JSON.parse(jsonText);

      console.log('[Decompose] Result:', {
        isComplex: decomposition.isComplex,
        taskCount: decomposition.subTasks?.length || 0
      });

      return res.status(200).json({
        success: true,
        decomposition
      });
    } catch (parseError) {
      console.error('[Decompose] JSON parse error:', parseError, 'Text:', jsonText);
      // Return simple fallback
      return res.status(200).json({
        success: true,
        decomposition: {
          plan: 'Parse error - using simple execution',
          isComplex: false,
          subTasks: []
        }
      });
    }

  } catch (error) {
    console.error('[Decompose] Error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
}

export default withApiAccess(handler, "/api/playcanvas/decompose");
