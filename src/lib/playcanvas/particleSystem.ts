/**
 * Particle System for PlayCanvas
 *
 * High-quality particle effects for immersive scenes:
 * - Fire (flames, embers)
 * - Smoke (rising smoke, mist)
 * - Sparkles (magic particles, glitter)
 * - Rain (weather effect)
 * - Snow (weather effect)
 * - Fog volume (atmospheric)
 * - Dust (ambient particles)
 * - Explosion (burst effect)
 */

export type ParticlePreset =
  | 'fire'
  | 'campfire'  // Alias for fire
  | 'smoke'
  | 'sparkles'
  | 'rain'
  | 'snow'
  | 'fog_volume'
  | 'dust'
  | 'explosion'
  | 'embers'
  | 'magic'
  | 'leaves'
  | 'bubbles';

interface ParticleConfig {
  numParticles: number;
  lifetime: number;
  rate: number;
  rate2?: number;
  startAngle?: number;
  startAngle2?: number;
  emitterShape: 'box' | 'sphere';
  emitterExtents?: { x: number; y: number; z: number };
  emitterRadius?: number;
  emitterExtentsInner?: { x: number; y: number; z: number };
  emitterRadiusInner?: number;
  wrap?: boolean;
  wrapBounds?: { x: number; y: number; z: number };
  localSpace: boolean;
  screenSpace?: boolean;
  colorMapAsset?: any;
  normalMapAsset?: any;
  loop: boolean;
  preWarm?: boolean;
  sort?: number;
  mode?: number;
  stretch?: number;
  alignToMotion?: boolean;
  lighting?: boolean;
  halfLambert?: boolean;
  intensity?: number;
  depthWrite?: boolean;
  depthSoftening?: number;
  scaleGraph?: any;
  scaleGraph2?: any;
  colorGraph?: any;
  alphaGraph?: any;
  alphaGraph2?: any;
  localVelocityGraph?: any;
  localVelocityGraph2?: any;
  velocityGraph?: any;
  velocityGraph2?: any;
  rotationSpeedGraph?: any;
  rotationSpeedGraph2?: any;
  radialSpeedGraph?: any;
  radialSpeedGraph2?: any;
}

// Store active particle entities
const activeParticles = new Map<string, any>();

/**
 * Create a particle effect entity with the given preset
 */
export function createParticleEffect(
  app: any,
  preset: ParticlePreset,
  position: { x: number; y: number; z: number },
  options: {
    scale?: number;
    color?: string;
    intensity?: number;
    loop?: boolean;
    autoDestroy?: boolean;
  } = {}
): any {
  const pc = (window as any).pc;
  if (!pc || !app) {
    console.warn('[Particles] PlayCanvas not available');
    return null;
  }

  // Verify pc.Curve and pc.CurveSet are available
  if (!pc.Curve || !pc.CurveSet) {
    console.warn('[Particles] pc.Curve or pc.CurveSet not available - using simple particle');
    return createSimpleParticle(app, pc, preset, position, options);
  }

  const scale = options.scale ?? 1;
  const intensity = options.intensity ?? 1;
  const loop = options.loop ?? true;

  // Get preset configuration
  const config = getPresetConfig(pc, preset, scale, intensity, options.color);
  if (!config) {
    console.warn(`[Particles] Unknown preset: ${preset}`);
    return null;
  }

  // Create particle entity
  const entity = new pc.Entity(`particle_${preset}_${Date.now()}`);
  entity.setPosition(position.x, position.y, position.z);

  try {
    // Add particle system component
    entity.addComponent('particlesystem', {
      ...config,
      loop: loop,
      autoPlay: true,
    });

    // Add to scene - this is where CurveSet errors often occur (during onEnable)
    app.root.addChild(entity);
  } catch (err) {
    console.warn(`[Particles] Failed to create ${preset} with curves, trying simple fallback:`, err);

    // Clean up failed entity
    if (entity.parent) entity.parent.removeChild(entity);
    entity.destroy();

    // Try simple particle fallback (no curves = no CurveSet errors)
    return createSimpleParticle(app, pc, preset, position, options);
  }

  // Track it
  const id = entity.name;
  activeParticles.set(id, entity);

  // Auto-destroy after lifetime if not looping
  if (!loop && options.autoDestroy !== false) {
    const lifetime = (config.lifetime || 1) * 1000 + 500;
    setTimeout(() => {
      destroyParticleEffect(id);
    }, lifetime);
  }

  console.log(`[Particles] Created ${preset} effect at (${position.x}, ${position.y}, ${position.z})`);
  return entity;
}

