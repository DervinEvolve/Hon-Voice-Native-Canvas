/**
 * WorldImmersiveCanvas - PlayCanvas-powered immersive scene viewer
 * 
 * Uses PlayCanvas engine (https://github.com/playcanvas/engine) for:
 * - Gaussian splatting (.splat, .ply files)
 * - glTF/GLB model loading
 * - HTML5 interactive scenes
 * - First-person camera controls
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import JSZip from 'jszip';
import { sharpService } from '../../services/sharpService';
import { useComicStore } from '../../store/useComicStore';
import { useImmersiveSceneStore, ImmersiveObject, getPositionRelativeToCamera } from '../../store/immersiveSceneStore';
import { GsplatRevealRadialEffect } from '../../lib/playcanvas/gsplat-reveal-radial';
import { setPlayCanvasApp } from '../../services/playcanvasMCP';
import { ForgeEffectManager, getForgeEffectManager, destroyForgeEffectManager } from '../../lib/playcanvas/forge-effect';
import { HonVisionIndicator } from './HonVisionIndicator';
import { registerBehaviorScripts } from '../../lib/playcanvas/behaviorScripts';
import { WEAPON_MODELS_AVAILABLE } from '../../lib/playcanvas/assetAvailability';

interface WorldImmersiveCanvasProps {
  onClose: () => void;
}

// Loading phases with Hon's signature colors
const LOADING_PHASES = [
  { text: 'Initializing...', color: '#a855f7' },
  { text: 'Loading scene...', color: '#8b5cf6' },
  { text: 'Streaming splats...', color: '#7c3aed' },
  { text: 'Almost there...', color: '#6d28d9' },
];

// LOD preset configurations for different device capabilities
const LOD_PRESETS = {
  'desktop-max': {
    range: [0, 5],
    lodDistances: [10, 20, 40, 80, 120, 150, 200]
  },
  'desktop': {
    range: [1, 5],
    lodDistances: [5, 10, 25, 50, 65, 90, 150]
  },
  'mobile-max': {
    range: [2, 5],
    lodDistances: [5, 7, 12, 25, 75, 120, 200]
  },
  'mobile': {
    range: [3, 5],
    lodDistances: [2, 4, 6, 10, 75, 120, 200]
  }
};

/**
 * Generate invisible collision geometry for a loaded scene
 * Analyzes mesh bounds and creates collision boxes for buildings/structures
 */
function generateSceneCollision(
  app: any, // pc.Application
  sceneEntity: any, // pc.Entity
  basePosition: { x: number; y: number; z: number }
): void {
  const pc = (window as any).pc;
  if (!pc) {
    console.warn('[SceneCollision] PlayCanvas not available');
    return;
  }
  
  console.log('[SceneCollision] Analyzing scene for collision generation...');
  
  // Track created collision boxes
  const collisionBoxes: any[] = [];
  
  // Recursive function to find all render components with mesh instances
  const analyzeMeshes = (entity: any, depth: number = 0): void => {
    if (!entity || depth > 10) return;
    
    // Check if entity has render component with mesh instances
    if (entity.render && entity.render.meshInstances) {
      for (const mi of entity.render.meshInstances) {
        if (!mi.aabb) continue;
        
        // Get the bounding box of this mesh instance
        const aabb = mi.aabb;
        const center = aabb.center;
        const halfExtents = aabb.halfExtents;
        
        // Only create collision for larger objects (likely buildings/walls)
        // Skip small objects like props, debris, etc.
        const minSize = 1.5; // Minimum size in any dimension to be considered a "structure"
        const volume = halfExtents.x * halfExtents.y * halfExtents.z * 8;
        
        if (halfExtents.x > minSize || halfExtents.y > minSize || halfExtents.z > minSize) {
          // Check if this looks like a building (tall) or wall (wide/deep but thin)
          const isBuilding = halfExtents.y > 3; // Tall structures
          const isWall = (halfExtents.x > 2 || halfExtents.z > 2) && halfExtents.y > 1;
          
          if (isBuilding || isWall) {
            // Create collision box entity
            const collisionEntity = new pc.Entity(`collision_${collisionBoxes.length}`);
            collisionEntity.tags.add('scene_collision');
            
            // Position at mesh center
            collisionEntity.setPosition(
              center.x + basePosition.x,
              center.y + basePosition.y,
              center.z + basePosition.z
            );
            
            // Add collision component
            collisionEntity.addComponent('collision', {
              type: 'box',
              halfExtents: new pc.Vec3(
                halfExtents.x * 0.95, // Slightly smaller to avoid edge cases
                halfExtents.y,
                halfExtents.z * 0.95
              )
            });
            
            // Add static rigidbody
            collisionEntity.addComponent('rigidbody', {
              type: 'static',
              friction: 0.5,
              restitution: 0.1
            });
            
            app.root.addChild(collisionEntity);
            collisionBoxes.push(collisionEntity);
          }
        }
      }
    }
    
    // Recurse into children
    if (entity.children) {
      for (const child of entity.children) {
        analyzeMeshes(child, depth + 1);
      }
    }
  };
  
  // Analyze the scene
  analyzeMeshes(sceneEntity);
  
  // If we found very few or no collisions, add some preset collision boxes
  // for common scene types (Times Square, city blocks, etc.)
  if (collisionBoxes.length < 5) {
    console.log('[SceneCollision] Few auto-detected structures, adding preset collision...');
    
    // Add boundary walls around the scene
    const boundarySize = 50;
    const wallHeight = 20;
    const wallThickness = 1;
    
    const boundaries = [
      { pos: [0, wallHeight/2, -boundarySize], ext: [boundarySize, wallHeight/2, wallThickness] }, // Back
      { pos: [0, wallHeight/2, boundarySize], ext: [boundarySize, wallHeight/2, wallThickness] },  // Front
      { pos: [-boundarySize, wallHeight/2, 0], ext: [wallThickness, wallHeight/2, boundarySize] }, // Left
      { pos: [boundarySize, wallHeight/2, 0], ext: [wallThickness, wallHeight/2, boundarySize] },  // Right
    ];
    
    for (let i = 0; i < boundaries.length; i++) {
      const b = boundaries[i];
      const wall = new pc.Entity(`boundary_wall_${i}`);
      wall.tags.add('scene_collision');
      wall.setPosition(
        b.pos[0] + basePosition.x,
        b.pos[1] + basePosition.y,
        b.pos[2] + basePosition.z
      );
      wall.addComponent('collision', {
        type: 'box',
        halfExtents: new pc.Vec3(b.ext[0], b.ext[1], b.ext[2])
      });
      wall.addComponent('rigidbody', {
        type: 'static',
        friction: 0.5,
        restitution: 0.1
      });
      app.root.addChild(wall);
      collisionBoxes.push(wall);
    }
    
    // Add some building-sized collision boxes for urban scenes
    const buildingPositions = [
      { pos: [-15, 15, -15], ext: [8, 15, 8] },
      { pos: [15, 15, -15], ext: [8, 15, 8] },
      { pos: [-15, 15, 15], ext: [8, 15, 8] },
      { pos: [15, 15, 15], ext: [8, 15, 8] },
      { pos: [-20, 10, 0], ext: [5, 10, 12] },
      { pos: [20, 10, 0], ext: [5, 10, 12] },
    ];
    
    for (let i = 0; i < buildingPositions.length; i++) {
      const b = buildingPositions[i];
      const building = new pc.Entity(`building_collision_${i}`);
      building.tags.add('scene_collision');
      building.setPosition(
        b.pos[0] + basePosition.x,
        b.pos[1] + basePosition.y,
        b.pos[2] + basePosition.z
      );
      building.addComponent('collision', {
        type: 'box',
        halfExtents: new pc.Vec3(b.ext[0], b.ext[1], b.ext[2])
      });
      building.addComponent('rigidbody', {
        type: 'static',
        friction: 0.5,
        restitution: 0.1
      });
      app.root.addChild(building);
      collisionBoxes.push(building);
    }
  }
  
  console.log(`[SceneCollision] Created ${collisionBoxes.length} collision boxes for scene`);
}

