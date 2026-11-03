/**
 * Asset Registry for Immersive Scene System
 * 
 * This registry catalogs all available 3D assets for use in PlayCanvas scenes.
 * Claude uses this to know what assets are available when building games/scenes.
 * 
 * All assets are GLB format and compatible with PlayCanvas/React.
 */

/**
 * Asset Storage Configuration
 * 
 * Toggle between local (development) and Supabase (production) storage:
 * - Local: Assets served from /assets/3d/ (works in dev, fails on Vercel due to LFS/size limits)
 * - Supabase: Assets served from Supabase Storage bucket (works everywhere)
 */
// Configure storage owned by the operator; a public clone must not silently
// consume the author's Supabase bucket. Only credited assets are catalogued.
const configuredAssetBase = import.meta.env?.VITE_3D_ASSET_BASE_URL?.trim();
export const ASSET_BASE_URL = (configuredAssetBase || '/assets/3d').replace(/\/+$/, '');

/**
 * Helper to get full asset path
 */
export function getAssetUrl(relativePath: string): string {
  // relativePath should be like "environment/scenes/times_square_block.glb"
  return `${ASSET_BASE_URL}/${relativePath}`;
}

export type AssetCategory = 
  | 'character'
  | 'vehicle'
  | 'environment'
  | 'weapon'
  | 'fps'
  | 'animation';

export type AssetSubcategory =
  // Characters
  | 'humanoid'
  | 'creature'
  | 'robot'
  // Vehicles
  | 'car'
  | 'aircraft'
  | 'spaceship'
  // Environment
  | 'tree'
  | 'building'
  | 'scene'
  | 'terrain'
  | 'vegetation'
  | 'prop'
  // Weapons
  | 'firearm'
  | 'melee'
  | 'explosive'
  | 'ammo'
  // FPS
  | 'rig';

/**
 * Scene size classification for proper scaling expectations
 * - small: Single room, small arena (10-50m)
 * - medium: City block, street section (50-200m)
 * - large: Multiple blocks, small city (200-500m)
 * - huge: Full city, large environment (500m+)
 */
export type SceneSize = 'small' | 'medium' | 'large' | 'huge';

/**
 * Real-world dimensions in meters
 * Used to ensure assets are properly scaled relative to each other
 */
export interface RealWorldDimensions {
  /** Height in meters (Y axis) */
  height: number;
  /** Width in meters (X axis) - typically the widest horizontal measurement */
  width: number;
  /** Depth/Length in meters (Z axis) */
  depth: number;
}

/**
 * Reference dimensions for common real-world objects (in meters)
 * These serve as guidelines for proper asset scaling
 */
export const REFERENCE_DIMENSIONS = {
  // Humans
  averageHumanHeight: 1.75,
  childHeight: 1.2,

  // Vehicles
  sedanLength: 4.5,
  sedanWidth: 1.8,
  sedanHeight: 1.5,
  sportsCarLength: 4.2,
  sportsCarWidth: 1.9,
  sportsCarHeight: 1.2,
  truckLength: 7.0,
  truckWidth: 2.5,
  truckHeight: 3.0,

  // Urban elements
  streetWidth: 6.0,  // Standard two-lane road
  sidewalkWidth: 2.0,
  streetlightHeight: 6.0,
  trafficLightHeight: 4.5,
  buildingFloorHeight: 3.0,

  // Nature
  mediumTreeHeight: 8.0,
  largeTreeHeight: 15.0,
  bushHeight: 1.5,

  // Weapons
  rifleLength: 0.9,
  pistolLength: 0.2,
  knifeLength: 0.3,
} as const;

export interface Asset3D {
  id: string;
  name: string;
  path: string;
  category: AssetCategory;
  subcategory: AssetSubcategory;
  tags: string[];
  rigged: boolean;
  animated: boolean;
  /**
   * Expected real-world dimensions in meters when properly scaled.
   * If not specified, uses category defaults.
   */
  realWorldDimensions?: RealWorldDimensions;
  /**
   * The scale factor to apply when loading to achieve real-world dimensions.
   * A value of 1.0 means the asset is already at correct scale (1 unit = 1 meter).
   * A value of 0.01 means the asset was modeled at 100x scale (common for cm-based workflows).
   */
  normalizedScale?: number;
  /**
   * For scene assets: indicates the expected size category.
   * Helps validation understand what size range is appropriate.
   */
  sceneSize?: SceneSize;
  /**
   * @deprecated Use normalizedScale instead
   */
  scale?: number;
  /**
   * Rotation correction in degrees { x, y, z } to apply when loading.
   * Use this for assets that were exported with incorrect orientation.
   * Common fix: { x: -90, y: 0, z: 0 } for Z-up models in Y-up engine.
   */
  rotationCorrection?: { x: number; y: number; z: number };
  description?: string;
}

/**
 * Complete registry of all 3D assets
 */
