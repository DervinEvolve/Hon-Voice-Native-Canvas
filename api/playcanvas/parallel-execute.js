import { withApiAccess } from "../_lib/api-access.js";
import { sceneCodeGenerationEnabled } from "../_lib/scene-code.js";
import { ownedApiCall } from '../_lib/api-access.js';
/**
 * Parallel Scene Execute API
 *
 * Main orchestration endpoint for "wide build" parallel scene construction.
 * Decomposes complex requests → spawns parallel sub-agents → merges results.
 */

export const config = {
  maxDuration: 120, // 2 minutes for complex parallel builds
  supportsResponseStreaming: true // Enable streaming for Vercel
};

const DECOMPOSITION_PROMPT = `You are a scene architect. Decompose complex 3D scene requests into specialized parallel sub-tasks.

=== TASK TYPES (each uses different tools!) ===

**GEOMETRY** (type: "geometry")
- Buildings, houses, trees, rocks, ground, paths, furniture
- Uses pc_execute to generate code
- REQUIRES zone assignment (spatial bounds)

**PARTICLES** (type: "particles")
- Fire, campfire, smoke, sparkles, magic, embers
- params: { preset, positionX, positionY, positionZ, scale, color }

**ATMOSPHERE** (type: "atmosphere")
- Sky, time of day, mood
- params: { preset: "dawn"/"day"/"sunset"/"dusk"/"night" }

**WEATHER** (type: "weather")
- Rain, snow, fog, storm effects
- params: { type: "rain"/"snow"/"fog" }

**AMBIANCE** (type: "ambiance")
- Dynamic effects for scene life (smoke, embers, dust, leaves)
- params: { effects: ["smoke_above_fire", "embers", "dust", "leaves", "fog_ground"] }

**LIGHTING** (type: "lighting") - NEW!
- Point lights (torches, windows), spotlights (lamps), area lights
- params: { lights: [{ type, position, color, intensity, range }] }
- type: "point", "spot", "directional"

**ANIMATION** (type: "animation") - NEW!
- Entity animations: rotation, bobbing, oscillation, path following
- params: { animations: [{ target, type, speed, range }] }
- target: entity description, type: "rotate"/"bob"/"sway"

**POST_PROCESSING** (type: "post_processing") - NEW!
- Bloom, vignette, color grading for cinematic look
- params: { bloom, bloomIntensity, vignette, vignetteIntensity, saturation, contrast }

**PHYSICS** (type: "physics") - NEW!
- Add physics to objects (gravity, collision, bounce)
- params: { targets: [{ description, type, mass, friction, restitution }] }
- type: "dynamic"/"static"/"kinematic"

**INTERACTIVITY** (type: "interactivity") - NEW!
- Click handlers, proximity triggers, hover effects
- params: { interactions: [{ target, trigger, action }] }
- trigger: "click"/"proximity"/"hover"

**WATER** (type: "water") - NEW!
- Lakes, rivers, ponds, oceans with realistic rendering
- params: { style, position, size, depth, waveIntensity, color, flowDirection }
- style: "lake"/"river"/"ocean"/"pond"/"pool"
- Includes: reflections, refractions, waves, foam, depth coloring

=== RULES ===
1. GEOMETRY tasks need zones (non-overlapping spatial bounds)
2. Other tasks need params, NOT zones
3. Priority: 0 = atmosphere, 1 = geometry/water, 2 = lighting/particles, 3 = animation/ambiance/physics, 4 = post_processing/interactivity
4. 3-8 tasks total for complete scenes
5. For games: ALWAYS include physics + interactivity
6. For villages/nature: ALWAYS include ambiance + lighting
7. For cinematic: ALWAYS include post_processing + atmosphere
8. For scenes with water (lakes, rivers, beaches, islands): ALWAYS include water task!

=== CRITICAL: BUILDINGS/HOUSES ===
**VILLAGES/TOWNS MUST have GEOMETRY tasks for buildings!**
- If user asks for "village", "town", "houses" - you MUST include geometry tasks for buildings
- Create MULTIPLE geometry zones: "village_houses_north", "village_houses_south", "central_clearing"
- Each house zone should build 2-4 houses with proper structure (walls, roof, door, windows)
- Do NOT skip buildings! Trees alone do NOT make a village!

=== OUTPUT JSON (VILLAGE EXAMPLE - note multiple geometry zones!) ===
{
  "plan": "Build forest village with houses in clusters, central well, atmosphere and ambiance",
  "isComplex": true,
  "subTasks": [
    {
      "id": "task_1",
      "name": "Set village atmosphere",
      "type": "atmosphere",
      "params": { "preset": "sunset" },
      "priority": 0
    },
    {
      "id": "task_2",
      "name": "Build north village houses",
      "type": "geometry",
      "zone": { "id": "north", "name": "North Village", "bounds": { "minX": -40, "maxX": -5, "minZ": -30, "maxZ": 10 } },
      "description": "Build 3-4 wooden houses with peaked roofs, doors, windows. Add surrounding trees.",
      "priority": 1
    },
    {
      "id": "task_3",
      "name": "Build south village houses",
      "type": "geometry",
      "zone": { "id": "south", "name": "South Village", "bounds": { "minX": 5, "maxX": 40, "minZ": -30, "maxZ": 10 } },
      "description": "Build 3-4 wooden houses varied sizes. Include chimneys and paths.",
      "priority": 1
    },
    {
      "id": "task_4",
      "name": "Build central well and clearing",
      "type": "geometry",
      "zone": { "id": "center", "name": "Village Center", "bounds": { "minX": -15, "maxX": 15, "minZ": -15, "maxZ": 15 } },
      "description": "Central stone well with wooden roof, benches, ground plane",
      "priority": 1
    },
    {
      "id": "task_5",
      "name": "Add village lighting",
      "type": "lighting",
      "params": { "lights": [
        { "type": "point", "position": [0, 2, 0], "color": "#ff9944", "intensity": 2, "range": 10 },
        { "type": "point", "position": [-20, 3, 0], "color": "#ffcc88", "intensity": 1, "range": 8 },
        { "type": "point", "position": [20, 3, 0], "color": "#ffcc88", "intensity": 1, "range": 8 }
      ]},
      "priority": 2
    },
    {
      "id": "task_6",
      "name": "Add scene ambiance",
      "type": "ambiance",
      "params": { "effects": ["smoke_above_fire", "embers"] },
      "priority": 3
    }
  ]
}

For simple requests: {"plan": "Simple", "isComplex": false, "subTasks": []}`;

