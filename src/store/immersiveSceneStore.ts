import { create } from 'zustand';
import { nanoid } from 'nanoid';

// Lazy import for canvas history to avoid circular deps
let canvasHistoryModule: typeof import('../utils/canvasHistory') | null = null;
const getCanvasHistory = async () => {
  if (!canvasHistoryModule) {
    canvasHistoryModule = await import('../utils/canvasHistory');
  }
  return canvasHistoryModule;
};

// Types for immersive scene objects
export interface ImmersiveObject {
  id: string;
  type: 'primitive' | 'model' | 'light' | 'effect' | 'splat';

  // For primitives
  primitiveType?: 'cube' | 'sphere' | 'cylinder' | 'cone' | 'plane' | 'torus';

  // For models
  modelUrl?: string;
  modelPrompt?: string; // What the user asked for (for reference)

  // For Gaussian splats
  splatUrl?: string;
  sourceImageUrl?: string; // The original image used to generate the splat
  
  // For lights
  lightType?: 'point' | 'spot' | 'directional';
  
  // For effects/particles
  effectType?: 'fire' | 'smoke' | 'sparkles' | 'rain' | 'snow' | 'fog_volume';
  
  // Transform
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number }; // Euler angles in degrees
  scale: { x: number; y: number; z: number };
  
  // Appearance
  color?: string; // Hex color
  emissive?: string; // Emissive color
  emissiveIntensity?: number;
  metalness?: number;
  roughness?: number;
  opacity?: number;
  
  // Light properties
  intensity?: number;
  range?: number;
  
  // Animation
  animation?: {
    type: 'rotate' | 'float' | 'pulse' | 'orbit' | 'follow';
    speed?: number;
    amplitude?: number;
    axis?: 'x' | 'y' | 'z';
  };
  
  // Metadata
  name?: string; // User-friendly name ("the red cube", "dragon statue")
  createdAt: string;
  createdBy: 'user' | 'hon';
}

export interface ImmersiveEnvironment {
  // Sky
  skyType: 'color' | 'gradient' | 'hdri';
  skyColor?: string;
  skyGradientTop?: string;
  skyGradientBottom?: string;
  
  // Fog
  fogEnabled: boolean;
  fogColor?: string;
  fogDensity?: number;
  fogStart?: number;
  fogEnd?: number;
  
  // Ambient light
  ambientColor: string;
  ambientIntensity: number;
  
  // Time of day preset
  timeOfDay?: 'dawn' | 'morning' | 'noon' | 'afternoon' | 'sunset' | 'dusk' | 'night' | 'midnight';
  
  // Post-processing
  bloom?: { enabled: boolean; intensity: number; threshold: number };
  vignette?: { enabled: boolean; intensity: number };
}

export interface ImmersiveCamera {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number }; // Euler angles
  fov: number;
}

export interface ImmersiveSound {
  id: string;
  type: 'ambient' | 'spatial' | 'music';
  url?: string;
  preset?: 'forest' | 'rain' | 'wind' | 'ocean' | 'city' | 'cave' | 'fire_crackle';
  position?: { x: number; y: number; z: number }; // For spatial audio
  volume: number;
  loop: boolean;
  isPlaying: boolean;
}

// Snapshot of scene state for undo/redo (optimized with incremental diffs)
interface SceneSnapshot {
  // Full state (only stored for first snapshot or after significant changes)
  objects?: ImmersiveObject[];
  environment?: ImmersiveEnvironment;
  sounds?: ImmersiveSound[];

  // Incremental diff (stores only what changed)
  diff?: {
    type: 'add' | 'update' | 'remove' | 'clear' | 'full';
    objectId?: string;
    objectData?: ImmersiveObject;
    previousData?: Partial<ImmersiveObject>;
    environmentChanges?: Partial<ImmersiveEnvironment>;
  };

  timestamp: number;
  action: string; // Description of what changed

  // Flag to indicate if this should trigger a persistent snapshot
  shouldPersist?: boolean;
}

interface ImmersiveSceneState {
  // Scene objects
  objects: ImmersiveObject[];

  // Environment settings
  environment: ImmersiveEnvironment;

