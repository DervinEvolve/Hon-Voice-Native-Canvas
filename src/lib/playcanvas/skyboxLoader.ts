/**
 * Skybox and Environment Loader for PlayCanvas
 *
 * Provides high-quality environment lighting:
 * - HDRI skybox loading
 * - Procedural sky gradients
 * - Time-of-day presets with matching lighting
 * - Environment cubemap for reflections
 */

// Available HDRI presets (using Poly Haven free HDRIs via CDN)
// These are high-quality, free-to-use environment maps
export const HDRI_PRESETS = {
  // Outdoor environments
  'sunset': {
    name: 'Golden Sunset',
    url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/golden_bay_1k.hdr',
    exposure: 1.2,
    skyboxMip: 1,
  },
  'cloudy': {
    name: 'Cloudy Sky',
    url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/kloofendal_48d_partly_cloudy_puresky_1k.hdr',
    exposure: 1.0,
    skyboxMip: 0,
  },
  'night': {
    name: 'Starry Night',
    url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/starry_night_1k.hdr',
    exposure: 0.5,
    skyboxMip: 0,
  },
  'studio': {
    name: 'Studio Light',
    url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_03_1k.hdr',
    exposure: 1.0,
    skyboxMip: 2,
  },
  'forest': {
    name: 'Forest Path',
    url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/forest_slope_1k.hdr',
    exposure: 0.9,
    skyboxMip: 1,
  },
  'city': {
    name: 'City Night',
    url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/modern_buildings_night_1k.hdr',
    exposure: 0.8,
    skyboxMip: 1,
  },
  'beach': {
    name: 'Beach Sunset',
    url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/the_sky_is_on_fire_1k.hdr',
    exposure: 1.3,
    skyboxMip: 0,
  },
  'overcast': {
    name: 'Overcast Day',
    url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/kloofendal_overcast_puresky_1k.hdr',
    exposure: 0.8,
    skyboxMip: 1,
  },
} as const;

export type HDRIPreset = keyof typeof HDRI_PRESETS;

// Gradient sky presets for procedural backgrounds
export const GRADIENT_SKY_PRESETS = {
  'dawn': {
    topColor: [0.1, 0.1, 0.2],
    horizonColor: [1.0, 0.6, 0.3],
    bottomColor: [0.8, 0.4, 0.2],
    sunColor: [1.0, 0.9, 0.7],
    sunIntensity: 0.8,
  },
  'day': {
    topColor: [0.2, 0.4, 0.8],
    horizonColor: [0.6, 0.8, 1.0],
    bottomColor: [0.8, 0.9, 1.0],
    sunColor: [1.0, 1.0, 0.95],
    sunIntensity: 1.2,
  },
  'sunset': {
    topColor: [0.15, 0.1, 0.3],
    horizonColor: [1.0, 0.4, 0.2],
    bottomColor: [0.9, 0.3, 0.1],
    sunColor: [1.0, 0.6, 0.3],
    sunIntensity: 1.0,
  },
  'dusk': {
    topColor: [0.1, 0.05, 0.2],
    horizonColor: [0.4, 0.2, 0.4],
    bottomColor: [0.2, 0.1, 0.2],
    sunColor: [0.8, 0.5, 0.4],
    sunIntensity: 0.4,
  },
  'night': {
    topColor: [0.02, 0.02, 0.05],
    horizonColor: [0.05, 0.05, 0.1],
    bottomColor: [0.02, 0.02, 0.04],
    sunColor: [0.3, 0.4, 0.5],
    sunIntensity: 0.1,
  },
  'midnight': {
    topColor: [0.01, 0.01, 0.02],
    horizonColor: [0.02, 0.02, 0.04],
    bottomColor: [0.01, 0.01, 0.02],
    sunColor: [0.1, 0.1, 0.2],
    sunIntensity: 0.05,
  },
} as const;

export type GradientSkyPreset = keyof typeof GRADIENT_SKY_PRESETS;

// Track current skybox state
let currentSkyboxEntity: any = null;
let currentHDRITexture: any = null;

