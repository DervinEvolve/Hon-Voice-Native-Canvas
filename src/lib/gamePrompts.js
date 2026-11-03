// Enhanced game generation prompts that leverage all available templates
// This helps Hon create more creative and reliable games

export const GAME_FEATURE_MIXINS = {
  shooting: `
    // Enhanced shooting mechanics with visual polish
    let fireRate = 0.25;
    let lastFireTime = 0;
    const projectiles = [];
    const muzzleFlash = []; // Visual effect
    
    function fireProjectile(x, y, z, direction) {
      // Create visually polished projectile
      const projGeo = new THREE.SphereGeometry(0.15, 12, 12);
      const projMat = new THREE.MeshStandardMaterial({
        color: 0xffff00,
        emissive: 0xffff00,
        emissiveIntensity: 0.9,
        metalness: 0.8,
        roughness: 0.2
      });
      const proj = new THREE.Mesh(projGeo, projMat);
      proj.position.set(x, y, z);
      proj.userData.direction = direction;
      proj.userData.trail = []; // For trail effect
      scene.add(proj);
      projectiles.push(proj);
      
      // Muzzle flash effect
      const flashGeo = new THREE.SphereGeometry(0.3, 8, 8);
      const flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
      const flash = new THREE.Mesh(flashGeo, flashMat);
      flash.position.set(x, y, z);
      scene.add(flash);
      muzzleFlash.push({ mesh: flash, age: 0 });
    }
    
    // In update loop: handle shooting
    lastFireTime += deltaTime;
    if ((inputs.keys[' '] || inputs.keys.Space) && lastFireTime > fireRate) {
      fireProjectile(playerX, playerY, playerZ - 1, { x: 0, y: 0, z: -1 });
      lastFireTime = 0;
    }
    
    // Update projectiles with visual effects
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const proj = projectiles[i];
      proj.position.x += proj.userData.direction.x * 30 * deltaTime;
      proj.position.y += proj.userData.direction.y * 30 * deltaTime;
      proj.position.z += proj.userData.direction.z * 30 * deltaTime;
      
      // Add subtle rotation for visual interest
      proj.rotation.x += deltaTime * 5;
      proj.rotation.y += deltaTime * 5;
      
      if (Math.abs(proj.position.z) > 55) {
        scene.remove(proj);
        projectiles.splice(i, 1);
      }
    }
    
    // Update muzzle flash (fade out quickly)
    for (let i = muzzleFlash.length - 1; i >= 0; i--) {
      muzzleFlash[i].age += deltaTime;
      if (muzzleFlash[i].age > 0.1) {
        scene.remove(muzzleFlash[i].mesh);
        muzzleFlash.splice(i, 1);
      } else {
        muzzleFlash[i].mesh.material.opacity = 0.8 * (1 - muzzleFlash[i].age / 0.1);
        muzzleFlash[i].mesh.scale.setScalar(1 + muzzleFlash[i].age * 2);
      }
    }`,
    
  jumping: `
    // Jump mechanics
    let velocityY = 0;
    let isGrounded = false;
    const jumpPower = 12;
    const gravity = -30;
    
    // In update loop: handle jumping
    if ((inputs.keys[' '] || inputs.keys.Space) && isGrounded) {
      velocityY = jumpPower;
      isGrounded = false;
    }
    
    // Apply gravity
    velocityY += gravity * deltaTime;
    playerY += velocityY * deltaTime;
    
    // Ground check (adjust based on your ground level)
    if (playerY <= 0.5 && velocityY <= 0) {
      playerY = 0.5;
      velocityY = 0;
      isGrounded = true;
    }`,
    
  powerups: `
    // Enhanced power-up system with visual polish
    let speedBoost = 1;
    let invulnerable = false;
    let powerupTimer = 0;
    
    function spawnPowerup(x, y, z, type) {
      // Create visually appealing powerup with multiple elements
      const powerGroup = new THREE.Group();
      
      // Main torus with enhanced materials
      const powerGeo = new THREE.TorusGeometry(0.5, 0.2, 16, 32);
      const powerMat = new THREE.MeshStandardMaterial({
        color: type === 'speed' ? 0x00ff00 : 0xff00ff,
        emissive: type === 'speed' ? 0x00ff00 : 0xff00ff,
        emissiveIntensity: 0.8,
        metalness: 0.9,
        roughness: 0.1
      });
      const powerup = new THREE.Mesh(powerGeo, powerMat);
      powerGroup.add(powerup);
      
      // Add glowing core
      const coreGeo = new THREE.SphereGeometry(0.2, 12, 12);
      const coreMat = new THREE.MeshBasicMaterial({
        color: type === 'speed' ? 0x88ff88 : 0xff88ff,
        emissive: type === 'speed' ? 0x88ff88 : 0xff88ff,
        emissiveIntensity: 1.0
      });
      const core = new THREE.Mesh(coreGeo, coreMat);
      powerGroup.add(core);
      
      powerGroup.position.set(x, y, z);
      powerGroup.userData.type = type;
      powerGroup.userData.rotationSpeed = 2;
      scene.add(powerGroup);
      return powerGroup;
    }
    
    // Animate powerups in update loop:
    // powerup.rotation.y += deltaTime * powerup.userData.rotationSpeed;
    // const pulse = 1 + Math.sin(time * 3) * 0.2;
    // powerup.scale.setScalar(pulse);`,
    
  particles: `
    // Particle effects
    function createParticleExplosion(x, y, z, color = 0xffffff) {
      const particles = [];
      for (let i = 0; i < 20; i++) {
        const particleGeo = new THREE.SphereGeometry(0.1, 4, 4);
        const particleMat = new THREE.MeshBasicMaterial({
          color: color,
          emissive: color,
          emissiveIntensity: 1.0
        });
        const particle = new THREE.Mesh(particleGeo, particleMat);
        particle.position.set(x, y, z);
        particle.userData.velocity = {
          x: (Math.random() - 0.5) * 10,
          y: Math.random() * 10,
          z: (Math.random() - 0.5) * 10
        };
        particle.userData.lifetime = 1.0;
        scene.add(particle);
        particles.push(particle);
      }
      return particles;
    }`
};

