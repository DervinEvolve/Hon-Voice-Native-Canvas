/**
 * Gemini 3 Pro Game Generation Prompts
 * Designed to let Gemini 3's advanced reasoning capabilities shine
 * Less restrictive, more creative, templates only as fallbacks
 */

export const GEMINI3_SYSTEM_PROMPT = [
  "You are Hon's Senior Game Architect. Generate reliable, high-performance Three.js games OR HTML/CSS interactive scenes that plug into Hon's sandbox.",
  "",
  "=== MODE DETECTION ===",
  "Analyze the user's request to determine the appropriate mode:",
  "- THREE.JS GAME MODE: For games, simulations, 3D experiences, physics-based interactions",
  "- HTML/CSS SCENE MODE: For interactive art, visualizations, UI demos, animations, data displays, creative coding",
  "",
  "Keywords suggesting HTML/CSS scene: 'animation', 'visualization', 'art', 'interactive scene', 'CSS', 'particles', 'generative', 'canvas 2D', 'SVG', 'morphing', 'gradient', 'kaleidoscope', 'fractal', 'wave', 'ripple', 'aurora', 'fireworks', 'rain', 'snow', 'starfield', 'matrix', 'typing effect', 'counter', 'clock', 'timer', 'progress', 'loading', 'carousel', 'slider', 'gallery'",
  "",
  "=== THREE.JS GAME MODE ===",
  "EXECUTION ENVIRONMENT:",
  "- Hon injects your code into a pre-built runtime that already creates THREE.Scene, camera, renderer, lights, input handlers, and HUD mounting.",
  "- You NEVER instantiate a renderer, scene, or camera. Use the provided context APIs only.",
  "- Hon will wrap your code using this signature:",
  "  runtime.setup({ THREE, scene, camera, state, hudRoot, finishGame })",
  "  runtime.update({ deltaTime, input, THREE, scene, camera, state, hudRoot, finishGame })",
  "  runtime.cleanup(...)",
  "",
  "MANDATORY DESIGN RULES:",
  "1. All movement/physics use deltaTime (frame-rate independent).",
  "2. Provide engaging mechanics, clear objectives, and the ability to win/lose.",
  "3. Always update \\`state.score\\` and \\`state.health\\` (or set health to null if unused).",
  "4. Call finishGame('win' | 'lose') when the round ends.",
  "5. Keep mesh counts reasonable (<400) and reuse objects when possible.",
  "6. Never rely on DOM APIs beyond updating the provided HUD root.",
  "7. Prefer procedural geometry. Only call window.loadModel3D(url) if Hon supplies URLs.",
  "",
  "STRICT COMPILER RULES:",
  "- NO GLOBAL VARIABLES. Code runs inside a sandbox; variables declared in setup are NOT visible inside update. Persist everything on the provided game object.",
  "  - BAD: let player = ...",
  "  - GOOD: game.objects.player = ...",
  "  - BAD: let score = 0;",
  "  - GOOD: game.state.score = 0;",
  "- NEVER attach event listeners or instantiate OrbitControls. Use the injected input object only.",
  "- Baseline lighting already exists. Only add extra lights if they are gameplay objects (for example a glowing projectile).",
  "CRITICAL: Do NOT create HTML elements (document.createElement) or custom DOM overlays. Hon already renders HUD chrome.",
  "Render HUD info using meshes, sprites, or the provided hudRoot helpers only. Keep UI lightweight and 3D-native.",
  "Keep snippets concise—no verbose comments or redundant markup.",
  "",
  "=== HTML/CSS INTERACTIVE SCENE MODE ===",
  "For non-game interactive experiences, generate a self-contained HTML document with embedded CSS and JavaScript.",
  "",
  "HTML SCENE REQUIREMENTS:",
  "1. Return a COMPLETE HTML document with <!DOCTYPE html>, <html>, <head>, <body>",
  "2. All CSS must be in a <style> tag in the <head>",
  "3. All JavaScript must be in a <script> tag at the end of <body>",
  "4. Use requestAnimationFrame for smooth animations",
  "5. Make it responsive (use vh, vw, %, flexbox, grid)",
  "6. Include mouse/touch interactivity where appropriate",
  "7. Use modern CSS: gradients, transforms, animations, filters, backdrop-filter",
  "8. Canvas 2D is allowed for generative art, particle systems, visualizations",
  "9. SVG is allowed for vector graphics and path animations",
  "",
  "HTML SCENE VISUAL EXCELLENCE:",
  "- Rich color palettes: use CSS custom properties for theming",
  "- Smooth transitions: cubic-bezier easing, transform animations",
  "- Depth and layers: z-index, shadows, blur effects",
  "- Responsive: works at any panel size",
  "- Performance: use transform/opacity for animations, avoid layout thrashing",
  "",
  "HTML SCENE INTERACTIVITY:",
  "- Mouse move: parallax, cursor following, hover effects",
  "- Click/tap: spawn elements, trigger animations, toggle states",
  "- Scroll: reveal animations, progress indicators",
  "- Keyboard: optional controls for scene manipulation",
  "",
  "=== OUTPUT CONTRACT ===",
  "FOR THREE.JS GAMES:",
  "- Return STRICT JSON that matches the schema described in the user prompt.",
  "- JSON only: no markdown, code fences, comments, or trailing text.",
  "- All code snippets must be valid JavaScript strings (escape newlines as \\\\n and inner quotes).",
  "",
  "FOR HTML/CSS SCENES:",
  "- Return ONLY the complete HTML document, no JSON wrapper",
  "- No markdown code fences, no explanations",
  "- The HTML must be valid and self-contained",
  "",
  "You have creative control over visuals, atmosphere, and mechanics, but structural compliance is non-negotiable."
].join('\n');

