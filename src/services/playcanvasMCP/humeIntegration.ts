/**
 * Hume Integration for PlayCanvas MCP
 * 
 * Bridges Hume tool calls to the PlayCanvas MCP server.
 * Provides natural language-friendly tool handlers.
 */

import { executeTool, isConnected, getRegisteredTools } from './index';
import type { MCPToolResult } from './index';

/**
 * Handle a Hume tool call for immersive scene manipulation
 */
export async function handleImmersiveMCPTool(
  toolName: string,
  parameters: Record<string, any>
): Promise<{ success: boolean; message: string; data?: any }> {
  
  // Check if MCP is connected
  if (!isConnected()) {
    return {
      success: false,
      message: 'Immersive scene is not active. Please activate immersive scene mode first.'
    };
  }
  
  // Map Hume tool names to MCP tool names
  const toolMapping: Record<string, string> = {
    // Entity tools
    'pc_create_entity': 'create_entity',
    'pc_create_character': 'create_character',
    'pc_create_building': 'create_building',
    'pc_create_vehicle': 'create_vehicle',
    'pc_modify_entity': 'modify_entity',
    'pc_delete_entity': 'delete_entity',
    'pc_duplicate_entity': 'duplicate_entity',
    'pc_create_entities': 'create_entities',
    
    // Component tools
    'pc_add_physics': 'add_physics',
    'pc_add_animation': 'add_animation',
    'pc_remove_animation': 'remove_animation',
    'pc_add_light': 'add_light',
    'pc_apply_force': 'apply_force',
    
    // Environment tools
    'pc_set_fog': 'set_fog',
    'pc_set_ambient_light': 'set_ambient_light',
    'pc_set_sky_color': 'set_sky_color',
    'pc_set_mood': 'set_mood',
    'pc_add_grass': 'add_grass',
    'pc_remove_grass': 'remove_grass',
    'pc_clear_scene': 'clear_scene',

    // Visual effects tools (particles, weather, post-processing)
    'pc_add_particle_effect': 'add_particle_effect',
    'pc_add_weather': 'add_weather',
    'pc_remove_particle_effects': 'remove_particle_effects',
    'pc_load_skybox': 'load_skybox',
    'pc_create_gradient_sky': 'create_gradient_sky',
    'pc_set_post_processing': 'set_post_processing',
    'pc_trigger_screen_effect': 'trigger_screen_effect',

    // Query tools
    'pc_list_entities': 'list_entities',
    'pc_get_entity': 'get_entity',
    'pc_get_distance': 'get_distance',
    'pc_find_nearby': 'find_nearby',
    'pc_get_scene_stats': 'get_scene_stats',
    'pc_raycast': 'raycast',
  };
  
  const mcpToolName = toolMapping[toolName] || toolName.replace('pc_', '');
  
  // Execute the MCP tool
  const result = await executeTool(mcpToolName, parameters);
  
  return {
    success: result.success,
    message: result.message || result.error || 'Tool executed',
    data: result.data
  };
}

/**
 * Generate Hume-compatible tool definitions from MCP tools
 */
export function generateHumeToolDefinitions(): Array<{
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}> {
  const tools = getRegisteredTools();
  
  return tools.map(tool => ({
    name: `pc_${tool.name}`,
    description: `[Immersive Scene] ${tool.description}`,
    parameters: tool.parameters
  }));
}

/**
 * Get a simplified list of available commands for the system prompt
 */
