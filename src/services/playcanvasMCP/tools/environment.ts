/**
 * Environment Tools for PlayCanvas MCP
 * 
 * Tools for controlling scene-level settings like fog, lighting, skybox, etc.
 */

import type { MCPTool, MCPToolResult } from '../index';

/**
 * Set scene fog
 */
const setFog: MCPTool = {
  name: 'set_fog',
  description: 'Add or modify fog in the scene for atmosphere',
  parameters: {
    type: 'object',
    properties: {
      enabled: {
        type: 'boolean',
        description: 'Enable or disable fog',
        default: true
      },
      type: {
        type: 'string',
        description: 'Fog type',
        enum: ['linear', 'exp', 'exp2', 'none'],
        default: 'linear'
      },
      color: {
        type: 'string',
        description: 'Fog color (hex or name)'
      },
      density: {
        type: 'number',
        description: 'Fog density (for exp/exp2)',
        default: 0.01
      },
      start: {
        type: 'number',
        description: 'Fog start distance (for linear)',
        default: 10
      },
      end: {
        type: 'number',
        description: 'Fog end distance (for linear)',
        default: 100
      }
    }
  },
  handler: (params, app): MCPToolResult => {
    const pc = (window as any).pc;
    const scene = app.scene;
    
    // PlayCanvas 2.x uses scene directly, 1.x uses scene.rendering
    const rendering = scene.rendering || scene;
    
    try {
      if (params.enabled === false || params.type === 'none') {
        rendering.fog = pc.FOG_NONE;
        return { success: true, message: 'Fog disabled' };
      }
      
      // Set fog type
      switch (params.type) {
        case 'exp':
          rendering.fog = pc.FOG_EXP;
          break;
        case 'exp2':
          rendering.fog = pc.FOG_EXP2;
          break;
        case 'linear':
        default:
          rendering.fog = pc.FOG_LINEAR;
      }
      
      // Set fog color
      if (params.color) {
        rendering.fogColor = parseSceneColor(pc, params.color);
      }
      
      // Set fog parameters
      if (params.density !== undefined) {
        rendering.fogDensity = params.density;
      }
      if (params.start !== undefined) {
        rendering.fogStart = params.start;
      }
      if (params.end !== undefined) {
        rendering.fogEnd = params.end;
      }
      
      return {
        success: true,
        message: `Set ${params.type || 'linear'} fog`
      };
    } catch (err) {
      return { success: false, error: `Could not set fog: ${(err as Error).message}` };
    }
  }
};

/**
 * Set ambient lighting
 */
const setAmbientLight: MCPTool = {
  name: 'set_ambient_light',
  description: 'Set the ambient (global) lighting for the scene',
  parameters: {
    type: 'object',
    properties: {
      color: {
        type: 'string',
        description: 'Ambient light color'
      },
      intensity: {
        type: 'number',
        description: 'Ambient light intensity (0-2)',
        default: 0.5
      }
    }
  },
  handler: (params, app): MCPToolResult => {
    const pc = (window as any).pc;
    const scene = app.scene;
    
    // PlayCanvas 2.x uses scene directly, 1.x uses scene.rendering
    const rendering = scene.rendering || scene;
    
    try {
      if (params.color) {
        const color = parseSceneColor(pc, params.color);
        // Scale by intensity
        const intensity = params.intensity ?? 0.5;
        rendering.ambientLight = new pc.Color(
          color.r * intensity,
          color.g * intensity,
          color.b * intensity
        );
      }
      
      return {
        success: true,
        message: 'Updated ambient lighting'
      };
    } catch (err) {
      return { success: false, error: `Could not set ambient light: ${(err as Error).message}` };
    }
  }
};

/**
 * Set scene exposure/brightness
 */
