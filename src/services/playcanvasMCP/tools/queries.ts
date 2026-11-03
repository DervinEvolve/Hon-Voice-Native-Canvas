/**
 * Query Tools for PlayCanvas MCP
 * 
 * Tools for querying scene state, finding entities, and getting information.
 */

import type { MCPTool, MCPToolResult } from '../index';

/**
 * List all entities in the scene
 */
const listEntities: MCPTool = {
  name: 'list_entities',
  description: 'Get a list of all entities in the scene with their properties. Returns name, position, scale, and TYPE (player, npc, enemy, building, vehicle, environment, etc.) for each entity.',
  parameters: {
    type: 'object',
    properties: {
      filter: {
        type: 'string',
        description: 'Optional filter by name (partial match)'
      },
      includeComponents: {
        type: 'boolean',
        description: 'Include component information',
        default: false
      }
    }
  },
  handler: (params, app): MCPToolResult => {
    const entities: any[] = [];
    
    app.root.forEach((entity: any) => {
      // Skip root itself
      if (entity === app.root) return;
      
      // Apply name filter if provided
      if (params.filter) {
        if (!entity.name.toLowerCase().includes(params.filter.toLowerCase())) {
          return;
        }
      }
      
      const pos = entity.getPosition();
      const scale = entity.getLocalScale();

      const info: any = {
        id: entity.getGuid(),
        name: entity.name,
        position: {
          x: Math.round(pos.x * 100) / 100,
          y: Math.round(pos.y * 100) / 100,
          z: Math.round(pos.z * 100) / 100
        },
        scale: {
          x: Math.round(scale.x * 100) / 100,
          y: Math.round(scale.y * 100) / 100,
          z: Math.round(scale.z * 100) / 100
        },
        enabled: entity.enabled
      };

      // Add semantic type information based on tags and components
      const types: string[] = [];
      if (entity.tags) {
        if (entity.tags.has('player')) types.push('player');
        if (entity.tags.has('enemy')) types.push('enemy');
        if (entity.tags.has('npc')) types.push('npc');
        if (entity.tags.has('collectible')) types.push('collectible');
        if (entity.tags.has('environment')) types.push('environment');
        if (entity.tags.has('vehicle')) types.push('vehicle');
        if (entity.tags.has('building')) types.push('building');
        if (entity.tags.has('weapon')) types.push('weapon');
      }

      // Infer type from components if no tags
      if (types.length === 0) {
        if (entity.camera) types.push('camera');
        if (entity.light) types.push('light');
        if (entity.gsplat) types.push('gaussian_splat');
        if (entity.render && entity.collision) types.push('object');
      }

      if (types.length > 0) {
        info.type = types.join(', ');
      }

      if (params.includeComponents) {
        info.components = [];
        if (entity.render) info.components.push('render');
        if (entity.camera) info.components.push('camera');
        if (entity.light) info.components.push('light');
        if (entity.rigidbody) info.components.push('rigidbody');
        if (entity.collision) info.components.push('collision');
        if (entity.sound) info.components.push('sound');
        if (entity.gsplat) info.components.push('gsplat');
        if (entity.anim) info.components.push('anim');
        if (entity.animation) info.components.push('animation');
      }
      
      entities.push(info);
    });
    
    return {
      success: true,
      message: `Found ${entities.length} entities`,
      data: { entities, count: entities.length }
    };
  }
};

/**
 * Get detailed information about a specific entity
 */