/**
 * Create a simple particle effect without curves (fallback)
 */
function createSimpleParticle(
  app: any,
  pc: any,
  preset: ParticlePreset,
  position: { x: number; y: number; z: number },
  options: { scale?: number; loop?: boolean } = {}
): any {
  const scale = options.scale ?? 1;
  const loop = options.loop ?? true;

  const entity = new pc.Entity(`particle_${preset}_${Date.now()}`);
  entity.setPosition(position.x, position.y, position.z);

  // Simple configs without curves
  const simpleConfigs: Record<string, any> = {
    fire: { numParticles: 50, lifetime: 1.5, rate: 0.02 },
    campfire: { numParticles: 50, lifetime: 1.5, rate: 0.02 },
    smoke: { numParticles: 30, lifetime: 4, rate: 0.1 },
    dust: { numParticles: 100, lifetime: 6, rate: 0.05 },
    embers: { numParticles: 40, lifetime: 3, rate: 0.05 },
    leaves: { numParticles: 50, lifetime: 5, rate: 0.1 },
    sparkles: { numParticles: 80, lifetime: 2, rate: 0.02 },
    rain: { numParticles: 500, lifetime: 1.5, rate: 0.001 },
    snow: { numParticles: 300, lifetime: 8, rate: 0.01 },
  };

  const config = simpleConfigs[preset] || { numParticles: 30, lifetime: 2, rate: 0.1 };

  entity.addComponent('particlesystem', {
    ...config,
    emitterShape: pc.EMITTERSHAPE_BOX,
    emitterExtents: new pc.Vec3(0.5 * scale, 0.5 * scale, 0.5 * scale),
    localSpace: false,
    loop: loop,
    autoPlay: true,
  });

  app.root.addChild(entity);
  activeParticles.set(entity.name, entity);

  console.log(`[Particles] Created simple ${preset} effect at (${position.x}, ${position.y}, ${position.z})`);
  return entity;
}

/**
 * Get particle configuration for a preset
 */
function getPresetConfig(
  pc: any,
  preset: ParticlePreset,
  scale: number,
  intensity: number,
  colorHex?: string
): any {
  // Parse color if provided
  let baseColor = new pc.Color(1, 0.5, 0.1); // Default orange for fire
  if (colorHex) {
    const hex = colorHex.replace('#', '');
    baseColor = new pc.Color(
      parseInt(hex.substring(0, 2), 16) / 255,
      parseInt(hex.substring(2, 4), 16) / 255,
      parseInt(hex.substring(4, 6), 16) / 255
    );
  }

  switch (preset) {
    case 'fire':
    case 'campfire':  // Alias for fire
      return createFireConfig(pc, scale, intensity);

    case 'smoke':
      return createSmokeConfig(pc, scale, intensity);

    case 'sparkles':
    case 'magic':
      return createSparklesConfig(pc, scale, intensity, baseColor);

    case 'rain':
      return createRainConfig(pc, scale, intensity);

    case 'snow':
      return createSnowConfig(pc, scale, intensity);

    case 'fog_volume':
      return createFogVolumeConfig(pc, scale, intensity);

    case 'dust':
      return createDustConfig(pc, scale, intensity);

    case 'explosion':
      return createExplosionConfig(pc, scale, intensity);

    case 'embers':
      return createEmbersConfig(pc, scale, intensity);

    case 'leaves':
      return createLeavesConfig(pc, scale, intensity);

    case 'bubbles':
      return createBubblesConfig(pc, scale, intensity);

    default:
      return null;
  }
}

/**
 * Fire effect - flickering flames
 */