const setExposure: MCPTool = {
  name: 'set_exposure',
  description: 'Set overall scene brightness/exposure',
  parameters: {
    type: 'object',
    properties: {
      exposure: {
        type: 'number',
        description: 'Exposure value (0.1-5, default 1)',
        default: 1
      }
    }
  },
  handler: (params, app): MCPToolResult => {
    const scene = app.scene;
    
    // PlayCanvas 2.x uses scene directly, 1.x uses scene.rendering
    const rendering = scene.rendering || scene;
    
    try {
      rendering.exposure = params.exposure ?? 1;
      return {
        success: true,
        message: `Set exposure to ${params.exposure ?? 1}`
      };
    } catch (err) {
      return { success: false, error: `Could not set exposure: ${(err as Error).message}` };
    }
  }
};

/**
 * Set skybox color (simple gradient)
 */
const setSkyColor: MCPTool = {
  name: 'set_sky_color',
  description: 'Set the sky/background color of the scene',
  parameters: {
    type: 'object',
    properties: {
      color: {
        type: 'string',
        description: 'Sky color (hex or name like "blue", "sunset", "night")'
      }
    },
    required: ['color']
  },
  handler: (params, app): MCPToolResult => {
    const pc = (window as any).pc;
    
    // Preset sky colors
    const skyPresets: Record<string, [number, number, number]> = {
      day: [0.5, 0.7, 1.0],
      night: [0.05, 0.05, 0.15],
      sunset: [0.9, 0.5, 0.3],
      sunrise: [0.95, 0.7, 0.5],
      overcast: [0.6, 0.6, 0.65],
      stormy: [0.3, 0.3, 0.35],
      space: [0.0, 0.0, 0.02],
      underwater: [0.1, 0.3, 0.5]
    };
    
    let color;
    const preset = skyPresets[params.color?.toLowerCase()];
    if (preset) {
      color = new pc.Color(preset[0], preset[1], preset[2]);
    } else {
      color = parseSceneColor(pc, params.color);
    }
    
    // Set clear color on all cameras
    app.root.forEach((entity: any) => {
      if (entity.camera) {
        entity.camera.clearColor = color;
      }
    });
    
    return {
      success: true,
      message: `Set sky color to ${params.color}`
    };
  }
};

/**
 * Set scene mood/atmosphere preset
 * Inspired by PlayCanvas React <Environment> component patterns
 */