/**
 * Load and apply an HDRI skybox
 */
export async function loadHDRISkybox(
  app: any,
  preset: HDRIPreset | string
): Promise<boolean> {
  const pc = (window as any).pc;
  if (!pc || !app) {
    console.warn('[Skybox] PlayCanvas not available');
    return false;
  }

  // Get preset or use custom URL
  let hdriUrl: string;
  let exposure = 1.0;
  let skyboxMip = 1;

  if (preset in HDRI_PRESETS) {
    const presetConfig = HDRI_PRESETS[preset as HDRIPreset];
    hdriUrl = presetConfig.url;
    exposure = presetConfig.exposure;
    skyboxMip = presetConfig.skyboxMip;
  } else if (preset.startsWith('http')) {
    hdriUrl = preset;
  } else {
    console.warn(`[Skybox] Unknown preset: ${preset}`);
    return false;
  }

  console.log(`[Skybox] Loading HDRI: ${preset}`);

  try {
    // Load the HDRI texture as an asset
    const asset = new pc.Asset(`hdri_${preset}`, 'texture', {
      url: hdriUrl,
    }, {
      type: pc.TEXTURETYPE_RGBE, // HDRI format
      mipmaps: true,
    });

    return new Promise((resolve) => {
      asset.on('load', () => {
        const texture = asset.resource;
        if (!texture) {
          console.error('[Skybox] Failed to load HDRI texture');
          resolve(false);
          return;
        }

        // Store reference
        currentHDRITexture = texture;

        // Apply to scene
        const scene = app.scene;

        // Set as skybox (if API available)
        if (scene.setSkybox) {
          scene.setSkybox([texture]);
        } else if (scene.skybox !== undefined) {
          scene.skybox = texture;
        }

        // Set skybox mip level (blur)
        if (scene.skyboxMip !== undefined) {
          scene.skyboxMip = skyboxMip;
        }

        // Set exposure
        if (scene.exposure !== undefined) {
          scene.exposure = exposure;
        } else if (scene.rendering?.exposure !== undefined) {
          scene.rendering.exposure = exposure;
        }

        // Also use for environment lighting (IBL)
        if (scene.envAtlas !== undefined) {
          scene.envAtlas = texture;
        }

        console.log(`[Skybox] HDRI applied: ${preset}, exposure=${exposure}`);
        resolve(true);
      });

      asset.on('error', (err: any) => {
        console.error('[Skybox] Failed to load HDRI:', err);
        resolve(false);
      });

      app.assets.add(asset);
      app.assets.load(asset);
    });
  } catch (err) {
    console.error('[Skybox] Error loading HDRI:', err);
    return false;
  }
}

/**
 * Create a procedural gradient sky
 * This works without loading external assets
 */