function createFireConfig(pc: any, scale: number, intensity: number): any {
  return {
    numParticles: Math.floor(50 * intensity),
    lifetime: 1.5,
    rate: 0.02,
    rate2: 0.05,
    emitterShape: pc.EMITTERSHAPE_BOX,
    emitterExtents: new pc.Vec3(0.3 * scale, 0.1 * scale, 0.3 * scale),
    localSpace: false,
    loop: true,
    preWarm: true,
    lighting: false,
    halfLambert: false,
    intensity: 2 * intensity,
    depthWrite: false,
    depthSoftening: 0.1,
    blendType: pc.BLEND_ADDITIVE,
    sort: pc.PARTICLESORT_NEWER_FIRST,

    // Scale: start small, grow, then shrink
    scaleGraph: new pc.CurveSet([
      new pc.Curve([0, 0.2 * scale, 0.2, 0.8 * scale, 0.5, 1.0 * scale, 1, 0.1 * scale]),
    ]),

    // Color: yellow -> orange -> red -> dark
    colorGraph: new pc.CurveSet([
      new pc.Curve([0, 1, 0.3, 1, 0.7, 0.8, 1, 0.2]),     // R
      new pc.Curve([0, 0.9, 0.3, 0.5, 0.7, 0.2, 1, 0]),   // G
      new pc.Curve([0, 0.3, 0.3, 0.1, 0.7, 0, 1, 0]),     // B
    ]),

    // Alpha: fade in and out
    alphaGraph: new pc.Curve([0, 0, 0.1, 0.8, 0.5, 1, 0.8, 0.5, 1, 0]),

    // Velocity: rise upward with some randomness
    velocityGraph: new pc.CurveSet([
      new pc.Curve([0, 0]),                              // X
      new pc.Curve([0, 2 * scale, 1, 3 * scale]),        // Y (upward)
      new pc.Curve([0, 0]),                              // Z
    ]),
    velocityGraph2: new pc.CurveSet([
      new pc.Curve([0, 0.5 * scale]),
      new pc.Curve([0, 3 * scale, 1, 4 * scale]),
      new pc.Curve([0, 0.5 * scale]),
    ]),

    // Rotation
    rotationSpeedGraph: new pc.Curve([0, 50, 1, 100]),
    rotationSpeedGraph2: new pc.Curve([0, -50, 1, -100]),
  };
}

/**
 * Smoke effect - rising billowy smoke
 */
function createSmokeConfig(pc: any, scale: number, intensity: number): any {
  return {
    numParticles: Math.floor(30 * intensity),
    lifetime: 4,
    rate: 0.1,
    rate2: 0.15,
    emitterShape: pc.EMITTERSHAPE_BOX,
    emitterExtents: new pc.Vec3(0.5 * scale, 0.2 * scale, 0.5 * scale),
    localSpace: false,
    loop: true,
    preWarm: true,
    lighting: false,
    intensity: 0.8,
    depthWrite: false,
    depthSoftening: 0.5,
    blendType: pc.BLEND_NORMAL,
    sort: pc.PARTICLESORT_OLDER_FIRST,

    // Scale: grow larger over time
    scaleGraph: new pc.CurveSet([
      new pc.Curve([0, 0.5 * scale, 0.3, 1.5 * scale, 1, 3 * scale]),
    ]),

    // Color: dark gray
    colorGraph: new pc.CurveSet([
      new pc.Curve([0, 0.3, 1, 0.2]),  // R
      new pc.Curve([0, 0.3, 1, 0.2]),  // G
      new pc.Curve([0, 0.3, 1, 0.2]),  // B
    ]),

    // Alpha: fade in, stay, fade out
    alphaGraph: new pc.Curve([0, 0, 0.1, 0.4, 0.5, 0.3, 1, 0]),

    // Velocity: rise slowly with drift
    velocityGraph: new pc.CurveSet([
      new pc.Curve([0, -0.2 * scale, 1, 0.5 * scale]),   // X drift
      new pc.Curve([0, 1 * scale, 1, 2 * scale]),        // Y rise
      new pc.Curve([0, 0]),                               // Z
    ]),
    velocityGraph2: new pc.CurveSet([
      new pc.Curve([0, 0.2 * scale, 1, -0.5 * scale]),
      new pc.Curve([0, 1.5 * scale, 1, 2.5 * scale]),
      new pc.Curve([0, 0.3 * scale]),
    ]),

    rotationSpeedGraph: new pc.Curve([0, 10, 1, 30]),
  };
}

