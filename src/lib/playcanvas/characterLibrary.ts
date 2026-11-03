/**
 * Character Library - Pre-rigged animated 3D characters
 * 
 * These characters come with built-in animations (idle, walk, run, jump)
 * and can be instantly loaded into the scene without any rigging wait time.
 * 
 * Assets are hosted on Supabase Storage for production deployment.
 * 
 * Features:
 * - Built-in model animations (an external animation library is optional)
 * - Weapon attachment code (weapon models are not in this build; see assetAvailability.ts)
 * - NPC behaviors (patrol, wander, idle)
 * - Enemy AI (chase, attack, flee)
 */

import { ANIMATION_CLIPS, ASSET_BASE_URL } from './assetRegistry';

export interface CharacterAnimation {
  name: string;
  clipName: string; // Name in the GLB animation clips
}

export interface CharacterDefinition {
  id: string;
  name: string;
  description: string;
  category: 'humanoid' | 'quadruped' | 'flying' | 'vehicle' | 'fantasy' | 'robot' | 'creature';
  glbUrl: string;
  scale: number;
  animations: CharacterAnimation[];
  defaultAnimation: string;
  // For player/enemy behavior
  speed?: number;
  jumpForce?: number;
  tags?: string[];
  // Weapon/equipment support
  canHoldWeapon?: boolean;
  weaponBone?: string; // Bone name for weapon attachment (usually 'RightHand' or similar)
  // Animation source
  useAnimationLibrary?: boolean; // If true, prefer Animation Library Pro over embedded clips
}

/**
 * Weapon slots that can be attached to characters. The model files are not in
 * this build (WEAPON_MODELS_AVAILABLE is false), so attaching is skipped.
 * Paths are dynamically constructed using ASSET_BASE_URL
 */
export const WEAPON_ATTACHMENTS = {
  firearms: {
    akm: { path: `${ASSET_BASE_URL}/weapons/firearms/AKM.glb`, type: 'rifle', animations: ['Pistol_Aim_Neutral', 'Pistol_Shoot', 'Pistol_Reload'] },
    shotgun: { path: `${ASSET_BASE_URL}/weapons/firearms/Mossberg%20590A1.glb`, type: 'shotgun', animations: ['Pistol_Aim_Neutral', 'Pistol_Shoot', 'Pistol_Reload'] },
    glock: { path: `${ASSET_BASE_URL}/weapons/firearms/Rigged%20Glock.glb`, type: 'pistol', animations: ['Pistol_Aim_Neutral', 'Pistol_Shoot', 'Pistol_Reload'] },
  },
  melee: {
    knife: { path: `${ASSET_BASE_URL}/weapons/melee/Combat%20Knife.glb`, type: 'knife', animations: ['Sword_Attack', 'Sword_Idle'] },
  },
  explosives: {
    grenade: { path: `${ASSET_BASE_URL}/weapons/explosives/Grenade.glb`, type: 'throwable', animations: ['Interact'] },
    c4: { path: `${ASSET_BASE_URL}/weapons/explosives/C4.glb`, type: 'placeable', animations: ['PickUp_Kneeling'] },
  },
};

/**
 * NPC behavior configurations
 */
export type NPCBehavior = 'idle' | 'patrol' | 'wander' | 'guard' | 'follow' | 'flee';
export type EnemyBehavior = 'idle' | 'patrol' | 'chase' | 'attack' | 'flee' | 'guard';

export interface NPCConfig {
  character: CharacterDefinition;
  behavior: NPCBehavior;
  patrolPoints?: { x: number; y: number; z: number }[];
  patrolRadius?: number; // For wander behavior
  idleAnimations?: string[];
  walkAnimation?: string;
}

export interface EnemyConfig {
  character: CharacterDefinition;
  behavior: EnemyBehavior;
  weapon?: keyof typeof WEAPON_ATTACHMENTS.firearms | keyof typeof WEAPON_ATTACHMENTS.melee;
  health?: number;
  damage?: number;
  detectionRange?: number;
  attackRange?: number;
  patrolPoints?: { x: number; y: number; z: number }[];
}