export function createGradientSky(
  app: any,
  preset: GradientSkyPreset | {
    topColor: number[];
    horizonColor: number[];
    bottomColor: number[];
  }
): boolean {
  const pc = (window as any).pc;
  if (!pc || !app) {
    console.warn('[Skybox] PlayCanvas not available');
    return false;
  }

  // Get colors from preset or use custom
  let colors: {
    topColor: readonly number[] | number[];
    horizonColor: readonly number[] | number[];
    bottomColor: readonly number[] | number[];
  };

  if (typeof preset === 'string' && preset in GRADIENT_SKY_PRESETS) {
    const presetData = GRADIENT_SKY_PRESETS[preset as GradientSkyPreset];
    colors = {
      topColor: presetData.topColor,
      horizonColor: presetData.horizonColor,
      bottomColor: presetData.bottomColor,
    };
  } else if (typeof preset === 'object') {
    colors = preset;
  } else {
    console.warn(`[Skybox] Unknown gradient preset: ${preset}`);
    return false;
  }

  try {
    // Remove existing skybox entity
    if (currentSkyboxEntity) {
      currentSkyboxEntity.destroy();
      currentSkyboxEntity = null;
    }

    // Create a sky dome entity
    const skyDome = new pc.Entity('sky_dome');

    // Add a sphere render component (inverted)
    skyDome.addComponent('render', {
      type: 'sphere',
    });

    // Scale it large to encompass the scene
    skyDome.setLocalScale(500, 500, 500);
    skyDome.setPosition(0, 0, 0);

    // Create gradient material
    const material = new pc.StandardMaterial();
    material.useSkybox = false;
    material.useLighting = false;
    material.cull = pc.CULLFACE_FRONT; // Render inside of sphere

    // Set emissive to gradient (approximation - top color)
    material.emissive = new pc.Color(
      colors.topColor[0],
      colors.topColor[1],
      colors.topColor[2]
    );
    material.emissiveIntensity = 1;

    // For a proper gradient, we'd need a custom shader
    // For now, use the average color
    const avgColor = [
      (colors.topColor[0] + colors.horizonColor[0] + colors.bottomColor[0]) / 3,
      (colors.topColor[1] + colors.horizonColor[1] + colors.bottomColor[1]) / 3,
      (colors.topColor[2] + colors.horizonColor[2] + colors.bottomColor[2]) / 3,
    ];
    material.diffuse = new pc.Color(avgColor[0], avgColor[1], avgColor[2]);

    material.update();

    // Apply material
    if (skyDome.render) {
      skyDome.render.material = material;
    }

    // Add to scene
    app.root.addChild(skyDome);
    currentSkyboxEntity = skyDome;

    // Also set the clear color to match horizon
    const camera = app.root.findByName('camera');
    if (camera && camera.camera) {
      camera.camera.clearColor = new pc.Color(
        colors.horizonColor[0],
        colors.horizonColor[1],
        colors.horizonColor[2]
      );
    }

    console.log(`[Skybox] Gradient sky created: ${typeof preset === 'string' ? preset : 'custom'}`);
    return true;
  } catch (err) {
    console.error('[Skybox] Error creating gradient sky:', err);
    return false;
  }
}

/**
 * Set simple solid color background (for splat viewing)
 */
export function setSolidBackground(
  app: any,
  colorHex: string = '#000000'
): boolean {
  const pc = (window as any).pc;
  if (!pc || !app) return false;

  try {
    // Parse hex color
    const hex = colorHex.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;

    // Remove skybox
    clearSkybox(app);

    // Set camera clear color
    const camera = app.root.findByName('camera');
    if (camera && camera.camera) {
      camera.camera.clearColor = new pc.Color(r, g, b);
    }

    // Also set scene ambient
    const scene = app.scene;
    if (scene.ambientLight) {
      // Keep ambient slightly brighter for visibility
      scene.ambientLight = new pc.Color(
        Math.max(r * 2, 0.1),
        Math.max(g * 2, 0.1),
        Math.max(b * 2, 0.1)
      );
    }

    console.log(`[Skybox] Solid background set: ${colorHex}`);
    return true;
  } catch (err) {
    console.error('[Skybox] Error setting solid background:', err);
    return false;
  }
}

/**
 * Clear all skybox/environment settings (return to black)
 */
export function clearSkybox(app: any): void {
  const pc = (window as any).pc;
  if (!pc || !app) return;

  // Destroy sky dome entity
  if (currentSkyboxEntity) {
    currentSkyboxEntity.destroy();
    currentSkyboxEntity = null;
  }

  // Clear HDRI texture reference
  if (currentHDRITexture) {
    currentHDRITexture = null;
  }

  // Reset scene skybox
  const scene = app.scene;
  if (scene.skybox !== undefined) {
    scene.skybox = null;
  }
  if (scene.envAtlas !== undefined) {
    scene.envAtlas = null;
  }

  // Reset camera to black
  const camera = app.root.findByName('camera');
  if (camera && camera.camera) {
    camera.camera.clearColor = new pc.Color(0, 0, 0);
  }

  console.log('[Skybox] Cleared');
}

/**
 * Apply time-of-day lighting preset
 * Updates lights and ambient without changing skybox
 */