export const ASSET_REGISTRY: Asset3D[] = [
  // ============================================
  // CHARACTERS - HUMANOID (11)
  // ============================================
  {
    id: 'cyberpunk_character',
    name: 'Cyberpunk Character',
    path: '/assets/3d/characters/humanoid/cyberpunk_character.glb',
    category: 'character',
    subcategory: 'humanoid',
    tags: ['cyberpunk', 'sci-fi', 'futuristic', 'player', 'npc'],
    rigged: true,
    animated: true,
    description: 'Futuristic cyberpunk style character'
  },
  {
    id: 'desert_soldier',
    name: 'Desert Soldier',
    path: '/assets/3d/characters/humanoid/desert_soldier_character.glb',
    category: 'character',
    subcategory: 'humanoid',
    tags: ['soldier', 'military', 'desert', 'combat', 'player', 'enemy'],
    rigged: true,
    animated: true,
    description: 'Military soldier in desert gear'
  },
  {
    id: 'driver',
    name: 'Driver Character',
    path: '/assets/3d/characters/humanoid/Driver_character.glb',
    category: 'character',
    subcategory: 'humanoid',
    tags: ['driver', 'racing', 'car', 'civilian'],
    rigged: true,
    animated: true,
    description: 'Racing/driving character'
  },
  {
    id: 'elf',
    name: 'Elf Character',
    path: '/assets/3d/characters/humanoid/Elf_character.glb',
    category: 'character',
    subcategory: 'humanoid',
    tags: ['elf', 'fantasy', 'magic', 'rpg', 'player', 'npc'],
    rigged: true,
    animated: true,
    description: 'Fantasy elf character'
  },
  {
    id: 'mage',
    name: 'Mage Character',
    path: '/assets/3d/characters/humanoid/mage_character.glb',
    category: 'character',
    subcategory: 'humanoid',
    tags: ['mage', 'wizard', 'magic', 'fantasy', 'rpg', 'player'],
    rigged: true,
    animated: true,
    description: 'Fantasy mage/wizard character'
  },
  {
    id: 'ninja',
    name: 'Ninja NPC',
    path: '/assets/3d/characters/humanoid/ninja_NPC.glb',
    category: 'character',
    subcategory: 'humanoid',
    tags: ['ninja', 'stealth', 'combat', 'enemy', 'npc', 'japanese'],
    rigged: true,
    animated: true,
    description: 'Stealthy ninja character'
  },
  {
    id: 'samurai',
    name: 'Samurai Character',
    path: '/assets/3d/characters/humanoid/samurai_character.glb',
    category: 'character',
    subcategory: 'humanoid',
    tags: ['samurai', 'warrior', 'sword', 'japanese', 'combat', 'player'],
    rigged: true,
    animated: true,
    description: 'Japanese samurai warrior'
  },
  {
    id: 'security_guard',
    name: 'Security Guard',
    path: '/assets/3d/characters/humanoid/security_guard_NPC.glb',
    category: 'character',
    subcategory: 'humanoid',
    tags: ['guard', 'security', 'police', 'npc', 'enemy', 'civilian'],
    rigged: true,
    animated: true,
    description: 'Security guard NPC'
  },
  {
    id: 'boy_npc',
    name: 'Boy NPC',
    path: '/assets/3d/characters/humanoid/boy_NPC.glb',
    category: 'character',
    subcategory: 'humanoid',
    tags: ['boy', 'child', 'kid', 'npc', 'civilian', 'young'],
    rigged: true,
    animated: true,
    description: 'Young boy NPC'
  },
  {
    id: 'girl_npc',
    name: 'Girl NPC',
    path: '/assets/3d/characters/humanoid/girl_NPC.glb',
    category: 'character',
    subcategory: 'humanoid',
    tags: ['girl', 'child', 'kid', 'npc', 'civilian', 'young'],
    rigged: true,
    animated: true,
    description: 'Young girl NPC'
  },
  {
    id: 'dancing_npc',
    name: 'Dancing NPC',
    path: '/assets/3d/characters/humanoid/Dancing_NPC.glb',
    category: 'character',
    subcategory: 'humanoid',
    tags: ['dancer', 'dancing', 'npc', 'party', 'club', 'animated'],
    rigged: true,
    animated: true,
    description: 'Character with dancing animation'
  },

  // ============================================
  // CHARACTERS - ROBOTS (2)
  // ============================================
  {
    id: 'robot_1',
    name: 'Robot Character',
    path: '/assets/3d/characters/robots/robot_character.glb',
    category: 'character',
    subcategory: 'robot',
    tags: ['robot', 'mech', 'sci-fi', 'android', 'enemy', 'player'],
    rigged: true,
    animated: true,
    description: 'Robotic character'
  },

  // ============================================
  // VEHICLES - CARS (6)
  // NOTE: Many vehicle GLBs are modeled in centimeters, requiring scale of 0.01
  // NOTE: Vehicles from Sketchfab often have Z-up orientation, need -90 X correction
  // ============================================
  {
    id: 'car_1',
    name: 'Car',
    path: '/assets/3d/vehicles/cars/car.glb',
    category: 'vehicle',
    subcategory: 'car',
    tags: ['car', 'sedan', 'vehicle', 'driving', 'city'],
    rigged: true,
    animated: false,
    realWorldDimensions: { height: 1.5, width: 1.8, depth: 4.5 },
    normalizedScale: 0.01, // Asset modeled in cm
    rotationCorrection: { x: -90, y: 0, z: 0 }, // Z-up to Y-up correction
    description: 'Standard car (~4.5m long)'
  },
  {
    id: 'car_2',
    name: 'Car 2',
    path: '/assets/3d/vehicles/cars/car_2.glb',
    category: 'vehicle',
    subcategory: 'car',
    tags: ['car', 'sedan', 'vehicle', 'driving', 'city'],
    rigged: true,
    animated: false,
    realWorldDimensions: { height: 1.5, width: 1.8, depth: 4.5 },
    normalizedScale: 0.01, // Asset modeled in cm
    rotationCorrection: { x: -90, y: 0, z: 0 }, // Z-up to Y-up correction
    description: 'Alternative car model (~4.5m long)'
  },
  {
    id: 'car_3',
    name: 'Car 3',
    path: '/assets/3d/vehicles/cars/car_3.glb',
    category: 'vehicle',
    subcategory: 'car',
    tags: ['car', 'sedan', 'vehicle', 'driving', 'city'],
    rigged: true,
    animated: false,
    realWorldDimensions: { height: 1.5, width: 1.8, depth: 4.5 },
    normalizedScale: 0.01, // Asset modeled in cm
    rotationCorrection: { x: -90, y: 0, z: 0 }, // Z-up to Y-up correction
    description: 'Third car variant (~4.5m long)'
  },
  {
    id: 'sportscar_1',
    name: 'Sports Car',
    path: '/assets/3d/vehicles/cars/rigged_sportscar.glb',
    category: 'vehicle',
    subcategory: 'car',
    tags: ['sportscar', 'racing', 'fast', 'sports', 'luxury'],
    rigged: true,
    animated: false,
    realWorldDimensions: { height: 1.2, width: 1.9, depth: 4.2 },
    normalizedScale: 0.01, // Asset modeled in cm
    rotationCorrection: { x: -90, y: 0, z: 0 }, // Z-up to Y-up correction
    description: 'Fast sports car (~4.2m long, low profile)'
  },
  {
    id: 'sportscar_2',
    name: 'Sports Car 2',
    path: '/assets/3d/vehicles/cars/rigged_sportscar_2.glb',
    category: 'vehicle',
    subcategory: 'car',
    tags: ['sportscar', 'racing', 'fast', 'sports', 'luxury'],
    rigged: true,
    animated: false,
    realWorldDimensions: { height: 1.2, width: 1.9, depth: 4.2 },
    normalizedScale: 0.01, // Asset modeled in cm
    rotationCorrection: { x: -90, y: 0, z: 0 }, // Z-up to Y-up correction
    description: 'Alternative sports car (~4.2m long, low profile)'
  },

  // ============================================
  // VEHICLES - AIRCRAFT (2)
  // ============================================
  {
    id: 'plane',
    name: 'Plane',
    path: '/assets/3d/vehicles/aircraft/Plane.glb',
    category: 'vehicle',
    subcategory: 'aircraft',
    tags: ['plane', 'airplane', 'aircraft', 'flying', 'transport'],
    rigged: false,
    animated: false,
    description: 'Standard airplane'
  },
  {
    id: 'rigged_plane',
    name: 'Rigged Plane',
    path: '/assets/3d/vehicles/aircraft/rigged_plane.glb',
    category: 'vehicle',
    subcategory: 'aircraft',
    tags: ['plane', 'airplane', 'aircraft', 'flying', 'controllable'],
    rigged: true,
    animated: false,
    description: 'Plane with rigged control surfaces'
  },

  // ============================================
  // VEHICLES - SPACESHIPS (6)
  // ============================================
  {
    id: 'small_spaceship_1',
    name: 'Small Spaceship',
    path: '/assets/3d/vehicles/spaceships/small_spaceship.glb',
    category: 'vehicle',
    subcategory: 'spaceship',
    tags: ['spaceship', 'sci-fi', 'space', 'fighter', 'small'],
    rigged: false,
    animated: false,
    description: 'Small fighter spaceship'
  },
  {
    id: 'small_spaceship_2',
    name: 'Small Spaceship 2',
    path: '/assets/3d/vehicles/spaceships/small_spaceship_2.glb',
    category: 'vehicle',
    subcategory: 'spaceship',
    tags: ['spaceship', 'sci-fi', 'space', 'fighter', 'small'],
    rigged: false,
    animated: false,
    description: 'Alternative small spaceship'
  },
  {
    id: 'large_spaceship',
    name: 'Large Spaceship',
    path: '/assets/3d/vehicles/spaceships/large_spaceship.glb',
    category: 'vehicle',
    subcategory: 'spaceship',
    tags: ['spaceship', 'sci-fi', 'space', 'cruiser', 'large'],
    rigged: false,
    animated: false,
    description: 'Large cruiser spaceship'
  },
  {
    id: 'mothership',
    name: 'Mothership',
    path: '/assets/3d/vehicles/spaceships/large_mothership.glb',
    category: 'vehicle',
    subcategory: 'spaceship',
    tags: ['spaceship', 'mothership', 'sci-fi', 'space', 'massive', 'boss'],
    rigged: false,
    animated: false,
    description: 'Massive mothership'
  },
  {
    id: 'rigged_spaceship',
    name: 'Rigged Big Spaceship',
    path: '/assets/3d/vehicles/spaceships/rigged_big_spaceship.glb',
    category: 'vehicle',
    subcategory: 'spaceship',
    tags: ['spaceship', 'sci-fi', 'space', 'controllable', 'large'],
    rigged: true,
    animated: false,
    description: 'Large spaceship with rigged parts'
  },
  {
    id: 'spaceship_interior',
    name: 'Spaceship with Interior',
    path: '/assets/3d/vehicles/spaceships/spaceship_with_interior.glb',
    category: 'vehicle',
    subcategory: 'spaceship',
    tags: ['spaceship', 'interior', 'sci-fi', 'space', 'detailed'],
    rigged: false,
    animated: false,
    description: 'Spaceship with detailed interior'
  },

  // ============================================
  // ENVIRONMENT - TREES (6)
  // ============================================
  {
    id: 'big_tree',
    name: 'Big Tree',
    path: '/assets/3d/environment/trees/Big_tree.glb',
    category: 'environment',
    subcategory: 'tree',
    tags: ['tree', 'big', 'nature', 'forest', 'foliage'],
    rigged: false,
    animated: false,
    description: 'Large tree'
  },
  {
    id: 'big_tree_2',
    name: 'Big Tree 2',
    path: '/assets/3d/environment/trees/big_tree_2.glb',
    category: 'environment',
    subcategory: 'tree',
    tags: ['tree', 'big', 'nature', 'forest', 'foliage'],
    rigged: false,
    animated: false,
    description: 'Alternative large tree'
  },
  {
    id: 'mango_tree',
    name: 'Mango Tree',
    path: '/assets/3d/environment/trees/mango_tree.glb',
    category: 'environment',
    subcategory: 'tree',
    tags: ['tree', 'mango', 'tropical', 'fruit', 'nature'],
    rigged: false,
    animated: false,
    description: 'Tropical mango tree'
  },
  {
    id: 'one_tree',
    name: 'Single Tree',
    path: '/assets/3d/environment/trees/one_tree.glb',
    category: 'environment',
    subcategory: 'tree',
    tags: ['tree', 'single', 'nature', 'simple'],
    rigged: false,
    animated: false,
    description: 'Simple single tree'
  },
  {
    id: 'three_trees',
    name: 'Three Trees',
    path: '/assets/3d/environment/trees/three_trees.glb',
    category: 'environment',
    subcategory: 'tree',
    tags: ['tree', 'group', 'nature', 'forest', 'cluster'],
    rigged: false,
    animated: false,
    description: 'Group of three trees'
  },
  {
    id: 'tree_house',
    name: 'Tree House',
    path: '/assets/3d/environment/trees/tree_house.glb',
    category: 'environment',
    subcategory: 'tree',
    tags: ['tree', 'house', 'treehouse', 'fantasy', 'building'],
    rigged: false,
    animated: false,
    description: 'Tree with a house built in it'
  },

  // ============================================
  // ENVIRONMENT - BUILDINGS (4)
  // ============================================
  {
    id: 'building',
    name: 'Building',
    path: '/assets/3d/environment/buildings/building.glb',
    category: 'environment',
    subcategory: 'building',
    tags: ['building', 'structure', 'city', 'urban'],
    rigged: false,
    animated: false,
    description: 'Generic building'
  },
  {
    id: 'one_building',
    name: 'Single Building',
    path: '/assets/3d/environment/buildings/one_building.glb',
    category: 'environment',
    subcategory: 'building',
    tags: ['building', 'single', 'city', 'urban'],
    rigged: false,
    animated: false,
    description: 'Single standalone building'
  },
  {
    id: 'apartment_building',
    name: 'City Apartment Building',
    path: '/assets/3d/environment/buildings/city_apartment_building.glb',
    category: 'environment',
    subcategory: 'building',
    tags: ['building', 'apartment', 'city', 'urban', 'residential'],
    rigged: false,
    animated: false,
    description: 'Urban apartment building'
  },
  {
    id: 'city_building',
    name: 'City Building',
    path: '/assets/3d/environment/buildings/city_building.glb',
    category: 'environment',
    subcategory: 'building',
    tags: ['building', 'city', 'urban', 'skyscraper'],
    rigged: false,
    animated: false,
    description: 'City skyscraper building'
  },

  // ============================================
  // ENVIRONMENT - SCENES (5)
  // NOTE: Scene GLBs vary in scale - some modeled in cm, some in meters.
  // sceneSize indicates expected footprint:
  //   small: 10-50m, medium: 50-200m, large: 200-500m, huge: 500m+
  // normalizedScale is AUTO-DETECTED based on actual asset dimensions
  // ============================================
  {
    id: 'city_scene',
    name: 'City',
    path: '/assets/3d/environment/scenes/city.glb',
    category: 'environment',
    subcategory: 'scene',
    tags: ['city', 'urban', 'scene', 'environment', 'full', 'fps', 'open world'],
    rigged: false,
    animated: false,
    sceneSize: 'large',
    realWorldDimensions: { height: 45, width: 300, depth: 300 },
    normalizedScale: 1.0, // Will be auto-adjusted based on actual dimensions
    description: 'Large city scene (~300m x 300m) - multiple blocks, buildings up to 45m'
  },
  {
    id: 'city_block',
    name: 'City Block',
    path: '/assets/3d/environment/scenes/city_block.glb',
    category: 'environment',
    subcategory: 'scene',
    tags: ['city', 'block', 'urban', 'street', 'buildings', 'fps', 'combat'],
    rigged: false,
    animated: false,
    sceneSize: 'medium',
    realWorldDimensions: { height: 30, width: 100, depth: 100 },
    normalizedScale: 1.0, // Will be auto-adjusted based on actual dimensions
    rotationCorrection: { x: -90, y: 0, z: 0 }, // Asset exported with Z-up, needs correction for Y-up engine
    description: 'City block (~100m x 100m) - single block, buildings 15-30m'
  },
  {
    id: 'city_street',
    name: 'City Street',
    path: '/assets/3d/environment/scenes/city_street.glb',
    category: 'environment',
    subcategory: 'scene',
    tags: ['city', 'street', 'road', 'urban', 'fps', 'racing'],
    rigged: false,
    animated: false,
    sceneSize: 'medium',
    realWorldDimensions: { height: 25, width: 50, depth: 150 },
    normalizedScale: 1.0, // Will be auto-adjusted based on actual dimensions
    description: 'City street section (~150m long) - street with flanking buildings'
  },
  {
    id: 'times_square',
    name: 'Times Square Block',
    path: '/assets/3d/environment/scenes/times_square_block.glb',
    category: 'environment',
    subcategory: 'scene',
    tags: ['city', 'times square', 'new york', 'urban', 'famous', 'fps', 'combat', 'multiplayer'],
    rigged: false,
    animated: false,
    sceneSize: 'medium',
    realWorldDimensions: { height: 60, width: 150, depth: 150 },
    normalizedScale: 1.0, // Will be auto-adjusted based on actual dimensions
    description: 'Times Square plaza (~150m x 150m) - iconic NYC intersection with tall buildings'
  },
  {
    id: 'postwar_city',
    name: 'Post-War City FPS',
    path: '/assets/3d/environment/scenes/postwar_city_FPS.glb',
    category: 'environment',
    subcategory: 'scene',
    tags: ['city', 'postwar', 'destroyed', 'fps', 'combat', 'ruins'],
    rigged: false,
    animated: false,
    sceneSize: 'medium',
    realWorldDimensions: { height: 25, width: 120, depth: 120 },
    normalizedScale: 1.0, // Will be auto-adjusted based on actual dimensions
    description: 'Destroyed city area (~120m x 120m) - rubble, cover, FPS gameplay'
  },

  // ============================================
  // ENVIRONMENT - TERRAIN (2)
  // ============================================
  {
    id: 'desert_ruins',
    name: 'Desert Ruins',
    path: '/assets/3d/environment/terrain/desert_ruins.glb',
    category: 'environment',
    subcategory: 'terrain',
    tags: ['desert', 'ruins', 'ancient', 'sand', 'archaeology', 'fps', 'combat', 'adventure', 'pairs_with:mountainous_desert'],
    rigged: false,
    animated: false,
    sceneSize: 'medium',
    realWorldDimensions: { height: 15, width: 100, depth: 100 },
    normalizedScale: 1.0, // Will be auto-adjusted based on actual dimensions
    description: 'Ancient desert ruins (~100m x 100m) - stone columns 5-10m, walls 3-5m'
  },
  {
    id: 'mountainous_desert',
    name: 'Mountainous Desert',
    path: '/assets/3d/environment/terrain/mountainous_desert.glb',
    category: 'environment',
    subcategory: 'terrain',
    tags: ['desert', 'mountain', 'terrain', 'landscape', 'vast', 'fps', 'open world', 'adventure', 'pairs_with:desert_ruins'],
    rigged: false,
    animated: false,
    sceneSize: 'large',
    realWorldDimensions: { height: 100, width: 400, depth: 400 },
    normalizedScale: 1.0, // Will be auto-adjusted based on actual dimensions
    description: 'Large desert landscape (~400m x 400m) - mountains, valleys, open terrain'
  },
  {
    id: 'grass_chunks',
    name: 'Grass Chunks',
    path: '/assets/3d/environment/vegetation/simple_grass_chunks.glb',
    category: 'environment',
    subcategory: 'vegetation',
    tags: ['grass', 'chunks', 'nature', 'ground', 'simple'],
    rigged: false,
    animated: false,
    description: 'Simple grass chunks'
  },

  // ============================================
  // ENVIRONMENT - PROPS (3)
  // ============================================
  {
    id: 'traffic_light',
    name: 'Traffic Light',
    path: '/assets/3d/environment/props/traffic_light.glb',
    category: 'environment',
    subcategory: 'prop',
    tags: ['traffic', 'light', 'street', 'city', 'urban', 'signal'],
    rigged: false,
    animated: false,
    description: 'Street traffic light'
  },
];