/**
 * Get animations for a behavior from Animation Library Pro
 */
export function getAnimationsForBehavior(behavior: NPCBehavior | EnemyBehavior): string[] {
  switch (behavior) {
    case 'idle':
      return ['Idle_Loop', 'Idle_LookAround_Loop'];
    case 'patrol':
    case 'guard':
      return ['Walk_Loop', 'Idle_Loop', 'Turn90_L', 'Turn90_R'];
    case 'wander':
      return ['Walk_Loop', 'Idle_Loop', 'Idle_LookAround_Loop'];
    case 'chase':
      return ['Jog_Fwd_Loop', 'Sprint_Loop'];
    case 'attack':
      return ['Pistol_Shoot', 'Sword_Attack', 'Punch_Jab', 'Kick'];
    case 'flee':
      return ['Sprint_Loop', 'Jog_Fwd_Loop'];
    case 'follow':
      return ['Walk_Loop', 'Jog_Fwd_Loop', 'Idle_Loop'];
    default:
      return ['Idle_Loop'];
  }
}

/**
 * Get combat animations based on weapon type
 */
export function getCombatAnimations(weaponType: string): string[] {
  switch (weaponType) {
    case 'rifle':
    case 'shotgun':
    case 'pistol':
      return ['Pistol_Idle_Loop', 'Pistol_Aim_Neutral', 'Pistol_Shoot', 'Pistol_Reload'];
    case 'knife':
    case 'sword':
      return ['Sword_Idle', 'Sword_Attack', 'Sword_Enter', 'Sword_Exit'];
    case 'unarmed':
      return ['PunchKick_Enter', 'Punch_Jab', 'Punch_Cross', 'Kick'];
    case 'magic':
      return ['Spell_Simple_Idle_Loop', 'Spell_Simple_Shoot', 'Spell_Double_Shoot_Loop'];
    default:
      return ['Idle_Loop'];
  }
}

/**
 * Create an NPC configuration
 */
export function createNPCConfig(
  characterId: string,
  behavior: NPCBehavior = 'wander',
  options?: Partial<NPCConfig>
): NPCConfig {
  const character = getCharacter(characterId) || CHARACTER_LIBRARY[0];
  return {
    character,
    behavior,
    patrolRadius: 10,
    idleAnimations: ['Idle_Loop', 'Idle_LookAround_Loop'],
    walkAnimation: 'Walk_Loop',
    ...options,
  };
}

/**
 * Create an Enemy configuration with weapon
 */
export function createEnemyConfig(
  characterId: string,
  weapon: keyof typeof WEAPON_ATTACHMENTS.firearms | keyof typeof WEAPON_ATTACHMENTS.melee = 'akm',
  behavior: EnemyBehavior = 'patrol',
  options?: Partial<EnemyConfig>
): EnemyConfig {
  const character = getCharacter(characterId) || getCharacter('ninja') || CHARACTER_LIBRARY[0];
  return {
    character,
    behavior,
    weapon,
    health: 100,
    damage: 10,
    detectionRange: 15,
    attackRange: weapon === 'knife' ? 2 : 20,
    ...options,
  };
}

/**
 * Library of pre-rigged animated characters
 * Local assets stored in src/assets/3d/characters/
 */
