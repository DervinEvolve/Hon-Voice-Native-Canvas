import { withApiAccess } from "../_lib/api-access.js";
import { sceneCodeGenerationEnabled } from "../_lib/scene-code.js";
/**
 * Sub-Task Execution API
 *
 * Executes a single zone-constrained sub-task as part of parallel scene building.
 * Uses the same system prompt as execute.js but adds zone constraints.
 */

export const config = {
  maxDuration: 45
};

// Import base system prompt from execute.js would be ideal, but for Vercel we duplicate
// The zone constraints are injected dynamically
const PLAYCANVAS_BASE_PROMPT = `You are a PlayCanvas expert generating JavaScript code for a 3D scene sub-task.

CONTEXT:
- You have access to \`app\` (PlayCanvas Application), \`pc\` (namespace), \`camera\` (main camera)
- Code runs in browser context with full PlayCanvas API access
- You are building ONE PART of a larger scene - stay within your assigned zone

KEY PATTERNS:
\`\`\`javascript
// Entity creation
const entity = new pc.Entity('name');
entity.addComponent('render', { type: 'box' });
entity.setPosition(x, y, z);
entity.setLocalScale(sx, sy, sz);
app.root.addChild(entity);

// PBR Materials (always use)
const mat = new pc.StandardMaterial();
mat.diffuse = new pc.Color(r, g, b);
mat.metalness = 0.5;
mat.gloss = 0.7;
mat.useMetalness = true;
mat.update();
entity.render.meshInstances.forEach(mi => mi.material = mat);

// Shadows
entity.render.castShadows = true;
entity.render.receiveShadows = true;
\`\`\`

RULES:
1. Return ONLY executable JavaScript - no markdown, no explanations
2. Use PBR materials with proper metalness/gloss values
3. Ground objects correctly (y = height/2 for boxes/cylinders on ground)
4. DO NOT redeclare app, pc, or camera
5. DO NOT set fog, ambient light, skybox, or exposure
6. Keep code concise (50-150 lines max)
7. CRITICAL: Stay within your assigned spatial zone bounds`;

function buildZoneConstraint(zone) {
  if (!zone) return '';

  return `
SPATIAL ZONE CONSTRAINT (CRITICAL - DO NOT EXCEED):
Zone: ${zone.name} (${zone.id})
X bounds: ${zone.bounds.minX} to ${zone.bounds.maxX}
Z bounds: ${zone.bounds.minZ} to ${zone.bounds.maxZ}
Y: Start objects at y=0 (ground level)

ALL entities must have positions where:
- x >= ${zone.bounds.minX} AND x <= ${zone.bounds.maxX}
- z >= ${zone.bounds.minZ} AND z <= ${zone.bounds.maxZ}

Example position calculation for your zone:
const zoneMinX = ${zone.bounds.minX}, zoneMaxX = ${zone.bounds.maxX};
const zoneMinZ = ${zone.bounds.minZ}, zoneMaxZ = ${zone.bounds.maxZ};
const x = zoneMinX + Math.random() * (zoneMaxX - zoneMinX);
const z = zoneMinZ + Math.random() * (zoneMaxZ - zoneMinZ);
`;
}

 async function handler(req, res) {
  if (req.method !== 'OPTIONS' && !sceneCodeGenerationEnabled(res)) return;
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
    const { intent, zone, taskId, sceneContext } = req.body;

    if (!intent) {
      return res.status(400).json({ error: 'Intent is required' });
    }

    const apiKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'API key not configured' });
    }

    console.log('[ExecuteSubtask] Task:', taskId, 'Zone:', zone?.name || 'global');

    // Build zone-constrained system prompt
    const systemPrompt = PLAYCANVAS_BASE_PROMPT + buildZoneConstraint(zone);

    // Build user prompt
    const userPrompt = sceneContext
      ? `Scene context:\n${sceneContext}\n\nSub-task:\n${intent}\n\nGenerate PlayCanvas code for this sub-task only.`
      : `Sub-task:\n${intent}\n\nGenerate PlayCanvas code for this sub-task only.`;

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
        max_tokens: 4096,
        system: [
          {
            type: 'text',
            text: systemPrompt,
            cache_control: { type: 'ephemeral' }
          }
        ],
        messages: [
          {
            role: 'user',
            content: userPrompt
          }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[ExecuteSubtask] API error:', errorText);
      return res.status(500).json({ error: 'Code generation failed', details: errorText });
    }

    const data = await response.json();
    let code = data.content?.[0]?.text || '';

    // Extract code from markdown blocks if present
    const codeBlockMatch = code.match(/```(?:javascript|js)?\n([\s\S]*?)```/);
    if (codeBlockMatch) {
      code = codeBlockMatch[1].trim();
    }

    // Clean up code
    code = code.trim();
    const lines = code.split('\n');
    let startIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('const ') || line.startsWith('let ') || line.startsWith('var ') ||
          line.startsWith('//') || line.startsWith('app.') || line.startsWith('pc.') ||
          line.startsWith('function') || line.startsWith('(') || line.startsWith('{')) {
        startIndex = i;
        break;
      }
    }

    code = lines.slice(startIndex).join('\n').trim();

    // Validate syntax
    try {
      new Function('app', 'pc', 'camera', code);
    } catch (syntaxError) {
      console.error('[ExecuteSubtask] Syntax error:', syntaxError.message);
      return res.status(400).json({
        error: 'Generated code has syntax errors',
        syntaxError: syntaxError.message,
        taskId
      });
    }

    // Auto-fix common issues
    if (code.includes('const camera =') || code.includes('let camera =')) {
      code = code.replace(/(?:const|let|var)\s+camera\s*=\s*[^;]+;?\n?/g, '');
    }
    if (code.includes('const app =') || code.includes('let app =')) {
      code = code.replace(/(?:const|let|var)\s+app\s*=\s*[^;]+;?\n?/g, '');
    }

    console.log('[ExecuteSubtask] Generated code length:', code.length, 'for task:', taskId);

    return res.status(200).json({
      success: true,
      code,
      taskId,
      zone
    });

  } catch (error) {
    console.error('[ExecuteSubtask] Error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
}

export default withApiAccess(handler, "/api/playcanvas/execute-subtask");