const SUBTASK_PROMPT = `You are a PlayCanvas expert generating HIGH-QUALITY stylized 3D scenes.

=== QUALITY REQUIREMENTS (CRITICAL!) ===

**MULTI-PART OBJECTS ARE MANDATORY** - Single primitives look terrible!
- TREE = trunk (cylinder) + 3 foliage cones (layered) = minimum 4 entities
- HOUSE = walls (box) + roof (cone) + door (box) + 2 windows (boxes) + chimney = minimum 6 entities
- STREETLAMP = pole (cylinder) + fixture (box/sphere) = minimum 2 entities
- ROCK = okay as single sphere (natural objects can be simpler)

A scene with 5 trees should have 20+ entities (4 per tree).
A village with 3 houses should have 18+ entities for houses alone.

NEVER create a tree as just one cone. NEVER create a house as just one box.
Use the factory functions below - they are designed for quality!

=== PRE-CONFIGURED ENVIRONMENT ===
The scene ALREADY has professional lighting set up:
- 3-point lighting system (sun, fill, rim) with soft shadows
- ACES tone mapping for cinematic look
- Clustered lighting enabled

DO NOT create lights or change camera.clearColor - the environment is ready!

CONTEXT:
- \`app\` (PlayCanvas Application), \`pc\` (namespace), \`camera\` available
- Build ONLY your assigned zone - other agents handle other zones
- Focus on OBJECTS (entities) - lighting/sky is handled separately

=== FACTORY FUNCTIONS (COPY THESE EXACTLY!) ===

TREE with layered foliage (4+ entities per tree):
\`\`\`javascript
function createTree(x, z, scale = 1) {
  const tree = new pc.Entity('tree');

  // Trunk - brown cylinder
  const trunk = new pc.Entity('trunk');
  trunk.addComponent('render', { type: 'cylinder' });
  trunk.setLocalScale(0.3 * scale, 3 * scale, 0.3 * scale);
  trunk.setLocalPosition(0, 1.5 * scale, 0);
  const trunkMat = new pc.StandardMaterial();
  trunkMat.diffuse = new pc.Color(0.35, 0.25, 0.15);
  trunkMat.useMetalness = true; trunkMat.metalness = 0; trunkMat.gloss = 0.2;
  trunkMat.update();
  trunk.render.meshInstances.forEach(mi => mi.material = trunkMat);
  trunk.render.castShadows = true;
  tree.addChild(trunk);

  // 3 layers of foliage (bottom to top: larger to smaller)
  const foliageHeights = [2.8, 4.2, 5.3];
  const foliageSizes = [2.8, 2.2, 1.4];
  const greens = [
    new pc.Color(0.15, 0.45, 0.15),
    new pc.Color(0.2, 0.55, 0.2),
    new pc.Color(0.12, 0.4, 0.12)
  ];

  foliageHeights.forEach((h, i) => {
    const foliage = new pc.Entity('foliage' + i);
    foliage.addComponent('render', { type: 'cone' });
    foliage.setLocalScale(foliageSizes[i] * scale, 1.8 * scale, foliageSizes[i] * scale);
    foliage.setLocalPosition(0, h * scale, 0);
    const mat = new pc.StandardMaterial();
    mat.diffuse = greens[i];
    mat.useMetalness = true; mat.metalness = 0; mat.gloss = 0.25;
    mat.update();
    foliage.render.meshInstances.forEach(mi => mi.material = mat);
    foliage.render.castShadows = true;
    tree.addChild(foliage);
  });

  tree.setPosition(x, 0, z);
  app.root.addChild(tree);
  return tree;
}
\`\`\`

HOUSE with walls, roof, door, windows, chimney:
\`\`\`javascript
function createHouse(x, z, rotation, roofColor, wallColor) {
  const house = new pc.Entity('house');

  // Walls - main building
  const walls = new pc.Entity('walls');
  walls.addComponent('render', { type: 'box' });
  walls.setLocalScale(5, 3.5, 5);
  walls.setLocalPosition(0, 1.75, 0);
  const wallMat = new pc.StandardMaterial();
  wallMat.diffuse = wallColor;
  wallMat.useMetalness = true; wallMat.metalness = 0; wallMat.gloss = 0.15;
  wallMat.update();
  walls.render.meshInstances.forEach(mi => mi.material = wallMat);
  walls.render.castShadows = true;
  house.addChild(walls);

  // Pyramid roof
  const roof = new pc.Entity('roof');
  roof.addComponent('render', { type: 'cone' });
  roof.setLocalScale(7, 2.5, 7);
  roof.setLocalPosition(0, 4.75, 0);
  const roofMat = new pc.StandardMaterial();
  roofMat.diffuse = roofColor;
  roofMat.useMetalness = true; roofMat.metalness = 0; roofMat.gloss = 0.2;
  roofMat.update();
  roof.render.meshInstances.forEach(mi => mi.material = roofMat);
  roof.render.castShadows = true;
  house.addChild(roof);

  // Door
  const door = new pc.Entity('door');
  door.addComponent('render', { type: 'box' });
  door.setLocalScale(1, 2, 0.1);
  door.setLocalPosition(0, 1, 2.51);
  const doorMat = new pc.StandardMaterial();
  doorMat.diffuse = new pc.Color(0.4, 0.25, 0.15);
  doorMat.useMetalness = true; doorMat.metalness = 0; doorMat.gloss = 0.3;
  doorMat.update();
  door.render.meshInstances.forEach(mi => mi.material = doorMat);
  house.addChild(door);

  // Windows (2 on front)
  [-1.5, 1.5].forEach(wx => {
    const win = new pc.Entity('window');
    win.addComponent('render', { type: 'box' });
    win.setLocalScale(0.8, 0.8, 0.15);
    win.setLocalPosition(wx, 2.5, 2.51);
    const winMat = new pc.StandardMaterial();
    winMat.diffuse = new pc.Color(0.8, 0.9, 1.0);
    winMat.emissive = new pc.Color(0.2, 0.25, 0.3);
    winMat.useMetalness = true; winMat.gloss = 0.8;
    winMat.update();
    win.render.meshInstances.forEach(mi => mi.material = winMat);
    house.addChild(win);
  });

  // Chimney
  const chimney = new pc.Entity('chimney');
  chimney.addComponent('render', { type: 'box' });
  chimney.setLocalScale(0.8, 1.5, 0.8);
  chimney.setLocalPosition(1.5, 5.5, 0);
  const chimMat = new pc.StandardMaterial();
  chimMat.diffuse = new pc.Color(0.5, 0.35, 0.3);
  chimMat.useMetalness = true; chimMat.metalness = 0; chimMat.gloss = 0.15;
  chimMat.update();
  chimney.render.meshInstances.forEach(mi => mi.material = chimMat);
  chimney.render.castShadows = true;
  house.addChild(chimney);

  house.setPosition(x, 0, z);
  house.setEulerAngles(0, rotation * 180 / Math.PI, 0);
  app.root.addChild(house);
  return house;
}
\`\`\`

ROCK / BOULDER:
\`\`\`javascript
function createRock(x, z, scale = 1) {
  const rock = new pc.Entity('rock');
  rock.addComponent('render', { type: 'sphere' });
  rock.setLocalScale(1.5 * scale, 1 * scale, 1.3 * scale);
  rock.setPosition(x, 0.4 * scale, z);
  const mat = new pc.StandardMaterial();
  mat.diffuse = new pc.Color(0.4 + Math.random()*0.1, 0.38 + Math.random()*0.1, 0.35);
  mat.useMetalness = true; mat.metalness = 0; mat.gloss = 0.1;
  mat.update();
  rock.render.meshInstances.forEach(mi => mi.material = mat);
  rock.render.castShadows = true;
  app.root.addChild(rock);
  return rock;
}
\`\`\`

GROUND PLANE (create once per scene, in your zone):
\`\`\`javascript
function createGround(centerX, centerZ, width, depth, color) {
  const ground = new pc.Entity('ground');
  ground.addComponent('render', { type: 'box' });
  ground.setLocalScale(width, 0.2, depth);
  ground.setPosition(centerX, -0.1, centerZ);
  const mat = new pc.StandardMaterial();
  mat.diffuse = color || new pc.Color(0.3, 0.5, 0.25);
  mat.useMetalness = true; mat.metalness = 0; mat.gloss = 0.15;
  mat.update();
  ground.render.meshInstances.forEach(mi => mi.material = mat);
  ground.render.receiveShadows = true;
  app.root.addChild(ground);
  return ground;
}
\`\`\`

COLOR PALETTES:
- Walls: (0.9,0.85,0.75), (0.95,0.9,0.8), (0.85,0.8,0.7), (1,0.95,0.85)
- Roofs: (0.5,0.25,0.1), (0.45,0.3,0.2), (0.6,0.2,0.15), (0.55,0.35,0.25)
- Grass: (0.3, 0.5, 0.25) - lush green
- Path: (0.55, 0.48, 0.38) - dirt/gravel
- Stone: (0.45, 0.43, 0.4) - gray rock
- Water: (0.2, 0.5, 0.7) - lake blue

=== GROUNDING RULES (CRITICAL - OBJECTS MUST TOUCH GROUND!) ===

GROUND LEVEL IS Y=0. All objects must have their BASE at y=0, NOT their center!

POSITIONING FORMULAS (apply these EXACTLY):
- BOX/CUBE: setPosition(x, HEIGHT/2, z) - center is at half height
- CYLINDER: setPosition(x, HEIGHT/2, z) - center is at half height
- CONE: setPosition(x, HEIGHT/2, z) - center is at half height
- SPHERE: setPosition(x, RADIUS, z) - center is at radius height

EXAMPLES OF CORRECT GROUNDING:
\`\`\`javascript
// Box with height 4 → position y = 4/2 = 2
box.setLocalScale(3, 4, 3);
box.setPosition(10, 2, 5); // y=2 puts bottom at y=0

// Cylinder (tree trunk) with height 3 → position y = 3/2 = 1.5
trunk.setLocalScale(0.3, 3, 0.3);
trunk.setLocalPosition(0, 1.5, 0); // y=1.5 puts bottom at y=0

// Sphere with scale 2 (radius 1) → position y = 1
sphere.setLocalScale(2, 2, 2);
sphere.setPosition(0, 1, 0); // y=1 puts bottom at y=0
\`\`\`

SPACING RULES (objects must NOT overlap):
- Houses: minimum 10 units apart (center to center)
- Trees: minimum 3 units apart
- Small objects (rocks, bushes): minimum 1.5 units apart
- Check X AND Z distances when placing multiple objects

GROUND PLANE (create ONCE at start of your zone):
\`\`\`javascript
// Create ground covering your zone - this goes FIRST
const ground = new pc.Entity('ground');
ground.addComponent('render', { type: 'box' });
ground.setLocalScale(ZONE_WIDTH, 0.2, ZONE_DEPTH);
ground.setPosition(ZONE_CENTER_X, -0.1, ZONE_CENTER_Z); // y=-0.1 so top is at y=0
const groundMat = new pc.StandardMaterial();
groundMat.diffuse = new pc.Color(0.3, 0.5, 0.25);
groundMat.useMetalness = true; groundMat.metalness = 0; groundMat.gloss = 0.15;
groundMat.update();
ground.render.meshInstances.forEach(mi => mi.material = groundMat);
ground.render.receiveShadows = true;
app.root.addChild(ground);
\`\`\`

RULES:
1. Create ground FIRST, then ALL objects on top of it
2. Use the factory functions above - they handle grounding correctly
3. Return ONLY executable JavaScript code
4. Stay WITHIN your assigned zone bounds
5. DO NOT redeclare app, pc, camera
6. Enable castShadows=true on all objects, receiveShadows=true on ground
7. Use PBR materials: useMetalness=true, metalness=0-1, gloss=0-1, then .update()

CRITICAL - NEVER DO:
- Add characters, NPCs, people, villagers (NEVER unless explicitly requested)
- Create any lights (sun, directional, point) - lighting is pre-configured
- Change camera.clearColor - environment is pre-configured
- Set app.scene.fog, fogColor, ambientLight, rendering settings (causes errors)
- Use single primitives for complex objects (trees need 3+ parts, houses need 5+ parts)
- Position objects at y=0 for their CENTER - this makes them sink into ground!
- Overlap objects - check spacing before placing each object`;