const setMood: MCPTool = {
  name: 'set_mood',
  description: 'Apply a mood/atmosphere preset to the scene. Supports moods (bright, dark, etc.) and times of day (dawn, noon, dusk, night). Natural environments (forest, meadow, tropical) automatically include animated grass.',
  parameters: {
    type: 'object',
    properties: {
      mood: {
        type: 'string',
        description: 'Mood or time-of-day preset',
        enum: [
          // Moods
          'bright', 'dark', 'foggy', 'mysterious', 'warm', 'cool', 'dramatic', 'peaceful', 'spooky', 'underwater',
          // Time of day (inspired by PlayCanvas React Environment presets)
          'dawn', 'morning', 'noon', 'afternoon', 'dusk', 'evening', 'night', 'midnight',
          // Environments
          'forest', 'meadow', 'desert', 'arctic', 'tropical', 'urban', 'space', 'void'
        ]
      },
      includeGrass: {
        type: 'boolean',
        description: 'Auto-add grass for natural environments (default true for forest/meadow/tropical/peaceful)',
        default: true
      },
      transition: {
        type: 'number',
        description: 'Transition time in seconds (0 for instant)',
        default: 0
      }
    },
    required: ['mood']
  },
  handler: async (params, app): Promise<MCPToolResult> => {
    const pc = (window as any).pc;
    const scene = app.scene;
    
    // PlayCanvas 2.x uses scene directly, 1.x uses scene.rendering
    const rendering = scene.rendering || scene;
    
    // Comprehensive mood presets (inspired by PlayCanvas React Environment component)
    const moods: Record<string, {
      ambientColor: [number, number, number];
      fogColor?: [number, number, number];
      fogDensity?: number;
      exposure?: number;
      skyColor: [number, number, number];
    }> = {
      // ---- Original moods ----
      bright: {
        ambientColor: [0.8, 0.8, 0.9],
        skyColor: [0.6, 0.8, 1.0],
        exposure: 1.2
      },
      dark: {
        ambientColor: [0.1, 0.1, 0.15],
        skyColor: [0.02, 0.02, 0.05],
        exposure: 0.5
      },
      foggy: {
        ambientColor: [0.6, 0.6, 0.65],
        fogColor: [0.7, 0.7, 0.75],
        fogDensity: 0.03,
        skyColor: [0.7, 0.7, 0.75],
        exposure: 0.9
      },
      mysterious: {
        ambientColor: [0.2, 0.15, 0.3],
        fogColor: [0.1, 0.05, 0.15],
        fogDensity: 0.02,
        skyColor: [0.1, 0.05, 0.15],
        exposure: 0.7
      },
      warm: {
        ambientColor: [0.9, 0.7, 0.5],
        skyColor: [0.95, 0.7, 0.4],
        exposure: 1.1
      },
      cool: {
        ambientColor: [0.5, 0.6, 0.8],
        skyColor: [0.4, 0.5, 0.7],
        exposure: 0.9
      },
      dramatic: {
        ambientColor: [0.3, 0.2, 0.2],
        fogColor: [0.1, 0.05, 0.05],
        fogDensity: 0.01,
        skyColor: [0.2, 0.1, 0.1],
        exposure: 0.8
      },
      peaceful: {
        ambientColor: [0.7, 0.8, 0.7],
        skyColor: [0.6, 0.8, 0.9],
        exposure: 1.0
      },
      spooky: {
        ambientColor: [0.15, 0.2, 0.15],
        fogColor: [0.1, 0.15, 0.1],
        fogDensity: 0.025,
        skyColor: [0.05, 0.08, 0.05],
        exposure: 0.6
      },
      underwater: {
        ambientColor: [0.2, 0.4, 0.5],
        fogColor: [0.1, 0.3, 0.4],
        fogDensity: 0.04,
        skyColor: [0.05, 0.2, 0.3],
        exposure: 0.7
      },
      
      // ---- Time of day ----
      dawn: {
        ambientColor: [0.7, 0.5, 0.5],
        skyColor: [0.9, 0.6, 0.5],
        fogColor: [0.8, 0.5, 0.4],
        fogDensity: 0.008,
        exposure: 0.8
      },
      morning: {
        ambientColor: [0.85, 0.8, 0.7],
        skyColor: [0.7, 0.85, 1.0],
        exposure: 1.0
      },
      noon: {
        ambientColor: [0.95, 0.95, 1.0],
        skyColor: [0.5, 0.7, 1.0],
        exposure: 1.3
      },
      afternoon: {
        ambientColor: [0.9, 0.85, 0.75],
        skyColor: [0.6, 0.75, 0.95],
        exposure: 1.1
      },
      dusk: {
        ambientColor: [0.8, 0.5, 0.4],
        skyColor: [0.85, 0.4, 0.3],
        fogColor: [0.6, 0.3, 0.2],
        fogDensity: 0.01,
        exposure: 0.7
      },
      evening: {
        ambientColor: [0.4, 0.35, 0.5],
        skyColor: [0.25, 0.2, 0.4],
        exposure: 0.6
      },
      night: {
        ambientColor: [0.15, 0.15, 0.25],
        skyColor: [0.05, 0.05, 0.15],
        exposure: 0.4
      },
      midnight: {
        ambientColor: [0.08, 0.08, 0.15],
        skyColor: [0.02, 0.02, 0.08],
        exposure: 0.3
      },
      
      // ---- Environments ----
      forest: {
        ambientColor: [0.4, 0.55, 0.35],
        skyColor: [0.5, 0.65, 0.4],
        fogColor: [0.3, 0.45, 0.25],
        fogDensity: 0.015,
        exposure: 0.85
      },
      meadow: {
        ambientColor: [0.6, 0.75, 0.5],
        skyColor: [0.55, 0.75, 0.95],
        fogColor: [0.7, 0.8, 0.65],
        fogDensity: 0.005,
        exposure: 1.1
      },
      desert: {
        ambientColor: [0.95, 0.85, 0.6],
        skyColor: [0.9, 0.8, 0.55],
        fogColor: [0.85, 0.75, 0.5],
        fogDensity: 0.005,
        exposure: 1.25
      },
      arctic: {
        ambientColor: [0.85, 0.9, 1.0],
        skyColor: [0.8, 0.9, 1.0],
        fogColor: [0.9, 0.95, 1.0],
        fogDensity: 0.02,
        exposure: 1.15
      },
      tropical: {
        ambientColor: [0.7, 0.9, 0.7],
        skyColor: [0.4, 0.85, 1.0],
        exposure: 1.2
      },
      urban: {
        ambientColor: [0.6, 0.6, 0.65],
        skyColor: [0.55, 0.6, 0.7],
        fogColor: [0.5, 0.5, 0.55],
        fogDensity: 0.008,
        exposure: 0.95
      },
      space: {
        ambientColor: [0.05, 0.05, 0.08],
        skyColor: [0.0, 0.0, 0.02],
        exposure: 0.4
      },
      void: {
        ambientColor: [0.0, 0.0, 0.0],
        skyColor: [0.0, 0.0, 0.0],
        exposure: 0.2
      }
    };
    
    const mood = moods[params.mood];
    if (!mood) {
      return { success: false, error: `Unknown mood: ${params.mood}` };
    }
    
    try {
      // Apply ambient
      rendering.ambientLight = new pc.Color(...mood.ambientColor);
      
      // Apply fog if defined
      if (mood.fogColor && mood.fogDensity) {
        rendering.fog = pc.FOG_EXP2;
        rendering.fogColor = new pc.Color(...mood.fogColor);
        rendering.fogDensity = mood.fogDensity;
      } else {
        rendering.fog = pc.FOG_NONE;
      }
      
      // Apply exposure
      if (mood.exposure) {
        rendering.exposure = mood.exposure;
      }
      
      // Apply sky color
      app.root.forEach((entity: any) => {
        if (entity.camera) {
          entity.camera.clearColor = new pc.Color(...mood.skyColor);
        }
      });
      
      // Auto-add grass for natural environments
      const grassMoods: Record<string, string> = {
        forest: 'forest',
        meadow: 'meadow',
        tropical: 'meadow',
        peaceful: 'lawn'
      };
      
      const includeGrass = params.includeGrass !== false; // Default true
      const grassStyle = grassMoods[params.mood];
      
      if (includeGrass && grassStyle) {
        try {
          // Clear any existing grass first
          const { clearGrass, createForestGrass, createMeadowGrass, createLawnGrass } = 
            await import('../../../lib/playcanvas/grassSystem');
          
          clearGrass(app);
          
          // Add appropriate grass style
          if (grassStyle === 'forest') {
            createForestGrass(app, { x: 0, y: 0, z: 0 });
          } else if (grassStyle === 'meadow') {
            createMeadowGrass(app, { x: 0, y: 0, z: 0 });
          } else if (grassStyle === 'lawn') {
            createLawnGrass(app, { x: 0, y: 0, z: 0 });
          }
          
          return {
            success: true,
            message: `Applied "${params.mood}" mood with ${grassStyle} grass`
          };
        } catch (grassErr) {
          console.warn('[setMood] Could not add grass:', grassErr);
          return {
            success: true,
            message: `Applied "${params.mood}" mood to scene`
          };
        }
      }
      
      return {
        success: true,
        message: `Applied "${params.mood}" mood to scene`
      };
    } catch (err) {
      // If rendering properties fail, at least set sky color
      app.root.forEach((entity: any) => {
        if (entity.camera) {
          entity.camera.clearColor = new pc.Color(...mood.skyColor);
        }
      });
      return {
        success: true,
        message: `Applied "${params.mood}" mood (partial - sky color only)`
      };
    }
  }
};