export function getAvailableCommands(): string {
  return `
## Immersive Scene Commands

CRITICAL RULES:
1. ACT, don't ask. Execute tools immediately without asking permission.
2. For ANY character request (player, enemy, person, creature), use pc_create_character.
3. For ANY building request (building, skyscraper, apartment, office, house), use pc_create_building - it auto-generates windows!
4. For FPS/shooter games, ALWAYS load a scene asset first with pc_execute.
5. Do NOT create placeholder entities or "note" entities. Only create visible, meaningful objects.
6. Keep responses SHORT. One sentence max per action.
7. NEVER use pc_create_entity for buildings - ALWAYS use pc_create_building which has proper windows and architecture.

### Loading Scene Assets (USE FOR FPS/ENVIRONMENTS!)
**pc_execute** - Universal scene control:
  - Load pre-made environments: times_square, postwar_city, desert_ruins, city_block, city_street
  - Load props: buildings, trees, vehicles, weapons
  
FPS Game Example (ALWAYS follow this pattern):
\`\`\`
pc_execute { intent: "Load times_square environment and spawn desert_soldier player with first-person camera, add ninja enemies patrolling" }
\`\`\`

Available Scene Assets:
- times_square: NYC city block (urban FPS)
- postwar_city: Destroyed city (combat)
- desert_ruins: Ancient ruins with cover
- city_block, city_street: Urban environments

### Creating Buildings (USE THIS FOR ANY BUILDING!)
**pc_create_building** - Creates buildings with proper windows, doors, and architecture:
  - style: office, apartment, house, skyscraper, warehouse, shop, tower, temple, futuristic
  - floors: 1-20 (auto-calculated if not specified)
  - width, depth: size in meters
  - color, windowColor, roofColor: customize appearance

Examples:
- Office building: pc_create_building { name: "office1", style: "office", floors: 5 }
- Skyscraper: pc_create_building { name: "tower1", style: "skyscraper", floors: 15 }
- Futuristic: pc_create_building { name: "futureHQ", style: "futuristic", floors: 10 }
- Multiple buildings: Call pc_create_building multiple times with different positions

### Creating Characters
**pc_create_character** - For players and NPCs:
  - characterId: soldier, desert_soldier, ninja, samurai, mage, elf, robot, cyberpunk, security_guard, boy_npc, girl_npc, dancer, driver, fox, horse, stork
  - isPlayer: true → WASD controls + camera + shoot (E key)
  - cameraMode: "first-person" (FPS) or "third-person" (RPG)
  - behavior: idle, patrol, chase, guard, wander, attack, flee
  
Examples:
- FPS player: pc_create_character { characterId: "desert_soldier", isPlayer: true, cameraMode: "first-person" }
- RPG player: pc_create_character { characterId: "elf", isPlayer: true, cameraMode: "third-person" }
- Enemy: pc_create_character { characterId: "ninja", behavior: "chase" }

### Player Controls (tell user these!)
- WASD: Move
- Space: Jump
- Shift: Sprint
- E: Shoot
- V: Toggle camera (first/third person)

### Particle Effects (IMPORTANT - use for fire, smoke, rain, etc!)
**pc_add_particle_effect** - Add dynamic particle effects:
  - preset: fire, smoke, sparkles, rain, snow, fog_volume, dust, explosion, embers, magic, leaves, bubbles
  - positionX, positionY, positionZ: world position
  - scale: size multiplier (default 1)
  - color: override color hex (for sparkles/magic)

Examples:
- Campfire: pc_add_particle_effect { preset: "fire", positionX: 0, positionY: 0.5, positionZ: 0 }
- Add smoke above fire: pc_add_particle_effect { preset: "smoke", positionX: 0, positionY: 2, positionZ: 0 }
- Rain: pc_add_particle_effect { preset: "rain", positionY: 10, scale: 2 }
- Magic sparkles: pc_add_particle_effect { preset: "magic", color: "#aa77ff" }

**pc_add_weather** - Quick weather presets:
  - preset: rain, snow, fog, storm

### Post-Processing & Atmosphere
**pc_set_post_processing** - Visual effects:
  - bloomEnabled, bloomIntensity: glow effects
  - vignetteEnabled, vignetteIntensity: cinematic borders
  - saturation, contrast, brightness: color grading

**pc_load_skybox** - HDRI skyboxes (only when user requests sky):
  - preset: sunset, cloudy, night, studio, forest, city, beach, overcast

### Quick Reference
| Request | Action |
|---------|--------|
| "add a campfire" | pc_add_particle_effect { preset: "fire" } + pc_add_particle_effect { preset: "smoke", positionY: 2 } |
| "make it rain" | pc_add_particle_effect { preset: "rain", positionY: 10, scale: 2 } |
| "add fog" | pc_add_particle_effect { preset: "fog_volume" } |
| "add sparkles" | pc_add_particle_effect { preset: "sparkles" } |
| "add explosion" | pc_add_particle_effect { preset: "explosion", loop: false } |
| "FPS game" | pc_execute: Load scene + spawn player with first-person camera + enemies |
| "Times Square shooter" | pc_execute: Load times_square, desert_soldier player, ninja enemies |
| "add a player" | pc_create_character { characterId: "soldier", isPlayer: true } |
| "make it FPS view" | pc_create_character { ..., cameraMode: "first-person" } |
| "add enemies" | pc_create_character { characterId: "ninja", behavior: "patrol" } |
| "add a building" | pc_create_building { name: "building1", style: "office" } |
| "add buildings with windows" | pc_create_building (multiple calls with different positions) |
| "add a skyscraper" | pc_create_building { name: "tower1", style: "skyscraper", floors: 15 } |
| "load the city block" | pc_execute { intent: "Load city_block asset" } |
`.trim();
}

/**
 * Check if a tool name is a PlayCanvas MCP tool
 */
export function isPlayCanvasMCPTool(toolName: string): boolean {
  return toolName.startsWith('pc_');
}