/**
 * Animation clips available in Animation Library Pro
 * These can be applied to any humanoid character
 */
export const ANIMATION_CLIPS = {
  // Locomotion
  locomotion: {
    idle: ['Idle_Loop', 'Idle_LookAround_Loop', 'Idle_Tired_Loop', 'Idle_Talking_Loop'],
    walk: ['Walk_Loop', 'Walk_Formal_Loop'],
    jog: ['Jog_Fwd_Loop', 'Jog_Bwd_Loop', 'Jog_Left_Loop', 'Jog_Right_Loop'],
    sprint: ['Sprint_Loop', 'Sprint_Enter', 'Sprint_Exit'],
    crouch: ['Crouch_Idle_Loop', 'Crouch_Fwd_Loop', 'Crouch_Bwd_Loop', 'Crouch_Enter', 'Crouch_Exit'],
    crawl: ['Crawl_Fwd_Loop', 'Crawl_Bwd_Loop', 'Crawl_Idle_Loop', 'Crawl_Enter', 'Crawl_Exit'],
    swim: ['Swim_Fwd_Loop', 'Swim_Idle_Loop'],
  },
  
  // Combat - Ranged
  pistol: {
    idle: 'Pistol_Idle_Loop',
    aim: ['Pistol_Aim_Neutral', 'Pistol_Aim_Up', 'Pistol_Aim_Down'],
    shoot: 'Pistol_Shoot',
    reload: 'Pistol_Reload',
  },
  
  // Combat - Melee
  sword: {
    idle: 'Sword_Idle',
    attack: ['Sword_Attack', 'Sword_Attack_Standing', 'Sword_Attack_RM'],
    enter: 'Sword_Enter',
    exit: 'Sword_Exit',
  },
  melee: {
    punch: ['Punch_Jab', 'Punch_Cross'],
    kick: 'Kick',
    enter: 'PunchKick_Enter',
    exit: 'PunchKick_Exit',
  },
  
  // Magic
  spell: {
    simple: ['Spell_Simple_Idle_Loop', 'Spell_Simple_Shoot', 'Spell_Simple_Enter', 'Spell_Simple_Exit'],
    double: ['Spell_Double_Idle_Loop', 'Spell_Double_Shoot_Loop', 'Spell_Double_Enter', 'Spell_Double_Exit'],
  },
  
  // Movement
  jump: {
    start: 'Jump_Start',
    loop: 'Jump_Loop',
    land: 'Jump_Land',
  },
  dodge: {
    left: ['Dodge_Left', 'Dodge_Left_RM'],
    right: ['Dodge_Right', 'Dodge_Right_RM'],
  },
  roll: ['Roll', 'Roll_RM'],
  turn: {
    left: 'Turn90_L',
    right: 'Turn90_R',
  },
  
  // Climbing
  climb: {
    up: 'Climb_Up_Loop',
    down: 'Climb_Down_Loop',
    left: 'Climb_Left_Loop',
    right: 'Climb_Right_Loop',
    idle: 'Climb_Idle_Loop',
    enter: 'Climb_Enter',
    exit: 'Climb_Exit',
    ledge: ['ClimbLedge', 'ClimbLedge_RM'],
  },
  
  // Actions
  actions: {
    interact: 'Interact',
    pickupKneeling: 'PickUp_Kneeling',
    pickupTable: 'PickUp_Table',
    drink: 'Drink',
    push: ['Push_Loop', 'Push_Enter', 'Push_Exit'],
    fixing: 'Fixing_Kneeling',
  },
  
  // Sitting
  sitting: {
    idle: ['Sitting_Idle_Loop', 'Sitting_Idle02_Loop', 'Sitting_Idle03_Loop'],
    talking: 'Sitting_Talking_Loop',
    nodding: 'Sitting_Nodding_Loop',
    enter: 'Sitting_Enter',
    exit: 'Sitting_Exit',
    ground: ['GroundSit_Idle_Loop', 'GroundSit_Enter', 'GroundSit_Exit'],
  },
  
  // Driving
  driving: 'Driving_Loop',
  
  // Emotes
  emotes: {
    dance: 'Dance_Loop',
    celebration: 'Celebration',
    crying: 'Crying',
    backflip: 'BackFlip',
  },
  
  // Damage & Death
  damage: {
    hitChest: 'Hit_Chest',
    hitHead: 'Hit_Head',
    hitStomach: 'Hit_Stomach',
    hitShoulderL: 'Hit_Shoulder_L',
    hitShoulderR: 'Hit_Shoulder_R',
  },
  death: ['Death01', 'Death02'],
  
  // Counter/Shop NPC
  counter: {
    idle: 'Counter_Idle_Loop',
    enter: 'Counter_Enter',
    exit: 'Counter_Exit',
    give: 'Counter_Give',
    show: 'Counter_Show',
    angry: 'Counter_Angry',
  },
  
  // Misc
  torch: 'Idle_Torch_Loop',
  tpose: 'A_Tpose',
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get all assets in a category
 */
export function getAssetsByCategory(category: AssetCategory): Asset3D[] {
  return ASSET_REGISTRY.filter(a => a.category === category);
}

/**
 * Get all assets in a subcategory
 */
export function getAssetsBySubcategory(subcategory: AssetSubcategory): Asset3D[] {
  return ASSET_REGISTRY.filter(a => a.subcategory === subcategory);
}

/**
 * Search assets by tags or name
 */
export function searchAssets(query: string): Asset3D[] {
  const q = query.toLowerCase();
  return ASSET_REGISTRY.filter(a => 
    a.name.toLowerCase().includes(q) ||
    a.id.toLowerCase().includes(q) ||
    a.tags.some(tag => tag.includes(q)) ||
    a.description?.toLowerCase().includes(q)
  );
}

/**
 * Safely encode a path for URLs without double-encoding.
 * Handles already-encoded paths and special characters.
 */
function encodePathSafely(path: string): string {
  // First, decode any existing percent-encoding to normalize the path
  // This prevents double-encoding (e.g., %20 becoming %2520)
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(path);
  } catch {
    // If decoding fails, path wasn't encoded - use as-is
    decodedPath = path;
  }

  // Split by slashes, encode each segment, then rejoin
  // This preserves the path structure while encoding special characters
  return decodedPath
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');
}