/**
 * Add animated grass/foliage to the scene
 */
const addGrass: MCPTool = {
  name: 'add_grass',
  description: 'Add animated grass field with wind effects. Great for forest, meadow, or nature scenes.',
  parameters: {
    type: 'object',
    properties: {
      style: {
        type: 'string',
        description: 'Grass style preset',
        enum: ['forest', 'meadow', 'lawn', 'wild', 'short', 'tall'],
        default: 'forest'
      },
      areaWidth: {
        type: 'number',
        description: 'Area width in units (default 30)',
        default: 30
      },
      areaDepth: {
        type: 'number',
        description: 'Area depth in units (default 30)',
        default: 30
      },
      positionX: {
        type: 'number',
        description: 'Center X position (default 0)',
        default: 0
      },
      positionY: {
        type: 'number',
        description: 'Center Y position (default 0)',
        default: 0
      },
      positionZ: {
        type: 'number',
        description: 'Center Z position (default 0)',
        default: 0
      },
      density: {
        type: 'number',
        description: 'Blades per unit area (20-80, default varies by style)'
      },
      windStrength: {
        type: 'number',
        description: 'Wind intensity (0-1, default 0.25)'
      },
      colorBase: {
        type: 'string',
        description: 'Base color hex (e.g. "#1a4d1a")'
      },
      colorTip: {
        type: 'string',
        description: 'Tip color hex (e.g. "#4a8b4a")'
      }
    }
  },
  handler: async (params, app): Promise<MCPToolResult> => {
    try {
      const { createGrassField, createForestGrass, createMeadowGrass, createLawnGrass, createWildGrass } =
        await import('../../../lib/playcanvas/grassSystem');

      const position = {
        x: params.positionX ?? 0,
        y: params.positionY ?? 0,
        z: params.positionZ ?? 0
      };
      
      let grassField;
      
      // Use preset styles when no custom params provided
      if (params.style === 'meadow' && !params.density && !params.colorBase) {
        grassField = createMeadowGrass(app, position);
      } else if (params.style === 'lawn' && !params.density && !params.colorBase) {
        grassField = createLawnGrass(app, position);
      } else if (params.style === 'wild' && !params.density && !params.colorBase) {
        grassField = createWildGrass(app, position);
      } else if ((params.style === 'forest' || !params.style) && !params.density && !params.colorBase) {
        grassField = createForestGrass(app, position);
      } else {
        // Custom configuration
        const config: any = { position };

        if (params.areaWidth !== undefined || params.areaDepth !== undefined) {
          config.area = { width: params.areaWidth || 30, depth: params.areaDepth || 30 };
        }

        if (params.density !== undefined) {
          config.density = params.density;
        }
        
        if (params.windStrength !== undefined) {
          config.windStrength = params.windStrength;
        }
        
        if (params.colorBase) {
          config.colorBase = params.colorBase;
        }
        
        if (params.colorTip) {
          config.colorTip = params.colorTip;
        }
        
        // Style-based defaults
        if (params.style === 'short') {
          config.bladeHeight = config.bladeHeight || 0.2;
          config.density = config.density || 60;
        } else if (params.style === 'tall') {
          config.bladeHeight = config.bladeHeight || 0.8;
          config.density = config.density || 25;
          config.windStrength = config.windStrength || 0.4;
        }
        
        grassField = createGrassField(app, config);
      }
      
      if (grassField) {
        return {
          success: true,
          message: `Added ${params.style || 'forest'} grass field`,
          data: { entityId: grassField.getGuid(), name: grassField.name }
        };
      } else {
        return { success: false, error: 'Failed to create grass field' };
      }
    } catch (err) {
      return { success: false, error: `Could not add grass: ${(err as Error).message}` };
    }
  }
};