const GEMINI3_JSON_SCHEMA_INSTRUCTIONS = [
  "Respond with JSON matching this structure (no markdown, no extra keys):",
  "{",
  '  "thought_process": "Optional short explanation of the mechanics (max 5 sentences).",',
  '  "metadata": {',
  '    "title": "Concise game title",',
  '    "genre": "Short descriptor (e.g. Retro FPS, Neon Runner)",',
  '    "summary": "One-sentence overview of the experience"',
  "  },",
  '  "state": "game.state = { score: 0, health: 100, ... }; // MUST assign to game.state",',
  '  "helpers": "// Optional helper functions. Attach meshes to game.objects.* when caching geometry.",',
  '  "setup": "// Initialization code. MUST use game.state & game.objects. Configure camera, populate scene, preload assets.",',
  '  "update": "// The per-frame loop. Signature Hint: ({ deltaTime, input, game, THREE, scene, camera, hudRoot, finishGame, rng }) => { ... }\\n// Responsibilities: consume input, move objects stored on game.objects, mutate game.state, and call finishGame(\'win\'|\'lose\') when appropriate.",',
  '  "hud": {',
  '    "html": "<div>Custom HUD markup (inside hudRoot)</div>",',
  '    "css": ".custom-hud { ... }",',
  '    "update": "// Called every frame. Update HUD DOM nodes using document.getElementById or hudRoot.querySelector."',
  "  },",
  '  "cleanup": "// Optional teardown logic (remove timers, audio, transient meshes).",',
  '  "onGameOver": "// Optional: runs once when finishGame() fires (e.g., spawn explosion, freeze enemies)"',
  "}",
  "",
  "STRICT RULES:",
  "- Strings must use double quotes only. Escape newlines as \\\\n.",
  "- Do not include template literals or unescaped backticks.",
  "- setup/update/cleanup helpers should NEVER declare their own scene/camera/renderer.",
  "- Must call finishGame when the player loses or wins.",
  "- HUD HTML must reference IDs you also update inside hud.update (e.g., #hon-hud-score).",
  "- Use ONLY JSON. No prose, no explanation."
].join('\n');

function formatCustomAssets(customAssets = {}) {
  const entries = Object.entries(customAssets || {});
  if (!entries.length) return '';
  return [
    'Available custom GLB URLs (use only if they enhance gameplay):',
    ...entries
      .filter(([_, url]) => typeof url === 'string' && url)
      .map(([key, url]) => `- ${key}: ${url}`)
  ].join('\n');
}

/**
 * Detect if the request is for an HTML/CSS interactive scene vs a Three.js game
 */
function isInteractiveSceneRequest(description) {
  const desc = description.toLowerCase();
  const sceneKeywords = [
    'animation', 'visualization', 'interactive scene', 'css animation',
    'particles', 'generative', 'canvas 2d', 'svg', 'morphing', 'gradient',
    'kaleidoscope', 'fractal', 'wave', 'ripple', 'aurora', 'fireworks',
    'rain effect', 'snow effect', 'starfield', 'matrix', 'typing effect',
    'counter', 'clock', 'timer', 'progress bar', 'loading animation',
    'carousel', 'slider', 'gallery', 'parallax', 'scroll animation',
    'hover effect', 'mouse trail', 'cursor effect', 'background animation',
    'text animation', 'logo animation', 'splash screen', 'landing page',
    'data visualization', 'chart', 'graph', 'infographic', 'dashboard widget',
    'music visualizer', 'audio reactive', 'waveform', 'spectrum',
    'generative art', 'creative coding', 'procedural', 'algorithmic art',
    'interactive art', 'digital art', 'motion graphics', 'kinetic typography'
  ];
  
  // Check for explicit scene keywords
  if (sceneKeywords.some(kw => desc.includes(kw))) return true;
  
  // Check for explicit game keywords (these override scene detection)
  const gameKeywords = ['game', 'play', 'score', 'enemy', 'player', 'shoot', 'jump', 'collect', 'avoid', 'race', 'puzzle', 'level', 'health', 'lives', 'powerup'];
  if (gameKeywords.some(kw => desc.includes(kw))) return false;
  
  return false;
}

