/**
 * Immersive Scene Tools for Hon
 *
 * Tools for adding objects and manipulating the immersive 3D scene via voice commands.
 */

import { useImmersiveSceneStore, getPositionRelativeToCamera, ImmersiveObject } from '../store/immersiveSceneStore';
import { useComicStore } from '../store/useComicStore';

// Color name to hex mapping
const COLOR_MAP: Record<string, string> = {
  red: '#ff0000',
  green: '#00ff00',
  blue: '#0000ff',
  yellow: '#ffff00',
  orange: '#ff8800',
  purple: '#8800ff',
  pink: '#ff00ff',
  cyan: '#00ffff',
  white: '#ffffff',
  black: '#000000',
  gray: '#888888',
  grey: '#888888',
  gold: '#ffd700',
  silver: '#c0c0c0',
  brown: '#8b4513',
  teal: '#008080',
  navy: '#000080',
  coral: '#ff7f50',
  turquoise: '#40e0d0',
  violet: '#ee82ee',
  indigo: '#4b0082',
  lime: '#00ff00',
  crimson: '#dc143c',
  mint: '#98ff98',
  ruby: '#e0115f',
  emerald: '#50c878',
  sapphire: '#0f52ba',
  amber: '#ffbf00',
};

// Parse color from string (name or hex)
function parseColor(colorStr: string): string {
  if (!colorStr) return '#ffffff';
  const lower = colorStr.toLowerCase().trim();
  if (COLOR_MAP[lower]) return COLOR_MAP[lower];
  if (lower.startsWith('#')) return lower;
  for (const [name, hex] of Object.entries(COLOR_MAP)) {
    if (lower.includes(name)) return hex;
  }
  return '#ffffff';
}

// Parse position from parameters
function parsePosition(params: any): { x: number; y: number; z: number } | null {
  const store = useImmersiveSceneStore.getState();
  const camera = store.camera;

  if (params.x !== undefined || params.y !== undefined || params.z !== undefined) {
    return {
      x: Number(params.x) || 0,
      y: Number(params.y) || 0,
      z: Number(params.z) || 0,
    };
  }

  if (params.position || params.where || params.location) {
    const posStr = String(params.position || params.where || params.location).toLowerCase();
    const distance = Number(params.distance) || 3;

    if (posStr.includes('front') || posStr.includes('ahead')) {
      return getPositionRelativeToCamera(camera, 'front', distance);
    }
    if (posStr.includes('behind') || posStr.includes('back')) {
      return getPositionRelativeToCamera(camera, 'behind', distance);
    }
    if (posStr.includes('left')) {
      return getPositionRelativeToCamera(camera, 'left', distance);
    }
    if (posStr.includes('right')) {
      return getPositionRelativeToCamera(camera, 'right', distance);
    }
    if (posStr.includes('above') || posStr.includes('up')) {
      return getPositionRelativeToCamera(camera, 'above', distance);
    }
    if (posStr.includes('below') || posStr.includes('down')) {
      return getPositionRelativeToCamera(camera, 'below', distance);
    }
  }

  return getPositionRelativeToCamera(camera, 'front', 3);
}

// Parse scale from parameters
function parseScale(params: any): { x: number; y: number; z: number } {
  if (params.scale !== undefined) {
    const s = Number(params.scale) || 1;
    return { x: s, y: s, z: s };
  }

  const sizeStr = String(params.size || '').toLowerCase();
  if (sizeStr.includes('tiny')) return { x: 0.2, y: 0.2, z: 0.2 };
  if (sizeStr.includes('small')) return { x: 0.5, y: 0.5, z: 0.5 };
  if (sizeStr.includes('large') || sizeStr.includes('big')) return { x: 2, y: 2, z: 2 };
  if (sizeStr.includes('huge') || sizeStr.includes('giant')) return { x: 4, y: 4, z: 4 };

  return { x: 1, y: 1, z: 1 };
}

// Primitive keywords
const PRIMITIVE_KEYWORDS = [
  'cube', 'box', 'sphere', 'ball', 'orb', 'cylinder', 'pillar',
  'cone', 'pyramid', 'plane', 'floor', 'ground', 'torus', 'ring',
  'light', 'lamp', 'point light', 'spot light'
];