// Helper: Fetch with timeout
async function fetchWithTimeout(url, options, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  }
}

// Check if intent should use parallel execution
// IMPORTANT: This should only trigger for TRULY complex scenes, not simple Planning Mode steps
function shouldDecompose(intent) {
  // Short requests are NEVER complex - use sequential
  if (intent.length < 50) return false;

  const lower = intent.toLowerCase();

  // Asset loading requests should NEVER decompose - just load the asset directly
  const assetLoadPatterns = [
    'load', 'upload', 'add asset', 'import', 'spawn asset',
    'city_block', 'city block asset', 'times_square', 'times square',
    'postwar_city', 'desert_ruins', 'city_street'
  ];
  const isAssetLoad = assetLoadPatterns.some(p => lower.includes(p));
  if (isAssetLoad) return false;

  // Scene-level keywords that indicate a complex multi-part scene
  const sceneKeywords = [
    'village', 'town', 'city', 'world', 'kingdom', 'realm',
    'game level', 'game world', 'environment', 'landscape',
    'complete scene', 'full scene', 'entire scene'
  ];

  // Compound location keywords (must have "with" to indicate complexity)
  const compoundKeywords = [
    'forest with', 'island with', 'castle with', 'mountain with',
    'beach with', 'desert with', 'park with', 'street with'
  ];

  // Quantity keywords that suggest many elements
  const quantityKeywords = [
    'multiple', 'several', 'bunch of', 'lots of', 'many',
    'a few', 'some', 'various', 'different'
  ];

  const hasSceneKeyword = sceneKeywords.some(kw => lower.includes(kw));
  const hasCompoundKeyword = compoundKeywords.some(kw => lower.includes(kw));
  const hasQuantityKeyword = quantityKeywords.some(kw => lower.includes(kw));

  // Multiple elements check: 3+ commas OR 3+ "and"s (stricter threshold)
  const commaCount = (lower.match(/,/g) || []).length;
  const andCount = (lower.match(/\band\b/g) || []).length;
  const hasMultipleElements = commaCount >= 3 || andCount >= 3;

  // Long detailed prompts (150+ chars instead of 100)
  const isDetailed = intent.length > 150;

  // Only decompose if we have strong signals of complexity
  return hasSceneKeyword || hasCompoundKeyword || (hasQuantityKeyword && hasMultipleElements) || (isDetailed && hasMultipleElements);
}