export function generateEnhancedPrompt(userDescription, customAssets = {}) {
  // Check if this is an interactive scene request
  if (isInteractiveSceneRequest(userDescription)) {
    return generateInteractiveScenePrompt(userDescription);
  }
  
  const features = detectRequestedFeatures(userDescription);
  
  let prompt = `You are creating a Three.js game. Here are the requirements:

USER REQUEST: ${userDescription}

AVAILABLE GAME TEMPLATES:
1. dodger - Avoid obstacles coming at you
2. collector - Gather items in an arena
3. shooter - Destroy enemies with projectiles  
4. racer - Fly through gates at high speed
5. platformer - Jump between platforms and collect items
6. puzzle - Match-3 style puzzle game

You can MIX features from different templates! For example:
- A collector game with shooting mechanics
- A platformer with enemy dodging
- A racer with collectible power-ups

VISUAL THEMES AVAILABLE:
- neon: Glowing, futuristic with emissive materials
- retro: Bright, flat colors with simple shading
- cyberpunk: Dark with neon accents, metallic surfaces

CRITICAL VISUAL QUALITY REQUIREMENTS:
1. DETAIL & DEPTH - Don't use flat, generic objects:
   - Add geometry complexity: use multiple meshes, combine shapes
   - Create layered environments: background, midground, foreground elements
   - Add environmental details: particles, fog, lighting variations
   - Use varied sizes, rotations, and positions for visual interest
   - Add subtle animations to background elements (rotating objects, floating particles)

2. MATERIAL ENHANCEMENT - Make everything look polished:
   - Use emissive colors for important objects (player, collectibles, weapons)
   - Apply metalness (0.7-1.0) and roughness (0.1-0.3) for realistic materials
   - Add color variation: don't use the same color for everything
   - Create material presets: matte (roughness 0.9), glossy (roughness 0.1), metallic (metalness 0.9)

3. LIGHTING & ATMOSPHERE:
   - Use fog for depth: scene.fog = new THREE.Fog(color, near, far)
   - Multiple light sources: ambient (base lighting) + 2-3 directional/point lights
   - Colorful lights: use warm (0xffaa44) and cool (0x4488ff) light colors
   - Dynamic lighting: adjust intensity based on game state

4. PARTICLE EFFECTS & POLISH:
   - Add particles for impacts, explosions, collectibles
   - Use trails for projectiles and moving objects
   - Add screen shake on impacts
   - Subtle pulsing/glowing animations for important objects

IMPORTANT RULES:
1. ALWAYS include scene.userData.update = function(deltaTime, inputs) { ... }
2. ALWAYS include scene.userData.cleanup = function() { ... }
3. Use inputs.keys for controls (w/a/s/d, ArrowKeys, Space)
4. Create a score display div element with styling
5. Set gameOver flag and scene.userData.gameOver when game ends
6. Use deltaTime for frame-independent movement
7. Add proper multi-source lighting (ambient + 2+ directional/point lights)
8. Make ALL materials visually interesting with emissive, metalness, and roughness

ENHANCED FEATURES TO CONSIDER:
`;

  // Add custom 3D assets information if provided
  const hasCustomAssets = customAssets && typeof customAssets === 'object' && Object.keys(customAssets).length > 0;
  if (hasCustomAssets) {
    prompt += `\nCUSTOM 3D MODELS AVAILABLE:
You can use these pre-generated 3D models (from Meshy/text-to-3d) in your game:
`;
    for (const [key, url] of Object.entries(customAssets)) {
      if (typeof url === 'string' && url) {
        prompt += `- ${key}: Available via window.loadModel3D('${url}')\n`;
        if (key === 'player') {
          prompt += `  CRITICAL: This is the PLAYER CHARACTER. Replace the default player geometry with this model!\n`;
          prompt += `  Example: const playerModel = await window.loadModel3D('${url}');\n`;
          prompt += `           playerModel.position.set(playerX, playerY, playerZ);\n`;
          prompt += `           scene.add(playerModel);\n`;
          prompt += `           // Remove or hide the default player geometry (ConeGeometry, etc.)\n`;
        } else {
          prompt += `  Example: const ${key}Model = await window.loadModel3D('${url}');\n`;
          prompt += `           ${key}Model.position.set(x, y, z); // Use in game\n`;
        }
      }
    }
    prompt += `\nSEAMLESS 3D ASSET INTEGRATION - CRITICAL:
- ALWAYS prefer custom 3D models over primitive geometries when available
- If 'player' model exists: REPLACE default player geometry immediately, don't use both
- Load models at game start: window.loadModel3D('${Object.values(customAssets)[0]}').then(model => { /* use model */ })
- Scale models appropriately: model.scale.set(x, y, z) - typical scale 0.5-2.0
- Add rotation/position to models for natural look
- Models enhance visual quality - use them instead of simple ConeGeometry/BoxGeometry/SphereGeometry
- For async loading: wait for models, then use them. Don't spawn until loaded.
- If model fails to load, fallback to enhanced primitive with better materials\n`;
  }

  // Add relevant feature mixins based on request
  if (features.shooting) {
    prompt += `\n- SHOOTING MECHANICS (Space to fire):
${GAME_FEATURE_MIXINS.shooting}\n`;
  }
  
  if (features.jumping) {
    prompt += `\n- JUMPING MECHANICS (Space to jump):
${GAME_FEATURE_MIXINS.jumping}\n`;
  }
  
  if (features.powerups) {
    prompt += `\n- POWER-UP SYSTEM:
${GAME_FEATURE_MIXINS.powerups}\n`;
  }

  prompt += `
ADVANCED VISUAL POLISH REQUIREMENTS:
- DETAILED ENVIRONMENTS: Create rich, multi-layered scenes, not empty spaces
  * Add environmental objects: buildings, structures, background elements
  * Use varied geometry: mix BoxGeometry, CylinderGeometry, TorusGeometry for visual diversity
  * Create depth: objects at different Z positions with fog for atmosphere
  * Add ambient details: floating particles, rotating background objects

- PROFESSIONAL MATERIALS: Every object should have polished materials
  * Player/enemies: High emissive (0.3-0.8), metallic (0.7-1.0), low roughness (0.1-0.3)
  * Environment: Varying metalness (0.0-0.7), realistic roughness (0.3-0.9)
  * Important items: Bright emissive colors, glowing effects
  * Use THREE.Color() for rich, varied color palettes

- DYNAMIC LIGHTING: Create atmosphere with multiple lights
  * Ambient: Soft base lighting (intensity 0.3-0.5)
  * Directional: Main light source with color (intensity 0.7-1.0)
  * Point/Spot: Accent lights for important areas
  * Adjust light colors: warm (0xffaa44) for sun, cool (0x4488ff) for ambient

- PARTICLE SYSTEMS: Add life to the game
  * Impact particles: Small spheres that spawn and fade on collisions
  * Trail effects: Follow moving objects (projectiles, player)
  * Environmental particles: Floating dust, sparks, ambient effects
  * Use THREE.SphereGeometry(0.1) with MeshBasicMaterial for particles

- SMOOTH ANIMATIONS: Everything should move naturally
  * Use deltaTime for all movement (frame-independent)
  * Add easing: Math.sin(time * speed) for smooth oscillations
  * Rotation: Objects should rotate subtly (cube.rotation.y += deltaTime * 0.5)
  * Scale pulses: Use Math.sin(time) for breathing/glowing effects

- UI POLISH: Make HUD look professional
  * Styled score display with background, padding, font styling
  * Health bars, progress indicators where relevant
  * Visual feedback for all player actions

QUALITY REQUIREMENTS:
- Smooth animations using deltaTime
- Visual feedback for ALL actions (particles, screen effects, sounds visual indicators)
- Clear win/lose conditions with visual indicators
- Balanced difficulty progression
- Memory cleanup in cleanup function
- Rich, detailed environments (not empty spaces)
- Professional visual polish on every element

Generate ONLY the game code, no explanations. Make it visually stunning, detailed, and polished!`;

  return prompt;
}