/**
 * Sparkles/Magic effect - floating glitter particles
 */
function createSparklesConfig(pc: any, scale: number, intensity: number, color: any): any {
  return {
    numParticles: Math.floor(80 * intensity),
    lifetime: 2,
    rate: 0.02,
    rate2: 0.05,
    emitterShape: pc.EMITTERSHAPE_SPHERE,
    emitterRadius: 1 * scale,
    emitterRadiusInner: 0.2 * scale,
    localSpace: false,
    loop: true,
    lighting: false,
    intensity: 3 * intensity,
    depthWrite: false,
    blendType: pc.BLEND_ADDITIVE,

    // Scale: tiny sparks
    scaleGraph: new pc.CurveSet([
      new pc.Curve([0, 0.05 * scale, 0.5, 0.15 * scale, 1, 0.02 * scale]),
    ]),

    // Color: use provided color or default to gold
    colorGraph: new pc.CurveSet([
      new pc.Curve([0, color.r, 1, color.r * 0.5]),
      new pc.Curve([0, color.g, 1, color.g * 0.5]),
      new pc.Curve([0, color.b, 1, color.b * 0.5]),
    ]),

    // Alpha: twinkle
    alphaGraph: new pc.Curve([0, 0, 0.1, 1, 0.3, 0.3, 0.5, 1, 0.7, 0.3, 0.9, 1, 1, 0]),

    // Velocity: float around slowly
    velocityGraph: new pc.CurveSet([
      new pc.Curve([0, 0]),
      new pc.Curve([0, 0.5 * scale]),
      new pc.Curve([0, 0]),
    ]),
    velocityGraph2: new pc.CurveSet([
      new pc.Curve([0, 0.3 * scale]),
      new pc.Curve([0, 1 * scale]),
      new pc.Curve([0, 0.3 * scale]),
    ]),
  };
}

/**
 * Rain effect - falling raindrops
 */
function createRainConfig(pc: any, scale: number, intensity: number): any {
  const area = 20 * scale; // Coverage area

  return {
    numParticles: Math.floor(500 * intensity),
    lifetime: 1.5,
    rate: 0.001,
    rate2: 0.003,
    emitterShape: pc.EMITTERSHAPE_BOX,
    emitterExtents: new pc.Vec3(area, 0.5, area),
    localSpace: false,
    loop: true,
    preWarm: true,
    lighting: false,
    intensity: 0.6,
    depthWrite: false,
    blendType: pc.BLEND_NORMAL,
    stretch: 5, // Stretch particles in direction of motion

    // Scale: thin streaks
    scaleGraph: new pc.CurveSet([
      new pc.Curve([0, 0.02 * scale]),
    ]),

    // Color: light blue-gray
    colorGraph: new pc.CurveSet([
      new pc.Curve([0, 0.7]),
      new pc.Curve([0, 0.8]),
      new pc.Curve([0, 0.9]),
    ]),

    alphaGraph: new pc.Curve([0, 0.3, 0.5, 0.5, 1, 0.2]),

    // Velocity: fall fast with slight angle
    velocityGraph: new pc.CurveSet([
      new pc.Curve([0, 0.5 * scale]),                     // X (wind)
      new pc.Curve([0, -15 * scale]),                     // Y (fall)
      new pc.Curve([0, 0]),                               // Z
    ]),

    // Wrap around for continuous rain
    wrap: true,
    wrapBounds: new pc.Vec3(area * 2, 15, area * 2),
  };
}

/**
 * Snow effect - gently falling snowflakes
 */