export const CHARACTER_LIBRARY: CharacterDefinition[] = [
  // ============================================
  // LOCAL HUMANOIDS (from downloaded assets)
  // ============================================
  {
    id: 'cyberpunk',
    name: 'Cyberpunk Character',
    description: 'Futuristic cyberpunk style character - sci-fi games',
    category: 'humanoid',
    glbUrl: `${ASSET_BASE_URL}/characters/humanoid/cyberpunk_character.glb`,
    scale: 1.0,
    animations: [
      { name: 'idle', clipName: 'Idle' },
      { name: 'walk', clipName: 'Walk' },
      { name: 'run', clipName: 'Run' },
    ],
    defaultAnimation: 'idle',
    speed: 6,
    jumpForce: 8,
    tags: ['cyberpunk', 'sci-fi', 'futuristic', 'player'],
  },
  {
    id: 'desert_soldier',
    name: 'Desert Soldier',
    description: 'Military soldier in desert gear - FPS/combat games',
    category: 'humanoid',
    glbUrl: `${ASSET_BASE_URL}/characters/humanoid/desert_soldier_character.glb`,
    scale: 1.0,
    animations: [
      { name: 'idle', clipName: 'Idle' },
      { name: 'walk', clipName: 'Walk' },
      { name: 'run', clipName: 'Run' },
    ],
    defaultAnimation: 'idle',
    speed: 5,
    jumpForce: 8,
    tags: ['soldier', 'military', 'combat', 'fps', 'player'],
  },
  {
    id: 'driver',
    name: 'Driver',
    description: 'Racing/driving character',
    category: 'humanoid',
    glbUrl: `${ASSET_BASE_URL}/characters/humanoid/Driver_character.glb`,
    scale: 1.0,
    animations: [
      { name: 'idle', clipName: 'Idle' },
    ],
    defaultAnimation: 'idle',
    speed: 4,
    jumpForce: 6,
    tags: ['driver', 'racing', 'car'],
  },
  {
    id: 'elf',
    name: 'Elf',
    description: 'Fantasy elf character - RPG games',
    category: 'fantasy',
    glbUrl: `${ASSET_BASE_URL}/characters/humanoid/Elf_character.glb`,
    scale: 1.0,
    animations: [
      { name: 'idle', clipName: 'Idle' },
      { name: 'walk', clipName: 'Walk' },
      { name: 'run', clipName: 'Run' },
    ],
    defaultAnimation: 'idle',
    speed: 6,
    jumpForce: 10,
    tags: ['elf', 'fantasy', 'rpg', 'magic'],
  },
  {
    id: 'mage',
    name: 'Mage',
    description: 'Fantasy mage/wizard - RPG games',
    category: 'fantasy',
    glbUrl: `${ASSET_BASE_URL}/characters/humanoid/mage_character.glb`,
    scale: 1.0,
    animations: [
      { name: 'idle', clipName: 'Idle' },
      { name: 'walk', clipName: 'Walk' },
      { name: 'cast', clipName: 'Cast' },
    ],
    defaultAnimation: 'idle',
    speed: 4,
    jumpForce: 6,
    tags: ['mage', 'wizard', 'magic', 'fantasy', 'rpg'],
  },
  {
    id: 'ninja',
    name: 'Ninja',
    description: 'Stealthy ninja - action games',
    category: 'humanoid',
    glbUrl: `${ASSET_BASE_URL}/characters/humanoid/ninja_NPC.glb`,
    scale: 1.0,
    animations: [
      { name: 'idle', clipName: 'Idle' },
      { name: 'walk', clipName: 'Walk' },
      { name: 'run', clipName: 'Run' },
    ],
    defaultAnimation: 'idle',
    speed: 8,
    jumpForce: 12,
    tags: ['ninja', 'stealth', 'combat', 'enemy'],
  },
  {
    id: 'samurai',
    name: 'Samurai',
    description: 'Japanese samurai warrior',
    category: 'humanoid',
    glbUrl: `${ASSET_BASE_URL}/characters/humanoid/samurai_character.glb`,
    scale: 1.0,
    animations: [
      { name: 'idle', clipName: 'Idle' },
      { name: 'walk', clipName: 'Walk' },
      { name: 'run', clipName: 'Run' },
    ],
    defaultAnimation: 'idle',
    speed: 5,
    jumpForce: 8,
    tags: ['samurai', 'warrior', 'sword', 'japanese'],
  },
  {
    id: 'security_guard',
    name: 'Security Guard',
    description: 'Security guard NPC',
    category: 'humanoid',
    glbUrl: `${ASSET_BASE_URL}/characters/humanoid/security_guard_NPC.glb`,
    scale: 1.0,
    animations: [
      { name: 'idle', clipName: 'Idle' },
      { name: 'walk', clipName: 'Walk' },
    ],
    defaultAnimation: 'idle',
    speed: 4,
    jumpForce: 6,
    tags: ['guard', 'security', 'npc', 'enemy'],
  },
  {
    id: 'boy',
    name: 'Boy NPC',
    description: 'Young boy character',
    category: 'humanoid',
    glbUrl: `${ASSET_BASE_URL}/characters/humanoid/boy_NPC.glb`,
    scale: 1.0,
    animations: [
      { name: 'idle', clipName: 'Idle' },
      { name: 'walk', clipName: 'Walk' },
    ],
    defaultAnimation: 'idle',
    speed: 5,
    jumpForce: 8,
    tags: ['boy', 'child', 'npc', 'civilian'],
  },
  {
    id: 'girl',
    name: 'Girl NPC',
    description: 'Young girl character',
    category: 'humanoid',
    glbUrl: `${ASSET_BASE_URL}/characters/humanoid/girl_NPC.glb`,
    scale: 1.0,
    animations: [
      { name: 'idle', clipName: 'Idle' },
      { name: 'walk', clipName: 'Walk' },
    ],
    defaultAnimation: 'idle',
    speed: 5,
    jumpForce: 8,
    tags: ['girl', 'child', 'npc', 'civilian'],
  },
  {
    id: 'dancer',
    name: 'Dancing NPC',
    description: 'Character with dancing animation',
    category: 'humanoid',
    glbUrl: `${ASSET_BASE_URL}/characters/humanoid/Dancing_NPC.glb`,
    scale: 1.0,
    animations: [
      { name: 'idle', clipName: 'Idle' },
      { name: 'dance', clipName: 'Dance' },
    ],
    defaultAnimation: 'dance',
    speed: 4,
    jumpForce: 6,
    tags: ['dancer', 'npc', 'party', 'animated'],
  },

  // ============================================
  // LOCAL ROBOTS
  // ============================================
  {
    id: 'robot_local',
    name: 'Robot',
    description: 'Robotic character with animation',
    category: 'robot',
    glbUrl: `${ASSET_BASE_URL}/characters/robots/robot_character.glb`,
    scale: 0.6, // Robot model is larger, scale to match humans
    animations: [
      // GLB only has one animation named "Scene" - use for both idle and walk
      { name: 'idle', clipName: 'Scene' },
      { name: 'walk', clipName: 'Scene' },
    ],
    defaultAnimation: 'idle',
    speed: 4,
    jumpForce: 8,
    tags: ['robot', 'mech', 'sci-fi', 'android'],
  },
];