export const WorldImmersiveCanvas: React.FC<WorldImmersiveCanvasProps> = ({ onClose }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<any>(null);
  const cameraEntityRef = useRef<any>(null);
  const pcRef = useRef<any>(null); // Store PlayCanvas module reference
  const sceneObjectsRef = useRef<Map<string, any>>(new Map()); // Track PlayCanvas entities by object ID
  const forgeManagerRef = useRef<ForgeEffectManager | null>(null); // Forge effect manager for object materialization
  
  const [isLoading, setIsLoading] = useState(true);
  const [loadingPhase, setLoadingPhase] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isPointerLocked, setIsPointerLocked] = useState(false);
  const [selectedEntity, setSelectedEntity] = useState<any>(null);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [transformMode, setTransformMode] = useState<'move' | 'rotate' | 'scale'>('move');
  const selectedEntityRef = useRef<any>(null); // For highlight outline
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number; z: number } | null>(null); // For real-time minimap updates
  
  // Game state - shown when game elements are present
  const [gameState, setGameState] = useState({
    active: false,
    score: 0,
    health: 100,
    maxHealth: 100,
    level: 1,
    gameOver: false,
    victory: false
  });
  
  const worldSettings = useComicStore(s => s.worldSettings);
  const worldScenes = useComicStore(s => s.worldScenes);
  const selectedSceneId = worldSettings.selectedSceneId;
  
  // Immersive scene store
  const immersiveObjects = useImmersiveSceneStore(s => s.objects);
  const immersiveEnvironment = useImmersiveSceneStore(s => s.environment);
  const setEnvironment = useImmersiveSceneStore(s => s.setEnvironment);

  const updateCamera = useImmersiveSceneStore(s => s.updateCamera);

  // Reset to black background on mount (prevents stale blue sky from previous sessions)
  useEffect(() => {
    setEnvironment({ skyColor: '#000000' });
  }, []);
  
  // Get the selected scene and check for LOD URL
  const selectedScene = worldScenes.find(s => s.id === selectedSceneId);
  const lodUrl = selectedScene?.metadata?.lodUrl;
  const lodStatus = selectedScene?.metadata?.lodStatus;
  // Prefer LOD URL if available for true LOD streaming, otherwise fall back to raw file
  const sharpRequestId = selectedScene?.metadata?.sharpRequestId;
  const [privateScene, setPrivateScene] = useState<{ id: string; url: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setPrivateScene(null);
    if (typeof sharpRequestId === 'string') {
      sharpService.refreshResultUrl(sharpRequestId).then(url => {
        if (!cancelled) { setPrivateScene({ id: sharpRequestId, url }); setError(null); }
      }).catch(() => { if (!cancelled) setError('This private scene could not be opened. Sign in as its owner.'); });
    }
    return () => { cancelled = true; };
  }, [sharpRequestId, selectedSceneId]);
  // A persisted signed URL is never reused as proof of private scene access.
  const splatUrl = sharpRequestId
    ? (privateScene?.id === sharpRequestId ? privateScene.url : null)
    : lodUrl || selectedScene?.fileUrl || worldSettings.splatUrl;

  // Cycle loading phases
  useEffect(() => {
    if (!isLoading) return;
    const interval = setInterval(() => {
      setLoadingPhase(p => (p + 1) % LOADING_PHASES.length);
    }, 1500);
    return () => clearInterval(interval);
  }, [isLoading]);

  // Initialize PlayCanvas engine
  useEffect(() => {
    if (!canvasRef.current || (sharpRequestId && !splatUrl)) return;

    let app: any = null;
    let destroyed = false;

    const initPlayCanvas = async () => {
      try {
        // Wait for canvas to have proper dimensions (layout must be complete)
        const canvas = canvasRef.current;
        if (!canvas) return;
        
        // Ensure canvas has dimensions - wait for layout if needed
        let attempts = 0;
        while ((canvas.clientWidth === 0 || canvas.clientHeight === 0) && attempts < 10) {
          await new Promise(resolve => setTimeout(resolve, 50));
          attempts++;
        }
        
        if (canvas.clientWidth === 0 || canvas.clientHeight === 0) {
          console.error('[WorldImmersiveCanvas] Canvas has no dimensions after waiting');
          setError('Canvas layout not ready. Please try again.');
          setIsLoading(false);
          return;
        }
        
        if (destroyed) return;
        
        // Dynamically import PlayCanvas to avoid SSR issues
        const pc = await import('playcanvas');
        pcRef.current = pc; // Store reference for other effects
        
        // Also expose on window for MCP tools to access
        (window as any).pc = pc;
        
        if (destroyed) return;

        console.log('[WorldImmersiveCanvas] Initializing PlayCanvas engine... Canvas:', canvas.clientWidth, 'x', canvas.clientHeight);

        // Create the graphics device (the bridge to GPU)
        const device = await pc.createGraphicsDevice(canvasRef.current!, {
          // Prefer WebGPU if available, fallback to WebGL2
          deviceTypes: [pc.DEVICETYPE_WEBGPU, pc.DEVICETYPE_WEBGL2],
        });

        if (destroyed) {
          device.destroy();
          return;
        }

        // Create the application
        app = new pc.Application(canvasRef.current!, {
          graphicsDevice: device,
          mouse: new pc.Mouse(canvasRef.current!),
          keyboard: new pc.Keyboard(window),
          touch: pc.platform.touch ? new pc.TouchDevice(canvasRef.current!) : undefined,
        });

        appRef.current = app;

        // Fill the window and auto-resize
        app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
        app.setCanvasResolution(pc.RESOLUTION_AUTO);

        // Handle window resize
        const onResize = () => app?.resizeCanvas();
        window.addEventListener('resize', onResize);

        // Handle NPC spawn requests from immersive scene tools
        const handleSpawnNPCsRequest = (event: Event) => {
          const customEvent = event as CustomEvent;
          const { count, centerX, centerZ, characterIds } = customEvent.detail || {};
          console.log('[WorldImmersiveCanvas] Received spawn-npcs-request:', customEvent.detail);
          app.fire('hon:spawn-npcs', { count, centerX, centerZ, characterIds });
        };
        window.addEventListener('hon:spawn-npcs-request', handleSpawnNPCsRequest);

        // DEBUG: Press N key to spawn NPCs directly (for testing without Hon)
        const handleNPCSpawnKey = (e: KeyboardEvent) => {
          if (e.code === 'KeyN' && !e.repeat) {
            console.log('[WorldImmersiveCanvas] N key pressed - spawning NPCs for testing');
            app.fire('hon:spawn-npcs', { count: 5 });
          }
        };
        window.addEventListener('keydown', handleNPCSpawnKey);

        // Undo/Redo keyboard shortcuts (Ctrl+Z, Ctrl+Shift+Z)
        const handleUndoRedo = (e: KeyboardEvent) => {
          // Don't trigger if typing in an input
          if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
            return;
          }

          if (e.ctrlKey || e.metaKey) {
            if (e.code === 'KeyZ') {
              e.preventDefault();
              if (e.shiftKey) {
                // Redo
                const success = useImmersiveSceneStore.getState().redo();
                if (success) {
                  app.fire('hon:scene-state-restored', { action: 'redo' });
                }
              } else {
                // Undo
                const success = useImmersiveSceneStore.getState().undo();
                if (success) {
                  app.fire('hon:scene-state-restored', { action: 'undo' });
                }
              }
            }
          }
        };
        window.addEventListener('keydown', handleUndoRedo);

        // Create camera entity
        const camera = new pc.Entity('camera');
        camera.addComponent('camera', {
          clearColor: new pc.Color(0, 0, 0), // Black background
          fov: 75,
          nearClip: 0.1,
          farClip: 1000,
        });
        // Position at ground level, back from scene origin, facing forward
        camera.setPosition(0, 0.5, 4);
        camera.setEulerAngles(0, 0, 0); // Face forward (into -Z)
        app.root.addChild(camera);
        cameraEntityRef.current = camera;

        // Add first-person camera controls
        setupCameraControls(pc, app, camera);

        // === ADVANCED RENDERING SETUP ===
        // Enable high-quality rendering features (with fallbacks for different PC versions)
        try {
          // Try new API first (PlayCanvas 1.60+), fall back to old API
          const scene = app.scene;

          // Tone mapping - try both APIs
          if (scene.rendering?.toneMapping !== undefined) {
            scene.rendering.toneMapping = pc.TONEMAP_ACES;
            scene.rendering.exposure = 1.1;
            scene.rendering.gammaCorrection = pc.GAMMA_SRGB;
          } else if ((scene as any).toneMapping !== undefined) {
            (scene as any).toneMapping = pc.TONEMAP_ACES;
            (scene as any).exposure = 1.1;
            (scene as any).gammaCorrection = pc.GAMMA_SRGB;
          }

          // Enable clustered lighting if available
          if (scene.clusteredLightingEnabled !== undefined) {
            scene.clusteredLightingEnabled = true;
          }

          // Ambient light - try both APIs
          if (scene.rendering?.ambientLight !== undefined) {
            scene.rendering.ambientLight = new pc.Color(0.15, 0.18, 0.25);
          } else if ((scene as any).ambientLight !== undefined) {
            (scene as any).ambientLight = new pc.Color(0.15, 0.18, 0.25);
          }

          // === PROCEDURAL SKYBOX - DISABLED ===
          // Sky dome and cubemap removed - using pure black background by default
          // Hon can add sky/environment via pc_set_environment when needed
          console.log('[WorldImmersiveCanvas] Using black background (no sky dome or cubemap)');

          console.log('[WorldImmersiveCanvas] Advanced rendering enabled: ACES tonemapping, clustered lighting');
        } catch (renderErr) {
          console.warn('[WorldImmersiveCanvas] Could not enable advanced rendering:', renderErr);
        }

        // === POST-PROCESSING EFFECTS ===
        // Note: Most post-effects require additional PlayCanvas scripts to be loaded
        // We rely on tone mapping + good lighting for quality instead
        console.log('[WorldImmersiveCanvas] Post-processing: Using tone mapping and lighting for quality');

        // Add main directional light (sun) WITH SHADOWS
        const sunLight = new pc.Entity('sun');
        sunLight.addComponent('light', {
          type: 'directional',
          color: new pc.Color(1, 0.98, 0.95), // Warm sunlight
          intensity: 1.2,
          castShadows: true,
          shadowBias: 0.2,
          shadowDistance: 100,
          shadowResolution: 2048,
          normalOffsetBias: 0.05,
          shadowType: pc.SHADOW_PCF3, // Soft shadows
        });
        sunLight.setEulerAngles(50, 30, 0);
        app.root.addChild(sunLight);

        // Add a secondary fill light (sky bounce, no shadows)
        const fillLight = new pc.Entity('fill');
        fillLight.addComponent('light', {
          type: 'directional',
          color: new pc.Color(0.6, 0.7, 0.9), // Cool sky color
          intensity: 0.4,
          castShadows: false,
        });
        fillLight.setEulerAngles(-30, -120, 0);
        app.root.addChild(fillLight);

        // Add rim/back light for depth
        const rimLight = new pc.Entity('rim');
        rimLight.addComponent('light', {
          type: 'directional',
          color: new pc.Color(1, 0.95, 0.8),
          intensity: 0.3,
          castShadows: false,
        });
        rimLight.setEulerAngles(20, 180, 0);
        app.root.addChild(rimLight);

        // Ensure canvas is still valid before starting
        if (!canvasRef.current || destroyed) {
          console.warn('[WorldImmersiveCanvas] Canvas removed before start');
          device.destroy();
          return;
        }
        
        // Force a resize to ensure proper dimensions
        app.resizeCanvas();
        
        // Start the application
        app.start();

        // === DEFAULT ENVIRONMENT ===
        // Add ground plane and sky gradient immediately for good UX during building
        const createDefaultEnvironment = () => {
          // Set a nice sky gradient via clear color (light blue -> darker at horizon)
          camera.camera!.clearColor = new pc.Color(0.4, 0.6, 0.9); // Pleasant sky blue

          // Create ground plane so scene isn't floating in void
          const ground = new pc.Entity('default_ground');
          ground.addComponent('render', {
            type: 'plane',
            material: (() => {
              const mat = new pc.StandardMaterial();
              mat.diffuse = new pc.Color(0.25, 0.35, 0.2); // Grass green
              mat.update();
              return mat;
            })(),
          });
          ground.setLocalScale(200, 1, 200);
          ground.setPosition(0, 0, 0);
          ground.tags.add('default_environment');
          app.root.addChild(ground);

          // Create simple sky dome (hemisphere for gradient effect)
          const sky = new pc.Entity('default_sky');
          sky.addComponent('render', {
            type: 'sphere',
            material: (() => {
              const mat = new pc.StandardMaterial();
              mat.diffuse = new pc.Color(0.5, 0.7, 1.0); // Sky blue
              mat.emissive = new pc.Color(0.3, 0.5, 0.8); // Slight glow
              mat.cull = pc.CULLFACE_FRONT; // Render inside of sphere
              mat.update();
              return mat;
            })(),
          });
          sky.setLocalScale(500, 500, 500);
          sky.setPosition(0, 0, 0);
          sky.tags.add('default_environment');
          app.root.addChild(sky);

          console.log('[WorldImmersiveCanvas] Default environment created (ground + sky)');
        };
        createDefaultEnvironment();

        // Register behavior scripts for game entities
        registerBehaviorScripts(app);
        console.log('[WorldImmersiveCanvas] Behavior scripts registered');
        
        // Connect PlayCanvas MCP server for Hon's scene control
        setPlayCanvasApp(app, camera);
        console.log('[WorldImmersiveCanvas] PlayCanvas MCP connected');
        
        // ============================================
        // Scene Build Tracking System
        // Tracks pending operations and signals completion to Hon indicator
        // Uses build IDs to prevent race conditions between multiple builds
        // ============================================
        const pendingOperations = {
          // Maps track asset/character ID -> buildId to prevent cross-build contamination
          assets: new Map<string, number>(),
          reveals: new Map<string, number>(),
          characters: new Map<string, number>(),
          currentBuildId: 0,
          buildStartTime: 0,
          buildTimeout: null as NodeJS.Timeout | null,
        };

        const startNewBuild = () => {
          // Cancel any previous build
          if (pendingOperations.buildTimeout) {
            clearTimeout(pendingOperations.buildTimeout);
            pendingOperations.buildTimeout = null;
          }

          // Increment build ID to invalidate previous build's pending items
          pendingOperations.currentBuildId++;
          pendingOperations.buildStartTime = Date.now();

          // Clear tracking maps for new build
          pendingOperations.assets.clear();
          pendingOperations.reveals.clear();
          pendingOperations.characters.clear();

          console.log(`[WorldImmersiveCanvas] Scene build #${pendingOperations.currentBuildId} started`);

          // Safety timeout - complete after 30 seconds max
          const buildId = pendingOperations.currentBuildId;
          pendingOperations.buildTimeout = setTimeout(() => {
            // Only force complete if this is still the current build
            if (pendingOperations.currentBuildId === buildId) {
              const pendingAssets = pendingOperations.assets.size;
              const pendingReveals = pendingOperations.reveals.size;
              const pendingChars = pendingOperations.characters.size;
              console.warn(`[WorldImmersiveCanvas] Scene build #${buildId} timeout - forcing completion. Pending: ${pendingAssets} assets, ${pendingReveals} reveals, ${pendingChars} characters`);
              pendingOperations.assets.clear();
              pendingOperations.reveals.clear();
              pendingOperations.characters.clear();
              checkBuildComplete();
            }
          }, 30000);
        };

        const checkBuildComplete = () => {
          const isPending = pendingOperations.assets.size > 0 ||
                           pendingOperations.reveals.size > 0 ||
                           pendingOperations.characters.size > 0;

          if (!isPending && pendingOperations.buildStartTime > 0) {
            const buildTime = Date.now() - pendingOperations.buildStartTime;
            console.log(`[WorldImmersiveCanvas] Scene build #${pendingOperations.currentBuildId} complete in ${buildTime}ms`);

            // Clear timeout
            if (pendingOperations.buildTimeout) {
              clearTimeout(pendingOperations.buildTimeout);
              pendingOperations.buildTimeout = null;
            }

            // Reset
            pendingOperations.buildStartTime = 0;

            // Signal to Hume service that scene is ready
            window.dispatchEvent(new CustomEvent('hon:scene-build-complete', {
              detail: { buildTime, buildId: pendingOperations.currentBuildId, timestamp: Date.now() }
            }));
          }
        };

        // Track when scene building starts
        app.on('hon:load-asset', (request: any) => {
          if (pendingOperations.buildStartTime === 0) {
            startNewBuild();
          }
          pendingOperations.assets.set(request.assetId, pendingOperations.currentBuildId);
        });

        app.on('hon:spawn-character', (request: any) => {
          if (pendingOperations.buildStartTime === 0) {
            startNewBuild();
          }
          pendingOperations.characters.set(request.characterId, pendingOperations.currentBuildId);
        });

        app.on('hon:asset-loaded', (data: any) => {
          // Only process if this asset was tracked (defensive check for race condition)
          if (pendingOperations.assets.has(data.assetId)) {
            pendingOperations.assets.delete(data.assetId);
            if (data.hasRevealEffect) {
              pendingOperations.reveals.set(data.assetId, pendingOperations.currentBuildId);
            } else {
              checkBuildComplete();
            }
          }
        });

        app.on('hon:scene-reveal-complete', (data: any) => {
          // Only process if this reveal was tracked
          if (pendingOperations.reveals.has(data.assetId)) {
            pendingOperations.reveals.delete(data.assetId);
            checkBuildComplete();
          }
        });

        app.on('hon:character-spawned', (data: any) => {
          // Only process if this character was tracked
          if (pendingOperations.characters.has(data.characterId)) {
            pendingOperations.characters.delete(data.characterId);
            // Small delay to allow FPS arms to load
            setTimeout(checkBuildComplete, 500);
          }
        });

        app.on('hon:character-spawn-failed', (data: any) => {
          // Track failed character spawns
          console.error('[BuildTracking] Character spawn failed:', data.characterId, '-', data.error);

          // Remove from pending operations (don't block build completion on failures)
          if (pendingOperations.characters.has(data.characterId)) {
            pendingOperations.characters.delete(data.characterId);
            checkBuildComplete();
          }
        });

        // Wire up game events
        // Note: Player creation no longer auto-activates game mode
        // Use 'hon:start-game' to explicitly enter play mode
        app.on('hon:player-created', () => {
          console.log('[WorldImmersiveCanvas] Player created (build mode - game not started yet)');
          // Don't auto-activate game mode - let user trigger it when ready
        });

        // Explicit game start trigger
        app.on('hon:start-game', () => {
          console.log('[WorldImmersiveCanvas] Game mode activated');
          setGameState(prev => ({ ...prev, active: true }));
        });
        
        app.on('hon:collectible', (data: { value: number; effect: string }) => {
          if (data.effect === 'score') {
            setGameState(prev => ({ ...prev, score: prev.score + data.value }));
          } else if (data.effect === 'health') {
            setGameState(prev => ({ 
              ...prev, 
              health: Math.min(prev.maxHealth, prev.health + data.value) 
            }));
          }
        });
        
        app.on('hon:damage', (data: { damage: number }) => {
          setGameState(prev => {
            const newHealth = prev.health - data.damage;
            if (newHealth <= 0) {
              return { ...prev, health: 0, gameOver: true };
            }
            return { ...prev, health: newHealth };
          });
        });
        
        app.on('hon:victory', () => {
          setGameState(prev => ({ ...prev, victory: true }));
        });
        
        app.on('hon:reset-game', () => {
          setGameState({
            active: true,
            score: 0,
            health: 100,
            maxHealth: 100,
            level: 1,
            gameOver: false,
            victory: false
          });
        });
        
        // Handle animated character spawning from the character library
        app.on('hon:spawn-character', async (request: {
          name: string;
          characterId: string;
          position: { x: number; y: number; z: number };
          rotation: number;
          isPlayer: boolean;
          cameraMode?: 'first-person' | 'third-person';
          behavior: string;
          weapon?: string; // Weapon to attach (e.g., 'akm', 'glock', 'shotgun')
        }) => {
          console.log('[WorldImmersiveCanvas] Spawning character:', request.characterId, request);
          try {
            const {
              loadAnimatedCharacter,
              createPlayerControllerScript,
              createDualModeCameraController,
              attachWeaponToCharacter,
              createHitDetectionSystem
            } = await import('../../lib/playcanvas/animatedCharacterController');
            const { WEAPON_ATTACHMENTS, getCharacter } = await import('../../lib/playcanvas/characterLibrary');

            // Pre-check if character exists in library
            const charDef = getCharacter(request.characterId);
            if (!charDef) {
              console.error('[WorldImmersiveCanvas] Character not found in library:', request.characterId);
              return;
            }
            console.log('[WorldImmersiveCanvas] Character found:', charDef.name, 'URL:', charDef.glbUrl);

            const character = await loadAnimatedCharacter(app, {
              characterId: request.characterId,
              position: request.position,
              rotation: request.rotation,
              isPlayer: request.isPlayer,
              cameraMode: request.cameraMode
            });
            
            if (character) {
              console.log('[WorldImmersiveCanvas] Character loaded:', character.definition.name);
              
              // Determine weapon type
              let weaponId: 'akm' | 'glock' | 'shotgun' | 'knife' = 'akm';
              const charId = request.characterId.toLowerCase();
              
              if (request.weapon && ['akm', 'glock', 'shotgun', 'knife'].includes(request.weapon)) {
                weaponId = request.weapon as 'akm' | 'glock' | 'shotgun' | 'knife';
              } else if (charId.includes('ninja') || charId.includes('samurai')) {
                weaponId = 'knife';
              }
              
              // For FPS players, weapon is attached to FPS arms (not character model)
              // For third-person and NPCs, attach weapon to character model
              const isFPSPlayer = request.isPlayer && request.cameraMode === 'first-person';
              const shouldAttachToModel = !isFPSPlayer && (
                request.weapon || 
                (request.behavior === 'chase' || request.behavior === 'attack' || request.behavior === 'guard')
              );
              
              if (shouldAttachToModel && !WEAPON_MODELS_AVAILABLE) {
                console.info('[WorldImmersiveCanvas] Weapon models are not in this build; spawning without a weapon');
              } else if (shouldAttachToModel) {
                // Attach weapon to character model (for NPCs and third-person)
                let weaponPath: string | null = null;
                
                if (WEAPON_ATTACHMENTS.firearms[weaponId as keyof typeof WEAPON_ATTACHMENTS.firearms]) {
                  weaponPath = WEAPON_ATTACHMENTS.firearms[weaponId as keyof typeof WEAPON_ATTACHMENTS.firearms].path;
                } else if (weaponId === 'knife') {
                  weaponPath = WEAPON_ATTACHMENTS.melee.knife.path;
                }
                
                if (weaponPath) {
                  const weapon = await attachWeaponToCharacter(app, character, weaponPath, weaponId);
                  if (weapon) {
                    console.log('[WorldImmersiveCanvas] Weapon attached to character model:', weaponId);
                  }
                }
              }
              
              if (request.isPlayer) {
                // Initialize hit detection system (only once)
                if (!(app as any)._hitDetectionSystem) {
                  (app as any)._hitDetectionSystem = createHitDetectionSystem(app);
                  console.log('[WorldImmersiveCanvas] Hit detection system initialized');
                }
                
                // Set up player controls
                createPlayerControllerScript(app, character);
                
                // Set up dual-mode camera (supports both FPS and third-person)
                // For FPS mode, this also attaches FPS arms with weapon to camera
                const initialCameraMode = request.cameraMode || 'third-person';
                createDualModeCameraController(app, character.entity, camera, initialCameraMode, weaponId);
                
                console.log(`[WorldImmersiveCanvas] Player camera mode: ${initialCameraMode}, weapon: ${weaponId}`);

                // Player controller ready - game mode will be activated separately via hon:start-game
                console.log('[WorldImmersiveCanvas] Player controller ready (use hon:start-game to play)');
              }
              
              // Fire success event
              app.fire('hon:character-spawned', {
                name: request.name,
                characterId: request.characterId,
                entityId: character.entity.getGuid(),
                animations: character.definition.animations.map(a => a.name),
                cameraMode: request.cameraMode || 'third-person',
                weaponId: weaponId,
                hasFPSArms: isFPSPlayer
              });
            } else {
              const errorMsg = `Failed to load character "${request.characterId}" - check if GLB exists at: ${charDef.glbUrl}`;
              console.error('[WorldImmersiveCanvas]', errorMsg);

              // Fire error event for tracking and feedback
              app.fire('hon:character-spawn-failed', {
                name: request.name,
                characterId: request.characterId,
                error: errorMsg,
                glbUrl: charDef.glbUrl
              });
            }
          } catch (err) {
            const errorMsg = `Error spawning character "${request.characterId}": ${err instanceof Error ? err.message : String(err)}`;
            console.error('[WorldImmersiveCanvas]', errorMsg, err);

            // Fire error event for tracking and feedback
            app.fire('hon:character-spawn-failed', {
              name: request.name,
              characterId: request.characterId,
              error: errorMsg,
              originalError: err
            });
          }
        });

        // Handle NPC group spawning for populated scenes
        app.on('hon:spawn-npcs', async (request: {
          count?: number;
          centerX?: number;
          centerZ?: number;
          characterIds?: string[];
        }) => {
          console.log('[WorldImmersiveCanvas] Spawning NPCs:', request);
          try {
            const { spawnNPCGroup, createCityNPCConfigs } = await import('../../lib/playcanvas/npcController');
            type NPCControllerConfigType = import('../../lib/playcanvas/npcController').NPCControllerConfig;

            const count = request.count || 5;
            const centerX = request.centerX || 0;
            const centerZ = request.centerZ || 0;

            // Detect scene scale by looking for loaded environment assets
            // city_block and similar scenes use 0.01 scale (modeled in cm)
            let sceneScale = 1.0;
            const sceneEntities = app.root.findByTag('environment');
            if (sceneEntities.length > 0) {
              const envScale = sceneEntities[0].getLocalScale();
              if (envScale.x < 0.1) {
                sceneScale = envScale.x; // Use environment's scale
                console.log('[WorldImmersiveCanvas] Detected scene scale:', sceneScale);
              }
            }

            // Create NPC configs
            let configs: NPCControllerConfigType[];

            if (request.characterIds && request.characterIds.length > 0) {
              // Use specified characters with detected scale
              configs = request.characterIds.map((charId, i) => {
                const angle = (i / request.characterIds!.length) * Math.PI * 2;
                const radius = (sceneScale < 0.1 ? 0.1 : 10) + Math.random() * (sceneScale < 0.1 ? 0.15 : 15);
                return {
                  characterId: charId,
                  position: {
                    x: centerX + Math.cos(angle) * radius,
                    y: 0,
                    z: centerZ + Math.sin(angle) * radius,
                  },
                  behavior: 'wander' as const,
                  wanderRadius: sceneScale < 0.1 ? 0.15 : 15,
                  walkSpeed: sceneScale < 0.1 ? 0.015 : 1.5 + Math.random() * 1,
                  idleTime: 2 + Math.random() * 3,
                  walkTime: 4 + Math.random() * 4,
                  scale: sceneScale < 0.1 ? sceneScale : undefined,
                };
              });
            } else {
              // Use default city NPCs - but check if we're in a scaled scene
              configs = createCityNPCConfigs(centerX, centerZ, count);
              // If NOT in a city_block scene (no small-scale environment), use normal scale
              if (sceneScale >= 0.1) {
                configs = configs.map(c => ({
                  ...c,
                  scale: undefined, // Use default character scale
                  walkSpeed: 1.5 + Math.random() * 1,
                  wanderRadius: 15,
                  patrolPath: undefined, // Disable patrol paths for non-city scenes
                }));
              }
            }

            // Spawn NPCs
            const npcs = await spawnNPCGroup(app, configs);
            console.log('[WorldImmersiveCanvas] Spawned', npcs.length, 'NPCs');

            // Fire event for tracking
            app.fire('hon:npcs-spawned', { count: npcs.length });

          } catch (err) {
            const errorMsg = `Error spawning NPCs: ${err instanceof Error ? err.message : String(err)}`;
            console.error('[WorldImmersiveCanvas]', errorMsg, err);

            // Fire error event for tracking and feedback
            app.fire('hon:npcs-spawn-failed', {
              error: errorMsg,
              request: request,
              originalError: err
            });
          }
        });

        // Handle GLB asset loading from pc_execute generated code
        app.on('hon:load-asset', async (request: {
          assetId: string;
          position?: { x: number; y: number; z: number };
          rotation?: { x: number; y: number; z: number };
          scale?: number;
          placeOnGround?: boolean;
        }) => {
          console.log('[WorldImmersiveCanvas] Loading asset:', request);
          try {
            const { getAssetById, getNormalizedScale, getAssetDimensions, ASSET_REGISTRY } = await import('../../lib/playcanvas/assetRegistry');
            const { placeAssetIntelligently, formatPlacementFeedback } = await import('../../lib/playcanvas/assetPlacement');
            const assetDef = getAssetById(request.assetId);

            if (!assetDef) {
              console.error('[WorldImmersiveCanvas] Asset not found:', request.assetId);
              console.log('[WorldImmersiveCanvas] Available assets:', ASSET_REGISTRY.map(a => a.id).join(', '));
              return;
            }

            console.log('[WorldImmersiveCanvas] Found asset:', assetDef.name, 'at', assetDef.path);

            // Determine if this is an environment/scene asset
            const isEnvironmentAsset = assetDef.subcategory === 'scene' || assetDef.subcategory === 'terrain';

            // Load the GLB asset
            const asset = new pc.Asset(assetDef.id, 'container', {
              url: assetDef.path
            });

            asset.on('load', async () => {
              console.log('[WorldImmersiveCanvas] Asset loaded:', assetDef.name);

              // For environment scenes: clear demo objects and prepare for scene takeover
              if (isEnvironmentAsset) {
                // Clear demo scene objects from store
                const store = useImmersiveSceneStore.getState();
                const demoObjects = store.objects.filter(obj => obj.createdBy === 'demo');
                demoObjects.forEach(obj => store.removeObject(obj.id));
                console.log('[WorldImmersiveCanvas] Cleared', demoObjects.length, 'demo objects for environment scene');
              }

              // Create entity from the loaded container
              const entity = asset.resource.instantiateRenderEntity();
              entity.name = assetDef.id;

              // Use intelligent placement system
              const placementResult = await placeAssetIntelligently(
                app,
                pc,
                entity,
                assetDef,
                {
                  position: request.position || { x: 0, y: 0, z: 0 },
                  rotation: request.rotation,
                  scale: request.scale,
                  placeOnGround: request.placeOnGround !== false && !isEnvironmentAsset,
                  groundLevel: 0,
                  isEnvironmentAsset
                },
                getNormalizedScale,
                getAssetDimensions
              );

              // For environment assets: hide entity BEFORE adding to scene to prevent flash
              if (isEnvironmentAsset) {
                // Temporarily hide by setting scale to near-zero (will be revealed by effect)
                entity.setLocalScale(0.001, 0.001, 0.001);
              }

              app.root.addChild(entity);

              // Apply radial reveal effect for scene assets
              if (isEnvironmentAsset) {
                const assetDims = getAssetDimensions(assetDef);

                // Teleport camera INTO the scene center so user sees it reveal from inside
                // Position camera at scene center, slightly elevated for good view
                const sceneCenterX = placementResult.finalPosition.x;
                const sceneCenterZ = placementResult.finalPosition.z;
                const cameraY = 2; // Eye level height
                
                if (camera) {
                  camera.setPosition(sceneCenterX, cameraY, sceneCenterZ);
                  // Face the scene (into -Z direction from center)
                  camera.setEulerAngles(0, 0, 0);
                  console.log(`[WorldImmersiveCanvas] Teleported camera to scene center: (${sceneCenterX}, ${cameraY}, ${sceneCenterZ})`);
                }

                try {
                  const { applyRadialReveal } = await import('../../lib/playcanvas/glb-reveal-radial');

                  // Calculate max reveal radius based on actual bounding box
                  const maxRevealRadius = Math.max(
                    placementResult.boundingBox.size.x,
                    placementResult.boundingBox.size.z
                  ) * 0.6;

                  // Get camera position for reveal center (now inside the scene)
                  const cameraPos = camera?.getPosition() || { x: sceneCenterX, y: cameraY, z: sceneCenterZ };

                  // Restore proper scale before reveal starts
                  entity.setLocalScale(placementResult.finalScale, placementResult.finalScale, placementResult.finalScale);

                  // Small delay to ensure mesh instances are fully initialized
                  await new Promise(resolve => setTimeout(resolve, 50));

                  applyRadialReveal(app, entity, {
                    center: { x: cameraPos.x, y: placementResult.finalPosition.y, z: cameraPos.z },
                    speed: 25, // Faster reveal to reduce lag duration
                    acceleration: 12,
                    waveTint: [0.6, 0.2, 1.0], // Purple Hon tint
                    maxRadius: maxRevealRadius,
                    waveWidth: 12, // Wider wave = fewer frames to complete
                    glowDuration: 0.2,
                    onComplete: () => {
                      console.log('[WorldImmersiveCanvas] Scene reveal complete:', assetDef.name);
                      app.fire('hon:scene-reveal-complete', { assetId: request.assetId });
                    }
                  });
                  console.log(`[WorldImmersiveCanvas] Started radial reveal effect for ${assetDef.name} (radius: ${maxRevealRadius.toFixed(0)}m)`);
                } catch (err) {
                  console.warn('[WorldImmersiveCanvas] Could not apply reveal effect:', err);
                  // If reveal fails, restore scale so scene is visible
                  entity.setLocalScale(placementResult.finalScale, placementResult.finalScale, placementResult.finalScale);
                }

                // Create invisible ground plane with physics using actual dimensions
                const groundHalfWidth = Math.max(
                  placementResult.boundingBox.size.x,
                  placementResult.boundingBox.size.z
                ) / 2;

                const ground = new pc.Entity('ground_collision');
                ground.addComponent('collision', {
                  type: 'box',
                  halfExtents: new pc.Vec3(groundHalfWidth, 0.1, groundHalfWidth)
                });
                ground.addComponent('rigidbody', {
                  type: 'static',
                  friction: 0.5,
                  restitution: 0.1
                });
                ground.setPosition(placementResult.finalPosition.x, -0.1, placementResult.finalPosition.z);
                app.root.addChild(ground);
                console.log(`[WorldImmersiveCanvas] Added ground collision: ${(groundHalfWidth * 2).toFixed(0)}m x ${(groundHalfWidth * 2).toFixed(0)}m`);

                // Skip heavy collision generation for smoother reveal
                // generateSceneCollision(app, entity, placementResult.finalPosition);
                // Collision will be generated on-demand when player is added
              }

              // Generate feedback message for Hon to report
              const feedbackMessage = formatPlacementFeedback(assetDef, placementResult);

              console.log('[WorldImmersiveCanvas] Asset added to scene:', assetDef.name);
              app.fire('hon:asset-loaded', {
                assetId: request.assetId,
                name: assetDef.name,
                entityId: entity.getGuid(),
                hasGroundCollision: isEnvironmentAsset,
                hasRevealEffect: isEnvironmentAsset,
                // Include detailed placement info for intelligent feedback
                placement: {
                  position: placementResult.finalPosition,
                  scale: placementResult.finalScale,
                  dimensions: placementResult.boundingBox.size,
                  isValid: placementResult.validation.isValid,
                  warnings: placementResult.validation.warnings,
                  suggestions: placementResult.validation.suggestions,
                  feedbackMessage
                }
              });
            });

            asset.on('error', (err: Error) => {
              console.error('[WorldImmersiveCanvas] Failed to load asset:', assetDef.path, err);
            });

            app.assets.add(asset);
            app.assets.load(asset);

          } catch (err) {
            console.error('[WorldImmersiveCanvas] Error loading asset:', err);
          }
        });
        
        // Handle grass system events from pc_execute generated code
        app.on('hon:add-grass', async (request: {
          style?: string;
          position?: { x: number; y: number; z: number };
          area?: { width: number; depth: number };
          density?: number;
          windStrength?: number;
        }) => {
          console.log('[WorldImmersiveCanvas] Adding grass:', request);
          try {
            const { createGrassField, createForestGrass, createMeadowGrass, createLawnGrass, createWildGrass, clearGrass } = 
              await import('../../lib/playcanvas/grassSystem');
            
            // Clear existing grass first
            clearGrass(app);
            
            const position = request.position || { x: 0, y: 0, z: 0 };
            const style = request.style || 'forest';
            
            let grassField;
            if (style === 'meadow') {
              grassField = createMeadowGrass(app, position);
            } else if (style === 'wild') {
              grassField = createWildGrass(app, position);
            } else if (style === 'lawn') {
              grassField = createLawnGrass(app, position);
            } else {
              grassField = createForestGrass(app, position);
            }
            
            if (grassField) {
              console.log('[WorldImmersiveCanvas] Grass field created:', style);
              app.fire('hon:grass-added', { style, entityId: grassField.getGuid() });
            }
          } catch (err) {
            console.error('[WorldImmersiveCanvas] Error adding grass:', err);
          }
        });
        
        app.on('hon:remove-grass', async () => {
          console.log('[WorldImmersiveCanvas] Removing grass');
          try {
            const { clearGrass } = await import('../../lib/playcanvas/grassSystem');
            clearGrass(app);
          } catch (err) {
            console.error('[WorldImmersiveCanvas] Error removing grass:', err);
          }
        });

        // Handle particle effects from pc_execute generated code
        app.on('hon:add-particle', async (request: {
          preset: 'fire' | 'smoke' | 'sparkles' | 'rain' | 'snow' | 'fog_volume' | 'dust' | 'explosion' | 'embers' | 'magic' | 'leaves' | 'bubbles';
          position?: { x: number; y: number; z: number };
          scale?: number;
          color?: string;
          intensity?: number;
          loop?: boolean;
        }) => {
          console.log('[WorldImmersiveCanvas] Adding particle effect:', request);
          try {
            const { createParticleEffect } = await import('../../lib/playcanvas/particleSystem');

            const position = request.position || { x: 0, y: 0.5, z: 0 };
            const entity = createParticleEffect(
              app,
              request.preset || 'fire',
              position,
              {
                scale: request.scale ?? 1,
                color: request.color,
                intensity: request.intensity ?? 1,
                loop: request.loop ?? true,
              }
            );

            if (entity) {
              console.log('[WorldImmersiveCanvas] Particle effect created:', request.preset);
            }
          } catch (err) {
            console.error('[WorldImmersiveCanvas] Error adding particle effect:', err);
          }
        });

        // Handle removing all particle effects
        app.on('hon:remove-particles', async () => {
          console.log('[WorldImmersiveCanvas] Removing all particle effects');
          try {
            const { destroyAllParticleEffects } = await import('../../lib/playcanvas/particleSystem');
            destroyAllParticleEffects();
          } catch (err) {
            console.error('[WorldImmersiveCanvas] Error removing particle effects:', err);
          }
        });

        // Handle weather effects from pc_execute generated code
        app.on('hon:add-weather', async (request: {
          type: 'rain' | 'snow' | 'fog';
          intensity?: number;
        }) => {
          console.log('[WorldImmersiveCanvas] Adding weather effect:', request);
          try {
            const { createWeatherEffect } = await import('../../lib/playcanvas/particleSystem');
            const weatherType = request.type === 'fog' ? 'fog_volume' : request.type;
            createWeatherEffect(app, weatherType, request.intensity ?? 1);
            console.log('[WorldImmersiveCanvas] Weather effect created:', request.type);
          } catch (err) {
            console.error('[WorldImmersiveCanvas] Error adding weather effect:', err);
          }
        });

        // Handle gradient sky from pc_execute generated code
        app.on('hon:set-sky', async (request: {
          preset: 'dawn' | 'day' | 'sunset' | 'dusk' | 'night';
        }) => {
          console.log('[WorldImmersiveCanvas] Setting sky preset:', request);
          try {
            const { createGradientSky, applyTimeOfDayLighting } = await import('../../lib/playcanvas/skyboxLoader');
            const camera = app.root.findByName('camera');
            if (camera) {
              createGradientSky(app, camera, request.preset || 'day');
              applyTimeOfDayLighting(app, request.preset || 'day');
              console.log('[WorldImmersiveCanvas] Sky preset applied:', request.preset);
            }
          } catch (err) {
            console.error('[WorldImmersiveCanvas] Error setting sky:', err);
          }
        });

        // Initialize materialize effect manager for smooth object appearance
        forgeManagerRef.current = getForgeEffectManager(pc, app);
        console.log('[WorldImmersiveCanvas] Materialize effect manager initialized');

        // Listen for procedural entity creation to apply materialize effect
        // Using fast MaterializeEffect instead of full radial reveal for quicker response
        app.on('hon:entity-materialize', (data: { entity: any; name: string }) => {
          if (data.entity && forgeManagerRef.current) {
            // Quick materialize effect - scale pop with slight overshoot
            forgeManagerRef.current.materialize(data.entity, {
              duration: 0.4, // Fast 400ms animation
              onComplete: () => {
                console.log('[Materialize] Complete:', data.name);
              }
            });
          }
        });

        // Load the scene content (loading overlay stays visible until radial reveal starts)
        if (splatUrl) {
          await loadScene(pc, app, splatUrl);
        } else {
          // Create a default demo scene if no splat is selected
          createDemoScene(pc, app);
        }
        
        // Scene loaded - hide loading overlay now that radial reveal is starting
        setIsLoading(false);

        console.log('[WorldImmersiveCanvas] PlayCanvas initialized successfully');

        // Cleanup function
        return () => {
          window.removeEventListener('resize', onResize);
          window.removeEventListener('hon:spawn-npcs-request', handleSpawnNPCsRequest);
          window.removeEventListener('keydown', handleNPCSpawnKey);
          window.removeEventListener('keydown', handleUndoRedo);
        };

      } catch (err) {
        console.error('[WorldImmersiveCanvas] Failed to initialize:', err);
        setError(err instanceof Error ? err.message : 'Failed to initialize 3D engine');
        setIsLoading(false);
      }
    };

    initPlayCanvas();

    return () => {
      destroyed = true;
      // Disconnect MCP server
      setPlayCanvasApp(null, null);
      
      // Cleanup materialize effect manager
      if (forgeManagerRef.current) {
        forgeManagerRef.current.destroy();
        forgeManagerRef.current = null;
      }
      destroyForgeEffectManager();
      
      if (appRef.current) {
        try {
          appRef.current.destroy();
        } catch (e) {
          console.warn('[WorldImmersiveCanvas] Error during cleanup:', e);
        }
        appRef.current = null;
      }
    };
  }, [splatUrl, sharpRequestId]);

  // Setup first-person camera controls
  const setupCameraControls = (pc: any, app: any, camera: any) => {
    // Movement state
    const moveState = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      up: false,
      down: false,
    };
    
    // Flag to disable when player character is active
    let playerModeActive = false;
    
    // Listen for player character spawn - disable free camera when player is controlling
    app.on('hon:character-spawned', (data: { isPlayer?: boolean }) => {
      if (data && (data as any).entityId) {
        // A character was spawned - if it's the player, disable free camera
        // The spawn event from WorldImmersiveCanvas includes the request
        console.log('[CameraControls] Character spawned, checking if player...');
      }
    });
    
    // When player controller activates, disable free camera
    app.on('hon:player-controller-active', () => {
      playerModeActive = true;
      console.log('[CameraControls] Player mode active - disabling free camera movement');
    });
    
    // When player is removed, re-enable free camera
    app.on('hon:player-controller-removed', () => {
      playerModeActive = false;
      console.log('[CameraControls] Player removed - re-enabling free camera movement');
    });

    // Camera rotation - start facing forward (into -Z)
    let eulerAngles = new pc.Vec3(0, 0, 0);
    const sensitivity = 0.1;
    const moveSpeed = 5;

    // Keyboard input
    app.keyboard.on('keydown', (event: any) => {
      switch (event.key) {
        case pc.KEY_W:
        case pc.KEY_UP:
          moveState.forward = true;
          break;
        case pc.KEY_S:
        case pc.KEY_DOWN:
          moveState.backward = true;
          break;
        case pc.KEY_A:
        case pc.KEY_LEFT:
          moveState.left = true;
          break;
        case pc.KEY_D:
        case pc.KEY_RIGHT:
          moveState.right = true;
          break;
        case pc.KEY_SPACE:
          moveState.up = true;
          break;
        case pc.KEY_SHIFT:
          moveState.down = true;
          break;
        case pc.KEY_ESCAPE:
          if (document.pointerLockElement) {
            document.exitPointerLock();
          }
          break;
      }
    });

    app.keyboard.on('keyup', (event: any) => {
      switch (event.key) {
        case pc.KEY_W:
        case pc.KEY_UP:
          moveState.forward = false;
          break;
        case pc.KEY_S:
        case pc.KEY_DOWN:
          moveState.backward = false;
          break;
        case pc.KEY_A:
        case pc.KEY_LEFT:
          moveState.left = false;
          break;
        case pc.KEY_D:
        case pc.KEY_RIGHT:
          moveState.right = false;
          break;
        case pc.KEY_SPACE:
          moveState.up = false;
          break;
        case pc.KEY_SHIFT:
          moveState.down = false;
          break;
      }
    });

    // Mouse look (when pointer locked)
    app.mouse.on('mousemove', (event: any) => {
      if (document.pointerLockElement !== canvasRef.current) return;

      eulerAngles.x -= event.dy * sensitivity;
      eulerAngles.y -= event.dx * sensitivity;

      // Clamp vertical rotation
      eulerAngles.x = Math.max(-89, Math.min(89, eulerAngles.x));

      camera.setEulerAngles(eulerAngles.x, eulerAngles.y, 0);
    });

    // Click handling - either lock pointer OR select objects
    const handleCanvasClick = (event: MouseEvent) => {
      // If pointer is locked, clicking is for look - ignore for selection
      if (document.pointerLockElement) return;
      
      // Check if Shift is held - if so, do object selection via raycast
      if (event.shiftKey) {
        const rect = canvasRef.current!.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width;
        const y = (event.clientY - rect.top) / rect.height;
        
        // Create a ray from camera through click point
        const screenPos = new pc.Vec3(x * 2 - 1, (1 - y) * 2 - 1, 1);
        const worldPos = camera.camera.screenToWorld(
          event.clientX - rect.left,
          event.clientY - rect.top,
          camera.camera.farClip
        );
        
        const origin = camera.getPosition();
        const direction = new pc.Vec3().sub2(worldPos, origin).normalize();
        
        // Raycast against all entities with render components
        let closestEntity: any = null;
        let closestDistance = Infinity;
        
        const checkEntity = (entity: any) => {
          if (entity.render && entity.render.meshInstances) {
            // Get entity AABB for intersection test
            const aabb = entity.render.meshInstances[0]?.aabb;
            if (aabb) {
              const intersection = new pc.Vec3();
              if (aabb.intersectsRay(new pc.Ray(origin, direction), intersection)) {
                const distance = intersection.distance(origin);
                if (distance < closestDistance) {
                  closestDistance = distance;
                  closestEntity = entity;
                }
              }
            }
          }
          // Check children
          entity.children?.forEach(checkEntity);
        };
        
        app.root.children.forEach(checkEntity);
        
        if (closestEntity) {
          // Find the corresponding tracked entity and ID
          // We need to use the tracked entity (from sceneObjectsRef) for transforms to work correctly
          let foundId: string | null = null;
          let trackedEntity: any = closestEntity;
          
          sceneObjectsRef.current.forEach((entity, id) => {
            // Check if this tracked entity matches the clicked entity
            if (entity === closestEntity) {
              foundId = id;
              trackedEntity = entity;
            } else if (entity.findByGuid?.(closestEntity._guid)) {
              // closestEntity is a child of this tracked entity
              foundId = id;
              trackedEntity = entity;
            }
          });
          
          // If we didn't find it in tracked objects, try to find parent that IS tracked
          if (!foundId && closestEntity.parent) {
            let parent = closestEntity.parent;
            while (parent && !foundId) {
              sceneObjectsRef.current.forEach((entity, id) => {
                if (entity === parent) {
                  foundId = id;
                  trackedEntity = entity;
                }
              });
              parent = parent.parent;
            }
          }
          
          setSelectedEntity(trackedEntity);
          setSelectedObjectId(foundId);
          setDragPosition(null); // Clear any previous drag state
          selectedEntityRef.current = trackedEntity;
          console.log('[WorldImmersiveCanvas] Selected entity:', trackedEntity.name, 'ID:', foundId, 'isTracked:', !!foundId);
        } else {
          // Clicked empty space - deselect
          setSelectedEntity(null);
          setSelectedObjectId(null);
          setDragPosition(null);
          selectedEntityRef.current = null;
        }
        return;
      }
      
      // Normal click - lock pointer for look controls
      canvasRef.current?.requestPointerLock();
    };
    
    canvasRef.current?.addEventListener('click', handleCanvasClick);

    // Track pointer lock state
    document.addEventListener('pointerlockchange', () => {
      setIsPointerLocked(document.pointerLockElement === canvasRef.current);
    });

    // Update loop for movement and camera sync
    let lastCameraSync = 0;
    app.on('update', (dt: number) => {
      // Skip if player mode is active (player controller handles movement)
      if (playerModeActive) return;
      
      if (!document.pointerLockElement) return;

      const forward = camera.forward;
      const right = camera.right;
      const up = new pc.Vec3(0, 1, 0);

      const velocity = new pc.Vec3();

      if (moveState.forward) velocity.add(forward);
      if (moveState.backward) velocity.sub(forward);
      if (moveState.right) velocity.add(right);
      if (moveState.left) velocity.sub(right);
      if (moveState.up) velocity.add(up);
      if (moveState.down) velocity.sub(up);

      if (velocity.length() > 0) {
        velocity.normalize();
        velocity.mulScalar(moveSpeed * dt);
        camera.translate(velocity);
      }
      
      // Sync camera position to store (throttled to every 100ms)
      lastCameraSync += dt;
      if (lastCameraSync > 0.1) {
        lastCameraSync = 0;
        const pos = camera.getPosition();
        const rot = camera.getEulerAngles();
        updateCamera({
          position: { x: pos.x, y: pos.y, z: pos.z },
          rotation: { x: rot.x, y: rot.y, z: rot.z },
        });
      }
    });
  };

  // Extract scene file URL from a zip (for legacy uploads)
  const extractSceneUrlFromZip = async (zipUrl: string): Promise<string | null> => {
    console.log('[WorldImmersiveCanvas] Extracting scene from zip URL:', zipUrl);
    
    try {
      const response = await fetch(zipUrl);
      if (!response.ok) throw new Error(`Failed to fetch zip: ${response.status}`);
      
      const zipData = await response.arrayBuffer();
      const zip = await JSZip.loadAsync(zipData);
      const files = Object.keys(zip.files);
      
      console.log('[WorldImmersiveCanvas] Zip contents:', files);
      
      // Find the first supported scene file
      const priorityOrder = ['.splat', '.ply', '.glb', '.gltf'];
      
      for (const ext of priorityOrder) {
        const sceneFileName = files.find(f => 
          f.toLowerCase().endsWith(ext) && !f.startsWith('__MACOSX') && !zip.files[f].dir
        );
        
        if (sceneFileName) {
          console.log('[WorldImmersiveCanvas] Found scene file in zip:', sceneFileName);
          const fileData = await zip.files[sceneFileName].async('blob');
          // Create a blob URL for the extracted file
          const blobUrl = URL.createObjectURL(fileData);
          // Add extension hint for the loader
          return blobUrl + '#' + ext.replace('.', '');
        }
      }
      
      console.warn('[WorldImmersiveCanvas] No supported scene file found in zip');
      return null;
    } catch (err) {
      console.error('[WorldImmersiveCanvas] Failed to extract zip:', err);
      return null;
    }
  };

  // Load scene content (Gaussian splats, glTF, etc.)
  const loadScene = async (pc: any, app: any, url: string) => {
    console.log('[WorldImmersiveCanvas] Loading scene from:', url);

    let actualUrl = url;
    let extension = url.split('.').pop()?.toLowerCase()?.split('?')[0]?.split('#')[0];

    // Handle zip files by extracting the scene
    if (extension === 'zip') {
      console.log('[WorldImmersiveCanvas] Detected zip file, extracting...');
      const extractedUrl = await extractSceneUrlFromZip(url);
      if (extractedUrl) {
        actualUrl = extractedUrl;
        // Get extension from the hash hint we added
        extension = extractedUrl.split('#').pop() || 'ply';
        console.log('[WorldImmersiveCanvas] Extracted scene URL:', actualUrl, 'Extension:', extension);
      } else {
        console.warn('[WorldImmersiveCanvas] Could not extract scene from zip');
        createDemoScene(pc, app);
        return;
      }
    }

    try {
      if (extension === 'splat') {
        // .splat files are always Gaussian splat format
        await loadGaussianSplat(pc, app, actualUrl);
      } else if (extension === 'ply') {
        // .ply files might be Gaussian splat OR regular point cloud/mesh
        // Try loading as Gaussian splat first
        try {
          await loadGaussianSplat(pc, app, actualUrl);
        } catch (splatErr: any) {
          console.warn('[WorldImmersiveCanvas] PLY is not a Gaussian splat, trying as mesh...');
          // If it fails, the file might be a regular PLY mesh
          // For now, show the error and fall back to demo
          setError(splatErr?.message || 'Failed to load PLY file. Make sure it\'s a Gaussian splat format from Luma AI, Polycam, or similar.');
          createDemoScene(pc, app);
        }
      } else if (extension === 'glb' || extension === 'gltf') {
        // Load glTF model
        await loadGltfModel(pc, app, actualUrl);
      } else {
        console.warn('[WorldImmersiveCanvas] Unknown file type:', extension);
        createDemoScene(pc, app);
      }
    } catch (err: any) {
      console.error('[WorldImmersiveCanvas] Failed to load scene:', err);
      setError(err?.message || 'Failed to load scene');
      // Fall back to demo scene
      createDemoScene(pc, app);
    }
  };

  // Load Gaussian splat using PlayCanvas GSplat system with LOD streaming support
  const loadGaussianSplat = async (pc: any, app: any, url: string) => {
    console.log('[WorldImmersiveCanvas] Loading Gaussian splat...');
    console.log('[WorldImmersiveCanvas] URL:', url);

    // Check if this is a LOD streaming format (lod-meta.json)
    const isLodFormat = url.includes('lod-meta.json');
    
    // Create a GSplat asset
    const asset = new pc.Asset('splat', 'gsplat', { url });
    
    app.assets.add(asset);

    return new Promise<void>((resolve, reject) => {
      asset.on('load', () => {
        console.log('[WorldImmersiveCanvas] Gaussian splat loaded successfully');

        // Create entity for the splat
        const splatEntity = new pc.Entity('splat');
        
        // Configure gsplat component - enable unified mode for LOD streaming
        const gsplatConfig: any = {
          asset: asset,
        };
        
        // Enable unified (LOD streaming) mode if supported
        if (isLodFormat) {
          gsplatConfig.unified = true;
          console.log('[WorldImmersiveCanvas] LOD streaming mode enabled');
        }
        
        splatEntity.addComponent('gsplat', gsplatConfig);
        
        // Configure scene-level LOD settings if using LOD format
        if (isLodFormat && app.scene.gsplat) {
          // Detect device type and apply appropriate preset
          const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
          const preset = isMobile ? LOD_PRESETS['mobile'] : LOD_PRESETS['desktop'];
          
          app.scene.gsplat.lodRangeMin = preset.range[0];
          app.scene.gsplat.lodRangeMax = preset.range[1];
          app.scene.gsplat.lodUpdateDistance = 0.5;
          app.scene.gsplat.lodUnderfillLimit = 5;
          app.scene.gsplat.lodUpdateAngle = 90;
          app.scene.gsplat.lodBehindPenalty = 5;
          app.scene.gsplat.radialSorting = true;
          
          // Set LOD distances on the gsplat component
          if (splatEntity.gsplat) {
            splatEntity.gsplat.lodDistances = preset.lodDistances;
          }
          
          console.log('[WorldImmersiveCanvas] LOD settings applied:', preset);
        }
        
        // Center and scale appropriately
        splatEntity.setPosition(0, 0, 0);
        splatEntity.setLocalScale(1, 1, 1);
        
        // Luma AI exports with inverted Y axis - rotate 180° on X to flip right-side up
        splatEntity.setEulerAngles(180, 0, 0);

        app.root.addChild(splatEntity);

        // Move camera closer to feel "in the scene" for splat experiences
        // Sharp splats are typically compact, so start user near the center
        const camera = cameraEntityRef.current;
        if (camera) {
          camera.setPosition(0, 0.5, 2); // Closer than default (was 4 units back)
          console.log('[WorldImmersiveCanvas] Camera repositioned closer for splat scene');
        }

        // Add radial reveal effect for satisfying loading experience
        setupRadialReveal(pc, app, splatEntity);
        
        resolve();
      });

      asset.on('error', (err: any) => {
        console.error('[WorldImmersiveCanvas] Failed to load splat:', err);
        // Provide more helpful error message
        const errorMsg = err?.message || String(err);
        if (errorMsg.includes("reading '0'") || errorMsg.includes('undefined')) {
          reject(new Error(
            'This .ply file is not a valid Gaussian splat format. ' +
            'Please use a .splat file or a .ply file exported from Luma AI, Polycam, or similar tools with Gaussian splat data.'
          ));
        } else {
          reject(err);
        }
      });

      app.assets.load(asset);
    });
  };
  
  // Radial reveal effect - uses PlayCanvas shader-based reveal
  // Creates radial waves: first small dots appear, then lift up with highlights, then settle
  // Based on: https://github.com/playcanvas/engine/blob/main/scripts/esm/gsplat/reveal-radial.mjs
  const setupRadialReveal = (pc: any, app: any, splatEntity: any) => {
    console.log('[WorldImmersiveCanvas] Setting up radial reveal effect...');
    
    // Get camera position as reveal center
    const camera = cameraEntityRef.current;
    if (!camera) return;
    
    const cameraPos = camera.getPosition();
    
    // Create the reveal effect with PlayCanvas shader
    const revealEffect = new GsplatRevealRadialEffect(app, splatEntity, {
      center: { x: cameraPos.x, y: cameraPos.y, z: cameraPos.z },
      speed: 2,                // Base wave speed (units/second)
      acceleration: 5,         // Speed increase over time for dramatic effect
      delay: 1,                // Delay before lift wave starts
      dotTint: [0, 1, 1],      // Cyan colored dots
      waveTint: [5, 0, 0],     // Red highlight on lift wave
      oscillationIntensity: 0.1, // Subtle particle oscillation
      endRadius: 50,           // Distance to cover full scene
    });
    
    // Start the effect
    revealEffect.start();
    
    console.log('[WorldImmersiveCanvas] Radial reveal shader effect started');
  };

  // Load glTF/GLB model
  const loadGltfModel = async (pc: any, app: any, url: string) => {
    console.log('[WorldImmersiveCanvas] Loading glTF model...');

    const asset = new pc.Asset('model', 'container', { url });
    
    app.assets.add(asset);

    return new Promise<void>((resolve, reject) => {
      asset.on('load', () => {
        console.log('[WorldImmersiveCanvas] glTF model loaded');

        // Instantiate the model
        const entity = asset.resource.instantiateRenderEntity();
        entity.setPosition(0, 0, 0);
        
        app.root.addChild(entity);
        resolve();
      });

      asset.on('error', (err: any) => {
        console.error('[WorldImmersiveCanvas] Failed to load model:', err);
        reject(err);
      });

      app.assets.load(asset);
    });
  };

  // Create a demo scene when no content is loaded
  // Also adds objects to the store so Hon can interact with them
  const createDemoScene = (pc: any, app: any) => {
    console.log('[WorldImmersiveCanvas] Creating demo scene...');
    
    const store = useImmersiveSceneStore.getState();
    
    // Clear any existing demo objects first
    store.clearObjects();

    // Create a ground plane (not added to store - it's part of the environment)
    const ground = new pc.Entity('ground');
    ground.addComponent('render', {
      type: 'plane',
      material: createGridMaterial(pc, app),
    });
    ground.setLocalScale(50, 1, 50);
    ground.setPosition(0, 0, 0);
    app.root.addChild(ground);

    // Create some floating cubes and add them to the store
    const colorHexes = ['#a855f7', '#5599f7', '#f755a8']; // Purple, Blue, Pink

    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2;
      const radius = 5;
      const x = Math.sin(angle) * radius;
      const y = 1 + Math.random() * 2;
      const z = Math.cos(angle) * radius;
      const color = colorHexes[i % colorHexes.length];
      
      // Add to store - this will trigger the sync effect to create the entity
      store.addObject({
        type: 'primitive',
        primitiveType: 'cube',
        name: `cube ${i + 1}`,
        position: { x, y, z },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        color,
        emissive: color,
        emissiveIntensity: 0.3,
        animation: { type: 'float', speed: 1, amplitude: 0.5 },
        createdBy: 'demo',
      });
    }

    // Create a central glowing sphere and add to store
    store.addObject({
      type: 'primitive',
      primitiveType: 'sphere',
      name: 'glowing sphere',
      position: { x: 0, y: 2, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 0.5, y: 0.5, z: 0.5 },
      color: '#8855cc',
      emissive: '#8855cc',
      emissiveIntensity: 2,
      animation: { type: 'pulse', speed: 2 },
      createdBy: 'demo',
    });
  };

  // Create a grid material for the ground
  const createGridMaterial = (pc: any, app: any) => {
    const material = new pc.StandardMaterial();
    material.diffuse = new pc.Color(0.1, 0.1, 0.15);
    material.emissive = new pc.Color(0.02, 0.02, 0.05);
    material.metalness = 0.2;
    material.gloss = 0.3;
    material.update();
    return material;
  };

  // Helper to parse hex color for Forge effect (returns plain object)
  const hexToForgeColor = (hex: string): { r: number; g: number; b: number } => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (result) {
      return {
        r: parseInt(result[1], 16) / 255,
        g: parseInt(result[2], 16) / 255,
        b: parseInt(result[3], 16) / 255,
      };
    }
    return { r: 0.4, g: 0.9, b: 1.0 }; // Default cyan
  };

  // Helper to parse hex color to PlayCanvas Color
  const hexToColor = useCallback((hex: string, pc: any): any => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (result) {
      return new pc.Color(
        parseInt(result[1], 16) / 255,
        parseInt(result[2], 16) / 255,
        parseInt(result[3], 16) / 255
      );
    }
    return new pc.Color(1, 1, 1);
  }, []);

  // Create a PlayCanvas entity from an ImmersiveObject
  const createEntityFromObject = useCallback((obj: ImmersiveObject, pc: any, app: any): any => {
    const entity = new pc.Entity(obj.name || obj.id);
    
    // Set transform
    entity.setPosition(obj.position.x, obj.position.y, obj.position.z);
    entity.setEulerAngles(obj.rotation.x, obj.rotation.y, obj.rotation.z);
    entity.setLocalScale(obj.scale.x, obj.scale.y, obj.scale.z);
    
    if (obj.type === 'primitive' && obj.primitiveType) {
      // Create material
      const material = new pc.StandardMaterial();
      if (obj.color) material.diffuse = hexToColor(obj.color, pc);
      if (obj.emissive) {
        material.emissive = hexToColor(obj.emissive, pc);
        material.emissiveIntensity = obj.emissiveIntensity || 1;
      }
      material.metalness = obj.metalness ?? 0.5;
      material.gloss = 1 - (obj.roughness ?? 0.5);
      if (obj.opacity !== undefined && obj.opacity < 1) {
        material.opacity = obj.opacity;
        material.blendType = pc.BLEND_NORMAL;
      }
      material.update();
      
      // Map common names to PlayCanvas primitive types
      // PlayCanvas uses: box, sphere, cylinder, cone, plane, capsule, torus
      const primitiveTypeMap: Record<string, string> = {
        'cube': 'box',
        'square': 'box',
        'ball': 'sphere',
        'circle': 'sphere',
        'tube': 'cylinder',
        'ring': 'torus',
        'donut': 'torus',
      };
      const pcPrimitiveType = primitiveTypeMap[obj.primitiveType.toLowerCase()] || obj.primitiveType;
      
      entity.addComponent('render', {
        type: pcPrimitiveType,
        material: material,
      });
    } else if (obj.type === 'light' && obj.lightType) {
      entity.addComponent('light', {
        type: obj.lightType,
        color: obj.color ? hexToColor(obj.color, pc) : new pc.Color(1, 1, 1),
        intensity: obj.intensity ?? 1,
        range: obj.range ?? 10,
        castShadows: true,
      });
    } else if (obj.type === 'model' && obj.modelUrl) {
      // Load glTF/GLB model asynchronously
      console.log('[WorldImmersiveCanvas] Loading model:', obj.modelUrl);
      const asset = new pc.Asset(obj.id, 'container', { url: obj.modelUrl });
      app.assets.add(asset);
      
      asset.on('load', () => {
        console.log('[WorldImmersiveCanvas] Model loaded successfully:', obj.id);
        try {
          const modelEntity = asset.resource.instantiateRenderEntity();
          // Apply scale to the model entity
          modelEntity.setLocalScale(obj.scale.x, obj.scale.y, obj.scale.z);
          entity.addChild(modelEntity);
        } catch (err) {
          console.error('[WorldImmersiveCanvas] Failed to instantiate model:', err);
        }
      });
      
      asset.on('error', (err: any) => {
        console.error('[WorldImmersiveCanvas] Failed to load model:', obj.id, err);
      });
      
      app.assets.load(asset);
    }
    
    // Add animation if specified
    if (obj.animation) {
      const animData = { 
        type: obj.animation.type, 
        speed: obj.animation.speed || 1,
        amplitude: obj.animation.amplitude || 1,
        startTime: Date.now(),
        initialPos: { ...obj.position },
        initialRot: { ...obj.rotation },
        initialScale: { ...obj.scale },
      };
      
      app.on('update', (dt: number) => {
        // Entity guard - stop if entity was destroyed
        if (!entity || !entity.parent) return;

        const elapsed = (Date.now() - animData.startTime) / 1000;

        switch (animData.type) {
          case 'rotate':
            const axis = obj.animation?.axis || 'y';
            const rotSpeed = animData.speed * 60; // degrees per second
            if (axis === 'x') entity.rotate(rotSpeed * dt, 0, 0);
            else if (axis === 'y') entity.rotate(0, rotSpeed * dt, 0);
            else entity.rotate(0, 0, rotSpeed * dt);
            break;

          case 'float':
            const floatY = animData.initialPos.y + Math.sin(elapsed * animData.speed) * animData.amplitude;
            entity.setPosition(animData.initialPos.x, floatY, animData.initialPos.z);
            break;

          case 'pulse':
            const pulseScale = 1 + Math.sin(elapsed * animData.speed * 2) * 0.2 * animData.amplitude;
            entity.setLocalScale(
              animData.initialScale.x * pulseScale,
              animData.initialScale.y * pulseScale,
              animData.initialScale.z * pulseScale
            );
            break;

          case 'orbit':
            const orbitRadius = animData.amplitude;
            const orbitX = animData.initialPos.x + Math.cos(elapsed * animData.speed) * orbitRadius;
            const orbitZ = animData.initialPos.z + Math.sin(elapsed * animData.speed) * orbitRadius;
            entity.setPosition(orbitX, animData.initialPos.y, orbitZ);
            break;
        }
      });
    }
    
    return entity;
  }, [hexToColor]);

  // Track object types to detect when we need to recreate (e.g., placeholder -> model)
  const objectTypesRef = useRef<Map<string, string>>(new Map());

  // Sync immersive objects to PlayCanvas scene
  useEffect(() => {
    const app = appRef.current;
    const pc = pcRef.current;
    if (!app || !pc || isLoading) return;
    
    const currentIds = new Set(immersiveObjects.map(o => o.id));
    
    // Remove entities that no longer exist in store
    sceneObjectsRef.current.forEach((entity, id) => {
      if (!currentIds.has(id)) {
        entity.destroy();
        sceneObjectsRef.current.delete(id);
        objectTypesRef.current.delete(id);
      }
    });
    
    // Add or update entities
    immersiveObjects.forEach((obj) => {
      const existingEntity = sceneObjectsRef.current.get(obj.id);
      const previousType = objectTypesRef.current.get(obj.id);
      
      // Determine the current "type signature" to detect significant changes
      const currentType = obj.type === 'model' ? `model:${obj.modelUrl}` : `${obj.type}:${obj.primitiveType || obj.lightType}`;
      
      // Check if we need to recreate the entity (type changed, e.g., placeholder became model)
      const needsRecreate = existingEntity && previousType && previousType !== currentType;
      
      if (needsRecreate) {
        console.log('[WorldImmersiveCanvas] Recreating entity due to type change:', obj.id, previousType, '->', currentType);
        existingEntity.destroy();
        sceneObjectsRef.current.delete(obj.id);
      }
      
      if (!sceneObjectsRef.current.has(obj.id)) {
        // Create new entity
        const entity = createEntityFromObject(obj, pc, app);
        app.root.addChild(entity);
        sceneObjectsRef.current.set(obj.id, entity);
        objectTypesRef.current.set(obj.id, currentType);
        
        // Apply materialize effect - scale + opacity fade in with stagger
        if (forgeManagerRef.current && obj.type !== 'light') {
          forgeManagerRef.current.materialize(entity, {
            duration: 1.2,
            onComplete: () => {
              console.log('[MaterializeEffect] Complete:', obj.name || obj.id);
            }
          });
        }
        
        console.log('[WorldImmersiveCanvas] Added immersive object:', obj.id, obj.name || obj.primitiveType || obj.type);
      } else {
        // Update existing entity transform
        const entity = sceneObjectsRef.current.get(obj.id);
        if (entity) {
          entity.setPosition(obj.position.x, obj.position.y, obj.position.z);
          entity.setEulerAngles(obj.rotation.x, obj.rotation.y, obj.rotation.z);
          entity.setLocalScale(obj.scale.x, obj.scale.y, obj.scale.z);
        }
      }
    });
  }, [immersiveObjects, isLoading, createEntityFromObject]);

  // Sync environment settings to PlayCanvas
  useEffect(() => {
    const app = appRef.current;
    const pc = pcRef.current;
    if (!app || !pc || isLoading) return;
    
    // Update sky/clear color
    if (cameraEntityRef.current) {
      const cam = cameraEntityRef.current.camera;
      if (cam && immersiveEnvironment.skyColor) {
        cam.clearColor = hexToColor(immersiveEnvironment.skyColor, pc);
      }
    }
    
    // Update fog using rendering settings (fog property is read-only in newer PlayCanvas)
    try {
      if (app.scene?.rendering) {
        const rendering = app.scene.rendering;
        if (immersiveEnvironment.fogEnabled) {
          rendering.fog = pc.FOG_EXP2;
          rendering.fogColor = immersiveEnvironment.fogColor
            ? hexToColor(immersiveEnvironment.fogColor, pc)
            : new pc.Color(0.1, 0.1, 0.1);
          rendering.fogDensity = immersiveEnvironment.fogDensity || 0.02;
        } else {
          rendering.fog = pc.FOG_NONE;
        }
      }
    } catch (fogErr) {
      // Fog API may vary by PlayCanvas version, ignore errors
      console.warn('[WorldImmersiveCanvas] Could not set fog:', fogErr);
    }

    // Update ambient light using rendering settings
    try {
      if (app.scene?.rendering && immersiveEnvironment.ambientColor) {
        app.scene.rendering.ambientLight = hexToColor(immersiveEnvironment.ambientColor, pc);
      }
    } catch (ambientErr) {
      console.warn('[WorldImmersiveCanvas] Could not set ambient light:', ambientErr);
    }
    
    console.log('[WorldImmersiveCanvas] Updated environment:', immersiveEnvironment.timeOfDay || 'custom');
  }, [immersiveEnvironment, isLoading, hexToColor]);

  // Handle escape to exit
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.pointerLockElement) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div 
      ref={containerRef}
      className="w-full h-full relative bg-black overflow-hidden"
    >
      {/* Canvas - always visible so users can see progressive splat loading */}
      <canvas
        ref={canvasRef}
        className="block w-full h-full"
      />

      {/* Loading Overlay - only shows during initial engine setup, then radial reveal takes over */}
      {isLoading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-20 transition-opacity duration-500">
          <div className="relative">
            <div 
              className="w-16 h-16 rounded-full border-4 border-transparent animate-spin"
              style={{ 
                borderTopColor: LOADING_PHASES[loadingPhase].color,
                borderRightColor: LOADING_PHASES[loadingPhase].color,
              }}
            />
            <div 
              className="absolute inset-2 rounded-full border-4 border-transparent animate-spin"
              style={{ 
                borderBottomColor: LOADING_PHASES[(loadingPhase + 1) % LOADING_PHASES.length].color,
                animationDirection: 'reverse',
                animationDuration: '0.8s',
              }}
            />
          </div>
          <p 
            className="mt-6 text-sm font-medium transition-colors duration-300"
            style={{ color: LOADING_PHASES[loadingPhase].color }}
          >
            {LOADING_PHASES[loadingPhase].text}
          </p>
        </div>
      )}

      {/* Error Overlay */}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 z-20">
          <div className="text-red-400 text-center max-w-md px-4">
            <p className="text-lg font-semibold mb-2">Failed to load scene</p>
            <p className="text-sm text-red-300/80">{error}</p>
            <button
              onClick={onClose}
              className="mt-4 px-4 py-2 bg-red-500/20 border border-red-500/40 rounded-lg text-red-300 hover:bg-red-500/30 transition"
            >
              Exit World Mode
            </button>
          </div>
        </div>
      )}

      {/* Instructions hint - bottom center, above page manager - always visible when not loading */}
      {!isLoading && !error && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 px-4 py-2 bg-black/40 backdrop-blur-md rounded-full border border-white/10 z-30 pointer-events-none">
          <p className="text-white/50 text-xs">
            {isPointerLocked ? (
              'WASD to move • Mouse to look • Space/Shift up/down • ESC release'
            ) : selectedEntity ? (
              'Arrow keys to move • Q/E rotate • R/F scale • ESC deselect'
            ) : (
              'Click to look around • Shift+Click to select objects'
            )}
          </p>
        </div>
      )}

      {/* Object Transform Panel - shows when an object is selected */}
      {selectedEntity && !isPointerLocked && (
        <div className="absolute top-16 right-4 w-72 bg-black/90 backdrop-blur-md rounded-xl border border-white/20 z-40 overflow-hidden shadow-2xl">
          <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-purple-500/10">
            <span className="text-white font-medium text-sm truncate flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
              {selectedEntity.name || 'Selected Object'}
            </span>
            <button
              onClick={() => {
                setSelectedEntity(null);
                setSelectedObjectId(null);
                setDragPosition(null);
                selectedEntityRef.current = null;
              }}
              className="text-white/50 hover:text-white transition p-1 hover:bg-white/10 rounded"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          {/* Transform Mode Tabs */}
          <div className="flex border-b border-white/10">
            {(['move', 'rotate', 'scale'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setTransformMode(mode)}
                className={`flex-1 py-2.5 text-xs font-medium transition ${
                  transformMode === mode 
                    ? 'text-purple-400 border-b-2 border-purple-400 bg-purple-500/10' 
                    : 'text-white/50 hover:text-white/80 hover:bg-white/5'
                }`}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
          
          {/* Transform Controls */}
          <div className="p-4">
            {/* MOVE TAB - Minimap style */}
            {transformMode === 'move' && selectedEntity && (() => {
              // Use dragPosition if actively dragging, otherwise get from entity
              const pos = dragPosition || (() => {
                const p = selectedEntity.getPosition();
                return { x: p.x, y: p.y, z: p.z };
              })();
              const MINIMAP_SIZE = 160;
              const WORLD_RANGE = 100; // -50 to +50
              
              // Convert world position to minimap position
              const toMinimap = (worldX: number, worldZ: number) => ({
                x: ((worldX + WORLD_RANGE/2) / WORLD_RANGE) * MINIMAP_SIZE,
                y: ((worldZ + WORLD_RANGE/2) / WORLD_RANGE) * MINIMAP_SIZE,
              });
              
              // Convert minimap position to world position
              const toWorld = (minimapX: number, minimapY: number) => ({
                x: (minimapX / MINIMAP_SIZE) * WORLD_RANGE - WORLD_RANGE/2,
                z: (minimapY / MINIMAP_SIZE) * WORLD_RANGE - WORLD_RANGE/2,
              });
              
              const selectedPos = toMinimap(pos.x, pos.z);
              
              return (
                <div className="space-y-3">
                  {/* Top-down minimap for X/Z positioning */}
                  <div className="relative">
                    <p className="text-[10px] text-white/40 mb-2 uppercase tracking-wider">Top View (drag to move)</p>
                    <div 
                      className="relative w-full bg-gray-900/80 rounded-lg border border-white/10 cursor-crosshair overflow-hidden"
                      style={{ height: MINIMAP_SIZE }}
                      onMouseDown={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const currentY = selectedEntity.getPosition().y;
                        
                        const handleMove = (moveEvent: MouseEvent) => {
                          const mx = Math.max(0, Math.min(MINIMAP_SIZE, moveEvent.clientX - rect.left));
                          const my = Math.max(0, Math.min(MINIMAP_SIZE, moveEvent.clientY - rect.top));
                          const worldPos = toWorld(mx, my);
                          
                          // Move the actual PlayCanvas entity immediately
                          selectedEntity.setPosition(worldPos.x, currentY, worldPos.z);
                          
                          // Update React state to trigger re-render (shows dot moving)
                          setDragPosition({ x: worldPos.x, y: currentY, z: worldPos.z });
                        };
                        
                        const handleUp = () => {
                          window.removeEventListener('mousemove', handleMove);
                          window.removeEventListener('mouseup', handleUp);
                          
                          // On release, sync final position to store
                          const finalPos = selectedEntity.getPosition();
                          if (selectedObjectId) {
                            useImmersiveSceneStore.getState().updateObject(selectedObjectId, {
                              position: { x: finalPos.x, y: finalPos.y, z: finalPos.z }
                            });
                          }
                          // Clear drag state
                          setDragPosition(null);
                        };
                        
                        // Handle initial click position
                        handleMove(e.nativeEvent);
                        window.addEventListener('mousemove', handleMove);
                        window.addEventListener('mouseup', handleUp);
                      }}
                    >
                      {/* Grid lines */}
                      <svg className="absolute inset-0 w-full h-full opacity-20">
                        {[...Array(5)].map((_, i) => (
                          <g key={i}>
                            <line x1={MINIMAP_SIZE * (i+1) / 5} y1="0" x2={MINIMAP_SIZE * (i+1) / 5} y2={MINIMAP_SIZE} stroke="white" strokeWidth="0.5" />
                            <line x1="0" y1={MINIMAP_SIZE * (i+1) / 5} x2={MINIMAP_SIZE} y2={MINIMAP_SIZE * (i+1) / 5} stroke="white" strokeWidth="0.5" />
                          </g>
                        ))}
                        {/* Center crosshair */}
                        <line x1={MINIMAP_SIZE/2} y1="0" x2={MINIMAP_SIZE/2} y2={MINIMAP_SIZE} stroke="white" strokeWidth="1" opacity="0.4" />
                        <line x1="0" y1={MINIMAP_SIZE/2} x2={MINIMAP_SIZE} y2={MINIMAP_SIZE/2} stroke="white" strokeWidth="1" opacity="0.4" />
                      </svg>
                      
                      {/* Other objects as dots */}
                      {Array.from(sceneObjectsRef.current.entries()).map(([id, entity]) => {
                        if (id === selectedObjectId || !entity?.getPosition) return null;
                        const objPos = entity.getPosition();
                        const minimapPos = toMinimap(objPos.x, objPos.z);
                        if (minimapPos.x < 0 || minimapPos.x > MINIMAP_SIZE || minimapPos.y < 0 || minimapPos.y > MINIMAP_SIZE) return null;
                        return (
                          <div
                            key={id}
                            className="absolute w-2 h-2 rounded-full bg-white/30 -translate-x-1 -translate-y-1"
                            style={{ left: minimapPos.x, top: minimapPos.y }}
                          />
                        );
                      })}
                      
                      {/* Selected object marker */}
                      <div
                        className="absolute w-4 h-4 rounded-full bg-purple-500 border-2 border-white shadow-lg shadow-purple-500/50 -translate-x-2 -translate-y-2 pointer-events-none"
                        style={{ 
                          left: Math.max(8, Math.min(MINIMAP_SIZE - 8, selectedPos.x)), 
                          top: Math.max(8, Math.min(MINIMAP_SIZE - 8, selectedPos.y)) 
                        }}
                      />
                      
                      {/* Axis labels */}
                      <span className="absolute bottom-1 right-2 text-[9px] text-white/30">X →</span>
                      <span className="absolute top-1 left-2 text-[9px] text-white/30">Z ↓</span>
                    </div>
                    
                    {/* Position readout */}
                    <div className="flex justify-between mt-2 text-[10px] text-white/50">
                      <span>X: {pos.x.toFixed(1)}</span>
                      <span>Z: {pos.z.toFixed(1)}</span>
                    </div>
                  </div>
                  
                  {/* Height (Y) slider */}
                  <div className="space-y-1">
                    <p className="text-[10px] text-white/40 uppercase tracking-wider">Height (Y)</p>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min="-10"
                        max="30"
                        step="0.1"
                        value={pos.y}
                        onChange={(e) => {
                          const newY = parseFloat(e.target.value);
                          const currentPos = selectedEntity.getPosition();
                          selectedEntity.setPosition(currentPos.x, newY, currentPos.z);
                          setDragPosition({ x: currentPos.x, y: newY, z: currentPos.z });
                          if (selectedObjectId) {
                            useImmersiveSceneStore.getState().updateObject(selectedObjectId, {
                              position: { x: currentPos.x, y: newY, z: currentPos.z }
                            });
                          }
                        }}
                        className="flex-1 h-2 bg-white/20 rounded-full appearance-none cursor-pointer accent-purple-500"
                      />
                      <span className="w-10 text-xs text-white/60 text-right">{pos.y.toFixed(1)}</span>
                    </div>
                    {/* Quick height buttons */}
                    <div className="flex gap-1 mt-1">
                      {[0, 1, 2, 5, 10].map((h) => (
                        <button
                          key={h}
                          onClick={() => {
                            const currentPos = selectedEntity.getPosition();
                            selectedEntity.setPosition(currentPos.x, h, currentPos.z);
                            setDragPosition({ x: currentPos.x, y: h, z: currentPos.z });
                            if (selectedObjectId) {
                              useImmersiveSceneStore.getState().updateObject(selectedObjectId, {
                                position: { x: currentPos.x, y: h, z: currentPos.z }
                              });
                            }
                          }}
                          className={`flex-1 py-1 text-[10px] rounded transition ${
                            Math.abs(pos.y - h) < 0.5 
                              ? 'bg-purple-500/30 text-purple-300' 
                              : 'bg-white/10 text-white/50 hover:bg-white/20'
                          }`}
                        >
                          {h}m
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()}
            
            {/* ROTATE TAB */}
            {transformMode === 'rotate' && selectedEntity && (
              <div className="space-y-3">
                {['x', 'y', 'z'].map((axis) => {
                  const rot = selectedEntity.getEulerAngles();
                  const value = axis === 'x' ? rot.x : axis === 'y' ? rot.y : rot.z;
                  const colors = { x: 'red', y: 'green', z: 'blue' };
                  return (
                    <div key={axis} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className={`text-xs font-bold uppercase`} style={{ color: colors[axis as keyof typeof colors] }}>{axis}</span>
                        <span className="text-xs text-white/60">{value.toFixed(0)}°</span>
                      </div>
                      <input
                        type="range"
                        min="-180"
                        max="180"
                        step="5"
                        value={value}
                        onChange={(e) => {
                          const newVal = parseFloat(e.target.value);
                          const currentRot = selectedEntity.getEulerAngles();
                          if (axis === 'x') selectedEntity.setEulerAngles(newVal, currentRot.y, currentRot.z);
                          else if (axis === 'y') selectedEntity.setEulerAngles(currentRot.x, newVal, currentRot.z);
                          else selectedEntity.setEulerAngles(currentRot.x, currentRot.y, newVal);
                          if (selectedObjectId) {
                            const updatedRot = selectedEntity.getEulerAngles();
                            useImmersiveSceneStore.getState().updateObject(selectedObjectId, {
                              rotation: { x: updatedRot.x, y: updatedRot.y, z: updatedRot.z }
                            });
                          }
                        }}
                        className="w-full h-2 bg-white/20 rounded-full appearance-none cursor-pointer accent-purple-500"
                      />
                    </div>
                  );
                })}
                {/* Quick rotation buttons */}
                <div className="flex gap-1 pt-2 border-t border-white/10">
                  {[0, 45, 90, 180, 270].map((angle) => (
                    <button
                      key={angle}
                      onClick={() => {
                        const rot = selectedEntity.getEulerAngles();
                        selectedEntity.setEulerAngles(rot.x, angle, rot.z);
                        if (selectedObjectId) {
                          useImmersiveSceneStore.getState().updateObject(selectedObjectId, {
                            rotation: { x: rot.x, y: angle, z: rot.z }
                          });
                        }
                      }}
                      className="flex-1 py-1.5 text-[10px] bg-white/10 text-white/50 hover:bg-white/20 rounded transition"
                    >
                      {angle}°
                    </button>
                  ))}
                </div>
              </div>
            )}
            
            {/* SCALE TAB */}
            {transformMode === 'scale' && selectedEntity && (
              <div className="space-y-3">
                {['x', 'y', 'z'].map((axis) => {
                  const scale = selectedEntity.getLocalScale();
                  const value = axis === 'x' ? scale.x : axis === 'y' ? scale.y : scale.z;
                  const colors = { x: 'red', y: 'green', z: 'blue' };
                  return (
                    <div key={axis} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className={`text-xs font-bold uppercase`} style={{ color: colors[axis as keyof typeof colors] }}>{axis}</span>
                        <span className="text-xs text-white/60">{value.toFixed(2)}</span>
                      </div>
                      <input
                        type="range"
                        min="0.1"
                        max="10"
                        step="0.1"
                        value={value}
                        onChange={(e) => {
                          const newVal = parseFloat(e.target.value);
                          const currentScale = selectedEntity.getLocalScale();
                          if (axis === 'x') selectedEntity.setLocalScale(newVal, currentScale.y, currentScale.z);
                          else if (axis === 'y') selectedEntity.setLocalScale(currentScale.x, newVal, currentScale.z);
                          else selectedEntity.setLocalScale(currentScale.x, currentScale.y, newVal);
                          if (selectedObjectId) {
                            const updatedScale = selectedEntity.getLocalScale();
                            useImmersiveSceneStore.getState().updateObject(selectedObjectId, {
                              scale: { x: updatedScale.x, y: updatedScale.y, z: updatedScale.z }
                            });
                          }
                        }}
                        className="w-full h-2 bg-white/20 rounded-full appearance-none cursor-pointer accent-purple-500"
                      />
                    </div>
                  );
                })}
                {/* Uniform scale buttons */}
                <div className="flex gap-1 pt-2 border-t border-white/10">
                  {[0.5, 1, 2, 3, 5].map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        selectedEntity.setLocalScale(s, s, s);
                        if (selectedObjectId) {
                          useImmersiveSceneStore.getState().updateObject(selectedObjectId, {
                            scale: { x: s, y: s, z: s }
                          });
                        }
                      }}
                      className="flex-1 py-1.5 text-[10px] bg-white/10 text-white/50 hover:bg-white/20 rounded transition"
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              </div>
            )}
            
            {/* Delete button */}
            <div className="pt-3 mt-3 border-t border-white/10">
              <button
                onClick={async () => {
                  const deletedName = selectedEntity?.name || 'object';
                  if (selectedObjectId) {
                    useImmersiveSceneStore.getState().removeObject(selectedObjectId);
                  } else if (selectedEntity) {
                    selectedEntity.destroy();
                  }
                  setSelectedEntity(null);
                  setSelectedObjectId(null);
                  setDragPosition(null);
                  selectedEntityRef.current = null;
                  
                  // Capture timeline snapshot after manual deletion
                  try {
                    const { createImmersiveSceneSnapshot } = await import('../../utils/canvasHistory');
                    setTimeout(() => {
                      createImmersiveSceneSnapshot(`Deleted ${deletedName}`, 'immersive_object_delete');
                    }, 500);
                  } catch (e) {
                    console.warn('[WorldImmersiveCanvas] Failed to capture snapshot:', e);
                  }
                }}
                className="w-full py-2 text-xs bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg transition flex items-center justify-center gap-2"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Delete Object
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Game HUD - positioned between File menu and Exit World button */}
      {gameState.active && !gameState.gameOver && !gameState.victory && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 pointer-events-none flex items-center gap-6">
          {/* Health Bar */}
          <div className="flex items-center gap-2 bg-black/40 backdrop-blur-sm px-4 py-2 rounded-xl border border-red-500/30">
            <div className="w-6 h-6 rounded-lg bg-red-500/20 border border-red-500/40 flex items-center justify-center">
              <svg className="w-3 h-3 text-red-400" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
              </svg>
            </div>
            <div className="w-32 h-3 bg-black/50 rounded-full overflow-hidden border border-red-500/30">
              <div 
                className="h-full bg-gradient-to-r from-red-600 to-red-400 transition-all duration-300"
                style={{ width: `${(gameState.health / gameState.maxHealth) * 100}%` }}
              />
            </div>
            <span className="text-red-300 text-sm font-medium min-w-[60px]">
              {gameState.health}/{gameState.maxHealth}
            </span>
          </div>
          
          {/* Score */}
          <div className="flex items-center gap-2 bg-black/40 backdrop-blur-sm px-4 py-2 rounded-xl border border-yellow-500/30">
            <div className="w-6 h-6 rounded-lg bg-yellow-500/20 border border-yellow-500/40 flex items-center justify-center">
              <svg className="w-3 h-3 text-yellow-400" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
            </div>
            <span className="text-yellow-300 font-bold text-lg tracking-wider drop-shadow-lg min-w-[40px]">
              {gameState.score.toLocaleString()}
            </span>
          </div>
        </div>
      )}
      
      {/* Game Over Overlay */}
      {gameState.gameOver && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-40">
          <h2 className="text-6xl font-black text-red-500 mb-4 animate-pulse">GAME OVER</h2>
          <p className="text-2xl text-white/60 mb-8">Final Score: {gameState.score.toLocaleString()}</p>
          <button
            onClick={() => {
              appRef.current?.fire('hon:reset-game');
            }}
            className="px-8 py-3 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl transition transform hover:scale-105"
          >
            Play Again
          </button>
        </div>
      )}
      
      {/* Victory Overlay */}
      {gameState.victory && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-40">
          <h2 className="text-6xl font-black text-green-400 mb-4 animate-bounce">VICTORY!</h2>
          <p className="text-2xl text-white/60 mb-8">Score: {gameState.score.toLocaleString()}</p>
          <button
            onClick={() => {
              appRef.current?.fire('hon:reset-game');
            }}
            className="px-8 py-3 bg-green-600 hover:bg-green-500 text-white font-bold rounded-xl transition transform hover:scale-105"
          >
            Play Again
          </button>
        </div>
      )}

      {/* Hon Vision Indicator - appears when Hon is "looking" at the scene */}
      <HonVisionIndicator />
    </div>
  );
};