/**
 * Get asset by ID
 */
export function getAssetById(id: string): Asset3D | undefined {
  const asset = ASSET_REGISTRY.find(a => a.id === id);
  if (asset) {
    // Transform path to use configured storage URL
    // Safely encode the path to handle spaces and special characters
    const relativePath = asset.path.replace('/assets/3d/', '');
    const encodedPath = encodePathSafely(relativePath);
    return {
      ...asset,
      path: `${ASSET_BASE_URL}/${encodedPath}`
    };
  }
  return undefined;
}

/**
 * Get rigged/animated characters only
 */
export function getAnimatedCharacters(): Asset3D[] {
  return ASSET_REGISTRY.filter(a => 
    a.category === 'character' && a.rigged && a.animated
  );
}

/**
 * Get static environment assets
 */
export function getStaticEnvironment(): Asset3D[] {
  return ASSET_REGISTRY.filter(a => 
    a.category === 'environment' && !a.rigged
  );
}

/**
 * Match user intent to best asset
 * e.g., "add a soldier" -> desert_soldier
 * e.g., "I need a tree" -> big_tree
 */
export function matchAssetToIntent(intent: string): Asset3D | undefined {
  const lower = intent.toLowerCase();
  
  // Direct ID match
  const directMatch = ASSET_REGISTRY.find(a => lower.includes(a.id.replace(/_/g, ' ')));
  if (directMatch) return directMatch;
  
  // Tag-based matching with scoring
  let bestMatch: Asset3D | undefined;
  let bestScore = 0;
  
  for (const asset of ASSET_REGISTRY) {
    let score = 0;
    
    // Check name
    if (lower.includes(asset.name.toLowerCase())) score += 10;
    
    // Check tags
    for (const tag of asset.tags) {
      if (lower.includes(tag)) score += 3;
    }
    
    // Check description
    if (asset.description && lower.includes(asset.description.toLowerCase())) score += 2;
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = asset;
    }
  }
  
  return bestMatch;
}