/**
 * Remove grass from the scene
 */
const removeGrass: MCPTool = {
  name: 'remove_grass',
  description: 'Remove all grass fields from the scene',
  parameters: {
    type: 'object',
    properties: {}
  },
  handler: async (params, app): Promise<MCPToolResult> => {
    try {
      const { clearGrass } = await import('../../../lib/playcanvas/grassSystem');
      clearGrass(app);
      return {
        success: true,
        message: 'Removed all grass from scene'
      };
    } catch (err) {
      return { success: false, error: `Could not remove grass: ${(err as Error).message}` };
    }
  }
};

/**
 * Clear/reset the scene
 */
const clearScene: MCPTool = {
  name: 'clear_scene',
  description: 'Remove all user-created entities from the scene',
  parameters: {
    type: 'object',
    properties: {
      keepLights: {
        type: 'boolean',
        description: 'Keep light entities',
        default: true
      },
      keepCamera: {
        type: 'boolean',
        description: 'Keep camera (always true)',
        default: true
      }
    }
  },
  handler: (params, app): MCPToolResult => {
    const entitiesToRemove: any[] = [];

    app.root.forEach((entity: any) => {
      // Skip camera
      if (entity.camera) return;

      // Optionally skip lights
      if (params.keepLights && entity.light) return;

      // Skip root
      if (entity === app.root) return;

      // ALWAYS preserve default environment (ground, sky)
      if (entity.tags?.has('default_environment')) return;

      entitiesToRemove.push(entity);
    });

    entitiesToRemove.forEach(entity => entity.destroy());

    return {
      success: true,
      message: `Cleared ${entitiesToRemove.length} entities from scene (preserved default environment)`
    };
  }
};