  // Camera state (synced from PlayCanvas)
  camera: ImmersiveCamera;

  // Sounds
  sounds: ImmersiveSound[];

  // Selection state
  selectedObjectId: string | null;

  // Last referenced object (for "make it bigger", "that one", etc.)
  lastReferencedObjectId: string | null;

  // Undo/Redo history
  history: SceneSnapshot[];
  historyIndex: number;
  maxHistorySize: number;
}

interface ImmersiveSceneActions {
  // Object management
  addObject: (object: Omit<ImmersiveObject, 'id' | 'createdAt'>) => string;
  updateObject: (id: string, updates: Partial<ImmersiveObject>) => void;
  removeObject: (id: string) => void;
  clearObjects: () => void;
  
  // Find objects by description
  findObjectByName: (name: string) => ImmersiveObject | undefined;
  findObjectsNear: (position: { x: number; y: number; z: number }, radius: number) => ImmersiveObject[];
  
  // Environment
  setEnvironment: (updates: Partial<ImmersiveEnvironment>) => void;
  setTimeOfDay: (time: ImmersiveEnvironment['timeOfDay']) => void;
  
  // Camera
  updateCamera: (camera: Partial<ImmersiveCamera>) => void;
  
  // Sounds
  addSound: (sound: Omit<ImmersiveSound, 'id'>) => string;
  updateSound: (id: string, updates: Partial<ImmersiveSound>) => void;
  removeSound: (id: string) => void;
  
  // Selection
  setSelectedObject: (id: string | null) => void;
  setLastReferencedObject: (id: string | null) => void;

  // Undo/Redo
  undo: () => boolean;
  redo: () => boolean;
  canUndo: () => boolean;
  canRedo: () => boolean;
  pushHistory: (action: string, diff?: SceneSnapshot['diff'], shouldPersist?: boolean) => void;

  // Persistent snapshots (Supabase)
  triggerPersistentSnapshot: (description: string) => Promise<void>;

  // Reset
  resetScene: () => void;
}

const DEFAULT_ENVIRONMENT: ImmersiveEnvironment = {
  skyType: 'color',
  skyColor: '#000000', // Pure black background by default
  fogEnabled: false,
  fogColor: '#000000',
  fogDensity: 0.02,
  ambientColor: '#404060',
  ambientIntensity: 0.5,
};

const DEFAULT_CAMERA: ImmersiveCamera = {
  position: { x: 0, y: 0.5, z: 4 },
  rotation: { x: 0, y: 0, z: 0 },
  fov: 75,
};