/**
 * Get formatted list of assets for AI context
 */
export function getAssetListForPrompt(): string {
  const categories = ['character', 'vehicle', 'environment', 'weapon', 'fps'] as AssetCategory[];
  
  const lines: string[] = ['## Available 3D Assets\n'];
  
  for (const cat of categories) {
    const assets = getAssetsByCategory(cat);
    if (assets.length === 0) continue;
    
    lines.push(`### ${cat.charAt(0).toUpperCase() + cat.slice(1)}s`);
    for (const asset of assets) {
      const rigged = asset.rigged ? '🎭' : '📦';
      lines.push(`- ${rigged} \`${asset.id}\`: ${asset.name} - ${asset.description || asset.tags.join(', ')}`);
    }
    lines.push('');
  }
  
  return lines.join('\n');
}

/**
 * Get summary stats
 */
export function getAssetStats(): Record<string, number> {
  const stats: Record<string, number> = {
    total: ASSET_REGISTRY.length,
    rigged: ASSET_REGISTRY.filter(a => a.rigged).length,
    animated: ASSET_REGISTRY.filter(a => a.animated).length,
  };

  const categories = ['character', 'vehicle', 'environment', 'weapon', 'fps', 'animation'] as AssetCategory[];
  for (const cat of categories) {
    stats[cat] = getAssetsByCategory(cat).length;
  }

  return stats;
}