function createSnowConfig(pc: any, scale: number, intensity: number): any {
  const area = 20 * scale;

  return {
    numParticles: Math.floor(300 * intensity),
    lifetime: 8,
    rate: 0.01,
    rate2: 0.02,
    emitterShape: pc.EMITTERSHAPE_BOX,
    emitterExtents: new pc.Vec3(area, 0.5, area),
    localSpace: false,
    loop: true,
    preWarm: true,
    lighting: false,
    intensity: 1,
    depthWrite: false,
    blendType: pc.BLEND_NORMAL,

    // Scale: varying snowflake sizes
    scaleGraph: new pc.CurveSet([
      new pc.Curve([0, 0.05 * scale, 1, 0.08 * scale]),
    ]),
    scaleGraph2: new pc.CurveSet([
      new pc.Curve([0, 0.1 * scale, 1, 0.15 * scale]),
    ]),

    // Color: pure white
    colorGraph: new pc.CurveSet([
      new pc.Curve([0, 1]),
      new pc.Curve([0, 1]),
      new pc.Curve([0, 1]),
    ]),

    alphaGraph: new pc.Curve([0, 0.6, 0.5, 0.8, 1, 0.4]),

    // Velocity: gentle fall with swaying
    velocityGraph: new pc.CurveSet([
      new pc.Curve([0, -0.3 * scale, 0.5, 0.3 * scale, 1, -0.3 * scale]),
      new pc.Curve([0, -1 * scale]),
      new pc.Curve([0, -0.2 * scale, 0.5, 0.2 * scale, 1, -0.2 * scale]),
    ]),

    rotationSpeedGraph: new pc.Curve([0, 30, 1, 60]),
    rotationSpeedGraph2: new pc.Curve([0, -30, 1, -60]),

    wrap: true,
    wrapBounds: new pc.Vec3(area * 2, 15, area * 2),
  };
}

/**
 * Fog volume effect - low-lying mist
 */
function createFogVolumeConfig(pc: any, scale: number, intensity: number): any {
  return {
    numParticles: Math.floor(20 * intensity),
    lifetime: 10,
    rate: 0.3,
    rate2: 0.5,
    emitterShape: pc.EMITTERSHAPE_BOX,
    emitterExtents: new pc.Vec3(10 * scale, 0.5 * scale, 10 * scale),
    localSpace: false,
    loop: true,
    preWarm: true,
    lighting: false,
    intensity: 0.4,
    depthWrite: false,
    depthSoftening: 2,
    blendType: pc.BLEND_NORMAL,
    sort: pc.PARTICLESORT_OLDER_FIRST,

    // Scale: large fog clouds
    scaleGraph: new pc.CurveSet([
      new pc.Curve([0, 3 * scale, 0.3, 6 * scale, 1, 8 * scale]),
    ]),

    // Color: white/gray fog
    colorGraph: new pc.CurveSet([
      new pc.Curve([0, 0.8]),
      new pc.Curve([0, 0.8]),
      new pc.Curve([0, 0.85]),
    ]),

    alphaGraph: new pc.Curve([0, 0, 0.2, 0.15, 0.8, 0.15, 1, 0]),

    // Velocity: slow drift
    velocityGraph: new pc.CurveSet([
      new pc.Curve([0, 0.2 * scale]),
      new pc.Curve([0, 0.05 * scale]),
      new pc.Curve([0, 0.1 * scale]),
    ]),
  };
}

/**
 * Dust particles - ambient floating dust
 */
function createDustConfig(pc: any, scale: number, intensity: number): any {
  return {
    numParticles: Math.floor(100 * intensity),
    lifetime: 6,
    rate: 0.05,
    rate2: 0.1,
    emitterShape: pc.EMITTERSHAPE_BOX,
    emitterExtents: new pc.Vec3(5 * scale, 3 * scale, 5 * scale),
    localSpace: false,
    loop: true,
    preWarm: true,
    lighting: true,
    halfLambert: true,
    intensity: 1,
    depthWrite: false,
    blendType: pc.BLEND_NORMAL,

    scaleGraph: new pc.CurveSet([
      new pc.Curve([0, 0.02 * scale, 1, 0.03 * scale]),
    ]),

    colorGraph: new pc.CurveSet([
      new pc.Curve([0, 0.9]),
      new pc.Curve([0, 0.85]),
      new pc.Curve([0, 0.7]),
    ]),

    alphaGraph: new pc.Curve([0, 0, 0.2, 0.3, 0.8, 0.3, 1, 0]),

    velocityGraph: new pc.CurveSet([
      new pc.Curve([0, 0.1 * scale, 0.5, -0.1 * scale, 1, 0.1 * scale]),
      new pc.Curve([0, 0.05 * scale]),
      new pc.Curve([0, 0.05 * scale, 0.5, -0.05 * scale, 1, 0.05 * scale]),
    ]),
  };
}