// Call Claude API with prompt caching (45s timeout per call)
async function callClaude(systemPrompt, userContent, apiKey, maxTokens = 4096) {
  const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: maxTokens,
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' }
        }
      ],
      messages: [{ role: 'user', content: userContent }]
    })
  }, 45000); // 45 second timeout

  if (!response.ok) {
    throw new Error(`Claude API error: ${await response.text()}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text || '';
}

// Extract and clean code from Claude response
function cleanCode(text) {
  let code = text;

  // Extract from markdown blocks
  const match = code.match(/```(?:javascript|js)?\n([\s\S]*?)```/);
  if (match) code = match[1].trim();

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

  // Remove redeclarations
  code = code.replace(/(?:const|let|var)\s+camera\s*=\s*[^;]+;?\n?/g, '');
  code = code.replace(/(?:const|let|var)\s+app\s*=\s*[^;]+;?\n?/g, '');
  code = code.replace(/(?:const|let|var)\s+pc\s*=\s*[^;]+;?\n?/g, '');

  // Remove forbidden scene settings (fog, ambient, rendering) - these cause runtime errors
  code = code.replace(/app\.scene\.fog\s*=\s*[^;]+;?\n?/g, '// fog removed (not supported)\n');
  code = code.replace(/app\.scene\.fogColor\s*=\s*[^;]+;?\n?/g, '');
  code = code.replace(/app\.scene\.fogStart\s*=\s*[^;]+;?\n?/g, '');
  code = code.replace(/app\.scene\.fogEnd\s*=\s*[^;]+;?\n?/g, '');
  code = code.replace(/app\.scene\.fogDensity\s*=\s*[^;]+;?\n?/g, '');
  code = code.replace(/app\.scene\.ambientLight\s*=\s*[^;]+;?\n?/g, '');
  code = code.replace(/app\.scene\.rendering\.[^=]+=\s*[^;]+;?\n?/g, '');

  // Remove camera.clearColor changes - preserve dark background for splats
  code = code.replace(/camera\.camera\.clearColor\s*=\s*[^;]+;?\n?/g, '// clearColor removed (environment preset)\n');

  // Remove light creation - 3-point lighting already configured
  // Match patterns like: const sun = new pc.Entity('sun'); sun.addComponent('light', {...}); ... app.root.addChild(sun);
  // This is complex because light entities span multiple lines. Instead, remove addComponent('light') calls on new entities
  code = code.replace(/(\w+)\.addComponent\s*\(\s*['"]light['"]\s*,[\s\S]*?\}\s*\)\s*;?\n?/g, '// light removed (pre-configured)\n');

  return code;
}

// ============================================
// QUALITY VALIDATION SYSTEM
// ============================================

/**
 * Validate code completeness - balanced braces, complete statements
 */
function validateCompleteness(code) {
  const issues = [];

  // Check balanced braces
  let braceCount = 0;
  let parenCount = 0;
  let bracketCount = 0;

  for (const char of code) {
    if (char === '{') braceCount++;
    if (char === '}') braceCount--;
    if (char === '(') parenCount++;
    if (char === ')') parenCount--;
    if (char === '[') bracketCount++;
    if (char === ']') bracketCount--;
  }

  if (braceCount !== 0) issues.push(`Unbalanced braces (${braceCount > 0 ? 'missing }' : 'extra }'})`);
  if (parenCount !== 0) issues.push(`Unbalanced parentheses (${parenCount > 0 ? 'missing )' : 'extra )'})`);
  if (bracketCount !== 0) issues.push(`Unbalanced brackets (${bracketCount > 0 ? 'missing ]' : 'extra ]'})`);

  // Check for incomplete statements (ends with operator or comma)
  const trimmed = code.trim();
  const lastChar = trimmed[trimmed.length - 1];
  const incompleteEndings = ['+', '-', '*', '/', '=', ',', ':', '?', '&', '|', '<', '>'];
  if (incompleteEndings.includes(lastChar)) {
    issues.push(`Code ends with incomplete statement (${lastChar})`);
  }

  // Check minimum code length
  if (code.length < 50) {
    issues.push('Code too short - likely incomplete generation');
  }

  return {
    valid: issues.length === 0,
    issues,
    score: Math.max(0, 100 - issues.length * 25)
  };
}

/**
 * Validate entity creation - ensure code actually creates entities
 */
function validateEntityCreation(code) {
  const issues = [];

  // Count entity creations
  const entityCreations = (code.match(/new\s+pc\.Entity/g) || []).length;
  const addChildCalls = (code.match(/\.addChild\(/g) || []).length;
  const addComponentCalls = (code.match(/\.addComponent\(/g) || []).length;

  if (entityCreations === 0) {
    issues.push('No entities created (missing new pc.Entity)');
  }

  if (addChildCalls === 0) {
    issues.push('No entities added to scene (missing addChild)');
  }

  if (addComponentCalls === 0) {
    issues.push('No components added (entities have no render/collision/etc)');
  }

  // Check for render components specifically
  const renderComponents = (code.match(/addComponent\s*\(\s*['"]render['"]/g) || []).length;
  if (renderComponents === 0 && entityCreations > 0) {
    issues.push('No render components - entities will be invisible');
  }

  return {
    valid: entityCreations > 0 && addChildCalls > 0,
    issues,
    entityCount: entityCreations,
    score: Math.min(100, entityCreations * 15 + addComponentCalls * 10)
  };
}

/**
 * Validate object complexity - ensure multi-part objects for trees, houses, etc.
 * CRITICAL: Prevents ugly single-primitive objects
 */
function validateObjectComplexity(code) {
  const issues = [];
  let complexityScore = 100;
  const lower = code.toLowerCase();

  // Define object types and their minimum child requirements
  const complexObjectRules = [
    {
      keywords: ['tree', 'pine', 'oak', 'forest'],
      minChildren: 3, // trunk + at least 2 foliage layers
      description: 'trees need trunk + 2-3 foliage layers'
    },
    {
      keywords: ['house', 'cottage', 'cabin', 'building', 'home'],
      minChildren: 4, // walls + roof + door + window
      description: 'houses need walls, roof, door, windows'
    },
    {
      keywords: ['castle', 'tower', 'fortress'],
      minChildren: 5, // base + walls + towers + battlements
      description: 'castles need multiple towers and walls'
    },
    {
      keywords: ['car', 'vehicle', 'truck'],
      minChildren: 3, // body + wheels
      description: 'vehicles need body + wheels'
    },
    {
      keywords: ['lamp', 'streetlight', 'lantern'],
      minChildren: 2, // pole + light fixture
      description: 'lamps need pole + light fixture'
    }
  ];

  // Count parent-child relationships
  const addChildMatches = code.match(/\.addChild\s*\(/g) || [];
  const totalChildren = addChildMatches.length;

  // Count factory functions (good sign of complex objects)
  const functionDefs = code.match(/function\s+create\w+/g) || [];
  const hasFactoryFunctions = functionDefs.length > 0;

  // Check each complex object type
  for (const rule of complexObjectRules) {
    const hasKeyword = rule.keywords.some(kw => lower.includes(kw));
    if (hasKeyword) {
      // Estimate if this object type has enough children
      // Look for entity names containing the keyword
      const entityNamePattern = new RegExp(`Entity\\s*\\(\\s*['"]\\w*${rule.keywords[0]}\\w*['"]`, 'gi');
      const matchingEntities = code.match(entityNamePattern) || [];

      if (matchingEntities.length > 0) {
        // Check if we have enough addChild calls relative to entities
        const expectedChildren = matchingEntities.length * rule.minChildren;

        if (totalChildren < expectedChildren * 0.5) {
          issues.push(`${rule.keywords[0]}s appear to lack detail (${rule.description})`);
          complexityScore -= 15;
        }
      }
    }
  }

  // Check for single-primitive patterns (bad)
  // Pattern: create entity, add ONE render component, setPosition, addChild to root
  // Without any child entities
  const singlePrimitivePattern = /new\s+pc\.Entity[^}]+addComponent\s*\(\s*['"]render['"][^}]+app\.root\.addChild/gs;
  const singlePrimitives = code.match(singlePrimitivePattern) || [];

  // Filter: if the block contains addChild (adding children), it's multi-part
  const trueSinglePrimitives = singlePrimitives.filter(block => {
    const childCount = (block.match(/\.addChild\s*\(/g) || []).length;
    return childCount <= 1; // Only the final addChild to root
  });

  if (trueSinglePrimitives.length > 3) {
    issues.push(`${trueSinglePrimitives.length} objects are single primitives - use multi-part construction`);
    complexityScore -= trueSinglePrimitives.length * 5;
  }

  // Bonus for using factory functions
  if (hasFactoryFunctions) {
    complexityScore = Math.min(100, complexityScore + 10);
  }

  // Check ratio of entities to children (higher = more complex)
  const entityCount = (code.match(/new\s+pc\.Entity/g) || []).length;
  if (entityCount > 0) {
    const complexityRatio = totalChildren / entityCount;
    if (complexityRatio < 0.3 && entityCount > 5) {
      issues.push('Low entity complexity - most objects are single primitives');
      complexityScore -= 20;
    }
  }

  return {
    valid: complexityScore >= 60,
    issues,
    score: Math.max(0, complexityScore),
    hasFactoryFunctions,
    entityCount,
    childCount: totalChildren
  };
}

/**
 * Validate zone boundary compliance
 */
function validateZoneBounds(code, zone) {
  if (!zone || !zone.bounds) {
    return { valid: true, issues: [], score: 100 };
  }

  const issues = [];
  const { minX, maxX, minZ, maxZ } = zone.bounds;

  // Extract setPosition calls and check coordinates
  const positionRegex = /setPosition\s*\(\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*\)/g;
  let match;
  let outOfBounds = 0;
  let totalPositions = 0;

  while ((match = positionRegex.exec(code)) !== null) {
    totalPositions++;
    const x = parseFloat(match[1]);
    const z = parseFloat(match[3]);

    if (x < minX - 5 || x > maxX + 5 || z < minZ - 5 || z > maxZ + 5) {
      outOfBounds++;
    }
  }

  if (outOfBounds > 0) {
    issues.push(`${outOfBounds}/${totalPositions} positions outside zone bounds`);
  }

  // Check for hardcoded positions at origin (common mistake)
  const originPositions = (code.match(/setPosition\s*\(\s*0\s*,\s*[^,]+,\s*0\s*\)/g) || []).length;
  if (originPositions > 2 && zone.bounds.minX > 5) {
    issues.push('Multiple entities at origin (0,0,0) - may be outside zone');
  }

  return {
    valid: outOfBounds === 0,
    issues,
    score: totalPositions > 0 ? Math.max(0, 100 - (outOfBounds / totalPositions) * 100) : 100
  };
}

/**
 * Validate grounding - ensure objects are properly positioned on ground
 */
function validateGrounding(code) {
  const issues = [];
  let groundingScore = 100;

  // Check for ground plane creation
  const hasGround = code.includes("'ground'") || code.includes('"ground"') ||
                    code.includes('ground') && code.includes('type: \'box\'');
  if (!hasGround) {
    issues.push('No ground plane created - objects may appear floating');
    groundingScore -= 20;
  }

  // Check for setPosition calls with y=0 (common mistake - centers object at ground)
  // This is usually wrong for boxes/cylinders - center should be at height/2
  const suspiciousY0 = /setPosition\s*\(\s*-?\d+\.?\d*\s*,\s*0\s*,\s*-?\d+\.?\d*\s*\)/g;
  const y0Matches = code.match(suspiciousY0) || [];

  // Filter out legitimate y=0 cases (parent entities, ground plane)
  // Look for context around each match
  if (y0Matches.length > 3) {
    issues.push(`${y0Matches.length} entities positioned at y=0 - some may be sinking into ground`);
    groundingScore -= Math.min(30, y0Matches.length * 5);
  }

  // Check for setLocalScale followed by setPosition to verify height/2 calculation
  // This is a heuristic - we look for scale with height > 1 and position y < height/2
  const scalePositionPairs = /setLocalScale\s*\([^)]+,\s*(\d+\.?\d*)\s*,[^)]+\)[;\s\n]*[^;]*setPosition\s*\([^,]+,\s*(\d+\.?\d*)\s*,/g;
  let pairMatch;
  let badGrounding = 0;

  const codeForPairs = code;
  while ((pairMatch = scalePositionPairs.exec(codeForPairs)) !== null) {
    const height = parseFloat(pairMatch[1]);
    const yPos = parseFloat(pairMatch[2]);
    // For objects with height > 1, y should be approximately height/2
    if (height > 1 && yPos < height * 0.4) {
      badGrounding++;
    }
  }

  if (badGrounding > 0) {
    issues.push(`${badGrounding} objects may be sinking into ground (y position too low for height)`);
    groundingScore -= badGrounding * 10;
  }

  // Check for negative Y positions (objects underground)
  const negativeY = /setPosition\s*\([^,]+,\s*-\d+\.?\d*\s*,/g;
  const negativeYMatches = (code.match(negativeY) || []).length;
  // Ground plane at y=-0.1 is OK, but multiple negative Y is suspicious
  if (negativeYMatches > 1) {
    issues.push(`${negativeYMatches} entities with negative Y - may be underground`);
    groundingScore -= negativeYMatches * 5;
  }

  return {
    valid: issues.length === 0,
    issues,
    score: Math.max(0, groundingScore)
  };
}

/**
 * Validate material quality - ensure PBR materials are used properly
 */
function validateMaterialQuality(code) {
  const issues = [];

  // Count material creations
  const standardMaterials = (code.match(/new\s+pc\.StandardMaterial/g) || []).length;
  const basicMaterials = (code.match(/new\s+pc\.BasicMaterial/g) || []).length;

  // Check for PBR properties
  const useMetalness = (code.match(/useMetalness\s*=\s*true/g) || []).length;
  const metalnessSet = (code.match(/\.metalness\s*=/g) || []).length;
  const glossSet = (code.match(/\.gloss\s*=/g) || []).length;
  const updateCalls = (code.match(/\.update\s*\(\s*\)/g) || []).length;

  // Check for material application
  const materialAssignments = (code.match(/\.material\s*=/g) || []).length;

  if (standardMaterials === 0 && basicMaterials === 0) {
    issues.push('No materials created - entities will have default gray');
  }

  if (standardMaterials > 0 && useMetalness < standardMaterials * 0.5) {
    issues.push('PBR materials missing useMetalness=true - reflections won\'t work');
  }

  if (standardMaterials > 0 && metalnessSet < standardMaterials * 0.5) {
    issues.push('Materials missing metalness property');
  }

  if (standardMaterials > 0 && glossSet < standardMaterials * 0.5) {
    issues.push('Materials missing gloss property');
  }

  if (standardMaterials > 0 && updateCalls < standardMaterials) {
    issues.push('Some materials missing .update() call - changes won\'t apply');
  }

  if (materialAssignments === 0 && standardMaterials > 0) {
    issues.push('Materials created but not assigned to entities');
  }

  // Calculate quality score
  let score = 50; // Base score
  if (standardMaterials > 0) score += 15;
  if (useMetalness > 0) score += 15;
  if (metalnessSet > 0) score += 10;
  if (glossSet > 0) score += 10;

  return {
    valid: issues.length <= 1, // Allow 1 minor issue
    issues,
    materialCount: standardMaterials + basicMaterials,
    score: Math.min(100, score)
  };
}

/**
 * Run all quality validations and return aggregate result
 */
function validateCodeQuality(code, zone = null) {
  const completeness = validateCompleteness(code);
  const entities = validateEntityCreation(code);
  const bounds = validateZoneBounds(code, zone);
  const materials = validateMaterialQuality(code);
  const grounding = validateGrounding(code);
  const complexity = validateObjectComplexity(code);

  // Aggregate all issues
  const allIssues = [
    ...completeness.issues.map(i => `[Completeness] ${i}`),
    ...entities.issues.map(i => `[Entities] ${i}`),
    ...bounds.issues.map(i => `[Bounds] ${i}`),
    ...materials.issues.map(i => `[Materials] ${i}`),
    ...grounding.issues.map(i => `[Grounding] ${i}`),
    ...complexity.issues.map(i => `[Complexity] ${i}`)
  ];

  // Calculate overall score - complexity and grounding are critical for visual quality!
  const overallScore = Math.round(
    completeness.score * 0.20 +
    entities.score * 0.15 +
    bounds.score * 0.10 +
    materials.score * 0.15 +
    grounding.score * 0.20 +
    complexity.score * 0.20
  );

  // Determine if code passes quality threshold
  const passesQuality =
    completeness.valid &&
    entities.valid &&
    bounds.valid &&
    grounding.score >= 50 && // Grounding must be at least 50%
    complexity.score >= 50 && // Complexity must be at least 50%
    overallScore >= 60;

  return {
    valid: passesQuality,
    score: overallScore,
    issues: allIssues,
    details: {
      completeness,
      entities,
      bounds,
      materials,
      grounding,
      complexity
    }
  };
}

// SSE helper - format event for streaming
function formatSSE(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// ============================================
// SPECIALIZED TASK EXECUTORS BY TYPE
// ============================================

/**
 * Execute a PARTICLES task - returns tool call for pc_add_particle_effect
 * These don't need code generation - they use the dedicated particle tool
 */
function executeParticleTask(task) {
  const params = task.params || {};

  // Map common presets
  const preset = params.preset || 'fire';
  const x = params.positionX ?? 0;
  const y = params.positionY ?? 0.5;
  const z = params.positionZ ?? 0;
  const scale = params.scale ?? 1;

  return {
    taskId: task.id,
    taskName: task.name,
    type: 'particles',
    toolCall: {
      tool: 'pc_add_particle_effect',
      params: {
        preset,
        positionX: x,
        positionY: y,
        positionZ: z,
        scale,
        color: params.color || null
      }
    },
    success: true,
    generationTime: 0 // No LLM call needed
  };
}

/**
 * Execute an ATMOSPHERE task - returns tool call for pc_create_gradient_sky or pc_set_mood
 */
function executeAtmosphereTask(task) {
  const params = task.params || {};
  const preset = params.preset || 'day';

  // Determine which tool to use based on description
  const description = (task.description || '').toLowerCase();
  const useMood = description.includes('mood') || description.includes('lighting') || description.includes('ambien');

  if (useMood) {
    return {
      taskId: task.id,
      taskName: task.name,
      type: 'atmosphere',
      toolCall: {
        tool: 'pc_set_mood',
        params: { mood: preset }
      },
      success: true,
      generationTime: 0
    };
  }

  return {
    taskId: task.id,
    taskName: task.name,
    type: 'atmosphere',
    toolCall: {
      tool: 'pc_create_gradient_sky',
      params: { preset }
    },
    success: true,
    generationTime: 0
  };
}

/**
 * Execute a WEATHER task - returns tool call for pc_add_weather
 */
function executeWeatherTask(task) {
  const params = task.params || {};
  const weatherType = params.type || 'rain';

  return {
    taskId: task.id,
    taskName: task.name,
    type: 'weather',
    toolCall: {
      tool: 'pc_add_weather',
      params: { type: weatherType }
    },
    success: true,
    generationTime: 0
  };
}

/**
 * Execute ambiance task - adds multiple dynamic effects for scene life
 * Returns an array of tool calls that will be executed in sequence
 */
function executeAmbianceTask(task) {
  const params = task.params || {};
  const effects = params.effects || ['dust', 'embers'];

  // Map effect names to actual particle tool calls
  const effectToolCalls = [];

  for (const effect of effects) {
    switch (effect) {
      case 'smoke_above_fire':
        // Add smoke that rises above where fire would be (center by default)
        effectToolCalls.push({
          tool: 'pc_add_particle_effect',
          params: {
            preset: 'smoke',
            positionX: params.fireX ?? 0,
            positionY: (params.fireY ?? 0.5) + 2, // Above the fire
            positionZ: params.fireZ ?? 0,
            scale: 1.5
          }
        });
        break;

      case 'embers':
        // Floating embers near fire sources
        effectToolCalls.push({
          tool: 'pc_add_particle_effect',
          params: {
            preset: 'embers',
            positionX: params.fireX ?? 0,
            positionY: (params.fireY ?? 0.5) + 1,
            positionZ: params.fireZ ?? 0,
            scale: 1.2
          }
        });
        break;

      case 'dust':
        // Ambient dust particles floating in the air
        effectToolCalls.push({
          tool: 'pc_add_particle_effect',
          params: {
            preset: 'dust',
            positionX: 0,
            positionY: 2,
            positionZ: 0,
            scale: 2
          }
        });
        break;

      case 'leaves':
        // Falling leaves for forest scenes
        effectToolCalls.push({
          tool: 'pc_add_particle_effect',
          params: {
            preset: 'leaves',
            positionX: 0,
            positionY: 8,
            positionZ: 0,
            scale: 1.5
          }
        });
        break;

      case 'fog_ground':
        // Low-lying fog for atmosphere
        effectToolCalls.push({
          tool: 'pc_add_particle_effect',
          params: {
            preset: 'fog_volume',
            positionX: 0,
            positionY: 0.5,
            positionZ: 0,
            scale: 2
          }
        });
        break;

      case 'sparkles':
        // Magic sparkles for fantasy scenes
        effectToolCalls.push({
          tool: 'pc_add_particle_effect',
          params: {
            preset: 'sparkles',
            positionX: 0,
            positionY: 3,
            positionZ: 0,
            scale: 1.5,
            color: params.sparkleColor || '#ffdd88'
          }
        });
        break;

      case 'bubbles':
        // Bubbles for underwater/aquatic scenes
        effectToolCalls.push({
          tool: 'pc_add_particle_effect',
          params: {
            preset: 'bubbles',
            positionX: 0,
            positionY: 0,
            positionZ: 0,
            scale: 1
          }
        });
        break;
    }
  }

  // Return the first effect as the main result, queue others
  // The ambiance task returns multiple tool calls that get executed
  return {
    taskId: task.id,
    taskName: task.name,
    type: 'ambiance',
    toolCalls: effectToolCalls, // Multiple tool calls!
    toolCall: effectToolCalls[0] || null, // First one for compatibility
    success: effectToolCalls.length > 0,
    generationTime: 0,
    message: `Adding ${effectToolCalls.length} ambiance effects: ${effects.join(', ')}`
  };
}

/**
 * Execute LIGHTING task - adds point lights, spotlights
 */
function executeLightingTask(task) {
  const params = task.params || {};
  const lights = params.lights || [];

  const lightToolCalls = [];

  for (const light of lights) {
    lightToolCalls.push({
      tool: 'pc_add_light',
      params: {
        type: light.type || 'point',
        positionX: light.position?.[0] ?? 0,
        positionY: light.position?.[1] ?? 3,
        positionZ: light.position?.[2] ?? 0,
        color: light.color || '#ffffff',
        intensity: light.intensity ?? 1,
        range: light.range ?? 10,
        castShadows: light.castShadows ?? false
      }
    });
  }

  return {
    taskId: task.id,
    taskName: task.name,
    type: 'lighting',
    toolCalls: lightToolCalls,
    toolCall: lightToolCalls[0] || null,
    success: lightToolCalls.length > 0,
    generationTime: 0,
    message: `Adding ${lightToolCalls.length} lights`
  };
}

/**
 * Execute POST_PROCESSING task - bloom, vignette, color grading
 */
function executePostProcessingTask(task) {
  const params = task.params || {};

  return {
    taskId: task.id,
    taskName: task.name,
    type: 'post_processing',
    toolCall: {
      tool: 'pc_set_post_processing',
      params: {
        bloomEnabled: params.bloom ?? true,
        bloomIntensity: params.bloomIntensity ?? 0.3,
        bloomThreshold: params.bloomThreshold ?? 0.8,
        vignetteEnabled: params.vignette ?? true,
        vignetteIntensity: params.vignetteIntensity ?? 0.3,
        saturation: params.saturation ?? 1.1,
        contrast: params.contrast ?? 1.05,
        brightness: params.brightness ?? 1.0
      }
    },
    success: true,
    generationTime: 0,
    message: 'Applied post-processing effects'
  };
}

/**
 * Execute ANIMATION task - rotation, bobbing, sway
 * Returns code that adds animation scripts to entities
 */
function executeAnimationTask(task) {
  const params = task.params || {};
  const animations = params.animations || [];

  // Generate code that adds animation behaviors
  const animationCode = animations.map((anim, i) => {
    const target = anim.target || 'entity';
    const type = anim.type || 'rotate';
    const speed = anim.speed ?? 1;

    switch (type) {
      case 'rotate':
        return `
// Animation: Rotate ${target}
(function() {
  const entities = app.root.findByName('${target}') ? [app.root.findByName('${target}')] :
    app.root.find(e => e.name.toLowerCase().includes('${target.toLowerCase()}'));
  entities.forEach(e => {
    if (e) {
      app.on('update', (dt) => {
        if (!e || !e.parent) return; // Guard: entity destroyed
        e.rotate(0, ${speed * 30} * dt, 0);
      });
    }
  });
})();`;

      case 'bob':
        return `
// Animation: Bob ${target}
(function() {
  const entity = app.root.findByName('${target}');
  if (entity) {
    const startY = entity.getPosition().y;
    let time = 0;
    app.on('update', (dt) => {
      if (!entity || !entity.parent) return; // Guard: entity destroyed
      time += dt * ${speed};
      entity.setPosition(entity.getPosition().x, startY + Math.sin(time) * 0.3, entity.getPosition().z);
    });
  }
})();`;

      case 'sway':
        return `
// Animation: Sway ${target}
(function() {
  const entity = app.root.findByName('${target}');
  if (entity) {
    let time = Math.random() * 6.28;
    app.on('update', (dt) => {
      if (!entity || !entity.parent) return; // Guard: entity destroyed
      time += dt * ${speed};
      entity.setLocalEulerAngles(Math.sin(time) * 5, 0, Math.sin(time * 0.7) * 3);
    });
  }
})();`;

      default:
        return '';
    }
  }).filter(Boolean).join('\n');

  return {
    taskId: task.id,
    taskName: task.name,
    type: 'animation',
    code: animationCode,
    success: animations.length > 0,
    generationTime: 0,
    message: `Added ${animations.length} animations`
  };
}

/**
 * Execute PHYSICS task - add physics components
 */
function executePhysicsTask(task) {
  const params = task.params || {};
  const targets = params.targets || [];

  const physicsToolCalls = [];

  for (const target of targets) {
    physicsToolCalls.push({
      tool: 'pc_add_physics',
      params: {
        entityName: target.description || target.name,
        type: target.type || 'static',
        mass: target.mass ?? 1,
        friction: target.friction ?? 0.5,
        restitution: target.restitution ?? 0.3, // bounciness
        linearDamping: target.linearDamping ?? 0.1,
        angularDamping: target.angularDamping ?? 0.1
      }
    });
  }

  return {
    taskId: task.id,
    taskName: task.name,
    type: 'physics',
    toolCalls: physicsToolCalls,
    toolCall: physicsToolCalls[0] || null,
    success: physicsToolCalls.length > 0,
    generationTime: 0,
    message: `Adding physics to ${physicsToolCalls.length} objects`
  };
}

/**
 * Execute INTERACTIVITY task - click handlers, proximity triggers
 */
function executeInteractivityTask(task) {
  const params = task.params || {};
  const interactions = params.interactions || [];

  // Generate code for interactions
  const interactionCode = interactions.map((interaction, i) => {
    const target = interaction.target || 'entity';
    const trigger = interaction.trigger || 'click';
    const action = interaction.action || 'highlight';

    switch (trigger) {
      case 'click':
        return `
// Interactivity: Click on ${target}
(function() {
  const entity = app.root.findByName('${target}');
  if (entity) {
    entity.collision = entity.collision || entity.addComponent('collision', { type: 'box' });
    entity.script = entity.script || entity.addComponent('script');
    app.mouse.on('mousedown', (event) => {
      const from = camera.camera.screenToWorld(event.x, event.y, camera.camera.nearClip);
      const to = camera.camera.screenToWorld(event.x, event.y, camera.camera.farClip);
      const result = app.systems.rigidbody?.raycastFirst(from, to);
      if (result?.entity === entity) {
        console.log('Clicked: ${target}');
        // ${action} action
        const originalScale = entity.getLocalScale().clone();
        entity.setLocalScale(originalScale.x * 1.1, originalScale.y * 1.1, originalScale.z * 1.1);
        setTimeout(() => entity.setLocalScale(originalScale.x, originalScale.y, originalScale.z), 200);
      }
    });
  }
})();`;

      case 'proximity':
        return `
// Interactivity: Proximity trigger for ${target}
(function() {
  const entity = app.root.findByName('${target}');
  const player = app.root.findByTag('player')[0] || camera;
  if (entity && player) {
    let triggered = false;
    app.on('update', () => {
      if (!entity || !entity.parent) return; // Guard: entity destroyed
      const dist = entity.getPosition().distance(player.getPosition());
      if (dist < 5 && !triggered) {
        triggered = true;
        console.log('Near: ${target}');
        // ${action} action
      } else if (dist >= 5) {
        triggered = false;
      }
    });
  }
})();`;

      case 'hover':
        return `
// Interactivity: Hover effect for ${target}
(function() {
  const entity = app.root.findByName('${target}');
  if (entity && entity.render) {
    const originalColor = entity.render.material?.diffuse?.clone() || new pc.Color(1, 1, 1);
    app.mouse.on('mousemove', (event) => {
      const from = camera.camera.screenToWorld(event.x, event.y, camera.camera.nearClip);
      const to = camera.camera.screenToWorld(event.x, event.y, camera.camera.farClip);
      const result = app.systems.rigidbody?.raycastFirst(from, to);
      if (result?.entity === entity) {
        if (entity.render.material) entity.render.material.emissive = new pc.Color(0.3, 0.3, 0.3);
      } else {
        if (entity.render.material) entity.render.material.emissive = new pc.Color(0, 0, 0);
      }
    });
  }
})();`;

      default:
        return '';
    }
  }).filter(Boolean).join('\n');

  return {
    taskId: task.id,
    taskName: task.name,
    type: 'interactivity',
    code: interactionCode,
    success: interactions.length > 0,
    generationTime: 0,
    message: `Added ${interactions.length} interactions`
  };
}

/**
 * Execute WATER task - creates realistic water bodies
 * Generates code for water plane with shader, waves, reflections
 */
function executeWaterTask(task) {
  const params = task.params || {};
  const style = params.style || 'lake';
  const posX = params.position?.[0] ?? 0;
  const posY = params.position?.[1] ?? 0;
  const posZ = params.position?.[2] ?? 0;
  const sizeX = params.size?.[0] ?? 50;
  const sizeZ = params.size?.[1] ?? 50;
  const depth = params.depth ?? 3;
  const waveIntensity = params.waveIntensity ?? 0.3;
  const waterColor = params.color || '#1a5f7a';
  const flowDir = params.flowDirection || [0, 0]; // For rivers

  // Water style presets
  const stylePresets = {
    lake: { waveSpeed: 0.5, waveScale: 2, transparency: 0.7, foamAmount: 0.2, reflectivity: 0.8 },
    river: { waveSpeed: 1.5, waveScale: 1, transparency: 0.6, foamAmount: 0.5, reflectivity: 0.5 },
    ocean: { waveSpeed: 0.8, waveScale: 5, transparency: 0.5, foamAmount: 0.7, reflectivity: 0.9 },
    pond: { waveSpeed: 0.2, waveScale: 0.5, transparency: 0.8, foamAmount: 0.1, reflectivity: 0.9 },
    pool: { waveSpeed: 0.1, waveScale: 0.3, transparency: 0.95, foamAmount: 0, reflectivity: 0.7 }
  };

  const preset = stylePresets[style] || stylePresets.lake;

  // Generate water code
  const waterCode = `
// === Water Body: ${style} ===
(function() {
  // Create water plane
  const water = new pc.Entity('water_${style}');
  water.setPosition(${posX}, ${posY}, ${posZ});
  water.setLocalScale(${sizeX}, 1, ${sizeZ});

  // Parse water color
  const hex = '${waterColor}'.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  // Create water material with transparency and reflections
  const waterMat = new pc.StandardMaterial();
  waterMat.diffuse = new pc.Color(r * 0.3, g * 0.3, b * 0.3);
  waterMat.emissive = new pc.Color(r * 0.1, g * 0.15, b * 0.2);
  waterMat.specular = new pc.Color(0.8, 0.85, 0.9);
  waterMat.gloss = 0.95;
  waterMat.metalness = 0.1;
  waterMat.useMetalness = true;
  waterMat.opacity = ${preset.transparency};
  waterMat.blendType = pc.BLEND_NORMAL;
  waterMat.depthWrite = true;

  // Fresnel for edge transparency
  waterMat.fresnelModel = pc.FRESNEL_SCHLICK;

  waterMat.update();

  // Add render component (plane)
  water.addComponent('render', {
    type: 'plane',
    material: waterMat
  });

  app.root.addChild(water);

  // Animate waves
  let time = 0;
  const waveIntensity = ${waveIntensity};
  const waveSpeed = ${preset.waveSpeed};
  const waveScale = ${preset.waveScale};

  app.on('update', (dt) => {
    if (!water || !water.parent) return; // Guard: entity destroyed
    time += dt * waveSpeed;

    // Gentle wave motion on Y axis
    const wave1 = Math.sin(time * 2) * 0.02 * waveIntensity;
    const wave2 = Math.sin(time * 3 + 1) * 0.015 * waveIntensity;
    water.setPosition(${posX}, ${posY} + wave1 + wave2, ${posZ});

    // Subtle rotation for ripple effect
    const ripple = Math.sin(time) * 0.3 * waveIntensity;
    water.setLocalEulerAngles(ripple, 0, ripple * 0.5);
  });

  // Add foam/edge particles for non-pool water
  ${preset.foamAmount > 0 ? `
  const foam = new pc.Entity('water_foam');
  foam.setPosition(${posX}, ${posY} + 0.05, ${posZ});
  foam.addComponent('particlesystem', {
    autoPlay: true,
    loop: true,
    numParticles: ${Math.floor(50 * preset.foamAmount)},
    lifetime: 3,
    rate: 0.5,
    emitterShape: pc.EMITTERSHAPE_BOX,
    emitterExtents: new pc.Vec3(${sizeX * 0.4}, 0.1, ${sizeZ * 0.4}),
    localVelocityGraph: new pc.CurveSet([[0, 0], [1, 0]], [[0, 0.1], [1, 0.2]], [[0, 0], [1, 0]]),
    colorGraph: new pc.CurveSet([[0, 1], [1, 1]], [[0, 1], [1, 1]], [[0, 1], [1, 1]]),
    scaleGraph: new pc.Curve([0, 0.1, 0.5, 0.15, 1, 0]),
    alphaGraph: new pc.Curve([0, 0, 0.2, 0.3, 0.8, 0.2, 1, 0])
  });
  app.root.addChild(foam);
  ` : '// No foam for this water style'}

  // Create depth plane underneath for color gradient
  const depthPlane = new pc.Entity('water_depth');
  depthPlane.setPosition(${posX}, ${posY} - ${depth}, ${posZ});
  depthPlane.setLocalScale(${sizeX}, 1, ${sizeZ});

  const depthMat = new pc.StandardMaterial();
  depthMat.diffuse = new pc.Color(r * 0.1, g * 0.15, b * 0.2);
  depthMat.emissive = new pc.Color(0, 0.02, 0.05);
  depthMat.update();

  depthPlane.addComponent('render', {
    type: 'plane',
    material: depthMat
  });
  app.root.addChild(depthPlane);

  console.log('[Water] Created ${style} water body at (${posX}, ${posY}, ${posZ})');
})();
`;

  return {
    taskId: task.id,
    taskName: task.name,
    type: 'water',
    code: waterCode,
    success: true,
    generationTime: 0,
    message: `Created ${style} water body (${sizeX}x${sizeZ})`
  };
}

/**
 * Route task to appropriate executor based on type
 */
async function executeTaskByType(task, intent, apiKey, qualityFeedback = null) {
  const taskType = task.type || 'geometry';

  console.log(`[ParallelExecute] Executing ${taskType} task: ${task.name}`);

  switch (taskType) {
    case 'particles':
      return executeParticleTask(task);
    case 'atmosphere':
      return executeAtmosphereTask(task);
    case 'weather':
      return executeWeatherTask(task);
    case 'ambiance':
      return executeAmbianceTask(task);
    case 'lighting':
      return executeLightingTask(task);
    case 'post_processing':
      return executePostProcessingTask(task);
    case 'animation':
      return executeAnimationTask(task);
    case 'physics':
      return executePhysicsTask(task);
    case 'interactivity':
      return executeInteractivityTask(task);
    case 'water':
      return executeWaterTask(task);
    case 'geometry':
    default:
      // Geometry tasks use the LLM to generate code
      return executeSubTask(task, intent, apiKey, qualityFeedback);
  }
}

// Execute single sub-task with retry and completion callback
async function executeSubTaskWithProgress(task, intent, apiKey, onComplete, maxRetries = 1) {
  // Non-geometry tasks don't need LLM calls or retries
  const taskType = task.type || 'geometry';
  if (taskType !== 'geometry') {
    const result = await executeTaskByType(task, intent, apiKey);
    if (onComplete) onComplete(result);
    return result;
  }

  // Geometry tasks use LLM with quality validation and retries
  let result = await executeTaskByType(task, intent, apiKey);
  let qualityFeedback = null;

  // Retry on failure or low quality (up to maxRetries times)
  let retries = 0;
  while ((!result.success || (result.qualityScore && result.qualityScore < 60)) && retries < maxRetries) {
    retries++;

    // Build feedback for retry
    if (result.qualityIssues && result.qualityIssues.length > 0) {
      qualityFeedback = result.qualityIssues.slice(0, 3).join('; ');
      console.log(`[ParallelExecute] Quality issues for ${task.id}: ${qualityFeedback}`);
    }

    console.log(`[ParallelExecute] Retrying task ${task.id} (attempt ${retries + 1}, score: ${result.qualityScore || 'N/A'})`);
    result = await executeTaskByType(task, intent, apiKey, qualityFeedback);
  }

  if (onComplete) onComplete(result);
  return result;
}

// Execute single sub-task
async function executeSubTask(task, intent, apiKey, qualityFeedback = null) {
  const startTime = Date.now();

  const zoneConstraint = task.zone ? `
SPATIAL ZONE (STAY WITHIN):
Zone: ${task.zone.name}
X: ${task.zone.bounds.minX} to ${task.zone.bounds.maxX}
Z: ${task.zone.bounds.minZ} to ${task.zone.bounds.maxZ}
` : '';

  // Add quality feedback if this is a retry
  const feedbackSection = qualityFeedback ? `

IMPORTANT - Previous attempt had issues, please fix:
${qualityFeedback}

Make sure to:
- Create entities with new pc.Entity() and add them with addChild()
- Add render components so entities are visible
- Use PBR materials with useMetalness=true, metalness, and gloss properties
- Call material.update() after setting properties
- Stay within the assigned zone bounds
` : '';

  const systemPrompt = SUBTASK_PROMPT + zoneConstraint;
  const userContent = `Overall scene: ${intent}\n\nYour sub-task: ${task.name}\nDescription: ${task.description}${feedbackSection}\n\nGenerate the PlayCanvas code for ONLY this sub-task.`;

  try {
    const rawCode = await callClaude(systemPrompt, userContent, apiKey);
    const code = cleanCode(rawCode);

    // Validate syntax
    try {
      new Function('app', 'pc', 'camera', code);
    } catch (syntaxError) {
      return {
        taskId: task.id,
        taskName: task.name,
        code: '',
        zone: task.zone,
        success: false,
        error: `Syntax error: ${syntaxError.message}`,
        qualityScore: 0,
        qualityIssues: [`Syntax error: ${syntaxError.message}`],
        generationTime: Date.now() - startTime
      };
    }

    // Run quality validation
    const quality = validateCodeQuality(code, task.zone);

    if (!quality.valid) {
      console.log(`[ParallelExecute] Task ${task.id} quality score: ${quality.score}, issues: ${quality.issues.length}`);
    }

    return {
      taskId: task.id,
      taskName: task.name,
      code,
      zone: task.zone,
      success: quality.valid,
      qualityScore: quality.score,
      qualityIssues: quality.issues,
      qualityDetails: quality.details,
      generationTime: Date.now() - startTime
    };
  } catch (error) {
    return {
      taskId: task.id,
      taskName: task.name,
      code: '',
      zone: task.zone,
      success: false,
      error: error.message,
      qualityScore: 0,
      qualityIssues: [`Error: ${error.message}`],
      generationTime: Date.now() - startTime
    };
  }
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

  const startTime = Date.now();

  try {
    const { intent, sceneContext, mode = 'auto', maxAgents = 4, stream = false } = req.body;

    if (!intent) {
      return res.status(400).json({ error: 'Intent is required' });
    }

    const apiKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'API key not configured' });
    }

    console.log('[ParallelExecute] Intent:', intent.substring(0, 80), 'Mode:', mode);

    // Step 1: Determine execution mode
    const needsParallel = mode === 'parallel' || (mode === 'auto' && shouldDecompose(intent));

    if (!needsParallel || mode === 'sequential') {
      // Simple sequential execution - delegate to existing execute endpoint
      console.log('[ParallelExecute] Using sequential mode');

      const internalCall = ownedApiCall(req, '/api/playcanvas/execute');

      const execResponse = await fetchWithTimeout(internalCall.url, {
        method: 'POST',
        ...internalCall.options,
        body: JSON.stringify({ intent, sceneContext })
      }, 60000); // 60 second timeout for sequential builds

      if (!execResponse.ok) {
        const errorText = await execResponse.text();
        throw new Error(`Execute failed: ${errorText}`);
      }

      const execData = await execResponse.json();

      return res.status(200).json({
        success: true,
        mode: 'sequential',
        blocks: [{
          taskId: 'single',
          taskName: 'Full Scene',
          code: execData.code,
          success: true,
          generationTime: Date.now() - startTime
        }],
        totalTime: Date.now() - startTime
      });
    }

    // Step 2: Decompose intent into sub-tasks
    console.log('[ParallelExecute] Decomposing for parallel execution...');

    const decomposeText = await callClaude(
      DECOMPOSITION_PROMPT,
      `Decompose this scene request:\n\n"${intent}"`,
      apiKey,
      2048
    );

    let decomposition;
    try {
      const jsonText = decomposeText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      decomposition = JSON.parse(jsonText);
    } catch {
      console.error('[ParallelExecute] Failed to parse decomposition, falling back');
      decomposition = { plan: 'Parse failed', isComplex: false, subTasks: [] };
    }

    // If decomposition says it's simple, fall back to sequential
    if (!decomposition.isComplex || !decomposition.subTasks?.length) {
      console.log('[ParallelExecute] Decomposition returned simple, using sequential');

      const rawCode = await callClaude(
        SUBTASK_PROMPT,
        `Create: ${intent}`,
        apiKey,
        8192
      );

      return res.status(200).json({
        success: true,
        mode: 'sequential',
        decomposition,
        blocks: [{
          taskId: 'single',
          taskName: 'Full Scene',
          code: cleanCode(rawCode),
          success: true,
          generationTime: Date.now() - startTime
        }],
        totalTime: Date.now() - startTime
      });
    }

    // Step 3: Execute sub-tasks in parallel
    console.log(`[ParallelExecute] Executing ${decomposition.subTasks.length} tasks in parallel...`);

    const tasks = decomposition.subTasks;
    const totalTasks = tasks.length;

    // Group by priority for ordered execution
    const tasksByPriority = new Map();
    for (const task of tasks) {
      const p = task.priority || 0;
      if (!tasksByPriority.has(p)) tasksByPriority.set(p, []);
      tasksByPriority.get(p).push(task);
    }

    const priorities = Array.from(tasksByPriority.keys()).sort((a, b) => a - b);
    const allBlocks = [];

    // Streaming mode - send SSE events as tasks complete
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // Send decomposition event
      res.write(formatSSE('decomposed', {
        phase: 'generating',
        totalTasks,
        completedTasks: 0,
        plan: decomposition.plan
      }));

      let completedCount = 0;

      for (const priority of priorities) {
        const priorityTasks = tasksByPriority.get(priority);

        for (let i = 0; i < priorityTasks.length; i += maxAgents) {
          const batch = priorityTasks.slice(i, i + maxAgents);

          // Execute batch with progress tracking - send code OR toolCall for immediate execution
          const batchPromises = batch.map(task =>
            executeSubTaskWithProgress(task, intent, apiKey, (result) => {
              completedCount++;

              // Handle tasks with multiple tool calls (ambiance, lighting, physics)
              if (result.toolCalls && result.toolCalls.length > 0) {
                // Send a progress event for each tool call
                for (let i = 0; i < result.toolCalls.length; i++) {
                  const toolCall = result.toolCalls[i];
                  const effectName = toolCall.params?.preset || toolCall.params?.type || 'effect';
                  const progressData = {
                    phase: 'generating',
                    totalTasks,
                    completedTasks: completedCount,
                    taskName: `${result.taskName} (${effectName})`,
                    taskId: `${result.taskId}_${i}`,
                    taskType: result.type || 'ambiance',
                    zoneName: 'global',
                    success: result.success,
                    toolCall: toolCall,
                    message: `${result.message || `Adding effect ${i + 1}/${result.toolCalls.length}`}`
                  };
                  res.write(formatSSE('progress', progressData));
                }
                return;
              }

              // Standard single-result progress event
              const progressData = {
                phase: 'generating',
                totalTasks,
                completedTasks: completedCount,
                taskName: result.taskName,
                taskId: result.taskId,
                taskType: result.type || 'geometry',
                zoneName: result.zone?.name || 'global',
                success: result.success,
                message: `Built ${completedCount}/${totalTasks} sections`
              };

              // Include appropriate payload based on task type
              if (result.toolCall) {
                // Non-geometry tasks return tool calls for client to execute
                progressData.toolCall = result.toolCall;
              } else if (result.code) {
                // Geometry tasks return code for immediate execution
                progressData.code = result.code;
              }

              res.write(formatSSE('progress', progressData));
            })
          );

          const batchResults = await Promise.all(batchPromises);
          allBlocks.push(...batchResults);
        }
      }

      // Send completion event with merged code AND tool calls
      const successBlocks = allBlocks.filter(b => b.success);

      // Separate geometry (code) blocks from tool call blocks
      const codeBlocks = successBlocks.filter(b => b.code);
      const toolCallBlocks = successBlocks.filter(b => b.toolCall);

      // Merge geometry code blocks
      const mergedCode = codeBlocks
        .sort((a, b) => {
          const aP = parseInt(a.taskId.split('_')[1]) || 0;
          const bP = parseInt(b.taskId.split('_')[1]) || 0;
          return aP - bP;
        })
        .map(b => `// === ${b.taskName} ===\n// Zone: ${b.zone?.name || 'global'}\n${b.code}`)
        .join('\n\n');

      // Collect tool calls for client to execute
      const toolCalls = toolCallBlocks.map(b => ({
        taskId: b.taskId,
        taskName: b.taskName,
        ...b.toolCall
      }));

      // Calculate average quality score (only for geometry blocks)
      const avgQualityScore = codeBlocks.length > 0
        ? Math.round(codeBlocks.reduce((sum, b) => sum + (b.qualityScore || 0), 0) / codeBlocks.length)
        : 100; // Tool calls always succeed

      res.write(formatSSE('complete', {
        success: successBlocks.length > 0,
        mode: 'parallel',
        mergedCode,
        toolCalls, // Array of tool calls for client to execute
        stats: {
          totalTasks: allBlocks.length,
          successfulTasks: successBlocks.length,
          failedTasks: allBlocks.length - successBlocks.length,
          geometryTasks: codeBlocks.length,
          toolCallTasks: toolCallBlocks.length,
          avgQualityScore,
          totalGenerationTime: allBlocks.reduce((sum, b) => sum + (b.generationTime || 0), 0)
        },
        totalTime: Date.now() - startTime
      }));

      res.end();
      return;
    }

    // Non-streaming mode - with retry logic
    for (const priority of priorities) {
      const priorityTasks = tasksByPriority.get(priority);

      // Execute this priority level in parallel batches
      for (let i = 0; i < priorityTasks.length; i += maxAgents) {
        const batch = priorityTasks.slice(i, i + maxAgents);
        const batchResults = await Promise.all(
          batch.map(task => executeSubTaskWithProgress(task, intent, apiKey, null, 1))
        );
        allBlocks.push(...batchResults);
      }
    }

    // Step 4: Merge results - separate code blocks from tool calls
    const successBlocks = allBlocks.filter(b => b.success);

    // Separate geometry (code) blocks from tool call blocks
    const codeBlocks = successBlocks.filter(b => b.code);
    const toolCallBlocks = successBlocks.filter(b => b.toolCall);

    // Merge geometry code
    const mergedCode = codeBlocks
      .sort((a, b) => {
        const aP = parseInt(a.taskId.split('_')[1]) || 0;
        const bP = parseInt(b.taskId.split('_')[1]) || 0;
        return aP - bP;
      })
      .map(b => `// === ${b.taskName} ===\n// Zone: ${b.zone?.name || 'global'}\n${b.code}`)
      .join('\n\n');

    // Collect tool calls
    const toolCalls = toolCallBlocks.map(b => ({
      taskId: b.taskId,
      taskName: b.taskName,
      ...b.toolCall
    }));

    // Calculate average quality score (only for geometry blocks)
    const avgQualityScore = codeBlocks.length > 0
      ? Math.round(codeBlocks.reduce((sum, b) => sum + (b.qualityScore || 0), 0) / codeBlocks.length)
      : 100;

    console.log(`[ParallelExecute] Complete: ${successBlocks.length}/${allBlocks.length} tasks (${codeBlocks.length} geometry, ${toolCallBlocks.length} tool calls), avg quality: ${avgQualityScore}`);

    return res.status(200).json({
      success: successBlocks.length > 0,
      mode: 'parallel',
      decomposition,
      blocks: allBlocks,
      mergedCode,
      toolCalls,
      stats: {
        totalTasks: allBlocks.length,
        successfulTasks: successBlocks.length,
        failedTasks: allBlocks.length - successBlocks.length,
        geometryTasks: codeBlocks.length,
        toolCallTasks: toolCallBlocks.length,
        avgQualityScore,
        totalGenerationTime: allBlocks.reduce((sum, b) => sum + (b.generationTime || 0), 0)
      },
      totalTime: Date.now() - startTime
    });

  } catch (error) {
    console.error('[ParallelExecute] Error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
      totalTime: Date.now() - startTime
    });
  }
}

export default withApiAccess(handler, "/api/playcanvas/parallel-execute");