// Common aliases for character IDs
const CHARACTER_ALIASES: Record<string, string> = {
  'robot': 'robot_local',
  'soldier': 'desert_soldier',
  'player': 'desert_soldier',
  'boy_npc': 'boy',
  'girl_npc': 'girl',
};

/**
 * Get a character by ID (with alias support)
 */
export function getCharacter(id: string): CharacterDefinition | undefined {
  // Try exact match first
  const exact = CHARACTER_LIBRARY.find(c => c.id === id);
  if (exact) return exact;

  // Try alias
  const aliasId = CHARACTER_ALIASES[id];
  if (aliasId) {
    return CHARACTER_LIBRARY.find(c => c.id === aliasId);
  }

  // Try partial match (e.g., "robot" matches "robot_local")
  const partial = CHARACTER_LIBRARY.find(c =>
    c.id.startsWith(id + '_') || c.id === id + '_local'
  );
  return partial;
}

/**
 * Get characters by category
 */
export function getCharactersByCategory(category: CharacterDefinition['category']): CharacterDefinition[] {
  return CHARACTER_LIBRARY.filter(c => c.category === category);
}

/**
 * Search characters by name, description, or tags
 */
export function searchCharacters(query: string): CharacterDefinition[] {
  const q = query.toLowerCase();
  return CHARACTER_LIBRARY.filter(c => 
    c.name.toLowerCase().includes(q) || 
    c.description.toLowerCase().includes(q) ||
    c.id.toLowerCase().includes(q) ||
    c.tags?.some(tag => tag.includes(q))
  );
}