/**
 * Explosion effect - burst of particles
 */
function createExplosionConfig(pc: any, scale: number, intensity: number): any {
  return {
    numParticles: Math.floor(100 * intensity),
    lifetime: 1,
    rate: 0, // All at once
    rate2: 0,
    emitterShape: pc.EMITTERSHAPE_SPHERE,
    emitterRadius: 0.1 * scale,
    localSpace: false,
    loop: false,
    lighting: false,
    intensity: 4 * intensity,
    depthWrite: false,
    blendType: pc.BLEND_ADDITIVE,

    scaleGraph: new pc.CurveSet([
      new pc.Curve([0, 0.5 * scale, 0.3, 1 * scale, 1, 0.1 * scale]),
    ]),

    colorGraph: new pc.CurveSet([
      new pc.Curve([0, 1, 0.3, 1, 0.7, 0.8, 1, 0.2]),
      new pc.Curve([0, 0.9, 0.3, 0.5, 0.7, 0.1, 1, 0]),
      new pc.Curve([0, 0.3, 1, 0]),
    ]),

    alphaGraph: new pc.Curve([0, 1, 0.3, 0.8, 1, 0]),

    // Radial burst
    radialSpeedGraph: new pc.Curve([0, 10 * scale, 0.3, 5 * scale, 1, 0]),
    radialSpeedGraph2: new pc.Curve([0, 15 * scale, 0.3, 8 * scale, 1, 0]),
  };
}

/**
 * Embers effect - floating fire embers
 */
function createEmbersConfig(pc: any, scale: number, intensity: number): any {
  return {
    numParticles: Math.floor(40 * intensity),
    lifetime: 3,
    rate: 0.05,
    rate2: 0.1,
    emitterShape: pc.EMITTERSHAPE_BOX,
    emitterExtents: new pc.Vec3(0.5 * scale, 0.2 * scale, 0.5 * scale),
    localSpace: false,
    loop: true,
    lighting: false,
    intensity: 3,
    depthWrite: false,
    blendType: pc.BLEND_ADDITIVE,

    scaleGraph: new pc.CurveSet([
      new pc.Curve([0, 0.03 * scale, 0.5, 0.05 * scale, 1, 0.01 * scale]),
    ]),

    colorGraph: new pc.CurveSet([
      new pc.Curve([0, 1, 0.5, 1, 1, 0.3]),
      new pc.Curve([0, 0.6, 0.5, 0.3, 1, 0.1]),
      new pc.Curve([0, 0.1, 1, 0]),
    ]),

    alphaGraph: new pc.Curve([0, 0, 0.1, 1, 0.7, 0.8, 1, 0]),

    velocityGraph: new pc.CurveSet([
      new pc.Curve([0, 0]),
      new pc.Curve([0, 2 * scale, 1, 3 * scale]),
      new pc.Curve([0, 0]),
    ]),
    velocityGraph2: new pc.CurveSet([
      new pc.Curve([0, 0.5 * scale]),
      new pc.Curve([0, 3 * scale, 1, 4 * scale]),
      new pc.Curve([0, 0.5 * scale]),
    ]),
  };
}

/**
 * Falling leaves effect
 */
function createLeavesConfig(pc: any, scale: number, intensity: number): any {
  return {
    numParticles: Math.floor(50 * intensity),
    lifetime: 5,
    rate: 0.1,
    rate2: 0.2,
    emitterShape: pc.EMITTERSHAPE_BOX,
    emitterExtents: new pc.Vec3(10 * scale, 0.5, 10 * scale),
    localSpace: false,
    loop: true,
    lighting: true,
    halfLambert: true,
    intensity: 1,
    depthWrite: false,
    blendType: pc.BLEND_NORMAL,

    scaleGraph: new pc.CurveSet([
      new pc.Curve([0, 0.15 * scale, 1, 0.2 * scale]),
    ]),

    // Autumn colors
    colorGraph: new pc.CurveSet([
      new pc.Curve([0, 0.9, 1, 0.7]),
      new pc.Curve([0, 0.5, 1, 0.3]),
      new pc.Curve([0, 0.1, 1, 0]),
    ]),

    alphaGraph: new pc.Curve([0, 0, 0.1, 1, 0.9, 1, 1, 0]),

    velocityGraph: new pc.CurveSet([
      new pc.Curve([0, 0.5 * scale, 0.5, -0.5 * scale, 1, 0.5 * scale]),
      new pc.Curve([0, -1 * scale]),
      new pc.Curve([0, 0.3 * scale, 0.5, -0.3 * scale, 1, 0.3 * scale]),
    ]),

    rotationSpeedGraph: new pc.Curve([0, 100, 1, 200]),
    rotationSpeedGraph2: new pc.Curve([0, -100, 1, -200]),
  };
}