// Helper: Parse color for scene settings
function parseSceneColor(pc: any, colorStr: string): any {
  if (!colorStr) return new pc.Color(0.5, 0.5, 0.5);
  
  const namedColors: Record<string, [number, number, number]> = {
    white: [1, 1, 1],
    black: [0, 0, 0],
    gray: [0.5, 0.5, 0.5],
    grey: [0.5, 0.5, 0.5],
    red: [1, 0, 0],
    green: [0, 1, 0],
    blue: [0, 0, 1],
    yellow: [1, 1, 0],
    cyan: [0, 1, 1],
    magenta: [1, 0, 1],
    orange: [1, 0.5, 0],
    purple: [0.5, 0, 0.5]
  };
  
  const lower = colorStr.toLowerCase();
  if (namedColors[lower]) {
    return new pc.Color(...namedColors[lower]);
  }
  
  if (colorStr.startsWith('#')) {
    const hex = colorStr.slice(1);
    return new pc.Color(
      parseInt(hex.slice(0, 2), 16) / 255,
      parseInt(hex.slice(2, 4), 16) / 255,
      parseInt(hex.slice(4, 6), 16) / 255
    );
  }
  
  return new pc.Color(0.5, 0.5, 0.5);
}

/**
 * Add particle effect to the scene
 */
const addParticleEffect: MCPTool = {
  name: 'add_particle_effect',
  description: 'Add a particle effect like fire, smoke, rain, snow, sparkles, etc. Position as {x,y,z} object.',
  parameters: {
    type: 'object',
    properties: {
      preset: {
        type: 'string',
        description: 'Particle effect preset',
        enum: ['fire', 'smoke', 'sparkles', 'rain', 'snow', 'fog_volume', 'dust', 'explosion', 'embers', 'magic', 'leaves', 'bubbles']
      },
      positionX: {
        type: 'number',
        description: 'X position (default 0)',
        default: 0
      },
      positionY: {
        type: 'number',
        description: 'Y position (default 0)',
        default: 0
      },
      positionZ: {
        type: 'number',
        description: 'Z position (default 0)',
        default: 0
      },
      scale: {
        type: 'number',
        description: 'Scale multiplier (default 1)',
        default: 1
      },
      intensity: {
        type: 'number',
        description: 'Effect intensity multiplier (default 1)',
        default: 1
      },
      color: {
        type: 'string',
        description: 'Override color (hex) for effects like sparkles/magic'
      },
      loop: {
        type: 'boolean',
        description: 'Loop the effect (default true)',
        default: true
      }
    },
    required: ['preset']
  },
  handler: async (params, app): Promise<MCPToolResult> => {
    try {
      const { createParticleEffect } = await import('../../../lib/playcanvas/particleSystem');

      const position = {
        x: params.positionX ?? 0,
        y: params.positionY ?? 0,
        z: params.positionZ ?? 0
      };
      const entity = createParticleEffect(app, params.preset, position, {
        scale: params.scale,
        intensity: params.intensity,
        color: params.color,
        loop: params.loop !== false
      });

      if (entity) {
        return {
          success: true,
          message: `Added ${params.preset} effect at (${position.x}, ${position.y}, ${position.z})`,
          data: { entityId: entity.name, preset: params.preset }
        };
      } else {
        return { success: false, error: 'Failed to create particle effect' };
      }
    } catch (err) {
      return { success: false, error: `Could not add particle effect: ${(err as Error).message}` };
    }
  }
};