export function generateGemini3Prompt(userDescription, customAssets = {}) {
  const isScene = isInteractiveSceneRequest(userDescription);
  
  if (isScene) {
    // Generate HTML/CSS interactive scene prompt
    return generateInteractiveScenePrompt(userDescription);
  }
  
  // Generate Three.js game prompt (original behavior)
  const assetSection = formatCustomAssets(customAssets);
  return [
    `Design Brief: "${userDescription}"`,
    '',
    'Goals:',
    '- Deliver a complete, replayable arcade experience that matches the request.',
    '- Keep controls intuitive (WASD + mouse + Space/Click for actions).',
    '- Maintain constant motion/pressure so the user can verify controls immediately.',
    '- Ensure there is always a way to increase score and a clear lose state.',
    '',
    assetSection ? `${assetSection}\n` : '',
    'Environment guarantees already provided by Hon:',
    '- Baseline ambient + directional lights (do not add redundant global lights).',
    '- Infinite ground plane at y=0 (add platforms/arenas only when needed).',
    '- Input abstraction delivered every frame as `input`:',
    '  - input.keys: { w, a, s, d, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, space, shift }',
    '  - input.mouse: { x, y, dx, dy, buttons } and input.pointerLocked',
    '  - Example: if (input.keys.w) game.objects.player.position.z -= game.state.speed * deltaTime;',
    '- RNG helper ctx.rng() for deterministic randomness.',
    '',
    'Your job:',
    '- Build distinctive set dressing, enemies, projectiles, collectibles, and win/lose logic.',
    '- Keep the scene populated (no empty rooms).',
    '- Provide a rich HUD (score, health, wave, etc.) so users can see progress while zoomed out.',
    '',
    GEMINI3_JSON_SCHEMA_INSTRUCTIONS.trim()
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Generate prompt for HTML/CSS interactive scenes
 */
function generateInteractiveScenePrompt(userDescription) {
  return `Create an interactive HTML/CSS scene: "${userDescription}"

OUTPUT FORMAT:
Return ONLY a complete, self-contained HTML document. No JSON, no markdown, no explanations.

REQUIREMENTS:
1. Complete HTML5 document structure (<!DOCTYPE html>, <html>, <head>, <body>)
2. All CSS in a <style> tag in <head>
3. All JavaScript in a <script> tag at end of <body>
4. Must be fully responsive (use vh, vw, %, flexbox, grid)
5. Must include interactivity (mouse, touch, or automatic animation)

VISUAL EXCELLENCE:
- Use modern CSS: gradients, transforms, filters, backdrop-filter, clip-path
- Rich color palette with CSS custom properties (--primary, --secondary, etc.)
- Smooth animations with cubic-bezier easing
- Depth through shadows, blur, layering
- Consider dark mode aesthetics

INTERACTIVITY OPTIONS:
- Mouse/touch: hover effects, click spawns, drag interactions, parallax
- Automatic: requestAnimationFrame loops, CSS animations, transitions
- Canvas 2D: for particle systems, generative art, visualizations
- SVG: for vector animations, morphing, path drawing

PERFORMANCE:
- Use transform and opacity for animations (GPU accelerated)
- Avoid layout thrashing (batch DOM reads/writes)
- Use will-change sparingly for heavy animations
- Clean up intervals/animations if needed

EXAMPLE STRUCTURE:
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Interactive Scene</title>
  <style>
    :root {
      --primary: #6366f1;
      --secondary: #ec4899;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      min-height: 100vh;
      background: linear-gradient(135deg, var(--primary), var(--secondary));
      overflow: hidden;
    }
    /* Your creative CSS here */
  </style>
</head>
<body>
  <!-- Your HTML elements here -->
  <script>
    // Your interactive JavaScript here
    // Use requestAnimationFrame for smooth animations
    // Add event listeners for interactivity
  </script>
</body>
</html>

Now create the complete HTML document for: "${userDescription}"`;
}

/**
 * Optimized prompt structure for Gemini 3's reasoning capabilities
 * Places user request first, then technical context (per Gemini 3 best practices)
 */
export function generateGemini3ReasoningPrompt(userDescription, customAssets = {}) {
  // Gemini 3 best practice: User request first, then context
  let prompt = `Game request: "${userDescription}"

Reason through the design:
1. What core mechanics will make this engaging?
2. How should the game feel? (fast-paced, strategic, exploratory, etc.)
3. What visual style fits the concept?
4. What makes this game unique or memorable?

Then implement with:
- Complete Three.js game code
- Rich environment with lighting, materials, effects
- Smooth controls and responsive gameplay
- Clear objectives and game state management

`;

  if (customAssets && typeof customAssets === 'object' && Object.keys(customAssets).length > 0) {
    prompt += `Available 3D models:\n`;
    for (const [key, url] of Object.entries(customAssets)) {
      prompt += `- ${key}: window.loadModel3D('${url}')\n`;
    }
    prompt += `\n`;
  }

  prompt += `Generate the complete game code.`;

  return prompt;
}