/**
 * Bubbles effect
 */
function createBubblesConfig(pc: any, scale: number, intensity: number): any {
  return {
    numParticles: Math.floor(30 * intensity),
    lifetime: 4,
    rate: 0.1,
    rate2: 0.2,
    emitterShape: pc.EMITTERSHAPE_SPHERE,
    emitterRadius: 0.5 * scale,
    localSpace: false,
    loop: true,
    lighting: false,
    intensity: 1.5,
    depthWrite: false,
    blendType: pc.BLEND_NORMAL,

    scaleGraph: new pc.CurveSet([
      new pc.Curve([0, 0.1 * scale, 0.5, 0.2 * scale, 1, 0.15 * scale]),
    ]),
    scaleGraph2: new pc.CurveSet([
      new pc.Curve([0, 0.15 * scale, 0.5, 0.3 * scale, 1, 0.25 * scale]),
    ]),

    colorGraph: new pc.CurveSet([
      new pc.Curve([0, 0.8]),
      new pc.Curve([0, 0.9]),
      new pc.Curve([0, 1]),
    ]),

    alphaGraph: new pc.Curve([0, 0.3, 0.5, 0.5, 0.9, 0.3, 1, 0]),

    velocityGraph: new pc.CurveSet([
      new pc.Curve([0, 0]),
      new pc.Curve([0, 1 * scale, 1, 2 * scale]),
      new pc.Curve([0, 0]),
    ]),
    velocityGraph2: new pc.CurveSet([
      new pc.Curve([0, 0.3 * scale]),
      new pc.Curve([0, 1.5 * scale, 1, 2.5 * scale]),
      new pc.Curve([0, 0.3 * scale]),
    ]),
  };
}

/**
 * Destroy a particle effect by ID
 */
export function destroyParticleEffect(id: string): boolean {
  const entity = activeParticles.get(id);
  if (entity) {
    entity.destroy();
    activeParticles.delete(id);
    console.log(`[Particles] Destroyed effect: ${id}`);
    return true;
  }
  return false;
}

/**
 * Destroy all active particle effects
 */
export function destroyAllParticleEffects(): void {
  for (const [id, entity] of activeParticles) {
    entity.destroy();
  }
  activeParticles.clear();
  console.log('[Particles] All effects destroyed');
}

/**
 * Get all active particle effect IDs
 */
export function getActiveParticleEffects(): string[] {
  return Array.from(activeParticles.keys());
}

/**
 * Update particle effect position
 */
export function setParticlePosition(
  id: string,
  position: { x: number; y: number; z: number }
): boolean {
  const entity = activeParticles.get(id);
  if (entity) {
    entity.setPosition(position.x, position.y, position.z);
    return true;
  }
  return false;
}

/**
 * Create weather effect covering the scene
 */
export function createWeatherEffect(
  app: any,
  type: 'rain' | 'snow' | 'fog_volume',
  intensity: number = 1
): any {
  // Weather effects are created above the camera and cover a large area
  const camera = app.root.findByName('camera');
  const cameraPos = camera ? camera.getPosition() : { x: 0, y: 0, z: 0 };

  const position = {
    x: cameraPos.x,
    y: type === 'fog_volume' ? cameraPos.y : cameraPos.y + 10,
    z: cameraPos.z,
  };

  return createParticleEffect(app, type, position, {
    scale: 1,
    intensity: intensity,
    loop: true,
  });
}

export default {
  createParticleEffect,
  destroyParticleEffect,
  destroyAllParticleEffects,
  getActiveParticleEffects,
  setParticlePosition,
  createWeatherEffect,
};