/**
 * Add weather effect covering the scene
 */
const addWeather: MCPTool = {
  name: 'add_weather',
  description: 'Add weather effect like rain or snow that covers the entire scene',
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        description: 'Weather type',
        enum: ['rain', 'snow', 'fog_volume']
      },
      intensity: {
        type: 'number',
        description: 'Weather intensity (0.5-2, default 1)',
        default: 1
      }
    },
    required: ['type']
  },
  handler: async (params, app): Promise<MCPToolResult> => {
    try {
      const { createWeatherEffect } = await import('../../../lib/playcanvas/particleSystem');

      const entity = createWeatherEffect(app, params.type, params.intensity || 1);

      if (entity) {
        return {
          success: true,
          message: `Added ${params.type} weather effect`,
          data: { entityId: entity.name }
        };
      } else {
        return { success: false, error: 'Failed to create weather effect' };
      }
    } catch (err) {
      return { success: false, error: `Could not add weather: ${(err as Error).message}` };
    }
  }
};

/**
 * Remove particle effects
 */
const removeParticleEffects: MCPTool = {
  name: 'remove_particle_effects',
  description: 'Remove all particle effects from the scene',
  parameters: {
    type: 'object',
    properties: {}
  },
  handler: async (params, app): Promise<MCPToolResult> => {
    try {
      const { destroyAllParticleEffects } = await import('../../../lib/playcanvas/particleSystem');
      destroyAllParticleEffects();
      return {
        success: true,
        message: 'Removed all particle effects'
      };
    } catch (err) {
      return { success: false, error: `Could not remove particles: ${(err as Error).message}` };
    }
  }
};

/**
 * Load HDRI skybox
 */
const loadSkybox: MCPTool = {
  name: 'load_skybox',
  description: 'Load an HDRI skybox for realistic environment lighting and reflections',
  parameters: {
    type: 'object',
    properties: {
      preset: {
        type: 'string',
        description: 'HDRI preset',
        enum: ['sunset', 'cloudy', 'night', 'studio', 'forest', 'city', 'beach', 'overcast']
      }
    },
    required: ['preset']
  },
  handler: async (params, app): Promise<MCPToolResult> => {
    try {
      const { loadHDRISkybox } = await import('../../../lib/playcanvas/skyboxLoader');

      const success = await loadHDRISkybox(app, params.preset);

      if (success) {
        return {
          success: true,
          message: `Loaded ${params.preset} skybox`
        };
      } else {
        return { success: false, error: 'Failed to load skybox' };
      }
    } catch (err) {
      return { success: false, error: `Could not load skybox: ${(err as Error).message}` };
    }
  }
};

/**
 * Create gradient sky
 */
const createGradientSky: MCPTool = {
  name: 'create_gradient_sky',
  description: 'Create a procedural gradient sky (no external assets needed)',
  parameters: {
    type: 'object',
    properties: {
      preset: {
        type: 'string',
        description: 'Gradient preset',
        enum: ['dawn', 'day', 'sunset', 'dusk', 'night', 'midnight']
      }
    },
    required: ['preset']
  },
  handler: async (params, app): Promise<MCPToolResult> => {
    try {
      const { createGradientSky, applyTimeOfDayLighting } = await import('../../../lib/playcanvas/skyboxLoader');

      const success = createGradientSky(app, params.preset);

      // Also apply matching lighting
      applyTimeOfDayLighting(app, params.preset as any);

      if (success) {
        return {
          success: true,
          message: `Created ${params.preset} gradient sky with matching lighting`
        };
      } else {
        return { success: false, error: 'Failed to create gradient sky' };
      }
    } catch (err) {
      return { success: false, error: `Could not create sky: ${(err as Error).message}` };
    }
  }
};

/**
 * Set post-processing effects
 */