const getEntity: MCPTool = {
  name: 'get_entity',
  description: 'Get detailed information about a specific entity',
  parameters: {
    type: 'object',
    properties: {
      target: {
        type: 'string',
        description: 'Entity name or ID'
      }
    },
    required: ['target']
  },
  handler: (params, app): MCPToolResult => {
    const entity = findEntityByTarget(app, params.target);
    
    if (!entity) {
      return { success: false, error: `Could not find entity: ${params.target}` };
    }
    
    const pos = entity.getPosition();
    const rot = entity.getEulerAngles();
    const scale = entity.getLocalScale();
    
    const info: any = {
      id: entity.getGuid(),
      name: entity.name,
      enabled: entity.enabled,
      position: { x: pos.x, y: pos.y, z: pos.z },
      rotation: { x: rot.x, y: rot.y, z: rot.z },
      scale: { x: scale.x, y: scale.y, z: scale.z },
      components: {},
      children: entity.children.map((c: any) => c.name)
    };
    
    // Get component details
    if (entity.render) {
      info.components.render = {
        type: entity.render.type
      };
    }
    if (entity.light) {
      info.components.light = {
        type: entity.light.type,
        color: entity.light.color,
        intensity: entity.light.intensity
      };
    }
    if (entity.rigidbody) {
      info.components.rigidbody = {
        type: entity.rigidbody.type,
        mass: entity.rigidbody.mass
      };
    }
    if (entity.camera) {
      info.components.camera = {
        fov: entity.camera.fov,
        nearClip: entity.camera.nearClip,
        farClip: entity.camera.farClip
      };
    }
    
    return {
      success: true,
      message: `Entity "${entity.name}" details`,
      data: info
    };
  }
};

/**
 * Get distance between entities or from camera
 */
const getDistance: MCPTool = {
  name: 'get_distance',
  description: 'Get the distance between two entities, or from the camera to an entity',
  parameters: {
    type: 'object',
    properties: {
      from: {
        type: 'string',
        description: 'Source entity name/ID, or "camera"'
      },
      to: {
        type: 'string',
        description: 'Target entity name/ID'
      }
    },
    required: ['to']
  },
  handler: (params, app, camera): MCPToolResult => {
    let fromPos;
    
    if (!params.from || params.from.toLowerCase() === 'camera') {
      if (!camera) {
        return { success: false, error: 'Camera not available' };
      }
      fromPos = camera.getPosition();
    } else {
      const fromEntity = findEntityByTarget(app, params.from);
      if (!fromEntity) {
        return { success: false, error: `Could not find entity: ${params.from}` };
      }
      fromPos = fromEntity.getPosition();
    }
    
    const toEntity = findEntityByTarget(app, params.to);
    if (!toEntity) {
      return { success: false, error: `Could not find entity: ${params.to}` };
    }
    
    const toPos = toEntity.getPosition();
    const distance = fromPos.distance(toPos);
    
    return {
      success: true,
      message: `Distance to "${toEntity.name}": ${distance.toFixed(2)} units`,
      data: { 
        distance: Math.round(distance * 100) / 100,
        from: params.from || 'camera',
        to: toEntity.name
      }
    };
  }
};

/**
 * Find entities near a point or entity
 */
const findNearby: MCPTool = {
  name: 'find_nearby',
  description: 'Find entities within a certain distance of a point or entity',
  parameters: {
    type: 'object',
    properties: {
      near: {
        type: 'string',
        description: 'Entity name/ID or "camera" to search around'
      },
      radius: {
        type: 'number',
        description: 'Search radius in units',
        default: 10
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results',
        default: 10
      }
    }
  },
  handler: (params, app, camera): MCPToolResult => {
    let centerPos;
    
    if (!params.near || params.near.toLowerCase() === 'camera') {
      if (!camera) {
        return { success: false, error: 'Camera not available' };
      }
      centerPos = camera.getPosition();
    } else {
      const centerEntity = findEntityByTarget(app, params.near);
      if (!centerEntity) {
        return { success: false, error: `Could not find entity: ${params.near}` };
      }
      centerPos = centerEntity.getPosition();
    }
    
    const radius = params.radius || 10;
    const limit = params.limit || 10;
    const nearby: any[] = [];
    
    app.root.forEach((entity: any) => {
      if (entity === app.root) return;
      if (entity.camera) return; // Skip camera
      
      const distance = centerPos.distance(entity.getPosition());
      if (distance <= radius) {
        nearby.push({
          name: entity.name,
          id: entity.getGuid(),
          distance: Math.round(distance * 100) / 100
        });
      }
    });
    
    // Sort by distance and limit
    nearby.sort((a, b) => a.distance - b.distance);
    const results = nearby.slice(0, limit);
    
    return {
      success: true,
      message: `Found ${results.length} entities within ${radius} units`,
      data: { entities: results, count: results.length }
    };
  }
};