/**
 * Get a formatted list of available characters for Hon's context
 */
export function getCharacterListForPrompt(): string {
  const lines = CHARACTER_LIBRARY.map(c => {
    const anims = c.animations.map(a => a.name).join(', ');
    const tags = c.tags?.join(', ') || '';
    return `- ${c.id}: ${c.name} (${c.category}) - ${c.description}. Animations: ${anims}. Tags: ${tags}`;
  });
  return lines.join('\n');
}

/**
 * Match user intent to a character
 * e.g. "add a player" -> desert_soldier, "add a robot" -> robot_local
 */
export function matchCharacterToIntent(intent: string): CharacterDefinition {
  const lower = intent.toLowerCase();
  
  // Check for specific character names/ids first
  for (const char of CHARACTER_LIBRARY) {
    if (lower.includes(char.id.replace(/_/g, ' ')) || lower.includes(char.name.toLowerCase())) {
      return char;
    }
  }
  
  // Check tags
  for (const char of CHARACTER_LIBRARY) {
    if (char.tags?.some(tag => lower.includes(tag))) {
      return char;
    }
  }
  
  // Check for category keywords
  if (lower.includes('robot') || lower.includes('mech') || lower.includes('android')) {
    return getCharacter('robot_local') || CHARACTER_LIBRARY[0];
  }
  if (lower.includes('ninja') || lower.includes('stealth')) {
    return getCharacter('ninja') || CHARACTER_LIBRARY[0];
  }
  if (lower.includes('samurai') || lower.includes('sword') || lower.includes('warrior')) {
    return getCharacter('samurai') || CHARACTER_LIBRARY[0];
  }
  if (lower.includes('mage') || lower.includes('wizard') || lower.includes('magic')) {
    return getCharacter('mage') || CHARACTER_LIBRARY[0];
  }
  if (lower.includes('elf') || lower.includes('fantasy')) {
    return getCharacter('elf') || CHARACTER_LIBRARY[0];
  }
  if (lower.includes('cyberpunk') || lower.includes('futuristic') || lower.includes('sci-fi')) {
    return getCharacter('cyberpunk') || CHARACTER_LIBRARY[0];
  }
  if (lower.includes('soldier') || lower.includes('military') || lower.includes('combat')) {
    return getCharacter('desert_soldier') || CHARACTER_LIBRARY[0];
  }
  if (lower.includes('guard') || lower.includes('security')) {
    return getCharacter('security_guard') || CHARACTER_LIBRARY[0];
  }
  if (lower.includes('dancer') || lower.includes('dancing') || lower.includes('party')) {
    return getCharacter('dancer') || CHARACTER_LIBRARY[0];
  }
  if (lower.includes('driver') || lower.includes('racing')) {
    return getCharacter('driver') || CHARACTER_LIBRARY[0];
  }
  if (lower.includes('boy') || lower.includes('kid') || lower.includes('child')) {
    return getCharacter('boy') || getCharacter('girl') || CHARACTER_LIBRARY[0];
  }
  if (lower.includes('girl')) {
    return getCharacter('girl') || CHARACTER_LIBRARY[0];
  }
  
  // Default to desert_soldier for generic "player", "character", "person"
  if (lower.includes('player') || lower.includes('character') || lower.includes('person') || lower.includes('human')) {
    return getCharacter('desert_soldier') || getCharacter('cyberpunk') || CHARACTER_LIBRARY[0];
  }
  
  // Enemy defaults
  if (lower.includes('enemy') || lower.includes('npc')) {
    return getCharacter('ninja') || getCharacter('security_guard') || CHARACTER_LIBRARY[0];
  }
  
  // Fallback to first local character
  return getCharacter('desert_soldier') || CHARACTER_LIBRARY[0];
}

/**
 * Get all local (non-threejs) characters
 */
export function getLocalCharacters(): CharacterDefinition[] {
  return CHARACTER_LIBRARY.filter(c => !c.glbUrl.startsWith('http'));
}