const setPostProcessing: MCPTool = {
  name: 'set_post_processing',
  description: 'Configure post-processing effects like bloom and vignette for cinematic look',
  parameters: {
    type: 'object',
    properties: {
      bloomEnabled: {
        type: 'boolean',
        description: 'Enable bloom glow effect',
        default: true
      },
      bloomIntensity: {
        type: 'number',
        description: 'Bloom intensity (0-2, default 0.3)',
        default: 0.3
      },
      bloomThreshold: {
        type: 'number',
        description: 'Bloom threshold (0-1, default 0.8)',
        default: 0.8
      },
      vignetteEnabled: {
        type: 'boolean',
        description: 'Enable vignette darkened edges',
        default: true
      },
      vignetteIntensity: {
        type: 'number',
        description: 'Vignette intensity (0-1, default 0.3)',
        default: 0.3
      },
      saturation: {
        type: 'number',
        description: 'Color saturation (0-2, default 1.1)',
        default: 1.1
      },
      contrast: {
        type: 'number',
        description: 'Color contrast (0.5-2, default 1.05)',
        default: 1.05
      },
      brightness: {
        type: 'number',
        description: 'Brightness (0.5-2, default 1.0)',
        default: 1.0
      }
    }
  },
  handler: async (params, app): Promise<MCPToolResult> => {
    try {
      const { setBloom, setVignette, setColorGrading } = await import('../../../lib/playcanvas/postProcessing');

      // Apply bloom if any bloom param is set
      if (params.bloomEnabled !== undefined || params.bloomIntensity !== undefined) {
        setBloom(
          params.bloomEnabled !== false,
          params.bloomIntensity ?? 0.3,
          params.bloomThreshold ?? 0.8
        );
      }

      // Apply vignette if any vignette param is set
      if (params.vignetteEnabled !== undefined || params.vignetteIntensity !== undefined) {
        setVignette(
          params.vignetteEnabled !== false,
          params.vignetteIntensity ?? 0.3
        );
      }

      // Apply color grading if any color param is set
      if (params.saturation !== undefined || params.contrast !== undefined || params.brightness !== undefined) {
        setColorGrading(
          params.saturation ?? 1.1,
          params.contrast ?? 1.05,
          params.brightness ?? 1.0
        );
      }

      return {
        success: true,
        message: 'Post-processing settings applied'
      };
    } catch (err) {
      return { success: false, error: `Could not set post-processing: ${(err as Error).message}` };
    }
  }
};

/**
 * Trigger screen effect (for game feedback)
 */
const triggerScreenEffect: MCPTool = {
  name: 'trigger_screen_effect',
  description: 'Trigger a screen effect like damage flash or screen shake for game feedback',
  parameters: {
    type: 'object',
    properties: {
      effect: {
        type: 'string',
        description: 'Effect type',
        enum: ['damage_flash', 'screen_shake']
      },
      intensity: {
        type: 'number',
        description: 'Effect intensity (0-1)',
        default: 0.5
      },
      duration: {
        type: 'number',
        description: 'Duration in milliseconds',
        default: 200
      }
    },
    required: ['effect']
  },
  handler: async (params, app): Promise<MCPToolResult> => {
    try {
      const { triggerDamageFlash, triggerScreenShake } = await import('../../../lib/playcanvas/postProcessing');

      if (params.effect === 'damage_flash') {
        triggerDamageFlash(params.intensity ?? 0.5, params.duration ?? 200);
      } else if (params.effect === 'screen_shake') {
        triggerScreenShake(params.intensity ?? 0.02, params.duration ?? 300);
      }

      return {
        success: true,
        message: `Triggered ${params.effect} effect`
      };
    } catch (err) {
      return { success: false, error: `Could not trigger effect: ${(err as Error).message}` };
    }
  }
};

export const environmentTools: MCPTool[] = [
  setFog,
  setAmbientLight,
  setExposure,
  setSkyColor,
  setMood,
  addGrass,
  removeGrass,
  clearScene,
  // New visual effects tools
  addParticleEffect,
  addWeather,
  removeParticleEffects,
  loadSkybox,
  createGradientSky,
  setPostProcessing,
  triggerScreenEffect
];