// ============================================
// SCALE NORMALIZATION SYSTEM
// ============================================

/**
 * Default dimensions by category (in meters) used when asset doesn't specify dimensions
 */
export const DEFAULT_DIMENSIONS_BY_CATEGORY: Record<AssetCategory, RealWorldDimensions> = {
  character: { height: 1.75, width: 0.5, depth: 0.3 },
  vehicle: { height: 1.5, width: 1.8, depth: 4.5 },
  environment: { height: 10, width: 10, depth: 10 },
  weapon: { height: 0.1, width: 0.1, depth: 0.8 },
  fps: { height: 0.5, width: 0.3, depth: 0.8 },
  animation: { height: 1.75, width: 0.5, depth: 0.3 },
};

/**
 * Default dimensions by subcategory (in meters) - more specific than category defaults
 */
export const DEFAULT_DIMENSIONS_BY_SUBCATEGORY: Partial<Record<AssetSubcategory, RealWorldDimensions>> = {
  // Characters
  humanoid: { height: 1.75, width: 0.5, depth: 0.3 },
  creature: { height: 1.0, width: 0.8, depth: 1.2 },
  robot: { height: 1.8, width: 0.6, depth: 0.4 },

  // Vehicles
  car: { height: 1.5, width: 1.8, depth: 4.5 },
  aircraft: { height: 4.0, width: 15.0, depth: 12.0 },
  spaceship: { height: 3.0, width: 8.0, depth: 15.0 },

  // Environment
  tree: { height: 8.0, width: 5.0, depth: 5.0 },
  building: { height: 15.0, width: 10.0, depth: 10.0 },
  scene: { height: 20.0, width: 100.0, depth: 100.0 },
  terrain: { height: 50.0, width: 200.0, depth: 200.0 },
  vegetation: { height: 0.5, width: 1.0, depth: 1.0 },
  prop: { height: 2.0, width: 1.0, depth: 1.0 },

  // Weapons
  firearm: { height: 0.1, width: 0.08, depth: 0.8 },
  melee: { height: 0.05, width: 0.05, depth: 0.3 },
  explosive: { height: 0.1, width: 0.1, depth: 0.1 },
  ammo: { height: 0.05, width: 0.02, depth: 0.05 },

  // FPS
  rig: { height: 0.5, width: 0.3, depth: 0.8 },
};