// Check if description is asking for a primitive or custom 3D model
function shouldUseMeshy(description: string): boolean {
  const lower = description.toLowerCase();
  for (const keyword of PRIMITIVE_KEYWORDS) {
    if (lower.includes(keyword)) return false;
  }
  if (lower.split(' ').length <= 2 && !lower.includes('a ')) return false;
  return true;
}

/**
 * Tool: immersive_add_object
 * Add a 3D object to the immersive scene
 * - Primitives (cube, sphere, etc.) are created instantly
 * - Custom objects (dragon, tree, etc.) are generated with Meshy AI
 */
export async function handleImmersiveAddObject(params: any): Promise<{ success: boolean; objectId?: string; message: string; isGenerating?: boolean }> {
  const store = useImmersiveSceneStore.getState();
  const comicStore = useComicStore.getState();

  if (!comicStore.isWorldMode || comicStore.worldModePreference !== 'immersive') {
    return { success: false, message: 'Not in immersive mode. Please activate immersive scene first.' };
  }

  try {
    const description = String(params.description || params.object || params.type || '').trim();
    const descLower = description.toLowerCase();
    const position = parsePosition(params);
    const scale = parseScale(params);
    const color = parseColor(params.color || '');

    // Check if we should generate with Meshy AI
    if (shouldUseMeshy(descLower) && !params.forcePrimitive) {
      return await generateMeshyObject(description, position, scale, params);
    }

    // Create a primitive
    let objectData: Partial<ImmersiveObject> = {
      type: 'primitive',
      position: position || { x: 0, y: 1, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale,
      color,
      createdBy: 'hon',
    };

    if (descLower.includes('cube') || descLower.includes('box')) {
      objectData.primitiveType = 'cube';
      objectData.name = params.name || 'cube';
    } else if (descLower.includes('sphere') || descLower.includes('ball') || descLower.includes('orb')) {
      objectData.primitiveType = 'sphere';
      objectData.name = params.name || 'sphere';
    } else if (descLower.includes('cylinder') || descLower.includes('pillar')) {
      objectData.primitiveType = 'cylinder';
      objectData.name = params.name || 'cylinder';
    } else if (descLower.includes('cone') || descLower.includes('pyramid')) {
      objectData.primitiveType = 'cone';
      objectData.name = params.name || 'cone';
    } else if (descLower.includes('plane') || descLower.includes('floor') || descLower.includes('ground')) {
      objectData.primitiveType = 'plane';
      objectData.name = params.name || 'plane';
    } else if (descLower.includes('torus') || descLower.includes('ring')) {
      objectData.primitiveType = 'torus';
      objectData.name = params.name || 'torus';
    } else if (descLower.includes('light') || descLower.includes('lamp')) {
      objectData.type = 'light';
      objectData.lightType = descLower.includes('spot') ? 'spot' : 'point';
      objectData.intensity = Number(params.intensity) || 2;
      objectData.range = Number(params.range) || 10;
      objectData.name = params.name || 'light';
    } else {
      objectData.primitiveType = 'sphere';
      objectData.name = params.name || description || 'object';
    }

    // Add glow if mentioned
    if (descLower.includes('glow') || descLower.includes('emissive') || descLower.includes('bright')) {
      objectData.emissive = objectData.color || '#ffffff';
      objectData.emissiveIntensity = 2;
    }

    // Add animation if mentioned
    if (params.animation || descLower.includes('spin') || descLower.includes('rotat')) {
      objectData.animation = { type: 'rotate', speed: Number(params.speed) || 1 };
    } else if (descLower.includes('float') || descLower.includes('hover')) {
      objectData.animation = { type: 'float', speed: Number(params.speed) || 1, amplitude: 0.5 };
    } else if (descLower.includes('pulse') || descLower.includes('throb')) {
      objectData.animation = { type: 'pulse', speed: Number(params.speed) || 1 };
    }

    const objectId = store.addObject(objectData as Omit<ImmersiveObject, 'id' | 'createdAt'>);
    store.setLastReferencedObject(objectId);

    return {
      success: true,
      objectId,
      message: `Added ${objectData.name} to the scene.`,
    };
  } catch (err: any) {
    return { success: false, message: err.message || 'Failed to add object' };
  }
}

/**
 * Generate a custom 3D model using Meshy AI and add to scene
 */
async function generateMeshyObject(
  description: string,
  position: { x: number; y: number; z: number } | null,
  scale: { x: number; y: number; z: number },
  params: any
): Promise<{ success: boolean; objectId?: string; message: string; isGenerating?: boolean }> {
  const store = useImmersiveSceneStore.getState();

  console.log('[immersiveSceneTools] Generating 3D model with Meshy:', description);

  try {
    const { meshyService } = await import('./meshyService');
    meshyService.cleanupStale();

    const requestId = await meshyService.submit(description, {
      mode: 'full',
      topology: 'triangle',
      enable_pbr: true,
    });

    console.log('[immersiveSceneTools] Meshy request submitted:', requestId);

    // Create placeholder while generating
    const placeholderData: Partial<ImmersiveObject> = {
      type: 'primitive',
      primitiveType: 'sphere',
      position: position || { x: 0, y: 1, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 0.5, y: 0.5, z: 0.5 },
      color: '#8855ff',
      emissive: '#8855ff',
      emissiveIntensity: 1,
      animation: { type: 'pulse', speed: 2 },
      name: `generating: ${description}`,
      createdBy: 'hon',
    };

    const placeholderId = store.addObject(placeholderData as Omit<ImmersiveObject, 'id' | 'createdAt'>);
    meshyService.setPlaceholderId(requestId, placeholderId);

    // Poll for completion (5 minute timeout)
    const result = await meshyService.waitForResult(requestId, 5 * 60 * 1000, (progress) => {
      console.log('[immersiveSceneTools] Meshy progress:', progress);
      const currentObj = store.objects.find(o => o.id === placeholderId);
      if (currentObj && progress) {
        store.updateObject(placeholderId, {
          name: `generating: ${progress.substring(0, 30)}...`,
        });
      }
    });

    const modelUrl = result?.model_urls?.glb?.url || result?.model_glb?.url || '';
    const thumbnailUrl = result?.thumbnail?.url || '';

    if (!modelUrl) {
      store.removeObject(placeholderId);
      return { success: false, message: 'Model generation completed but no URL was returned.' };
    }

    console.log('[immersiveSceneTools] Meshy model ready:', modelUrl);

    // Update placeholder to actual model
    store.updateObject(placeholderId, {
      type: 'model',
      primitiveType: undefined,
      modelUrl,
      modelPrompt: description,
      position: position || { x: 0, y: 1, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: scale,
      color: undefined,
      emissive: undefined,
      emissiveIntensity: undefined,
      animation: params.animation ? { type: params.animation, speed: Number(params.speed) || 1 } : undefined,
      name: params.name || description,
    });

    store.setLastReferencedObject(placeholderId);

    return {
      success: true,
      objectId: placeholderId,
      message: `Added ${description} to the scene.`,
    };

  } catch (err: any) {
    console.error('[immersiveSceneTools] Meshy generation failed:', err);

    try {
      const { meshyService } = await import('./meshyService');
      const activeGens = meshyService.getActiveGenerations();
      for (const reqId of activeGens) {
        const placeholderId = meshyService.getPlaceholderId(reqId);
        if (placeholderId) {
          const obj = store.objects.find(o => o.id === placeholderId);
          if (obj && obj.name?.startsWith('generating:')) {
            store.removeObject(placeholderId);
          }
        }
      }
    } catch {}

    return {
      success: false,
      message: err.message?.includes('timeout')
        ? 'Model generation is taking longer than expected. Try a simpler description.'
        : err.message || 'Failed to generate 3D model'
    };
  }
}

/**
 * Tool: immersive_spawn_npcs
 * Spawn wandering NPCs in the scene with walking animations
 */
export async function handleImmersiveSpawnNPCs(params: any): Promise<{
  success: boolean;
  message: string;
  count?: number;
}> {
  try {
    const count = params.count || params.number || 5;
    const centerX = params.centerX || params.x || 0;
    const centerZ = params.centerZ || params.z || 0;

    let characterIds: string[] | undefined;
    if (params.characters || params.characterIds) {
      characterIds = params.characters || params.characterIds;
    }

    console.log('[immersiveSceneTools] Spawning NPCs:', { count, centerX, centerZ, characterIds });

    const appEvent = new CustomEvent('hon:spawn-npcs-request', {
      detail: { count, centerX, centerZ, characterIds },
    });
    window.dispatchEvent(appEvent);

    return {
      success: true,
      message: `Spawning ${count} NPCs. They will walk around the scene with animations.`,
      count,
    };
  } catch (err: any) {
    console.error('[immersiveSceneTools] Failed to spawn NPCs:', err);
    return {
      success: false,
      message: err.message || 'Failed to spawn NPCs',
    };
  }
}

/**
 * Tool: immersive_image_to_splat
 * Convert an image into a 3D Gaussian splat
 */
export async function handleImmersiveImageToSplat(params: any): Promise<{
  success: boolean;
  objectId?: string;
  message: string;
  isGenerating?: boolean;
}> {
  const comicStore = useComicStore.getState();

  try {
    let imageUrl = params.imageUrl || params.image_url || params.url || params.image;

    if (!imageUrl && params.useCurrentPanel !== false) {
      const currentPage = comicStore.pages[comicStore.currentPageIndex];
      const currentPanel = currentPage?.panels?.[0];
      if (currentPanel?.url) {
        imageUrl = currentPanel.url;
      }
    }

    if (!imageUrl) {
      return {
        success: false,
        message: 'No image URL provided.',
      };
    }

    console.log('[immersiveSceneTools] Converting image to splat:', imageUrl.substring(0, 80));

    const { sharpService } = await import('./sharpService');
    const { nanoid } = await import('nanoid');

    sharpService.cleanupStale();

    const sceneId = nanoid();
    const sceneName = params.name || `Generated Splat ${new Date().toLocaleTimeString()}`;

    comicStore.addWorldScene({
      id: sceneId,
      name: sceneName,
      source: 'generated',
      status: 'processing',
      createdAt: new Date().toISOString(),
      metadata: { sourceImageUrl: imageUrl },
    });

    comicStore.setWorldSettings({ selectedSceneId: sceneId });

    const requestId = await sharpService.submit(imageUrl);
    comicStore.updateWorldScene(sceneId, { metadata: { sourceImageUrl: imageUrl, sharpRequestId: requestId } });

    const result = await sharpService.waitForResult(requestId, 5 * 60 * 1000, (progress) => {
      console.log('[immersiveSceneTools] Sharp progress:', progress);
      comicStore.updateWorldScene(sceneId, {
        metadata: { sourceImageUrl: imageUrl, sharpRequestId: requestId, progress },
      });
    });

    if (!result.plyUrl) {
      comicStore.updateWorldScene(sceneId, {
        status: 'error',
        errorMessage: 'Splat generation completed but no URL was returned.',
      });
      return { success: false, message: 'Splat generation completed but no URL was returned.' };
    }

    console.log('[immersiveSceneTools] Splat ready');

    comicStore.updateWorldScene(sceneId, {
      status: 'ready',
      fileUrl: result.plyUrl,
      metadata: { sourceImageUrl: imageUrl, sharpRequestId: requestId, sizeBytes: result.sizeBytes, format: 'ply' },
    });

    return {
      success: true,
      objectId: sceneId,
      message: `Created 3D Gaussian splat from image!`,
    };
  } catch (err: any) {
    console.error('[immersiveSceneTools] Sharp generation failed:', err);

    const currentScenes = useComicStore.getState().worldScenes;
    const processingScene = currentScenes.find(s => s.status === 'processing' && s.source === 'generated');
    if (processingScene) {
      useComicStore.getState().updateWorldScene(processingScene.id, {
        status: 'error',
        errorMessage: err.message || 'Failed to generate Gaussian splat',
      });
    }

    return {
      success: false,
      message: err.message?.includes('timeout')
        ? 'Splat generation taking too long. Try a simpler image.'
        : err.message || 'Failed to generate Gaussian splat',
    };
  }
}