export const useImmersiveSceneStore = create<ImmersiveSceneState & ImmersiveSceneActions>((set, get) => ({
  // Initial state
  objects: [],
  environment: DEFAULT_ENVIRONMENT,
  camera: DEFAULT_CAMERA,
  sounds: [],
  selectedObjectId: null,
  lastReferencedObjectId: null,

  // Undo/Redo state
  history: [],
  historyIndex: -1,
  maxHistorySize: 50,

  // Helper to push current state to history (call BEFORE making changes)
  // Now supports incremental diffs for better performance
  pushHistory: (action: string, diff?: SceneSnapshot['diff'], shouldPersist: boolean = false) => {
    const state = get();

    // Use structuredClone for better performance than JSON.parse/stringify
    // Only store full state if no diff provided or first snapshot
    const snapshot: SceneSnapshot = diff
      ? {
          diff,
          timestamp: Date.now(),
          action,
          shouldPersist
        }
      : {
          // Full snapshot using structuredClone (faster than JSON methods)
          objects: structuredClone(state.objects),
          environment: structuredClone(state.environment),
          sounds: structuredClone(state.sounds),
          diff: { type: 'full' },
          timestamp: Date.now(),
          action,
          shouldPersist
        };

    set((s) => {
      // Truncate any redo history
      const newHistory = s.history.slice(0, s.historyIndex + 1);
      newHistory.push(snapshot);

      // Limit history size
      if (newHistory.length > s.maxHistorySize) {
        newHistory.shift();
      }

      return {
        history: newHistory,
        historyIndex: newHistory.length - 1
      };
    });

    // Trigger persistent snapshot in background (non-blocking)
    if (shouldPersist) {
      getCanvasHistory().then(module => {
        module.createImmersiveSceneSnapshot(action);
      }).catch(err => {
        console.warn('[ImmersiveScene] Failed to create persistent snapshot:', err);
      });
    }
  },

  // Object management - now with incremental diffs and persistent snapshots
  addObject: (objectData) => {
    const id = nanoid();
    const newObject: ImmersiveObject = {
      ...objectData,
      id,
      createdAt: new Date().toISOString(),
    };

    // Push history with incremental diff (add operation persists to Supabase)
    get().pushHistory(
      `Add ${objectData.name || objectData.type}`,
      { type: 'add', objectId: id, objectData: structuredClone(newObject) },
      true // Persist to Supabase
    );

    set((state) => ({
      objects: [...state.objects, newObject],
      lastReferencedObjectId: id,
    }));
    return id;
  },

  updateObject: (id, updates) => {
    const obj = get().objects.find(o => o.id === id);
    if (!obj) return;

    // Store previous data for undo (only the fields being updated)
    const previousData: Partial<ImmersiveObject> = {};
    for (const key of Object.keys(updates)) {
      const k = key as keyof ImmersiveObject;
      if (k in obj) {
        (previousData as Record<string, unknown>)[k] = obj[k];
      }
    }

    // Push history with incremental diff (updates don't persist unless significant)
    get().pushHistory(
      `Update ${obj?.name || 'object'}`,
      { type: 'update', objectId: id, previousData, objectData: structuredClone(updates) as ImmersiveObject },
      false // Don't persist every update (too frequent)
    );

    set((state) => ({
      objects: state.objects.map((o) =>
        o.id === id ? { ...o, ...updates } : o
      ),
      lastReferencedObjectId: id,
    }));
  },

  removeObject: (id) => {
    const obj = get().objects.find(o => o.id === id);
    if (!obj) return;

    // Push history with incremental diff (remove persists to Supabase)
    get().pushHistory(
      `Remove ${obj?.name || 'object'}`,
      { type: 'remove', objectId: id, objectData: structuredClone(obj) },
      true // Persist to Supabase
    );

    set((state) => ({
      objects: state.objects.filter((o) => o.id !== id),
      lastReferencedObjectId: state.lastReferencedObjectId === id ? null : state.lastReferencedObjectId,
      selectedObjectId: state.selectedObjectId === id ? null : state.selectedObjectId,
    }));
  },

  clearObjects: () => {
    const currentObjects = get().objects;
    if (currentObjects.length === 0) return;

    // Store all objects for potential undo
    get().pushHistory(
      'Clear all objects',
      { type: 'clear', objectData: undefined },
      true // Persist to Supabase
    );

    // Store full state before clearing for undo
    const state = get();
    const fullSnapshot: SceneSnapshot = {
      objects: structuredClone(state.objects),
      environment: structuredClone(state.environment),
      sounds: structuredClone(state.sounds),
      diff: { type: 'full' },
      timestamp: Date.now(),
      action: 'State before clear',
      shouldPersist: false
    };

    set((s) => {
      // Replace last history item with full snapshot
      const newHistory = [...s.history];
      if (newHistory.length > 0) {
        newHistory[newHistory.length - 1] = fullSnapshot;
      }
      return {
        history: newHistory,
        objects: [],
        selectedObjectId: null,
        lastReferencedObjectId: null
      };
    });
  },
  
  findObjectByName: (name) => {
    const state = get();
    const lowerName = name.toLowerCase();
    
    // Common synonyms mapping
    const synonyms: Record<string, string[]> = {
      'cube': ['box', 'square', 'block'],
      'sphere': ['ball', 'orb', 'globe'],
      'cylinder': ['pillar', 'column', 'tube'],
      'cone': ['pyramid', 'spike'],
      'torus': ['ring', 'donut', 'doughnut'],
      'plane': ['floor', 'ground', 'platform'],
      'splat': ['gaussian', '3d photo', 'splat', 'gaussian splat'],
    };
    
    // Build a list of terms to search for
    const searchTerms = [lowerName];
    for (const [canonical, alts] of Object.entries(synonyms)) {
      if (alts.includes(lowerName)) {
        searchTerms.push(canonical);
      }
      if (canonical === lowerName) {
        searchTerms.push(...alts);
      }
    }
    
    return state.objects.find((obj) => {
      const objName = obj.name?.toLowerCase() || '';
      const objType = obj.primitiveType?.toLowerCase() || '';
      const objPrompt = obj.modelPrompt?.toLowerCase() || '';
      
      return searchTerms.some(term => 
        objName.includes(term) ||
        objType.includes(term) ||
        objPrompt.includes(term)
      );
    });
  },
  
  findObjectsNear: (position, radius) => {
    const state = get();
    return state.objects.filter((obj) => {
      const dx = obj.position.x - position.x;
      const dy = obj.position.y - position.y;
      const dz = obj.position.z - position.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      return distance <= radius;
    });
  },
  
  // Environment
  setEnvironment: (updates) => {
    set((state) => ({
      environment: { ...state.environment, ...updates },
    }));
  },
  
  setTimeOfDay: (time) => {
    const presets: Record<NonNullable<ImmersiveEnvironment['timeOfDay']>, Partial<ImmersiveEnvironment>> = {
      dawn: {
        skyColor: '#ff9966',
        skyGradientTop: '#1a1a2e',
        skyGradientBottom: '#ff9966',
        ambientColor: '#ffd4a3',
        ambientIntensity: 0.4,
        fogColor: '#ffccaa',
      },
      morning: {
        skyColor: '#87ceeb',
        ambientColor: '#fffaf0',
        ambientIntensity: 0.6,
        fogColor: '#e0e8f0',
      },
      noon: {
        skyColor: '#4a90d9',
        ambientColor: '#ffffff',
        ambientIntensity: 0.8,
        fogColor: '#c0d8f0',
      },
      afternoon: {
        skyColor: '#6bb3f0',
        ambientColor: '#fff8e7',
        ambientIntensity: 0.7,
        fogColor: '#d0e0f0',
      },
      sunset: {
        skyColor: '#ff6b35',
        skyGradientTop: '#2d1b4e',
        skyGradientBottom: '#ff6b35',
        ambientColor: '#ffaa77',
        ambientIntensity: 0.5,
        fogColor: '#ff9966',
      },
      dusk: {
        skyColor: '#4a3b6b',
        ambientColor: '#9988aa',
        ambientIntensity: 0.3,
        fogColor: '#665577',
      },
      night: {
        skyColor: '#0a0a1a',
        ambientColor: '#334466',
        ambientIntensity: 0.2,
        fogColor: '#1a1a2a',
      },
      midnight: {
        skyColor: '#050510',
        ambientColor: '#222244',
        ambientIntensity: 0.1,
        fogColor: '#0a0a14',
      },
    };
    
    if (time && presets[time]) {
      set((state) => ({
        environment: { ...state.environment, ...presets[time], timeOfDay: time },
      }));
    }
  },
  
  // Camera
  updateCamera: (updates) => {
    set((state) => ({
      camera: { ...state.camera, ...updates },
    }));
  },
  
  // Sounds
  addSound: (soundData) => {
    const id = nanoid();
    const newSound: ImmersiveSound = { ...soundData, id };
    set((state) => ({
      sounds: [...state.sounds, newSound],
    }));
    return id;
  },
  
  updateSound: (id, updates) => {
    set((state) => ({
      sounds: state.sounds.map((sound) =>
        sound.id === id ? { ...sound, ...updates } : sound
      ),
    }));
  },
  
  removeSound: (id) => {
    set((state) => ({
      sounds: state.sounds.filter((sound) => sound.id !== id),
    }));
  },
  
  // Selection
  setSelectedObject: (id) => {
    set({ selectedObjectId: id });
  },
  
  setLastReferencedObject: (id) => {
    set({ lastReferencedObjectId: id });
  },

  // Undo/Redo implementation with incremental diff support
  canUndo: () => {
    const state = get();
    return state.historyIndex >= 0;
  },

  canRedo: () => {
    const state = get();
    return state.historyIndex < state.history.length - 1;
  },

  undo: () => {
    const state = get();
    if (state.historyIndex < 0) {
      console.log('[UndoRedo] Nothing to undo');
      return false;
    }

    // Get snapshot to restore
    const snapshot = state.history[state.historyIndex];

    // Save current state for potential redo (if we haven't already)
    if (state.historyIndex === state.history.length - 1) {
      // We're at the end, push current state for redo
      const currentSnapshot: SceneSnapshot = {
        objects: structuredClone(state.objects),
        environment: structuredClone(state.environment),
        sounds: structuredClone(state.sounds),
        diff: { type: 'full' },
        timestamp: Date.now(),
        action: 'Current state'
      };
      set((s) => ({
        history: [...s.history, currentSnapshot]
      }));
    }

    // Handle different snapshot types
    if (snapshot.diff && snapshot.diff.type !== 'full') {
      // Incremental undo based on diff type
      const { diff } = snapshot;

      switch (diff.type) {
        case 'add':
          // Undo add = remove the object
          if (diff.objectId) {
            set((s) => ({
              objects: s.objects.filter(o => o.id !== diff.objectId),
              historyIndex: state.historyIndex - 1,
              selectedObjectId: null
            }));
          }
          break;

        case 'remove':
          // Undo remove = re-add the object
          if (diff.objectData) {
            set((s) => ({
              objects: [...s.objects, structuredClone(diff.objectData!)],
              historyIndex: state.historyIndex - 1,
              selectedObjectId: null
            }));
          }
          break;

        case 'update':
          // Undo update = restore previous data
          if (diff.objectId && diff.previousData) {
            set((s) => ({
              objects: s.objects.map(o =>
                o.id === diff.objectId
                  ? { ...o, ...diff.previousData }
                  : o
              ),
              historyIndex: state.historyIndex - 1,
              selectedObjectId: null
            }));
          }
          break;

        default:
          // Fall back to full restore
          if (snapshot.objects && snapshot.environment && snapshot.sounds) {
            set({
              objects: structuredClone(snapshot.objects),
              environment: structuredClone(snapshot.environment),
              sounds: structuredClone(snapshot.sounds),
              historyIndex: state.historyIndex - 1,
              selectedObjectId: null
            });
          }
      }
    } else if (snapshot.objects && snapshot.environment && snapshot.sounds) {
      // Full snapshot restore
      set({
        objects: structuredClone(snapshot.objects),
        environment: structuredClone(snapshot.environment),
        sounds: structuredClone(snapshot.sounds),
        historyIndex: state.historyIndex - 1,
        selectedObjectId: null
      });
    } else {
      // Invalid snapshot, just decrement index
      set({ historyIndex: state.historyIndex - 1 });
    }

    console.log('[UndoRedo] Undo:', snapshot.action);
    return true;
  },

  redo: () => {
    const state = get();
    if (state.historyIndex >= state.history.length - 1) {
      console.log('[UndoRedo] Nothing to redo');
      return false;
    }

    // Move forward and restore
    const nextIndex = state.historyIndex + 2; // +2 because we want the state AFTER the action
    if (nextIndex >= state.history.length) {
      console.log('[UndoRedo] No redo state available');
      return false;
    }

    const snapshot = state.history[nextIndex];

    // Handle different snapshot types for redo
    if (snapshot.diff && snapshot.diff.type !== 'full') {
      const { diff } = snapshot;

      switch (diff.type) {
        case 'add':
          // Redo add = re-add the object
          if (diff.objectData) {
            set((s) => ({
              objects: [...s.objects, structuredClone(diff.objectData!)],
              historyIndex: state.historyIndex + 1,
              selectedObjectId: null
            }));
          }
          break;

        case 'remove':
          // Redo remove = remove the object again
          if (diff.objectId) {
            set((s) => ({
              objects: s.objects.filter(o => o.id !== diff.objectId),
              historyIndex: state.historyIndex + 1,
              selectedObjectId: null
            }));
          }
          break;

        case 'update':
          // Redo update = apply the update again
          if (diff.objectId && diff.objectData) {
            set((s) => ({
              objects: s.objects.map(o =>
                o.id === diff.objectId
                  ? { ...o, ...diff.objectData }
                  : o
              ),
              historyIndex: state.historyIndex + 1,
              selectedObjectId: null
            }));
          }
          break;

        default:
          // Fall back to full restore
          if (snapshot.objects && snapshot.environment && snapshot.sounds) {
            set({
              objects: structuredClone(snapshot.objects),
              environment: structuredClone(snapshot.environment),
              sounds: structuredClone(snapshot.sounds),
              historyIndex: state.historyIndex + 1,
              selectedObjectId: null
            });
          }
      }
    } else if (snapshot.objects && snapshot.environment && snapshot.sounds) {
      // Full snapshot restore
      set({
        objects: structuredClone(snapshot.objects),
        environment: structuredClone(snapshot.environment),
        sounds: structuredClone(snapshot.sounds),
        historyIndex: state.historyIndex + 1,
        selectedObjectId: null
      });
    } else {
      // Invalid snapshot, just increment index
      set({ historyIndex: state.historyIndex + 1 });
    }

    console.log('[UndoRedo] Redo:', snapshot.action);
    return true;
  },

  // Manually trigger a persistent snapshot to Supabase
  triggerPersistentSnapshot: async (description: string) => {
    try {
      const module = await getCanvasHistory();
      await module.createImmersiveSceneSnapshot(description);
      console.log('[ImmersiveScene] Persistent snapshot created:', description);
    } catch (err) {
      console.warn('[ImmersiveScene] Failed to create persistent snapshot:', err);
    }
  },

  // Reset
  resetScene: () => {
    const state = get();

    // Store full state before reset for undo
    const fullSnapshot: SceneSnapshot = {
      objects: structuredClone(state.objects),
      environment: structuredClone(state.environment),
      sounds: structuredClone(state.sounds),
      diff: { type: 'full' },
      timestamp: Date.now(),
      action: 'State before reset',
      shouldPersist: true
    };

    set((s) => {
      const newHistory = s.history.slice(0, s.historyIndex + 1);
      newHistory.push(fullSnapshot);
      if (newHistory.length > s.maxHistorySize) {
        newHistory.shift();
      }

      return {
        history: newHistory,
        historyIndex: newHistory.length - 1,
        objects: [],
        environment: DEFAULT_ENVIRONMENT,
        sounds: [],
        selectedObjectId: null,
        lastReferencedObjectId: null,
      };
    });

    // Trigger persistent snapshot
    getCanvasHistory().then(module => {
      module.createImmersiveSceneSnapshot('Reset scene');
    }).catch(err => {
      console.warn('[ImmersiveScene] Failed to create persistent snapshot:', err);
    });
  },
}));