export function applyTimeOfDayLighting(
  app: any,
  time: 'dawn' | 'morning' | 'noon' | 'afternoon' | 'sunset' | 'dusk' | 'night' | 'midnight'
): boolean {
  const pc = (window as any).pc;
  if (!pc || !app) return false;

  const lightingPresets = {
    dawn: {
      sunColor: [1.0, 0.7, 0.5],
      sunIntensity: 0.6,
      sunAngles: [10, 90, 0],
      ambientColor: [0.4, 0.3, 0.3],
      ambientIntensity: 0.3,
    },
    morning: {
      sunColor: [1.0, 0.95, 0.9],
      sunIntensity: 0.9,
      sunAngles: [30, 60, 0],
      ambientColor: [0.5, 0.5, 0.6],
      ambientIntensity: 0.4,
    },
    noon: {
      sunColor: [1.0, 1.0, 0.98],
      sunIntensity: 1.2,
      sunAngles: [70, 30, 0],
      ambientColor: [0.6, 0.65, 0.7],
      ambientIntensity: 0.5,
    },
    afternoon: {
      sunColor: [1.0, 0.95, 0.85],
      sunIntensity: 1.0,
      sunAngles: [45, -45, 0],
      ambientColor: [0.55, 0.55, 0.6],
      ambientIntensity: 0.45,
    },
    sunset: {
      sunColor: [1.0, 0.5, 0.2],
      sunIntensity: 0.7,
      sunAngles: [10, -90, 0],
      ambientColor: [0.5, 0.3, 0.3],
      ambientIntensity: 0.35,
    },
    dusk: {
      sunColor: [0.6, 0.4, 0.5],
      sunIntensity: 0.3,
      sunAngles: [-5, -110, 0],
      ambientColor: [0.25, 0.2, 0.3],
      ambientIntensity: 0.25,
    },
    night: {
      sunColor: [0.3, 0.4, 0.6],
      sunIntensity: 0.1,
      sunAngles: [-30, 0, 0],
      ambientColor: [0.1, 0.1, 0.2],
      ambientIntensity: 0.15,
    },
    midnight: {
      sunColor: [0.15, 0.15, 0.25],
      sunIntensity: 0.05,
      sunAngles: [-60, 0, 0],
      ambientColor: [0.05, 0.05, 0.1],
      ambientIntensity: 0.1,
    },
  };

  const preset = lightingPresets[time];
  if (!preset) {
    console.warn(`[Skybox] Unknown time of day: ${time}`);
    return false;
  }

  try {
    // Update sun light
    const sun = app.root.findByName('sun');
    if (sun && sun.light) {
      sun.light.color = new pc.Color(
        preset.sunColor[0],
        preset.sunColor[1],
        preset.sunColor[2]
      );
      sun.light.intensity = preset.sunIntensity;
      sun.setEulerAngles(preset.sunAngles[0], preset.sunAngles[1], preset.sunAngles[2]);
    }

    // Update ambient
    const scene = app.scene;
    if (scene.ambientLight !== undefined) {
      scene.ambientLight = new pc.Color(
        preset.ambientColor[0] * preset.ambientIntensity,
        preset.ambientColor[1] * preset.ambientIntensity,
        preset.ambientColor[2] * preset.ambientIntensity
      );
    }

    console.log(`[Skybox] Time of day lighting applied: ${time}`);
    return true;
  } catch (err) {
    console.error('[Skybox] Error applying time of day:', err);
    return false;
  }
}

/**
 * Get available HDRI presets
 */
export function getHDRIPresets(): string[] {
  return Object.keys(HDRI_PRESETS);
}

/**
 * Get available gradient sky presets
 */
export function getGradientSkyPresets(): string[] {
  return Object.keys(GRADIENT_SKY_PRESETS);
}

export default {
  loadHDRISkybox,
  createGradientSky,
  setSolidBackground,
  clearSkybox,
  applyTimeOfDayLighting,
  getHDRIPresets,
  getGradientSkyPresets,
  HDRI_PRESETS,
  GRADIENT_SKY_PRESETS,
};