/**
 * Get the expected real-world dimensions for an asset
 */
export function getAssetDimensions(asset: Asset3D): RealWorldDimensions {
  // Use explicit dimensions if available
  if (asset.realWorldDimensions) {
    return asset.realWorldDimensions;
  }

  // Fall back to subcategory defaults
  const subcategoryDims = DEFAULT_DIMENSIONS_BY_SUBCATEGORY[asset.subcategory];
  if (subcategoryDims) {
    return subcategoryDims;
  }

  // Fall back to category defaults
  return DEFAULT_DIMENSIONS_BY_CATEGORY[asset.category];
}

/**
 * Get the normalized scale factor for an asset.
 * This is the scale to apply when loading to achieve real-world dimensions.
 */
export function getNormalizedScale(asset: Asset3D): number {
  // Use explicit normalized scale if available
  if (asset.normalizedScale !== undefined) {
    return asset.normalizedScale;
  }

  // Use legacy scale property if available
  if (asset.scale !== undefined) {
    return asset.scale;
  }

  // Default to 1.0 (assume asset is at correct scale)
  return 1.0;
}

/**
 * Get the rotation correction for an asset, if any.
 * Returns { x: 0, y: 0, z: 0 } if no correction is needed.
 */
export function getRotationCorrection(asset: Asset3D): { x: number; y: number; z: number } {
  return asset.rotationCorrection || { x: 0, y: 0, z: 0 };
}

/**
 * Calculate the scale factor needed to match a target dimension.
 * @param currentSize - The current size of the asset's bounding box (after loading)
 * @param targetDimensions - The desired real-world dimensions
 * @param matchAxis - Which axis to use for scale matching ('height' | 'width' | 'depth' | 'largest')
 */
export function calculateScaleToMatch(
  currentSize: { x: number; y: number; z: number },
  targetDimensions: RealWorldDimensions,
  matchAxis: 'height' | 'width' | 'depth' | 'largest' = 'height'
): number {
  let currentDim: number;
  let targetDim: number;

  if (matchAxis === 'largest') {
    // Match the largest dimension to prevent overshoot
    const current = [currentSize.x, currentSize.y, currentSize.z];
    const target = [targetDimensions.width, targetDimensions.height, targetDimensions.depth];
    const ratios = current.map((c, i) => c > 0 ? target[i] / c : 1);
    return Math.min(...ratios);
  }

  switch (matchAxis) {
    case 'height':
      currentDim = currentSize.y;
      targetDim = targetDimensions.height;
      break;
    case 'width':
      currentDim = currentSize.x;
      targetDim = targetDimensions.width;
      break;
    case 'depth':
      currentDim = currentSize.z;
      targetDim = targetDimensions.depth;
      break;
  }

  if (currentDim <= 0) return 1.0;
  return targetDim / currentDim;
}

/**
 * Validate and potentially warn about unusual scale values
 */
export function validateAssetScale(
  asset: Asset3D,
  actualBoundingBox: { x: number; y: number; z: number }
): { isValid: boolean; message?: string; suggestedScale?: number } {
  const expectedDims = getAssetDimensions(asset);

  // Calculate what scale would be needed to match expected dimensions
  const heightScale = actualBoundingBox.y > 0 ? expectedDims.height / actualBoundingBox.y : 1;
  const widthScale = actualBoundingBox.x > 0 ? expectedDims.width / actualBoundingBox.x : 1;
  const depthScale = actualBoundingBox.z > 0 ? expectedDims.depth / actualBoundingBox.z : 1;

  // Check if all dimensions are roughly proportional (within 5x of each other)
  const scales = [heightScale, widthScale, depthScale].filter(s => s > 0);
  const maxScale = Math.max(...scales);
  const minScale = Math.min(...scales);

  if (maxScale / minScale > 10) {
    return {
      isValid: false,
      message: `Asset "${asset.id}" has unusual proportions. Expected roughly ${expectedDims.height}x${expectedDims.width}x${expectedDims.depth}m but bounding box suggests very different ratios.`,
      suggestedScale: heightScale, // Default to matching height
    };
  }

  // Check if scale is extremely off (>100x or <0.01x)
  const avgScale = scales.reduce((a, b) => a + b, 0) / scales.length;
  if (avgScale > 100 || avgScale < 0.01) {
    return {
      isValid: false,
      message: `Asset "${asset.id}" requires extreme scale adjustment (${avgScale.toFixed(3)}x). This may indicate the asset was modeled with different unit conventions.`,
      suggestedScale: avgScale,
    };
  }

  return { isValid: true };
}

// ============================================
// SCENE SIZE AUTO-DETECTION SYSTEM
// ============================================

/**
 * Expected dimension ranges for each scene size (in meters)
 * Used for intelligent auto-scaling when loading scenes
 */
export const SCENE_SIZE_RANGES: Record<SceneSize, { min: number; max: number; target: number }> = {
  small: { min: 10, max: 50, target: 30 },     // Rooms, small arenas
  medium: { min: 50, max: 200, target: 100 },  // City blocks, street sections
  large: { min: 200, max: 500, target: 300 },  // Multiple blocks, small cities
  huge: { min: 500, max: 2000, target: 800 },  // Full cities, large environments
};

/**
 * Get the expected size range for a scene based on its sceneSize property
 */