// Helper to get position relative to camera (for "in front of me", "to my left", etc.)
export function getPositionRelativeToCamera(
  camera: ImmersiveCamera,
  direction: 'front' | 'behind' | 'left' | 'right' | 'above' | 'below',
  distance: number = 3
): { x: number; y: number; z: number } {
  const { position, rotation } = camera;
  const yawRad = (rotation.y * Math.PI) / 180;
  
  // Forward vector based on camera yaw
  const forwardX = -Math.sin(yawRad);
  const forwardZ = -Math.cos(yawRad);
  
  // Right vector
  const rightX = Math.cos(yawRad);
  const rightZ = -Math.sin(yawRad);
  
  switch (direction) {
    case 'front':
      return {
        x: position.x + forwardX * distance,
        y: position.y,
        z: position.z + forwardZ * distance,
      };
    case 'behind':
      return {
        x: position.x - forwardX * distance,
        y: position.y,
        z: position.z - forwardZ * distance,
      };
    case 'left':
      return {
        x: position.x - rightX * distance,
        y: position.y,
        z: position.z - rightZ * distance,
      };
    case 'right':
      return {
        x: position.x + rightX * distance,
        y: position.y,
        z: position.z + rightZ * distance,
      };
    case 'above':
      return {
        x: position.x,
        y: position.y + distance,
        z: position.z,
      };
    case 'below':
      return {
        x: position.x,
        y: position.y - distance,
        z: position.z,
      };
    default:
      return { x: position.x, y: position.y, z: position.z - distance };
  }
}