/**
 * Get scene statistics
 */
const getSceneStats: MCPTool = {
  name: 'get_scene_stats',
  description: 'Get statistics about the current scene',
  parameters: {
    type: 'object',
    properties: {}
  },
  handler: (params, app): MCPToolResult => {
    let entityCount = 0;
    let lightCount = 0;
    let physicsCount = 0;
    let renderCount = 0;
    
    app.root.forEach((entity: any) => {
      if (entity === app.root) return;
      entityCount++;
      if (entity.light) lightCount++;
      if (entity.rigidbody) physicsCount++;
      if (entity.render) renderCount++;
    });
    
    const scene = app.scene;
    const stats: any = {
      entities: entityCount,
      renderables: renderCount,
      lights: lightCount,
      physicsObjects: physicsCount
    };
    
    if (scene.rendering) {
      stats.fog = scene.rendering.fog !== 0;
      stats.exposure = scene.rendering.exposure;
    }
    
    return {
      success: true,
      message: `Scene has ${entityCount} entities`,
      data: stats
    };
  }
};

/**
 * Raycast from camera
 */
const raycast: MCPTool = {
  name: 'raycast',
  description: 'Cast a ray from the camera to find what the user is looking at',
  parameters: {
    type: 'object',
    properties: {
      maxDistance: {
        type: 'number',
        description: 'Maximum raycast distance',
        default: 100
      }
    }
  },
  handler: (params, app, camera): MCPToolResult => {
    if (!camera) {
      return { success: false, error: 'Camera not available' };
    }
    
    const pc = (window as any).pc;
    const from = camera.getPosition();
    const forward = camera.forward;
    const to = from.clone().add(forward.clone().mulScalar(params.maxDistance || 100));
    
    // Check if physics system is available
    if (!app.systems.rigidbody) {
      return { 
        success: false, 
        error: 'Physics system not available. Enable physics to use raycast.' 
      };
    }
    
    const result = app.systems.rigidbody.raycastFirst(from, to);
    
    if (result) {
      return {
        success: true,
        message: `Looking at "${result.entity.name}"`,
        data: {
          entity: result.entity.name,
          entityId: result.entity.getGuid(),
          point: {
            x: result.point.x,
            y: result.point.y,
            z: result.point.z
          },
          distance: from.distance(result.point)
        }
      };
    }
    
    return {
      success: true,
      message: 'Not looking at any entity',
      data: { entity: null }
    };
  }
};

// Helper: Find entity by name or ID
function findEntityByTarget(app: any, target: string): any {
  if (!target) return null;
  
  const cleanTarget = target.toLowerCase().replace(/^(the|a|an)\s+/i, '').trim();
  
  // Try GUID
  let entity = app.root.findByGuid(target);
  if (entity) return entity;
  
  // Try exact name
  entity = app.root.findByName(target);
  if (entity) return entity;
  
  // Try case-insensitive
  let found: any = null;
  app.root.forEach((e: any) => {
    if (e.name.toLowerCase() === cleanTarget) {
      found = e;
    }
  });
  if (found) return found;
  
  // Try partial match
  app.root.forEach((e: any) => {
    if (e.name.toLowerCase().includes(cleanTarget)) {
      found = e;
    }
  });
  
  return found;
}

export const queryTools: MCPTool[] = [
  listEntities,
  getEntity,
  getDistance,
  findNearby,
  getSceneStats,
  raycast
];