export function getSceneSizeRange(asset: Asset3D): { min: number; max: number; target: number } | null {
  if (asset.subcategory !== 'scene' && asset.subcategory !== 'terrain') {
    return null;
  }
  const size = asset.sceneSize || 'medium';
  return SCENE_SIZE_RANGES[size];
}

/**
 * Detect the appropriate scale for a scene/environment asset based on actual dimensions.
 * This function analyzes the raw bounding box and calculates the scale needed
 * to achieve the expected real-world dimensions.
 *
 * @param asset - The asset definition
 * @param rawBoundingBox - The bounding box of the unscaled loaded entity
 * @returns The scale factor to apply, or 1.0 if no adjustment needed
 */
export function detectSceneAutoScale(
  asset: Asset3D,
  rawBoundingBox: { x: number; y: number; z: number }
): { scale: number; confidence: 'high' | 'medium' | 'low'; reason: string } {
  const expectedDims = getAssetDimensions(asset);
  const sizeRange = getSceneSizeRange(asset);

  // For non-scene assets, use the existing normalizedScale
  if (!sizeRange) {
    const existingScale = getNormalizedScale(asset);
    return {
      scale: existingScale,
      confidence: 'high',
      reason: `Using asset's normalizedScale: ${existingScale}`
    };
  }

  // Get the largest horizontal dimension of the raw asset
  const rawFootprint = Math.max(rawBoundingBox.x, rawBoundingBox.z);
  const rawHeight = rawBoundingBox.y;

  // Determine target dimensions
  const targetFootprint = Math.max(expectedDims.width, expectedDims.depth);
  const targetHeight = expectedDims.height;

  if (rawFootprint <= 0 || rawHeight <= 0) {
    return {
      scale: 1.0,
      confidence: 'low',
      reason: 'Invalid bounding box dimensions'
    };
  }

  // Calculate scale based on footprint (primary) and validate with height
  const footprintScale = targetFootprint / rawFootprint;
  const heightScale = targetHeight / rawHeight;

  // Check if the scales are roughly consistent (within 3x of each other)
  // This helps detect if the asset proportions match expectations
  const scaleRatio = Math.max(footprintScale, heightScale) / Math.min(footprintScale, heightScale);

  let finalScale: number;
  let confidence: 'high' | 'medium' | 'low';
  let reason: string;

  if (scaleRatio < 2) {
    // Scales are consistent - use the footprint scale (usually most reliable for scenes)
    finalScale = footprintScale;
    confidence = 'high';
    reason = `Auto-scaled to ${targetFootprint.toFixed(0)}m footprint (from ${rawFootprint.toFixed(1)}m raw)`;
  } else if (scaleRatio < 5) {
    // Somewhat inconsistent - use average but warn
    finalScale = (footprintScale + heightScale) / 2;
    confidence = 'medium';
    reason = `Auto-scaled using average (footprint: ${footprintScale.toFixed(3)}, height: ${heightScale.toFixed(3)})`;
  } else {
    // Very inconsistent proportions - default to footprint scale with low confidence
    finalScale = footprintScale;
    confidence = 'low';
    reason = `Unusual proportions detected. Using footprint-based scale: ${footprintScale.toFixed(3)}`;
  }

  // Sanity check: final scale should be reasonable (0.001 to 1000)
  if (finalScale < 0.001 || finalScale > 1000) {
    return {
      scale: 1.0,
      confidence: 'low',
      reason: `Calculated scale ${finalScale.toFixed(3)} is out of reasonable range`
    };
  }

  // Validate resulting size is within expected range
  const resultingFootprint = rawFootprint * finalScale;
  if (resultingFootprint < sizeRange.min * 0.5 || resultingFootprint > sizeRange.max * 2) {
    return {
      scale: finalScale,
      confidence: 'low',
      reason: `Result ${resultingFootprint.toFixed(0)}m is outside expected range ${sizeRange.min}-${sizeRange.max}m for ${asset.sceneSize} scene`
    };
  }

  return { scale: finalScale, confidence, reason };
}

/**
 * Check if an asset is an environment/scene asset that should use auto-scaling
 */
export function isEnvironmentAsset(asset: Asset3D): boolean {
  return asset.subcategory === 'scene' || asset.subcategory === 'terrain';
}

/**
 * Get formatted scale guidelines for AI prompt context
 */
export function getScaleGuidelinesForPrompt(): string {
  return `
## REAL-WORLD SCALE GUIDELINES (CRITICAL!)

All dimensions in the scene use METERS as the base unit. 1 unit = 1 meter.

### Scene Size Categories
- **small** (10-50m): Single rooms, small arenas
- **medium** (50-200m): City blocks, street sections
- **large** (200-500m): Multiple blocks, small game-ready cities
- **huge** (500m+): Full cities, large open-world environments

### Human Scale Reference
- Average adult human: 1.75m tall
- Child: 1.2m tall
- Player character eye level: ~1.6m

### Vehicle Dimensions
- Sedan car: ~4.5m long, 1.8m wide, 1.5m tall
- Sports car: ~4.2m long, 1.9m wide, 1.2m tall
- Military truck: ~7m long, 2.5m wide, 3m tall
- Motorcycle: ~2m long, 0.8m wide, 1.1m tall

### Urban Elements
- Street width (two lanes): ~6m
- Sidewalk width: ~2m
- Street light height: ~6m
- Traffic light: ~4.5m tall
- Building floor height: ~3m
- Average building: 5-15 floors (15-45m)

### Nature
- Medium tree: ~8m tall
- Large tree: ~15m tall
- Bush: ~1.5m tall
- Grass blade: ~0.1-0.3m

### Weapons
- Rifle: ~0.9m long
- Pistol: ~0.2m long
- Combat knife: ~0.3m long

### IMPORTANT RULES
1. Scene/environment assets are AUTO-SCALED based on their sceneSize category
2. Props and characters use their defined normalizedScale
3. A character should NOT be the size of a building
4. A car should NOT be 50 meters long
5. Scene elements should make sense relative to a 1.75m human
6. If placing multiple objects, ensure they are proportional to each other
`;
}
