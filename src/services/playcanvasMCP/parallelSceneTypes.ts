/**
 * Parallel Scene Builder Types
 *
 * Type definitions for the multi-agent scene building system.
 * Enables Hon to decompose complex scene requests into parallel sub-tasks.
 */

/**
 * Spatial zone for sub-agent assignment
 * Prevents collision by giving each agent a dedicated area
 */
export interface SpatialZone {
  id: string;
  name: string;
  bounds: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  };
  centerY?: number; // Default ground level
}

/**
 * A single decomposed task for a sub-agent
 */
export interface SceneSubTask {
  id: string;
  name: string;
  description: string;
  zone?: SpatialZone;
  priority: number; // Lower = execute first (0 = environment, 1 = structures, 2 = details)
  dependencies?: string[]; // IDs of tasks that must complete first
}

/**
 * Result from Claude's scene decomposition
 */
export interface SceneDecomposition {
  plan: string;
  isComplex: boolean; // True if request needs parallel building
  subTasks: SceneSubTask[];
  estimatedDuration?: number; // ms
}

/**
 * Generated code block from a sub-agent
 */
export interface SceneCodeBlock {
  taskId: string;
  taskName: string;
  code: string;
  zone?: SpatialZone;
  success: boolean;
  error?: string;
  generationTime?: number; // ms
}

/**
 * Request to the parallel execute API
 */
export interface ParallelExecuteRequest {
  intent: string;
  sceneContext?: string;
  mode: 'auto' | 'parallel' | 'sequential';
  maxAgents?: number; // Default 4
  zones?: SpatialZone[]; // Pre-defined zones (optional)
}

/**
 * Response from the parallel execute API
 */
export interface ParallelExecuteResponse {
  success: boolean;
  mode: 'parallel' | 'sequential';
  decomposition?: SceneDecomposition;
  blocks: SceneCodeBlock[];
  totalTime: number; // ms
  error?: string;
}

/**
 * Tool call structure for non-geometry tasks (particles, atmosphere, weather)
 */
export interface ProgressToolCall {
  tool: string;
  params: Record<string, unknown>;
}

/**
 * Progress event during parallel build
 */
export interface ParallelBuildProgress {
  buildId: string;
  phase: 'initializing' | 'decomposing' | 'distributing' | 'generating' | 'executing' | 'complete' | 'error';
  completedTasks: number;
  totalTasks: number;
  currentTask?: string;
  message?: string;
  // For progressive rendering - geometry tasks send code
  sectionCode?: string;
  sectionName?: string;
  sectionZone?: string;
  // For progressive rendering - non-geometry tasks send tool calls
  sectionToolCall?: ProgressToolCall;
}

/**
 * Configuration for the parallel builder
 */
export interface ParallelBuilderConfig {
  maxConcurrentAgents: number;
  requestTimeout: number; // ms per agent
  enableZoneManagement: boolean;
  defaultZoneSize: number; // meters
  minTasksForParallel: number; // Minimum tasks to trigger parallel mode
}

/**
 * Default configuration
 */
export const DEFAULT_PARALLEL_CONFIG: ParallelBuilderConfig = {
  maxConcurrentAgents: 4,
  requestTimeout: 30000, // 30 seconds
  enableZoneManagement: true,
  defaultZoneSize: 40, // 40x40 meter zones
  minTasksForParallel: 2,
};

/**
 * Pre-defined zone templates for common scene types
 */
export const ZONE_TEMPLATES = {
  quadrant: [
    { id: 'nw', name: 'Northwest', bounds: { minX: -50, maxX: 0, minZ: 0, maxZ: 50 } },
    { id: 'ne', name: 'Northeast', bounds: { minX: 0, maxX: 50, minZ: 0, maxZ: 50 } },
    { id: 'sw', name: 'Southwest', bounds: { minX: -50, maxX: 0, minZ: -50, maxZ: 0 } },
    { id: 'se', name: 'Southeast', bounds: { minX: 0, maxX: 50, minZ: -50, maxZ: 0 } },
  ],
  linear: [
    { id: 'left', name: 'Left Side', bounds: { minX: -60, maxX: -20, minZ: -30, maxZ: 30 } },
    { id: 'center', name: 'Center', bounds: { minX: -20, maxX: 20, minZ: -30, maxZ: 30 } },
    { id: 'right', name: 'Right Side', bounds: { minX: 20, maxX: 60, minZ: -30, maxZ: 30 } },
  ],
  radial: [
    { id: 'center', name: 'Center Plaza', bounds: { minX: -15, maxX: 15, minZ: -15, maxZ: 15 } },
    { id: 'north', name: 'North', bounds: { minX: -20, maxX: 20, minZ: 20, maxZ: 50 } },
    { id: 'south', name: 'South', bounds: { minX: -20, maxX: 20, minZ: -50, maxZ: -20 } },
    { id: 'east', name: 'East', bounds: { minX: 20, maxX: 50, minZ: -20, maxZ: 20 } },
    { id: 'west', name: 'West', bounds: { minX: -50, maxX: -20, minZ: -20, maxZ: 20 } },
  ],
} as const;

/**
 * Scene-level keywords that indicate complex multi-zone builds
 */
export const SCENE_KEYWORDS = [
  'village', 'town', 'city', 'world', 'kingdom', 'realm',
  'game level', 'game world', 'environment', 'landscape',
  'complete scene', 'full scene', 'entire scene',
];

/**
 * Compound keywords that require spatial context (e.g., "forest with river")
 */
export const COMPOUND_KEYWORDS = [
  'forest with', 'island with', 'castle with', 'mountain with',
  'beach with', 'desert with', 'park with', 'street with',
];

/**
 * Quantity keywords that only trigger parallel with multiple elements
 */
export const QUANTITY_KEYWORDS = [
  'multiple', 'several', 'bunch of', 'lots of', 'many', 'a few', 'some', 'various', 'different',
];

/**
 * Check if an intent likely needs parallel decomposition
 *
 * IMPORTANT: This is stricter than before to avoid triggering parallel mode
 * for simple Planning Mode steps like "Create trees and bushes".
 * Parallel mode is reserved for truly complex, multi-zone scenes.
 */
export function shouldDecompose(intent: string): boolean {
  // Short requests are NEVER complex - use sequential
  if (intent.length < 50) return false;

  const lower = intent.toLowerCase();

  // Check for explicit scene-level keywords
  const hasSceneKeyword = SCENE_KEYWORDS.some(kw => lower.includes(kw));
  if (hasSceneKeyword) return true;

  // Check for compound keywords (these inherently suggest complex scenes)
  const hasCompoundKeyword = COMPOUND_KEYWORDS.some(kw => lower.includes(kw));
  if (hasCompoundKeyword) return true;

  // Count explicit list markers
  const commaCount = (lower.match(/,/g) || []).length;
  const andCount = (lower.match(/\band\b/g) || []).length;
  const hasMultipleElements = commaCount >= 3 || andCount >= 3;

  // Check for quantity keywords + multiple elements
  const hasQuantityKeyword = QUANTITY_KEYWORDS.some(kw => lower.includes(kw));
  if (hasQuantityKeyword && hasMultipleElements) return true;

  // Very detailed requests with multiple elements (stricter: 150+ chars)
  const isDetailed = intent.length > 150;
  if (isDetailed && hasMultipleElements) return true;

  return false;
}