function detectRequestedFeatures(description) {
  const desc = description.toLowerCase();
  return {
    shooting: desc.includes('shoot') || desc.includes('fire') || desc.includes('laser') || desc.includes('fps'),
    jumping: desc.includes('jump') || desc.includes('platform') || desc.includes('hop'),
    powerups: desc.includes('power') || desc.includes('boost') || desc.includes('upgrade'),
    particles: desc.includes('explod') || desc.includes('particle') || desc.includes('effect')
  };
}

/**
 * Detect if the request is for an HTML/CSS interactive scene vs a Three.js game
 */
export function isInteractiveSceneRequest(description) {
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

/**
 * Generate prompt for HTML/CSS interactive scenes
 */
export function generateInteractiveScenePrompt(userDescription) {
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

// Template for the system prompt that helps Hon understand game creation better
export const ENHANCED_SYSTEM_PROMPT = `You are Hon, an AI creator specializing in Three.js games AND HTML/CSS interactive scenes.

=== CRITICAL: SANDBOX ENVIRONMENT ===
Your code runs in a SANDBOXED iframe with PRE-EXISTING globals. You must NOT create these yourself:

ALREADY PROVIDED (DO NOT DECLARE):
- THREE - The Three.js library
- scene - A THREE.Scene() already created
- camera - A THREE.PerspectiveCamera already created and positioned
- input - Object with { keys: {}, mouse: { x, y, dx, dy }, pointerLocked: boolean }

FORBIDDEN - WILL CAUSE ERRORS:
- const scene = new THREE.Scene() // WRONG - scene already exists
- const camera = new THREE.PerspectiveCamera() // WRONG - camera already exists  
- const renderer = new THREE.WebGLRenderer() // WRONG - renderer is managed
- renderer.render(scene, camera) // WRONG - render loop is managed
- requestAnimationFrame() // WRONG - use scene.userData.update instead
- document.body.appendChild() // WRONG - DOM is managed

=== REQUIRED CODE STRUCTURE ===
Your code MUST follow this exact pattern:

\`\`\`javascript
// 1. Scene setup (add to existing scene, don't create new one)
scene.background = new THREE.Color(0x000011);
scene.fog = new THREE.Fog(0x000011, 10, 100);

// 2. Add lights (scene has basic lights, add more for atmosphere)
const light1 = new THREE.PointLight(0xff6600, 1, 50);
light1.position.set(10, 10, 10);
scene.add(light1);

// 3. Create game objects
const playerGeo = new THREE.BoxGeometry(1, 1, 1);
const playerMat = new THREE.MeshStandardMaterial({ color: 0x00ff00, emissive: 0x00ff00, emissiveIntensity: 0.3 });
const player = new THREE.Mesh(playerGeo, playerMat);
player.position.set(0, 0.5, 0);
scene.add(player);

// 4. Game state
let score = 0;
let health = 100;
let gameOver = false;

// 5. REQUIRED: Animation/update function
scene.userData.update = function(ctx) {
  // ctx contains: { deltaTime, dt, time, input, inputs, scene, camera, THREE }
  const dt = ctx.deltaTime;
  const keys = ctx.input.keys;
  
  if (gameOver) return;
  
  // Movement using WASD or arrows
  if (keys.KeyW || keys.ArrowUp) player.position.z -= 5 * dt;
  if (keys.KeyS || keys.ArrowDown) player.position.z += 5 * dt;
  if (keys.KeyA || keys.ArrowLeft) player.position.x -= 5 * dt;
  if (keys.KeyD || keys.ArrowRight) player.position.x += 5 * dt;
  
  // Update camera to follow player
  camera.position.set(player.position.x, player.position.y + 5, player.position.z + 10);
  camera.lookAt(player.position);
  
  // Game over condition
  if (health <= 0) {
    gameOver = true;
    scene.userData.gameOver = true;
  }
};

// 6. REQUIRED: Cleanup function
scene.userData.cleanup = function() {
  // Remove all objects you added
  scene.remove(player);
  // Dispose geometries and materials
  playerGeo.dispose();
  playerMat.dispose();
};
\`\`\`

=== INPUT HANDLING ===
The input object is provided with these properties:
- input.keys.KeyW, input.keys.KeyA, input.keys.KeyS, input.keys.KeyD - WASD keys
- input.keys.ArrowUp, input.keys.ArrowDown, input.keys.ArrowLeft, input.keys.ArrowRight
- input.keys.Space - spacebar
- input.keys.w, input.keys.a, input.keys.s, input.keys.d - lowercase aliases
- input.keys.space - lowercase alias
- input.mouse.dx, input.mouse.dy - mouse movement (when pointer locked)
- input.pointerLocked - true when mouse is captured

=== SYNTAX ERROR PREVENTION ===
BEFORE outputting code, verify:
1. Every { has a matching }
2. Every ( has a matching )
3. Every [ has a matching ]
4. No trailing commas before closing brackets
5. All strings are properly closed
6. scene.userData.update is defined as a function
7. scene.userData.cleanup is defined as a function
8. NO incomplete statements at end of code

=== MODE DETECTION ===
First, determine if the request is for:
1. THREE.JS GAME: Games with score, health, win/lose conditions, player control
2. HTML/CSS SCENE: Interactive art, visualizations, animations, creative coding, UI demos

Scene keywords: animation, visualization, interactive scene, CSS, particles, generative, canvas 2D, SVG, morphing, gradient, kaleidoscope, fractal, wave, ripple, aurora, fireworks, rain, snow, starfield, matrix, typing effect

=== THREE.JS GAME MODE ===
Game types you can create:
- dodger: Avoid obstacles
- collector: Gather items  
- shooter: Combat with projectiles
- racer: Speed through checkpoints
- platformer: Jump and climb
- puzzle: Logic and matching
- exploration: First-person walking around environments

VISUAL EXCELLENCE:
- Rich environments with multiple objects, not empty scenes
- Professional materials: MeshStandardMaterial with emissive, metalness, roughness
- Multiple light sources with color variation
- Fog for depth: scene.fog = new THREE.Fog(color, near, far)
- Particle effects for impacts and ambiance

EVERY GAME MUST HAVE:
- scene.userData.update = function(ctx) { ... }
- scene.userData.cleanup = function() { ... }
- Game state variables (score, health, etc.)
- Game over condition (set scene.userData.gameOver = true)

=== HTML/CSS INTERACTIVE SCENE MODE ===
For non-game interactive experiences, generate a COMPLETE HTML document:

\`\`\`html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    /* All CSS here */
  </style>
</head>
<body>
  <!-- Content here -->
  <script>
    // All JavaScript here
  </script>
</body>
</html>
\`\`\`

=== OUTPUT FORMAT ===
Return ONLY valid code. No markdown code fences around the output. No explanations.
- For Three.js games: Return raw JavaScript that uses the sandbox globals
- For HTML scenes: Return complete HTML document starting with <!DOCTYPE html>`;

// Backwards compatibility export for services that still import the old name
export const GAME_GENERATION_SYSTEM_PROMPT = ENHANCED_SYSTEM_PROMPT;

// Function to enhance existing game generation
export function enhanceGameRequest(originalRequest) {
  // This can be called before sending to AI to improve results
  const enhanced = generateEnhancedPrompt(originalRequest);
  
  // Add specific quality checks
  const features = detectRequestedFeatures(originalRequest);
  
  return {
    prompt: enhanced,
    expectedFeatures: features,
    validationRules: [
      'Must have update function',
      'Must have cleanup function', 
      'Must handle inputs',
      'Must track score or progress',
      'Must have game over condition'
    ]
  };
}