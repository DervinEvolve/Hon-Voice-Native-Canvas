/**
 * Entity Tools for PlayCanvas MCP
 *
 * Tools for creating, modifying, deleting, and managing entities in the scene.
 */

import type { MCPTool, MCPToolResult } from '../index';

/**
 * Action History for Undo System
 * Tracks entity creations so they can be reversed
 */
interface UndoAction {
  type: 'create' | 'delete' | 'modify';
  entityId: string;
  entityName: string;
  timestamp: number;
  // For 'delete' actions, store data to recreate
  entityData?: any;
}

// Global action history stack (max 50 actions)
const actionHistory: UndoAction[] = [];
const MAX_HISTORY = 50;

/**
 * Track an action for undo
 */
function trackAction(action: Omit<UndoAction, 'timestamp'>): void {
  actionHistory.push({
    ...action,
    timestamp: Date.now()
  });
  // Keep history bounded
  if (actionHistory.length > MAX_HISTORY) {
    actionHistory.shift();
  }
}

/**
 * Get the last action (for undo)
 */
function popLastAction(): UndoAction | undefined {
  return actionHistory.pop();
}

/**
 * Helper: Random variation for procedural generation variety
 */
function randomVariation(base: number, variance: number): number {
  return base * (1 + (Math.random() - 0.5) * variance);
}

/**
 * Helper: Random color variation for more organic appearance
 */
function varyColor(pc: any, baseColor: string, hueVariance = 0.05, brightnessVariance = 0.1): any {
  const base = parseColor(pc, baseColor);

  // Apply slight variations to RGB
  const r = Math.max(0, Math.min(1, base.r + (Math.random() - 0.5) * brightnessVariance));
  const g = Math.max(0, Math.min(1, base.g + (Math.random() - 0.5) * brightnessVariance));
  const b = Math.max(0, Math.min(1, base.b + (Math.random() - 0.5) * brightnessVariance));

  return new pc.Color(r, g, b);
}

/**
 * Helper: Random Y rotation for organic placement
 */
function randomYRotation(): number {
  return Math.random() * 360;
}

/**
 * Create a new entity in the scene
 */
const createEntity: MCPTool = {
  name: 'create_entity',
  description: 'Create a new 3D object in the immersive scene. Can add behaviors like player controls, enemy AI, or collectible effects. Returns the entity ID for future reference.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name for the entity (e.g., "red cube", "player spawn")'
      },
      type: {
        type: 'string',
        description: 'Type of primitive to create',
        enum: ['box', 'sphere', 'cylinder', 'cone', 'plane', 'capsule', 'torus']
      },
      position: {
        type: 'object',
        description: 'Position in 3D space { x, y, z }. Default is origin (0, 0, 0)'
      },
      rotation: {
        type: 'object',
        description: 'Rotation in degrees { x, y, z }. Default is no rotation'
      },
      scale: {
        type: 'object',
        description: 'Scale { x, y, z }. Default is (1, 1, 1)'
      },
      color: {
        type: 'string',
        description: 'Color as hex string (e.g., "#ff0000" for red) or color name'
      },
      behavior: {
        type: 'string',
        description: 'Attach a behavior to the entity',
        enum: ['player', 'enemy', 'collectible', 'projectile', 'trigger']
      },
      behaviorConfig: {
        type: 'object',
        description: 'Configuration for the behavior (speed, health, damage, etc.)'
      },
      physics: {
        type: 'string',
        description: 'Physics body type',
        enum: ['static', 'dynamic', 'kinematic']
      }
    },
    required: ['name', 'type']
  },
  handler: (params, app, camera): MCPToolResult => {
    const pc = (window as any).pc;
    if (!pc) {
      return { success: false, error: 'PlayCanvas not loaded' };
    }

    // Create entity
    const entity = new pc.Entity(params.name);
    
    // Add render component
    entity.addComponent('render', {
      type: params.type || 'box'
    });
    
    // Set position
    if (params.position) {
      entity.setPosition(
        params.position.x || 0,
        params.position.y || 0,
        params.position.z || 0
      );
    } else if (camera) {
      // Default: place in front of camera
      const forward = camera.forward.clone();
      const pos = camera.getPosition().clone().add(forward.mulScalar(5));
      entity.setPosition(pos.x, pos.y, pos.z);
    }
    
    // Set rotation
    if (params.rotation) {
      entity.setEulerAngles(
        params.rotation.x || 0,
        params.rotation.y || 0,
        params.rotation.z || 0
      );
    }
    
    // Set scale
    if (params.scale) {
      entity.setLocalScale(
        params.scale.x || 1,
        params.scale.y || 1,
        params.scale.z || 1
      );
    }
    
    // Set color with PBR material properties
    if (params.color && entity.render) {
      const material = new pc.StandardMaterial();
      const color = parseColor(pc, params.color);
      material.diffuse = color;
      // PBR properties for better lighting response
      material.metalness = 0.1; // Slight metallic sheen for generic objects
      material.gloss = 0.4; // Medium smoothness
      material.useMetalness = true;
      // Add subtle emissive for visibility
      material.emissive = color.clone().mulScalar(0.15);
      material.update();
      entity.render.meshInstances.forEach((mi: any) => {
        mi.material = material;
      });
    }
    
    // Add physics - default to static collision for solid objects
    // This ensures buildings, walls, etc. have collision by default
    const physicsType = params.physics || 'static'; // Default to static collision
    const noCollisionTypes = ['plane']; // Types that shouldn't have collision by default

    if (physicsType !== 'none' && !noCollisionTypes.includes(params.type)) {
      // Determine collision shape based on render type
      let collisionType = params.type || 'box';
      if (collisionType === 'torus') collisionType = 'mesh'; // Torus needs mesh collision
      if (collisionType === 'cone') collisionType = 'mesh';

      entity.addComponent('collision', {
        type: collisionType,
        halfExtents: params.scale ? new pc.Vec3(
          (params.scale.x || 1) / 2,
          (params.scale.y || 1) / 2,
          (params.scale.z || 1) / 2
        ) : new pc.Vec3(0.5, 0.5, 0.5),
        radius: collisionType === 'sphere' ? (params.scale?.x || 1) / 2 : 0.5,
        height: collisionType === 'capsule' || collisionType === 'cylinder' ? (params.scale?.y || 1) : 1
      });

      entity.addComponent('rigidbody', {
        type: physicsType,
        mass: physicsType === 'dynamic' ? (params.mass || 1) : 0,
        friction: 0.5,
        restitution: 0.3
      });
    }
    
    // Attach behavior script if specified
    if (params.behavior) {
      attachBehavior(entity, params.behavior, params.behaviorConfig || {}, app);
    }
    
    // Add to scene
    app.root.addChild(entity);

    // Apply ground detection - place object ON the ground, not floating or buried
    // Wait one frame for render component to initialize
    requestAnimationFrame(() => {
      if (entity.render && entity.render.meshInstances.length > 0) {
        // Calculate bounding box
        let minY = Infinity;
        entity.render.meshInstances.forEach((mi: any) => {
          if (mi.aabb && mi.aabb.minimum) {
            minY = Math.min(minY, mi.aabb.minimum.y);
          }
        });

        // If we got a valid bounding box, adjust Y position to sit on ground
        if (isFinite(minY)) {
          const currentPos = entity.getPosition();
          const groundLevel = 0; // Assume ground is at Y=0
          const offsetFromPivot = -minY;
          const correctY = groundLevel + offsetFromPivot;

          // Only adjust if significantly different (avoid tiny corrections)
          if (Math.abs(currentPos.y - correctY) > 0.01) {
            entity.setPosition(currentPos.x, correctY, currentPos.z);
          }
        }
      }
    });

    const entityId = entity.getGuid();

    // Track for undo
    trackAction({
      type: 'create',
      entityId,
      entityName: params.name || params.type
    });

    // Fire event for materialize effect (smooth appearance animation)
    app.fire('hon:entity-materialize', { entity, name: params.name });

    // Fire event for game state tracking
    if (params.behavior) {
      app.fire('hon:entity-created', {
        id: entityId,
        name: params.name,
        behavior: params.behavior
      });
    }

    return {
      success: true,
      message: `Created ${params.type} "${params.name}"${params.behavior ? ` with ${params.behavior} behavior` : ''}`,
      data: {
        id: entityId,
        name: params.name,
        type: params.type,
        behavior: params.behavior,
        position: entity.getPosition()
      }
    };
  }
};

/**
 * Attach a behavior script to an entity
 */
function attachBehavior(entity: any, behavior: string, config: any, app: any): void {
  const pc = (window as any).pc;
  if (!pc) return;
  
  // Add script component if not present
  if (!entity.script) {
    entity.addComponent('script');
  }
  
  switch (behavior) {
    case 'player':
      // Player behavior: WASD movement, jumping
      // Ensure player has dynamic physics for collision
      if (!entity.collision) {
        const pc = (window as any).pc;
        const scale = entity.getLocalScale();
        entity.addComponent('collision', {
          type: 'capsule',
          radius: Math.max(scale.x, scale.z) / 2,
          height: scale.y
        });
      }
      if (!entity.rigidbody) {
        entity.addComponent('rigidbody', {
          type: 'dynamic',
          mass: 70, // ~human weight
          friction: 0.5,
          restitution: 0,
          angularFactor: new (window as any).pc.Vec3(0, 0, 0), // Prevent rotation
          linearDamping: 0.5
        });
      }
      entity.script.create('playerController', {
        attributes: {
          speed: config.speed || 10,
          jumpForce: config.jumpForce || 8
        }
      });
      // Tag as player for enemy targeting
      entity.tags.add('player');
      // Fire player created event
      app.fire('hon:player-created', { entity, config });
      break;
      
    case 'enemy':
      // Enemy behavior: AI movement
      entity.script.create('enemyAI', {
        attributes: {
          behavior: config.behavior || 'chase',
          speed: config.speed || 5,
          range: config.range || 15,
          damage: config.damage || 10
        }
      });
      entity.tags.add('enemy');
      app.fire('hon:enemy-created', { entity, config });
      break;
      
    case 'collectible':
      // Collectible behavior: floating, rotating, pickup
      entity.script.create('collectible', {
        attributes: {
          value: config.value || 10,
          effect: config.effect || 'score',
          floatAnimation: config.floatAnimation !== false,
          rotateAnimation: config.rotateAnimation !== false
        }
      });
      entity.tags.add('collectible');
      // Make it a trigger
      if (entity.collision) {
        entity.collision.type = 'trigger';
      }
      app.fire('hon:collectible-created', { entity, config });
      break;
      
    case 'projectile':
      // Projectile behavior: move forward, destroy on hit
      entity.script.create('projectile', {
        attributes: {
          speed: config.speed || 20,
          damage: config.damage || 10,
          lifetime: config.lifetime || 5
        }
      });
      entity.tags.add('projectile');
      break;
      
    case 'trigger':
      // Trigger zone behavior
      if (entity.collision) {
        entity.collision.type = 'trigger';
      }
      entity.script.create('triggerZone', {
        attributes: {
          onEnterEvent: config.onEnter || 'hon:trigger-enter',
          onExitEvent: config.onExit || 'hon:trigger-exit'
        }
      });
      entity.tags.add('trigger');
      break;
  }
}

/**
 * Modify an existing entity
 */
const modifyEntity: MCPTool = {
  name: 'modify_entity',
  description: 'Modify properties of an existing entity (position, rotation, scale, color)',
  parameters: {
    type: 'object',
    properties: {
      target: {
        type: 'string',
        description: 'Entity name or ID to modify. Can use "the cube", "it", etc.'
      },
      position: {
        type: 'object',
        description: 'New position { x, y, z }'
      },
      rotation: {
        type: 'object',
        description: 'New rotation in degrees { x, y, z }'
      },
      scale: {
        type: 'object',
        description: 'New scale { x, y, z } or single number for uniform scale'
      },
      color: {
        type: 'string',
        description: 'New color as hex string or color name'
      },
      visible: {
        type: 'boolean',
        description: 'Show or hide the entity'
      }
    },
    required: ['target']
  },
  handler: (params, app): MCPToolResult => {
    const pc = (window as any).pc;
    const entity = findEntity(app, params.target);
    
    if (!entity) {
      return { success: false, error: `Could not find entity: ${params.target}` };
    }
    
    // Update position
    if (params.position) {
      entity.setPosition(
        params.position.x ?? entity.getPosition().x,
        params.position.y ?? entity.getPosition().y,
        params.position.z ?? entity.getPosition().z
      );
    }
    
    // Update rotation
    if (params.rotation) {
      entity.setEulerAngles(
        params.rotation.x ?? 0,
        params.rotation.y ?? 0,
        params.rotation.z ?? 0
      );
    }
    
    // Update scale
    if (params.scale) {
      if (typeof params.scale === 'number') {
        entity.setLocalScale(params.scale, params.scale, params.scale);
      } else {
        entity.setLocalScale(
          params.scale.x ?? 1,
          params.scale.y ?? 1,
          params.scale.z ?? 1
        );
      }
    }
    
    // Update color
    if (params.color && entity.render) {
      const material = new pc.StandardMaterial();
      material.diffuse = parseColor(pc, params.color);
      material.update();
      entity.render.meshInstances.forEach((mi: any) => {
        mi.material = material;
      });
    }
    
    // Update visibility
    if (params.visible !== undefined) {
      entity.enabled = params.visible;
    }
    
    return {
      success: true,
      message: `Modified "${entity.name}"`,
      data: { id: entity.getGuid(), name: entity.name }
    };
  }
};

/**
 * Delete an entity from the scene
 */
const deleteEntity: MCPTool = {
  name: 'delete_entity',
  description: 'Remove an entity from the scene',
  parameters: {
    type: 'object',
    properties: {
      target: {
        type: 'string',
        description: 'Entity name or ID to delete'
      }
    },
    required: ['target']
  },
  handler: (params, app): MCPToolResult => {
    const entity = findEntity(app, params.target);
    
    if (!entity) {
      return { success: false, error: `Could not find entity: ${params.target}` };
    }
    
    const name = entity.name;
    entity.destroy();
    
    return {
      success: true,
      message: `Deleted "${name}"`
    };
  }
};

/**
 * Duplicate an entity
 */
const duplicateEntity: MCPTool = {
  name: 'duplicate_entity',
  description: 'Create a copy of an existing entity',
  parameters: {
    type: 'object',
    properties: {
      target: {
        type: 'string',
        description: 'Entity name or ID to duplicate'
      },
      newName: {
        type: 'string',
        description: 'Name for the copy'
      },
      offset: {
        type: 'object',
        description: 'Position offset from original { x, y, z }'
      }
    },
    required: ['target']
  },
  handler: (params, app): MCPToolResult => {
    const entity = findEntity(app, params.target);
    
    if (!entity) {
      return { success: false, error: `Could not find entity: ${params.target}` };
    }
    
    const clone = entity.clone();
    clone.name = params.newName || `${entity.name} copy`;
    
    if (params.offset) {
      const pos = entity.getPosition();
      clone.setPosition(
        pos.x + (params.offset.x || 0),
        pos.y + (params.offset.y || 0),
        pos.z + (params.offset.z || 0)
      );
    }
    
    app.root.addChild(clone);

    // Fire event for materialize effect
    app.fire('hon:entity-materialize', { entity: clone, name: clone.name });

    return {
      success: true,
      message: `Duplicated "${entity.name}" as "${clone.name}"`,
      data: { id: clone.getGuid(), name: clone.name }
    };
  }
};

/**
 * Reparent an entity (change its parent in the hierarchy)
 */
const reparentEntity: MCPTool = {
  name: 'reparent_entity',
  description: 'Change the parent of an entity (for grouping/hierarchy)',
  parameters: {
    type: 'object',
    properties: {
      target: {
        type: 'string',
        description: 'Entity to reparent'
      },
      newParent: {
        type: 'string',
        description: 'New parent entity name/ID, or "root" for scene root'
      }
    },
    required: ['target', 'newParent']
  },
  handler: (params, app): MCPToolResult => {
    const entity = findEntity(app, params.target);
    
    if (!entity) {
      return { success: false, error: `Could not find entity: ${params.target}` };
    }
    
    let newParent;
    if (params.newParent === 'root') {
      newParent = app.root;
    } else {
      newParent = findEntity(app, params.newParent);
      if (!newParent) {
        return { success: false, error: `Could not find parent: ${params.newParent}` };
      }
    }
    
    entity.reparent(newParent);
    
    return {
      success: true,
      message: `Reparented "${entity.name}" to "${newParent.name}"`
    };
  }
};

/**
 * Create multiple entities at once
 */
const createEntities: MCPTool = {
  name: 'create_entities',
  description: 'Create multiple entities at once (e.g., a row of columns, scattered trees)',
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        description: 'Type of primitive',
        enum: ['box', 'sphere', 'cylinder', 'cone', 'plane']
      },
      count: {
        type: 'number',
        description: 'Number of entities to create'
      },
      baseName: {
        type: 'string',
        description: 'Base name (will be numbered)'
      },
      arrangement: {
        type: 'string',
        description: 'How to arrange them',
        enum: ['line', 'grid', 'circle', 'random']
      },
      spacing: {
        type: 'number',
        description: 'Distance between entities'
      },
      color: {
        type: 'string',
        description: 'Color for all entities'
      },
      randomizeColor: {
        type: 'boolean',
        description: 'Give each entity a random color'
      }
    },
    required: ['type', 'count']
  },
  handler: (params, app, camera): MCPToolResult => {
    const pc = (window as any).pc;
    const count = Math.min(params.count || 1, 100); // Cap at 100
    const spacing = params.spacing || 2;
    const baseName = params.baseName || params.type;
    const entities: any[] = [];
    
    // Get center position (in front of camera or origin)
    let centerX = 0, centerY = 0, centerZ = 0;
    if (camera) {
      const forward = camera.forward.clone();
      const pos = camera.getPosition().clone().add(forward.mulScalar(10));
      centerX = pos.x;
      centerY = pos.y;
      centerZ = pos.z;
    }
    
    for (let i = 0; i < count; i++) {
      const entity = new pc.Entity(`${baseName}_${i + 1}`);
      entity.addComponent('render', { type: params.type });
      
      // Calculate position based on arrangement
      let x = centerX, y = centerY, z = centerZ;
      
      switch (params.arrangement) {
        case 'line':
          x = centerX + (i - count / 2) * spacing;
          break;
        case 'grid':
          const cols = Math.ceil(Math.sqrt(count));
          x = centerX + (i % cols - cols / 2) * spacing;
          z = centerZ + (Math.floor(i / cols) - cols / 2) * spacing;
          break;
        case 'circle':
          const angle = (i / count) * Math.PI * 2;
          const radius = spacing * count / (2 * Math.PI);
          x = centerX + Math.cos(angle) * radius;
          z = centerZ + Math.sin(angle) * radius;
          break;
        case 'random':
          x = centerX + (Math.random() - 0.5) * spacing * count;
          z = centerZ + (Math.random() - 0.5) * spacing * count;
          y = centerY + Math.random() * spacing;
          break;
        default:
          x = centerX + (i - count / 2) * spacing;
      }
      
      entity.setPosition(x, y, z);
      
      // Set color
      if (params.color || params.randomizeColor) {
        const material = new pc.StandardMaterial();
        if (params.randomizeColor) {
          material.diffuse = new pc.Color(Math.random(), Math.random(), Math.random());
        } else {
          material.diffuse = parseColor(pc, params.color);
        }
        material.update();
        entity.render.meshInstances.forEach((mi: any) => {
          mi.material = material;
        });
      }
      
      app.root.addChild(entity);
      entities.push({ id: entity.getGuid(), name: entity.name });

      // Fire event for materialize effect
      app.fire('hon:entity-materialize', { entity, name: entity.name });
    }

    return {
      success: true,
      message: `Created ${count} ${params.type}(s) in ${params.arrangement || 'line'} arrangement`,
      data: { entities, count }
    };
  }
};

// Helper: Find entity by name or ID
function findEntity(app: any, target: string): any {
  if (!target) return null;
  
  // Clean up target string
  const cleanTarget = target.toLowerCase().replace(/^(the|a|an)\s+/i, '').trim();
  
  // Try to find by GUID first
  let entity = app.root.findByGuid(target);
  if (entity) return entity;
  
  // Try exact name match
  entity = app.root.findByName(target);
  if (entity) return entity;
  
  // Try case-insensitive search
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

// Helper: Parse color string to pc.Color
function parseColor(pc: any, colorStr: string): any {
  if (!colorStr) return new pc.Color(1, 1, 1);
  
  // Named colors
  const namedColors: Record<string, [number, number, number]> = {
    red: [1, 0, 0],
    green: [0, 1, 0],
    blue: [0, 0, 1],
    yellow: [1, 1, 0],
    cyan: [0, 1, 1],
    magenta: [1, 0, 1],
    white: [1, 1, 1],
    black: [0, 0, 0],
    orange: [1, 0.5, 0],
    purple: [0.5, 0, 0.5],
    pink: [1, 0.75, 0.8],
    brown: [0.6, 0.3, 0],
    gray: [0.5, 0.5, 0.5],
    grey: [0.5, 0.5, 0.5],
    gold: [1, 0.84, 0],
    silver: [0.75, 0.75, 0.75]
  };
  
  const lower = colorStr.toLowerCase();
  if (namedColors[lower]) {
    const [r, g, b] = namedColors[lower];
    return new pc.Color(r, g, b);
  }
  
  // Hex color
  if (colorStr.startsWith('#')) {
    const hex = colorStr.slice(1);
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    return new pc.Color(r, g, b);
  }
  
  return new pc.Color(1, 1, 1);
}

/**
 * Create a composite object (multiple primitives grouped together)
 * This allows creating more complex objects like trees, buildings, characters
 */
const createComposite: MCPTool = {
  name: 'create_composite',
  description: 'Create a complex object from multiple primitives grouped together. Use this to build trees, buildings, creatures, furniture, etc.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name for the composite object'
      },
      position: {
        type: 'object',
        description: 'Base position { x, y, z }'
      },
      scale: {
        type: 'number',
        description: 'Overall scale multiplier (default 1)'
      },
      parts: {
        type: 'array',
        description: 'Array of parts, each with: type (box/sphere/cylinder/cone/capsule/torus), localPosition {x,y,z}, localScale {x,y,z}, localRotation {x,y,z}, color, emissive (boolean), emissiveColor, emissiveIntensity, opacity'
      }
    },
    required: ['name', 'parts']
  },
  handler: (params, app, camera): MCPToolResult => {
    const pc = (window as any).pc;
    if (!pc) {
      return { success: false, error: 'PlayCanvas not loaded' };
    }

    // Create parent entity
    const parent = new pc.Entity(params.name);
    
    // Set base position
    if (params.position) {
      parent.setPosition(
        params.position.x || 0,
        params.position.y || 0,
        params.position.z || 0
      );
    } else if (camera) {
      const forward = camera.forward.clone();
      const pos = camera.getPosition().clone().add(forward.mulScalar(5));
      parent.setPosition(pos.x, pos.y, pos.z);
    }
    
    const overallScale = params.scale || 1;
    const partIds: string[] = [];
    
    // Create each part as a child
    (params.parts || []).forEach((part: any, index: number) => {
      const partEntity = new pc.Entity(`${params.name}_part_${index}`);
      
      // Add render component
      partEntity.addComponent('render', {
        type: part.type || 'box'
      });
      
      // Set local position (relative to parent)
      if (part.localPosition) {
        partEntity.setLocalPosition(
          (part.localPosition.x || 0) * overallScale,
          (part.localPosition.y || 0) * overallScale,
          (part.localPosition.z || 0) * overallScale
        );
      }
      
      // Set local rotation
      if (part.localRotation) {
        partEntity.setLocalEulerAngles(
          part.localRotation.x || 0,
          part.localRotation.y || 0,
          part.localRotation.z || 0
        );
      }
      
      // Set local scale
      if (part.localScale) {
        partEntity.setLocalScale(
          (part.localScale.x || 1) * overallScale,
          (part.localScale.y || 1) * overallScale,
          (part.localScale.z || 1) * overallScale
        );
      } else {
        partEntity.setLocalScale(overallScale, overallScale, overallScale);
      }
      
      // Create material with advanced properties
      const material = new pc.StandardMaterial();
      
      // Base color
      if (part.color) {
        material.diffuse = parseColor(pc, part.color);
      }
      
      // Emissive (glowing) material
      if (part.emissive) {
        const emissiveColor = part.emissiveColor ? parseColor(pc, part.emissiveColor) : parseColor(pc, part.color);
        const intensity = part.emissiveIntensity || 1;
        material.emissive = new pc.Color(
          emissiveColor.r * intensity,
          emissiveColor.g * intensity,
          emissiveColor.b * intensity
        );
        material.emissiveIntensity = intensity;
      }
      
      // Opacity/transparency
      if (part.opacity !== undefined && part.opacity < 1) {
        material.opacity = part.opacity;
        material.blendType = pc.BLEND_NORMAL;
      }
      
      // Metalness and glossiness for more realistic materials
      if (part.metalness !== undefined) {
        material.metalness = part.metalness;
      }
      if (part.glossiness !== undefined) {
        material.gloss = part.glossiness;
      }
      
      material.update();
      partEntity.render.meshInstances.forEach((mi: any) => {
        mi.material = material;
      });
      
      // Add as child of parent
      parent.addChild(partEntity);
      partIds.push(partEntity.getGuid());
    });
    
    // Add parent to scene
    app.root.addChild(parent);

    // Fire event for materialize effect
    app.fire('hon:entity-materialize', { entity: parent, name: params.name });

    return {
      success: true,
      message: `Created composite "${params.name}" with ${params.parts?.length || 0} parts`,
      data: {
        id: parent.getGuid(),
        name: params.name,
        partCount: params.parts?.length || 0,
        partIds
      }
    };
  }
};

/**
 * Set material properties on an entity (emissive, metalness, etc.)
 */
const setMaterial: MCPTool = {
  name: 'set_material',
  description: 'Set advanced material properties on an entity (emissive/glow, metalness, glossiness, opacity)',
  parameters: {
    type: 'object',
    properties: {
      target: {
        type: 'string',
        description: 'Entity name or ID'
      },
      color: {
        type: 'string',
        description: 'Base diffuse color'
      },
      emissive: {
        type: 'boolean',
        description: 'Enable emissive (glowing) effect'
      },
      emissiveColor: {
        type: 'string',
        description: 'Emissive color (defaults to base color)'
      },
      emissiveIntensity: {
        type: 'number',
        description: 'Emissive intensity (0-10, default 1)'
      },
      metalness: {
        type: 'number',
        description: 'Metalness (0-1, 0=plastic, 1=metal)'
      },
      glossiness: {
        type: 'number',
        description: 'Glossiness/shininess (0-1)'
      },
      opacity: {
        type: 'number',
        description: 'Opacity (0-1, 1=solid)'
      }
    },
    required: ['target']
  },
  handler: (params, app): MCPToolResult => {
    const pc = (window as any).pc;
    const entity = findEntity(app, params.target);
    
    if (!entity) {
      return { success: false, error: `Could not find entity: ${params.target}` };
    }
    
    if (!entity.render) {
      return { success: false, error: `Entity "${params.target}" has no render component` };
    }
    
    const material = new pc.StandardMaterial();
    
    // Copy existing material properties if available
    const existingMaterial = entity.render.meshInstances[0]?.material;
    if (existingMaterial) {
      material.diffuse = existingMaterial.diffuse?.clone() || new pc.Color(1, 1, 1);
    }
    
    // Apply new properties
    if (params.color) {
      material.diffuse = parseColor(pc, params.color);
    }
    
    if (params.emissive) {
      const emissiveColor = params.emissiveColor 
        ? parseColor(pc, params.emissiveColor) 
        : material.diffuse.clone();
      const intensity = params.emissiveIntensity || 1;
      material.emissive = new pc.Color(
        emissiveColor.r * intensity,
        emissiveColor.g * intensity,
        emissiveColor.b * intensity
      );
      material.emissiveIntensity = intensity;
    }
    
    if (params.metalness !== undefined) {
      material.metalness = params.metalness;
    }
    
    if (params.glossiness !== undefined) {
      material.gloss = params.glossiness;
    }
    
    if (params.opacity !== undefined && params.opacity < 1) {
      material.opacity = params.opacity;
      material.blendType = pc.BLEND_NORMAL;
    }
    
    material.update();
    entity.render.meshInstances.forEach((mi: any) => {
      mi.material = material;
    });
    
    return {
      success: true,
      message: `Updated material on "${entity.name}"`,
      data: { id: entity.getGuid(), name: entity.name }
    };
  }
};

/**
 * Create a stylized tree (composite of trunk + foliage)
 */
const createTree: MCPTool = {
  name: 'create_tree',
  description: 'Create a stylized tree with trunk and foliage. Customize style, size, and colors.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name for the tree'
      },
      position: {
        type: 'object',
        description: 'Position { x, y, z }'
      },
      style: {
        type: 'string',
        description: 'Tree style',
        enum: ['pine', 'oak', 'palm', 'dead', 'willow', 'mushroom', 'crystal', 'alien']
      },
      scale: {
        type: 'number',
        description: 'Overall scale (default 1)'
      },
      trunkColor: {
        type: 'string',
        description: 'Trunk color (default brown)'
      },
      foliageColor: {
        type: 'string',
        description: 'Foliage color (default green)'
      },
      glowing: {
        type: 'boolean',
        description: 'Make foliage glow'
      }
    },
    required: ['name']
  },
  handler: (params, app, camera): MCPToolResult => {
    const pc = (window as any).pc;
    if (!pc) {
      return { success: false, error: 'PlayCanvas not loaded' };
    }

    const style = params.style || 'oak';
    const baseScale = params.scale || 1;
    // Add height variation (±15%)
    const scale = randomVariation(baseScale, 0.3);
    const trunkColor = params.trunkColor || '#4a3728';
    const foliageColor = params.foliageColor || '#2d5a27';

    const tree = new pc.Entity(params.name || 'tree');

    // Position
    if (params.position) {
      tree.setPosition(params.position.x || 0, params.position.y || 0, params.position.z || 0);
    } else if (camera) {
      const forward = camera.forward.clone();
      const pos = camera.getPosition().clone().add(forward.mulScalar(8));
      tree.setPosition(pos.x, 0, pos.z);
    }

    // Add random Y rotation for variety
    tree.setLocalEulerAngles(0, randomYRotation(), 0);

    // Create trunk material with PBR properties
    const trunkMat = new pc.StandardMaterial();
    trunkMat.diffuse = varyColor(pc, trunkColor, 0.05, 0.15);
    trunkMat.metalness = 0.0; // Wood is non-metallic
    trunkMat.gloss = 0.15 + Math.random() * 0.1; // Slightly rough, natural variation
    trunkMat.useMetalness = true;
    trunkMat.update();

    // Create foliage material with PBR properties
    const foliageMat = new pc.StandardMaterial();
    foliageMat.diffuse = varyColor(pc, foliageColor, 0.05, 0.2);
    foliageMat.metalness = 0.0; // Leaves are non-metallic
    foliageMat.gloss = 0.3 + Math.random() * 0.15; // Natural sheen variation
    foliageMat.useMetalness = true;
    if (params.glowing) {
      foliageMat.emissive = parseColor(pc, foliageColor);
      foliageMat.emissiveIntensity = 0.5;
    }
    foliageMat.update();
    
    // Build tree based on style
    switch (style) {
      case 'pine':
        // Tall thin trunk with slight variation
        const pineTrunk = new pc.Entity('trunk');
        pineTrunk.addComponent('render', { type: 'cylinder' });
        const trunkThickness = randomVariation(0.3, 0.2);
        const trunkHeight = randomVariation(3, 0.15);
        pineTrunk.setLocalScale(trunkThickness * scale, trunkHeight * scale, trunkThickness * scale);
        pineTrunk.setLocalPosition(0, (trunkHeight / 2) * scale, 0);
        pineTrunk.render.meshInstances.forEach((mi: any) => mi.material = trunkMat);
        tree.addChild(pineTrunk);

        // Stacked cones for pine foliage - vary count (3-4)
        const coneCount = 3 + Math.floor(Math.random() * 2);
        for (let i = 0; i < coneCount; i++) {
          const cone = new pc.Entity(`foliage_${i}`);
          cone.addComponent('render', { type: 'cone' });
          const coneScale = randomVariation(1.5 - i * 0.3, 0.15);
          cone.setLocalScale(coneScale * scale, 1.5 * scale, coneScale * scale);
          cone.setLocalPosition(0, (2.5 + i * 1) * scale, 0);
          cone.render.meshInstances.forEach((mi: any) => mi.material = foliageMat);
          tree.addChild(cone);
        }
        break;
        
      case 'oak':
        // Thick trunk with variation
        const oakTrunk = new pc.Entity('trunk');
        oakTrunk.addComponent('render', { type: 'cylinder' });
        const oakTrunkScale = randomVariation(0.5, 0.2);
        const oakHeight = randomVariation(2, 0.2);
        oakTrunk.setLocalScale(oakTrunkScale * scale, oakHeight * scale, oakTrunkScale * scale);
        oakTrunk.setLocalPosition(0, (oakHeight / 2) * scale, 0);
        oakTrunk.render.meshInstances.forEach((mi: any) => mi.material = trunkMat);
        tree.addChild(oakTrunk);

        // Round foliage cluster with randomized positions
        const foliageCount = 4 + Math.floor(Math.random() * 2); // 4-5 foliage spheres
        for (let i = 0; i < foliageCount; i++) {
          const sphere = new pc.Entity(`foliage_${i}`);
          sphere.addComponent('render', { type: 'sphere' });
          const sphereScale = randomVariation(1.2 - i * 0.15, 0.2);
          sphere.setLocalScale(sphereScale * scale, sphereScale * 0.8 * scale, sphereScale * scale);
          // Randomize foliage position
          const angle = (i / foliageCount) * Math.PI * 2 + Math.random() * 0.5;
          const radius = (i === 0 ? 0 : 0.6 + Math.random() * 0.3);
          sphere.setLocalPosition(
            Math.cos(angle) * radius * scale,
            (2.5 + Math.random() * 0.5) * scale,
            Math.sin(angle) * radius * scale
          );
          sphere.render.meshInstances.forEach((mi: any) => mi.material = foliageMat);
          tree.addChild(sphere);
        }
        break;
        
      case 'palm':
        // Curved trunk with randomized lean angle
        const palmTrunk = new pc.Entity('trunk');
        palmTrunk.addComponent('render', { type: 'cylinder' });
        const palmHeight = randomVariation(4, 0.2);
        palmTrunk.setLocalScale(0.25 * scale, palmHeight * scale, 0.25 * scale);
        palmTrunk.setLocalPosition(0, (palmHeight / 2) * scale, 0);
        palmTrunk.setLocalEulerAngles(
          3 + Math.random() * 4,
          Math.random() * 360,
          2 + Math.random() * 4
        );
        palmTrunk.render.meshInstances.forEach((mi: any) => mi.material = trunkMat);
        tree.addChild(palmTrunk);

        // Palm fronds (flat boxes) - vary count and length
        const frondCount = 5 + Math.floor(Math.random() * 3); // 5-7 fronds
        for (let i = 0; i < frondCount; i++) {
          const frond = new pc.Entity(`frond_${i}`);
          frond.addComponent('render', { type: 'box' });
          const frondLength = randomVariation(2, 0.2);
          frond.setLocalScale(0.15 * scale, 0.05 * scale, frondLength * scale);
          frond.setLocalPosition(0, palmHeight * scale, 0);
          frond.setLocalEulerAngles(-30 + Math.random() * 10, (i / frondCount) * 360, 0);
          frond.render.meshInstances.forEach((mi: any) => mi.material = foliageMat);
          tree.addChild(frond);
        }
        break;
        
      case 'dead':
        // Gnarled trunk
        const deadTrunk = new pc.Entity('trunk');
        deadTrunk.addComponent('render', { type: 'cylinder' });
        deadTrunk.setLocalScale(0.4 * scale, 3 * scale, 0.3 * scale);
        deadTrunk.setLocalPosition(0, 1.5 * scale, 0);
        deadTrunk.setLocalEulerAngles(0, 0, 8);
        const deadMat = new pc.StandardMaterial();
        deadMat.diffuse = parseColor(pc, '#2a2a2a');
        deadMat.update();
        deadTrunk.render.meshInstances.forEach((mi: any) => mi.material = deadMat);
        tree.addChild(deadTrunk);
        
        // Bare branches
        for (let i = 0; i < 4; i++) {
          const branch = new pc.Entity(`branch_${i}`);
          branch.addComponent('render', { type: 'cylinder' });
          branch.setLocalScale(0.08 * scale, 1.5 * scale, 0.08 * scale);
          branch.setLocalPosition(0, 2.5 * scale, 0);
          branch.setLocalEulerAngles(45, i * 90, 30);
          branch.render.meshInstances.forEach((mi: any) => mi.material = deadMat);
          tree.addChild(branch);
        }
        break;
        
      case 'crystal':
        // Crystal tree - glowing geometric
        const crystalBase = new pc.Entity('base');
        crystalBase.addComponent('render', { type: 'cone' });
        crystalBase.setLocalScale(0.8 * scale, 2 * scale, 0.8 * scale);
        crystalBase.setLocalPosition(0, 1 * scale, 0);
        const crystalMat = new pc.StandardMaterial();
        crystalMat.diffuse = parseColor(pc, foliageColor);
        crystalMat.emissive = parseColor(pc, foliageColor);
        crystalMat.emissiveIntensity = 2;
        crystalMat.opacity = 0.8;
        crystalMat.blendType = pc.BLEND_NORMAL;
        crystalMat.update();
        crystalBase.render.meshInstances.forEach((mi: any) => mi.material = crystalMat);
        tree.addChild(crystalBase);
        
        // Crystal shards
        for (let i = 0; i < 5; i++) {
          const shard = new pc.Entity(`shard_${i}`);
          shard.addComponent('render', { type: 'cone' });
          const shardScale = (0.3 + Math.random() * 0.3) * scale;
          shard.setLocalScale(shardScale, shardScale * 3, shardScale);
          shard.setLocalPosition(
            (Math.random() - 0.5) * scale,
            (1.5 + Math.random()) * scale,
            (Math.random() - 0.5) * scale
          );
          shard.setLocalEulerAngles(
            Math.random() * 30 - 15,
            Math.random() * 360,
            Math.random() * 30 - 15
          );
          shard.render.meshInstances.forEach((mi: any) => mi.material = crystalMat);
          tree.addChild(shard);
        }
        break;
        
      default: // mushroom, alien, willow - simplified
        // Generic stylized tree
        const genericTrunk = new pc.Entity('trunk');
        genericTrunk.addComponent('render', { type: 'cylinder' });
        genericTrunk.setLocalScale(0.4 * scale, 2.5 * scale, 0.4 * scale);
        genericTrunk.setLocalPosition(0, 1.25 * scale, 0);
        genericTrunk.render.meshInstances.forEach((mi: any) => mi.material = trunkMat);
        tree.addChild(genericTrunk);
        
        const genericTop = new pc.Entity('top');
        genericTop.addComponent('render', { type: 'sphere' });
        genericTop.setLocalScale(2 * scale, 1.5 * scale, 2 * scale);
        genericTop.setLocalPosition(0, 3 * scale, 0);
        genericTop.render.meshInstances.forEach((mi: any) => mi.material = foliageMat);
        tree.addChild(genericTop);
    }
    
    app.root.addChild(tree);

    const treeId = tree.getGuid();

    // Track for undo
    trackAction({
      type: 'create',
      entityId: treeId,
      entityName: params.name || `${style} tree`
    });

    // Fire event for materialize effect
    app.fire('hon:entity-materialize', { entity: tree, name: params.name });

    return {
      success: true,
      message: `Created ${style} tree "${params.name}"`,
      data: { id: treeId, name: params.name, style }
    };
  }
};

/**
 * Create a rock/boulder
 */
const createRock: MCPTool = {
  name: 'create_rock',
  description: 'Create a stylized rock or boulder',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name for the rock'
      },
      position: {
        type: 'object',
        description: 'Position { x, y, z }'
      },
      style: {
        type: 'string',
        description: 'Rock style',
        enum: ['boulder', 'crystal', 'flat', 'jagged', 'mossy']
      },
      scale: {
        type: 'number',
        description: 'Overall scale'
      },
      color: {
        type: 'string',
        description: 'Rock color'
      }
    },
    required: ['name']
  },
  handler: (params, app, camera): MCPToolResult => {
    const pc = (window as any).pc;
    if (!pc) {
      return { success: false, error: 'PlayCanvas not loaded' };
    }

    const style = params.style || 'boulder';
    const baseScale = params.scale || 1;
    // Add size variation (±25% for rocks - more natural variation)
    const scale = randomVariation(baseScale, 0.5);
    const color = params.color || '#5a5a5a';

    const rock = new pc.Entity(params.name || 'rock');

    if (params.position) {
      rock.setPosition(params.position.x || 0, params.position.y || 0, params.position.z || 0);
    } else if (camera) {
      const forward = camera.forward.clone();
      const pos = camera.getPosition().clone().add(forward.mulScalar(5));
      rock.setPosition(pos.x, 0, pos.z);
    }

    // Add random Y rotation for variety
    rock.setLocalEulerAngles(0, randomYRotation(), 0);

    const rockMat = new pc.StandardMaterial();
    rockMat.diffuse = varyColor(pc, color, 0.05, 0.15);
    rockMat.metalness = 0.0; // Stone is non-metallic
    rockMat.gloss = 0.15 + Math.random() * 0.15; // Rough stone surface with variation
    rockMat.useMetalness = true;
    rockMat.update();
    
    switch (style) {
      case 'crystal':
        // Glowing crystal rock
        const crystalMat = new pc.StandardMaterial();
        crystalMat.diffuse = parseColor(pc, color);
        crystalMat.emissive = parseColor(pc, color);
        crystalMat.emissiveIntensity = 1.5;
        crystalMat.opacity = 0.85;
        crystalMat.blendType = pc.BLEND_NORMAL;
        crystalMat.update();
        
        for (let i = 0; i < 4; i++) {
          const shard = new pc.Entity(`shard_${i}`);
          shard.addComponent('render', { type: 'cone' });
          const s = (0.3 + Math.random() * 0.4) * scale;
          shard.setLocalScale(s, s * 2.5, s);
          shard.setLocalPosition(
            (Math.random() - 0.5) * 0.5 * scale,
            s * 1.2,
            (Math.random() - 0.5) * 0.5 * scale
          );
          shard.setLocalEulerAngles(Math.random() * 20 - 10, Math.random() * 360, Math.random() * 20 - 10);
          shard.render.meshInstances.forEach((mi: any) => mi.material = crystalMat);
          rock.addChild(shard);
        }
        break;
        
      case 'flat':
        const flat = new pc.Entity('base');
        flat.addComponent('render', { type: 'cylinder' });
        const flatWidth = randomVariation(1.5, 0.25);
        const flatHeight = randomVariation(0.3, 0.3);
        flat.setLocalScale(flatWidth * scale, flatHeight * scale, flatWidth * 0.8 * scale);
        flat.setLocalPosition(0, flatHeight / 2 * scale, 0);
        flat.render.meshInstances.forEach((mi: any) => mi.material = rockMat);
        rock.addChild(flat);
        break;

      default: // boulder, jagged, mossy
        // Cluster of spheres for organic look - vary count
        const numParts = style === 'jagged' ? (4 + Math.floor(Math.random() * 3)) : (2 + Math.floor(Math.random() * 3)); // 4-6 for jagged, 2-4 for boulder
        for (let i = 0; i < numParts; i++) {
          const part = new pc.Entity(`part_${i}`);
          part.addComponent('render', { type: i === 0 ? 'sphere' : 'box' });
          const s = (0.5 + Math.random() * 0.5) * scale;
          part.setLocalScale(s, s * 0.7, s * 0.9);
          part.setLocalPosition(
            (Math.random() - 0.5) * 0.5 * scale,
            s * 0.3,
            (Math.random() - 0.5) * 0.5 * scale
          );
          part.setLocalEulerAngles(Math.random() * 30, Math.random() * 360, Math.random() * 30);
          part.render.meshInstances.forEach((mi: any) => mi.material = rockMat);
          rock.addChild(part);
        }

        // Add moss for mossy style with color variation
        if (style === 'mossy') {
          const mossMat = new pc.StandardMaterial();
          mossMat.diffuse = varyColor(pc, '#3a5a3a', 0.1, 0.2);
          mossMat.update();
          const mossCount = 1 + Math.floor(Math.random() * 2); // 1-2 moss patches
          for (let i = 0; i < mossCount; i++) {
            const moss = new pc.Entity(`moss_${i}`);
            moss.addComponent('render', { type: 'sphere' });
            const mossScale = randomVariation(0.8, 0.3);
            moss.setLocalScale(mossScale * scale, 0.2 * scale, mossScale * scale);
            moss.setLocalPosition(
              (Math.random() - 0.5) * 0.4 * scale,
              0.4 * scale,
              (Math.random() - 0.5) * 0.4 * scale
            );
            moss.render.meshInstances.forEach((mi: any) => mi.material = mossMat);
            rock.addChild(moss);
          }
        }
    }
    
    app.root.addChild(rock);

    const rockId = rock.getGuid();

    // Track for undo
    trackAction({
      type: 'create',
      entityId: rockId,
      entityName: params.name || `${style} rock`
    });

    // Fire event for materialize effect
    app.fire('hon:entity-materialize', { entity: rock, name: params.name });

    return {
      success: true,
      message: `Created ${style} rock "${params.name}"`,
      data: { id: rockId, name: params.name, style }
    };
  }
};

/**
 * Create a building/structure with proper windows and architectural details
 */
const createBuilding: MCPTool = {
  name: 'create_building',
  description: 'Create a building with proper windows, doors, and architectural details. Windows are automatically placed in correct grid patterns.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name for the building'
      },
      position: {
        type: 'object',
        description: 'Position { x, y, z }'
      },
      style: {
        type: 'string',
        description: 'Building style',
        enum: ['office', 'apartment', 'house', 'skyscraper', 'warehouse', 'shop', 'tower', 'temple', 'futuristic']
      },
      floors: {
        type: 'number',
        description: 'Number of floors (1-20). Auto-calculated if not specified.'
      },
      width: {
        type: 'number',
        description: 'Building width in meters (default: auto based on style)'
      },
      depth: {
        type: 'number',
        description: 'Building depth in meters (default: auto based on style)'
      },
      color: {
        type: 'string',
        description: 'Wall color (default: varies by style)'
      },
      windowColor: {
        type: 'string',
        description: 'Window color (default: dark blue-gray)'
      },
      roofColor: {
        type: 'string',
        description: 'Roof/accent color'
      }
    },
    required: ['name']
  },
  handler: (params, app, camera): MCPToolResult => {
    const pc = (window as any).pc;
    if (!pc) {
      return { success: false, error: 'PlayCanvas not loaded' };
    }

    const style = params.style || 'office';

    // Style-based defaults
    const styleDefaults: Record<string, { floors: number; width: number; depth: number; wallColor: string; roofColor: string }> = {
      office: { floors: 4, width: 12, depth: 10, wallColor: '#c4beb4', roofColor: '#4a4a4a' },
      apartment: { floors: 6, width: 15, depth: 12, wallColor: '#d4c4a8', roofColor: '#6a5a4a' },
      house: { floors: 2, width: 8, depth: 7, wallColor: '#e8dcc8', roofColor: '#8b4513' },
      skyscraper: { floors: 15, width: 20, depth: 18, wallColor: '#708090', roofColor: '#2f4f4f' },
      warehouse: { floors: 2, width: 20, depth: 25, wallColor: '#a0a0a0', roofColor: '#606060' },
      shop: { floors: 1, width: 8, depth: 6, wallColor: '#f5f0e6', roofColor: '#8b7355' },
      tower: { floors: 8, width: 6, depth: 6, wallColor: '#b8b0a0', roofColor: '#5a4a3a' },
      temple: { floors: 1, width: 12, depth: 10, wallColor: '#e8e0d0', roofColor: '#8b7355' },
      futuristic: { floors: 10, width: 14, depth: 12, wallColor: '#3a4a5a', roofColor: '#1a2a3a' }
    };

    const defaults = styleDefaults[style] || styleDefaults.office;

    // Building dimensions
    const numFloors = Math.min(Math.max(params.floors || defaults.floors, 1), 20);
    const floorHeight = 3.2; // meters per floor
    const buildingHeight = numFloors * floorHeight;
    const buildingWidth = params.width || defaults.width;
    const buildingDepth = params.depth || defaults.depth;

    // Colors
    const wallColor = params.color || defaults.wallColor;
    const windowColor = params.windowColor || '#1a2530';
    const roofColor = params.roofColor || defaults.roofColor;

    // Window configuration
    const windowWidth = 1.2;
    const windowHeight = 1.6;
    const windowDepth = 0.15; // How far windows protrude
    const windowMarginX = 1.5; // Margin from building edge
    const windowMarginY = 0.8; // Distance from floor to window bottom
    const windowSpacingX = 0.8; // Space between windows horizontally

    const building = new pc.Entity(params.name || 'building');

    // Position
    if (params.position) {
      building.setPosition(params.position.x || 0, params.position.y || 0, params.position.z || 0);
    } else if (camera) {
      const forward = camera.forward.clone();
      const pos = camera.getPosition().clone().add(forward.mulScalar(15));
      building.setPosition(pos.x, 0, pos.z);
    }

    // Random rotation (90° increments)
    const baseRotation = Math.floor(Math.random() * 4) * 90;
    building.setLocalEulerAngles(0, baseRotation, 0);

    // === MATERIALS ===

    // Wall material
    const wallMat = new pc.StandardMaterial();
    wallMat.diffuse = varyColor(pc, wallColor, 0.02, 0.08);
    wallMat.metalness = 0.05;
    wallMat.gloss = 0.3;
    wallMat.useMetalness = true;
    wallMat.update();

    // Window material (dark, slightly reflective)
    const windowMat = new pc.StandardMaterial();
    windowMat.diffuse = parseColor(pc, windowColor);
    windowMat.metalness = 0.3;
    windowMat.gloss = 0.8;
    windowMat.useMetalness = true;
    windowMat.update();

    // Foundation material (darker)
    const foundationMat = new pc.StandardMaterial();
    const foundColor = parseColor(pc, wallColor);
    foundationMat.diffuse = new pc.Color(foundColor.r * 0.6, foundColor.g * 0.6, foundColor.b * 0.6);
    foundationMat.metalness = 0.1;
    foundationMat.gloss = 0.2;
    foundationMat.useMetalness = true;
    foundationMat.update();

    // Roof material
    const roofMat = new pc.StandardMaterial();
    roofMat.diffuse = varyColor(pc, roofColor, 0.03, 0.1);
    roofMat.metalness = 0.1;
    roofMat.gloss = 0.25;
    roofMat.useMetalness = true;
    roofMat.update();

    // Door material
    const doorMat = new pc.StandardMaterial();
    doorMat.diffuse = parseColor(pc, '#2a1a10');
    doorMat.metalness = 0.1;
    doorMat.gloss = 0.4;
    doorMat.useMetalness = true;
    doorMat.update();

    // Trim/ledge material
    const trimMat = new pc.StandardMaterial();
    const trimColor = parseColor(pc, wallColor);
    trimMat.diffuse = new pc.Color(trimColor.r * 0.85, trimColor.g * 0.85, trimColor.b * 0.85);
    trimMat.metalness = 0.05;
    trimMat.gloss = 0.35;
    trimMat.useMetalness = true;
    trimMat.update();

    // === MAIN STRUCTURE ===

    // Foundation (slightly wider, darker base)
    const foundationHeight = 0.4;
    const foundation = new pc.Entity('foundation');
    foundation.addComponent('render', { type: 'box' });
    foundation.setLocalScale(buildingWidth + 0.3, foundationHeight, buildingDepth + 0.3);
    foundation.setLocalPosition(0, foundationHeight / 2, 0);
    foundation.render.meshInstances.forEach((mi: any) => mi.material = foundationMat);
    building.addChild(foundation);

    // Main walls
    const walls = new pc.Entity('walls');
    walls.addComponent('render', { type: 'box' });
    walls.setLocalScale(buildingWidth, buildingHeight, buildingDepth);
    walls.setLocalPosition(0, foundationHeight + buildingHeight / 2, 0);
    walls.render.meshInstances.forEach((mi: any) => mi.material = wallMat);
    building.addChild(walls);

    // === WINDOWS ===

    // Calculate how many windows fit on each face
    const windowsPerFloorFront = Math.floor((buildingWidth - 2 * windowMarginX) / (windowWidth + windowSpacingX));
    const windowsPerFloorSide = Math.floor((buildingDepth - 2 * windowMarginX) / (windowWidth + windowSpacingX));

    // Calculate actual spacing to center windows
    const actualSpacingFront = (buildingWidth - 2 * windowMarginX - windowsPerFloorFront * windowWidth) / Math.max(windowsPerFloorFront - 1, 1);
    const actualSpacingSide = (buildingDepth - 2 * windowMarginX - windowsPerFloorSide * windowWidth) / Math.max(windowsPerFloorSide - 1, 1);

    // Helper to create window
    const createWindow = (x: number, y: number, z: number, rotY: number, name: string) => {
      const win = new pc.Entity(name);
      win.addComponent('render', { type: 'box' });
      win.setLocalScale(windowWidth, windowHeight, windowDepth);
      win.setLocalPosition(x, y, z);
      win.setLocalEulerAngles(0, rotY, 0);
      win.render.meshInstances.forEach((mi: any) => mi.material = windowMat);
      building.addChild(win);
    };

    // Place windows on each floor
    for (let floor = 0; floor < numFloors; floor++) {
      const floorY = foundationHeight + floor * floorHeight + windowMarginY + windowHeight / 2;

      // Skip ground floor front center for door (for buildings with doors)
      const hasDoor = style !== 'warehouse' && style !== 'temple';
      const doorWindowSkip = hasDoor && floor === 0 ? Math.floor(windowsPerFloorFront / 2) : -1;

      // Front face (positive Z)
      for (let w = 0; w < windowsPerFloorFront; w++) {
        if (w === doorWindowSkip) continue; // Skip for door
        const x = -buildingWidth / 2 + windowMarginX + windowWidth / 2 + w * (windowWidth + actualSpacingFront);
        createWindow(x, floorY, buildingDepth / 2 + windowDepth / 2, 0, `window_front_${floor}_${w}`);
      }

      // Back face (negative Z)
      for (let w = 0; w < windowsPerFloorFront; w++) {
        const x = -buildingWidth / 2 + windowMarginX + windowWidth / 2 + w * (windowWidth + actualSpacingFront);
        createWindow(x, floorY, -buildingDepth / 2 - windowDepth / 2, 0, `window_back_${floor}_${w}`);
      }

      // Left face (negative X)
      for (let w = 0; w < windowsPerFloorSide; w++) {
        const z = -buildingDepth / 2 + windowMarginX + windowWidth / 2 + w * (windowWidth + actualSpacingSide);
        createWindow(-buildingWidth / 2 - windowDepth / 2, floorY, z, 90, `window_left_${floor}_${w}`);
      }

      // Right face (positive X)
      for (let w = 0; w < windowsPerFloorSide; w++) {
        const z = -buildingDepth / 2 + windowMarginX + windowWidth / 2 + w * (windowWidth + actualSpacingSide);
        createWindow(buildingWidth / 2 + windowDepth / 2, floorY, z, 90, `window_right_${floor}_${w}`);
      }
    }

    // === DOOR ===
    if (style !== 'warehouse' && style !== 'temple') {
      const doorWidth = 1.8;
      const doorHeight = 2.6;

      // Door recess (darker area behind door)
      const doorRecess = new pc.Entity('door_recess');
      doorRecess.addComponent('render', { type: 'box' });
      doorRecess.setLocalScale(doorWidth + 0.3, doorHeight + 0.1, 0.3);
      doorRecess.setLocalPosition(0, foundationHeight + doorHeight / 2, buildingDepth / 2 + 0.1);
      doorRecess.render.meshInstances.forEach((mi: any) => mi.material = foundationMat);
      building.addChild(doorRecess);

      // Door
      const door = new pc.Entity('door');
      door.addComponent('render', { type: 'box' });
      door.setLocalScale(doorWidth, doorHeight, 0.1);
      door.setLocalPosition(0, foundationHeight + doorHeight / 2, buildingDepth / 2 + 0.2);
      door.render.meshInstances.forEach((mi: any) => mi.material = doorMat);
      building.addChild(door);

      // Door frame (thin trim around door)
      const frameThickness = 0.12;
      const frameDepth = 0.15;

      // Top frame
      const frameTop = new pc.Entity('door_frame_top');
      frameTop.addComponent('render', { type: 'box' });
      frameTop.setLocalScale(doorWidth + frameThickness * 2, frameThickness, frameDepth);
      frameTop.setLocalPosition(0, foundationHeight + doorHeight + frameThickness / 2, buildingDepth / 2 + 0.15);
      frameTop.render.meshInstances.forEach((mi: any) => mi.material = trimMat);
      building.addChild(frameTop);

      // Left frame
      const frameLeft = new pc.Entity('door_frame_left');
      frameLeft.addComponent('render', { type: 'box' });
      frameLeft.setLocalScale(frameThickness, doorHeight, frameDepth);
      frameLeft.setLocalPosition(-doorWidth / 2 - frameThickness / 2, foundationHeight + doorHeight / 2, buildingDepth / 2 + 0.15);
      frameLeft.render.meshInstances.forEach((mi: any) => mi.material = trimMat);
      building.addChild(frameLeft);

      // Right frame
      const frameRight = new pc.Entity('door_frame_right');
      frameRight.addComponent('render', { type: 'box' });
      frameRight.setLocalScale(frameThickness, doorHeight, frameDepth);
      frameRight.setLocalPosition(doorWidth / 2 + frameThickness / 2, foundationHeight + doorHeight / 2, buildingDepth / 2 + 0.15);
      frameRight.render.meshInstances.forEach((mi: any) => mi.material = trimMat);
      building.addChild(frameRight);
    }

    // === ROOF ===
    if (style === 'house' || style === 'shop') {
      // Pitched roof for houses/shops
      const roofOverhang = 0.5;
      const roofPitch = 25 + Math.random() * 10;
      const roofThickness = 0.25;

      const roofLeft = new pc.Entity('roof_left');
      roofLeft.addComponent('render', { type: 'box' });
      roofLeft.setLocalScale(buildingWidth + roofOverhang * 2, roofThickness, buildingDepth / 2 + 1);
      roofLeft.setLocalPosition(0, foundationHeight + buildingHeight + 0.5, -buildingDepth / 4);
      roofLeft.setLocalEulerAngles(roofPitch, 0, 0);
      roofLeft.render.meshInstances.forEach((mi: any) => mi.material = roofMat);
      building.addChild(roofLeft);

      const roofRight = new pc.Entity('roof_right');
      roofRight.addComponent('render', { type: 'box' });
      roofRight.setLocalScale(buildingWidth + roofOverhang * 2, roofThickness, buildingDepth / 2 + 1);
      roofRight.setLocalPosition(0, foundationHeight + buildingHeight + 0.5, buildingDepth / 4);
      roofRight.setLocalEulerAngles(-roofPitch, 0, 0);
      roofRight.render.meshInstances.forEach((mi: any) => mi.material = roofMat);
      building.addChild(roofRight);
    } else {
      // Flat roof with ledge for other buildings
      const roofLedgeHeight = 0.3;
      const roofLedgeWidth = 0.2;

      const roof = new pc.Entity('roof');
      roof.addComponent('render', { type: 'box' });
      roof.setLocalScale(buildingWidth + 0.2, 0.3, buildingDepth + 0.2);
      roof.setLocalPosition(0, foundationHeight + buildingHeight + 0.15, 0);
      roof.render.meshInstances.forEach((mi: any) => mi.material = roofMat);
      building.addChild(roof);

      // Roof ledge (parapet)
      const createLedge = (x: number, z: number, scaleX: number, scaleZ: number, name: string) => {
        const ledge = new pc.Entity(name);
        ledge.addComponent('render', { type: 'box' });
        ledge.setLocalScale(scaleX, roofLedgeHeight, scaleZ);
        ledge.setLocalPosition(x, foundationHeight + buildingHeight + 0.3 + roofLedgeHeight / 2, z);
        ledge.render.meshInstances.forEach((mi: any) => mi.material = trimMat);
        building.addChild(ledge);
      };

      // Parapet walls
      createLedge(0, buildingDepth / 2 + roofLedgeWidth / 2, buildingWidth + 0.4, roofLedgeWidth, 'parapet_front');
      createLedge(0, -buildingDepth / 2 - roofLedgeWidth / 2, buildingWidth + 0.4, roofLedgeWidth, 'parapet_back');
      createLedge(-buildingWidth / 2 - roofLedgeWidth / 2, 0, roofLedgeWidth, buildingDepth, 'parapet_left');
      createLedge(buildingWidth / 2 + roofLedgeWidth / 2, 0, roofLedgeWidth, buildingDepth, 'parapet_right');
    }

    // === FLOOR LINES (horizontal trim between floors) ===
    if (numFloors > 1 && style !== 'warehouse') {
      const trimHeight = 0.15;
      for (let floor = 1; floor < numFloors; floor++) {
        const trimY = foundationHeight + floor * floorHeight;

        // Front and back trim
        const trimFront = new pc.Entity(`trim_front_${floor}`);
        trimFront.addComponent('render', { type: 'box' });
        trimFront.setLocalScale(buildingWidth + 0.1, trimHeight, 0.1);
        trimFront.setLocalPosition(0, trimY, buildingDepth / 2 + 0.05);
        trimFront.render.meshInstances.forEach((mi: any) => mi.material = trimMat);
        building.addChild(trimFront);

        const trimBack = new pc.Entity(`trim_back_${floor}`);
        trimBack.addComponent('render', { type: 'box' });
        trimBack.setLocalScale(buildingWidth + 0.1, trimHeight, 0.1);
        trimBack.setLocalPosition(0, trimY, -buildingDepth / 2 - 0.05);
        trimBack.render.meshInstances.forEach((mi: any) => mi.material = trimMat);
        building.addChild(trimBack);
      }
    }

    // === SPECIAL STYLE ADDITIONS ===

    if (style === 'futuristic') {
      // Glowing accent strips
      const glowMat = new pc.StandardMaterial();
      glowMat.diffuse = parseColor(pc, '#00aaff');
      glowMat.emissive = parseColor(pc, '#00aaff');
      glowMat.emissiveIntensity = 2;
      glowMat.update();

      for (let i = 0; i < Math.min(numFloors, 5); i++) {
        const stripY = foundationHeight + (i + 0.5) * floorHeight;
        const strip = new pc.Entity(`glow_strip_${i}`);
        strip.addComponent('render', { type: 'box' });
        strip.setLocalScale(buildingWidth + 0.2, 0.08, 0.08);
        strip.setLocalPosition(0, stripY, buildingDepth / 2 + 0.1);
        strip.render.meshInstances.forEach((mi: any) => mi.material = glowMat);
        building.addChild(strip);
      }
    }

    if (style === 'temple') {
      // Add columns for temple
      const colRadius = 0.4;
      const colHeight = buildingHeight - 0.5;
      const colPositions = [
        { x: -buildingWidth / 2 + 1.5, z: buildingDepth / 2 - 0.5 },
        { x: buildingWidth / 2 - 1.5, z: buildingDepth / 2 - 0.5 },
        { x: -buildingWidth / 2 + 1.5, z: -buildingDepth / 2 + 0.5 },
        { x: buildingWidth / 2 - 1.5, z: -buildingDepth / 2 + 0.5 },
      ];
      colPositions.forEach((pos, i) => {
        const col = new pc.Entity(`column_${i}`);
        col.addComponent('render', { type: 'cylinder' });
        col.setLocalScale(colRadius, colHeight, colRadius);
        col.setLocalPosition(pos.x, foundationHeight + colHeight / 2, pos.z);
        col.render.meshInstances.forEach((mi: any) => mi.material = wallMat);
        building.addChild(col);
      });
    }

    app.root.addChild(building);

    const buildingId = building.getGuid();

    // Track for undo
    trackAction({
      type: 'create',
      entityId: buildingId,
      entityName: params.name || `${style} building`
    });

    // Fire event for materialize effect
    app.fire('hon:entity-materialize', { entity: building, name: params.name });

    const windowCount = (windowsPerFloorFront * 2 + windowsPerFloorSide * 2) * numFloors;

    return {
      success: true,
      message: `Created ${numFloors}-floor ${style} building "${params.name}" (${buildingWidth}m × ${buildingDepth}m × ${buildingHeight.toFixed(1)}m tall) with ${windowCount} windows`,
      data: {
        id: buildingId,
        name: params.name,
        style,
        floors: numFloors,
        dimensions: { width: buildingWidth, depth: buildingDepth, height: buildingHeight },
        windowCount
      }
    };
  }
};

/**
 * Create an animated character from the character library
 */
const createCharacter: MCPTool = {
  name: 'create_character',
  description: 'Create an animated character (player, enemy, NPC) from the library. Characters have smooth walk/run/idle animations. Use this for game characters instead of create_entity.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name for the character'
      },
      characterId: {
        type: 'string',
        description: 'Character ID from the built-in library: soldier, robot, ninja, mage, samurai, elf, driver, cyberpunk, security_guard, boy, girl, dancer, desert_soldier',
        enum: ['soldier', 'robot', 'ninja', 'mage', 'samurai', 'elf', 'driver', 'cyberpunk', 'security_guard', 'boy', 'girl', 'dancer', 'desert_soldier']
      },
      position: {
        type: 'object',
        description: 'Position { x, y, z }'
      },
      rotation: {
        type: 'number',
        description: 'Y rotation in degrees'
      },
      scale: {
        type: 'number',
        description: 'Scale multiplier (default 1.0). Use ~1.8 for human-sized characters in city scenes with realistic proportions.'
      },
      isPlayer: {
        type: 'boolean',
        description: 'If true, adds WASD controls and camera follow'
      },
      cameraMode: {
        type: 'string',
        description: 'Camera mode for player: "first-person" for FPS games, "third-person" for RPG/platformer. Default is third-person. Press V in-game to toggle.',
        enum: ['first-person', 'third-person']
      },
      behavior: {
        type: 'string',
        description: 'AI behavior for NPCs',
        enum: ['idle', 'patrol', 'chase', 'flee', 'wander', 'guard', 'attack']
      }
    },
    required: ['characterId']
  },
  handler: (params, app, camera): MCPToolResult => {
    // This is a placeholder - the actual loading happens in WorldImmersiveCanvas
    // We emit an event that the canvas component will handle
    const characterRequest = {
      name: params.name || params.characterId,
      characterId: params.characterId,
      position: params.position || (camera ? (() => {
        const forward = camera.forward.clone();
        const pos = camera.getPosition().clone().add(forward.mulScalar(5));
        return { x: pos.x, y: 0, z: pos.z };
      })() : { x: 0, y: 0, z: 0 }),
      rotation: params.rotation || 0,
      scale: params.scale || 1.0,
      isPlayer: params.isPlayer || false,
      cameraMode: params.cameraMode || 'third-person',
      behavior: params.behavior || 'idle'
    };
    
    // Fire event for WorldImmersiveCanvas to handle
    app.fire('hon:spawn-character', characterRequest);
    
    const cameraModeText = params.isPlayer 
      ? ` with ${characterRequest.cameraMode} camera (press V to toggle)` 
      : '';
    
    return {
      success: true,
      message: `Spawning ${params.characterId} character "${characterRequest.name}"${params.isPlayer ? ' as player (WASD controls)' : ''}${cameraModeText}`,
      data: {
        characterRequest,
        note: 'Character is loading asynchronously. Animations: idle, walk, run. Press V to toggle camera mode. IMPORTANT: Use pc_list_entities after a moment to verify the character appeared successfully. If missing, the GLB may have failed to load - check console for errors.'
      }
    };
  }
};

/**
 * Create a detailed procedural vehicle
 */
const createVehicle: MCPTool = {
  name: 'create_vehicle',
  description: 'Create a detailed procedural vehicle with proper body, wheels, windows, and lights. Styles: car, sports_car, truck, bus, van, taxi, police, ambulance, plane, helicopter.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name for the vehicle'
      },
      position: {
        type: 'object',
        description: 'Position { x, y, z }'
      },
      rotation: {
        type: 'number',
        description: 'Y-axis rotation in degrees (default: 0)'
      },
      style: {
        type: 'string',
        description: 'Vehicle style',
        enum: ['car', 'sports_car', 'truck', 'bus', 'van', 'taxi', 'police', 'ambulance', 'plane', 'helicopter']
      },
      color: {
        type: 'string',
        description: 'Body color (hex or name)'
      },
      scale: {
        type: 'number',
        description: 'Overall scale (default 1)'
      }
    },
    required: ['name']
  },
  handler: (params, app, camera): MCPToolResult => {
    const pc = (window as any).pc;
    if (!pc) {
      return { success: false, error: 'PlayCanvas not loaded' };
    }

    const style = params.style || 'car';
    const scale = params.scale || 1;
    const bodyColor = params.color || getDefaultVehicleColor(style);

    const vehicle = new pc.Entity(params.name || 'vehicle');

    // Position
    if (params.position) {
      vehicle.setPosition(params.position.x || 0, params.position.y || 0, params.position.z || 0);
    } else if (camera) {
      const forward = camera.forward.clone();
      const pos = camera.getPosition().clone().add(forward.mulScalar(8));
      vehicle.setPosition(pos.x, 0, pos.z);
    }

    // Rotation
    vehicle.setLocalEulerAngles(0, params.rotation || 0, 0);

    // Materials
    const bodyMat = new pc.StandardMaterial();
    bodyMat.diffuse = parseColor(pc, bodyColor);
    bodyMat.metalness = 0.6;
    bodyMat.gloss = 0.8;
    bodyMat.useMetalness = true;
    bodyMat.update();

    const glassMat = new pc.StandardMaterial();
    glassMat.diffuse = new pc.Color(0.1, 0.15, 0.2);
    glassMat.opacity = 0.6;
    glassMat.blendType = pc.BLEND_NORMAL;
    glassMat.metalness = 0.9;
    glassMat.gloss = 0.95;
    glassMat.useMetalness = true;
    glassMat.update();

    const tireMat = new pc.StandardMaterial();
    tireMat.diffuse = new pc.Color(0.1, 0.1, 0.1);
    tireMat.metalness = 0.0;
    tireMat.gloss = 0.2;
    tireMat.useMetalness = true;
    tireMat.update();

    const rimMat = new pc.StandardMaterial();
    rimMat.diffuse = new pc.Color(0.7, 0.7, 0.7);
    rimMat.metalness = 0.9;
    rimMat.gloss = 0.9;
    rimMat.useMetalness = true;
    rimMat.update();

    const headlightMat = new pc.StandardMaterial();
    headlightMat.diffuse = new pc.Color(1, 1, 0.9);
    headlightMat.emissive = new pc.Color(1, 1, 0.8);
    headlightMat.emissiveIntensity = 0.8;
    headlightMat.update();

    const taillightMat = new pc.StandardMaterial();
    taillightMat.diffuse = new pc.Color(0.8, 0, 0);
    taillightMat.emissive = new pc.Color(1, 0, 0);
    taillightMat.emissiveIntensity = 0.6;
    taillightMat.update();

    // Get vehicle dimensions based on style
    const dims = getVehicleDimensions(style);
    const s = scale;

    // Helper to create a wheel with tire and rim
    const createWheel = (x: number, y: number, z: number, wheelRadius: number) => {
      const wheelGroup = new pc.Entity('wheel');
      wheelGroup.setLocalPosition(x * s, y * s, z * s);
      wheelGroup.setLocalEulerAngles(0, 0, 90);

      // Tire (outer cylinder)
      const tire = new pc.Entity('tire');
      tire.addComponent('render', { type: 'cylinder' });
      tire.setLocalScale(wheelRadius * 2 * s, 0.2 * s, wheelRadius * 2 * s);
      tire.render.meshInstances.forEach((mi: any) => mi.material = tireMat);
      wheelGroup.addChild(tire);

      // Rim (inner cylinder, slightly smaller)
      const rim = new pc.Entity('rim');
      rim.addComponent('render', { type: 'cylinder' });
      rim.setLocalScale(wheelRadius * 1.4 * s, 0.22 * s, wheelRadius * 1.4 * s);
      rim.render.meshInstances.forEach((mi: any) => mi.material = rimMat);
      wheelGroup.addChild(rim);

      // Hub cap (center)
      const hub = new pc.Entity('hub');
      hub.addComponent('render', { type: 'cylinder' });
      hub.setLocalScale(wheelRadius * 0.5 * s, 0.24 * s, wheelRadius * 0.5 * s);
      hub.render.meshInstances.forEach((mi: any) => mi.material = rimMat);
      wheelGroup.addChild(hub);

      return wheelGroup;
    };

    // Build vehicle based on style
    switch (style) {
      case 'car':
      case 'taxi':
      case 'police': {
        // Main body (lower)
        const body = new pc.Entity('body');
        body.addComponent('render', { type: 'box' });
        body.setLocalScale(dims.length * s, dims.bodyHeight * s, dims.width * s);
        body.setLocalPosition(0, dims.wheelRadius * s + dims.bodyHeight / 2 * s, 0);
        body.render.meshInstances.forEach((mi: any) => mi.material = bodyMat);
        vehicle.addChild(body);

        // Cabin (upper - tapered)
        const cabin = new pc.Entity('cabin');
        cabin.addComponent('render', { type: 'box' });
        cabin.setLocalScale(dims.length * 0.55 * s, dims.cabinHeight * s, dims.width * 0.95 * s);
        cabin.setLocalPosition(-dims.length * 0.05 * s, (dims.wheelRadius + dims.bodyHeight + dims.cabinHeight / 2) * s, 0);
        cabin.render.meshInstances.forEach((mi: any) => mi.material = bodyMat);
        vehicle.addChild(cabin);

        // Hood slope (front of car)
        const hood = new pc.Entity('hood');
        hood.addComponent('render', { type: 'box' });
        hood.setLocalScale(dims.length * 0.25 * s, dims.bodyHeight * 0.3 * s, dims.width * 0.9 * s);
        hood.setLocalPosition(dims.length * 0.35 * s, (dims.wheelRadius + dims.bodyHeight + dims.bodyHeight * 0.15) * s, 0);
        hood.render.meshInstances.forEach((mi: any) => mi.material = bodyMat);
        vehicle.addChild(hood);

        // Trunk (rear)
        const trunk = new pc.Entity('trunk');
        trunk.addComponent('render', { type: 'box' });
        trunk.setLocalScale(dims.length * 0.2 * s, dims.bodyHeight * 0.25 * s, dims.width * 0.9 * s);
        trunk.setLocalPosition(-dims.length * 0.38 * s, (dims.wheelRadius + dims.bodyHeight + dims.bodyHeight * 0.125) * s, 0);
        trunk.render.meshInstances.forEach((mi: any) => mi.material = bodyMat);
        vehicle.addChild(trunk);

        // Front windshield
        const frontWindow = new pc.Entity('front_window');
        frontWindow.addComponent('render', { type: 'box' });
        frontWindow.setLocalScale(dims.length * 0.01 * s, dims.cabinHeight * 0.8 * s, dims.width * 0.85 * s);
        frontWindow.setLocalPosition(dims.length * 0.22 * s, (dims.wheelRadius + dims.bodyHeight + dims.cabinHeight * 0.5) * s, 0);
        frontWindow.setLocalEulerAngles(0, 0, 20);
        frontWindow.render.meshInstances.forEach((mi: any) => mi.material = glassMat);
        vehicle.addChild(frontWindow);

        // Rear windshield
        const rearWindow = new pc.Entity('rear_window');
        rearWindow.addComponent('render', { type: 'box' });
        rearWindow.setLocalScale(dims.length * 0.01 * s, dims.cabinHeight * 0.75 * s, dims.width * 0.85 * s);
        rearWindow.setLocalPosition(-dims.length * 0.28 * s, (dims.wheelRadius + dims.bodyHeight + dims.cabinHeight * 0.45) * s, 0);
        rearWindow.setLocalEulerAngles(0, 0, -25);
        rearWindow.render.meshInstances.forEach((mi: any) => mi.material = glassMat);
        vehicle.addChild(rearWindow);

        // Side windows
        for (const side of [-1, 1]) {
          const sideWindow = new pc.Entity(`side_window_${side > 0 ? 'left' : 'right'}`);
          sideWindow.addComponent('render', { type: 'box' });
          sideWindow.setLocalScale(dims.length * 0.4 * s, dims.cabinHeight * 0.5 * s, 0.02 * s);
          sideWindow.setLocalPosition(-dims.length * 0.05 * s, (dims.wheelRadius + dims.bodyHeight + dims.cabinHeight * 0.6) * s, side * dims.width * 0.475 * s);
          sideWindow.render.meshInstances.forEach((mi: any) => mi.material = glassMat);
          vehicle.addChild(sideWindow);
        }

        // Headlights
        for (const side of [-1, 1]) {
          const headlight = new pc.Entity(`headlight_${side > 0 ? 'left' : 'right'}`);
          headlight.addComponent('render', { type: 'box' });
          headlight.setLocalScale(0.05 * s, 0.1 * s, 0.2 * s);
          headlight.setLocalPosition(dims.length * 0.49 * s, (dims.wheelRadius + dims.bodyHeight * 0.7) * s, side * dims.width * 0.35 * s);
          headlight.render.meshInstances.forEach((mi: any) => mi.material = headlightMat);
          vehicle.addChild(headlight);
        }

        // Taillights
        for (const side of [-1, 1]) {
          const taillight = new pc.Entity(`taillight_${side > 0 ? 'left' : 'right'}`);
          taillight.addComponent('render', { type: 'box' });
          taillight.setLocalScale(0.05 * s, 0.08 * s, 0.25 * s);
          taillight.setLocalPosition(-dims.length * 0.49 * s, (dims.wheelRadius + dims.bodyHeight * 0.7) * s, side * dims.width * 0.35 * s);
          taillight.render.meshInstances.forEach((mi: any) => mi.material = taillightMat);
          vehicle.addChild(taillight);
        }

        // Grill
        const grill = new pc.Entity('grill');
        grill.addComponent('render', { type: 'box' });
        const grillMat = new pc.StandardMaterial();
        grillMat.diffuse = new pc.Color(0.15, 0.15, 0.15);
        grillMat.metalness = 0.8;
        grillMat.gloss = 0.6;
        grillMat.useMetalness = true;
        grillMat.update();
        grill.setLocalScale(0.02 * s, dims.bodyHeight * 0.4 * s, dims.width * 0.5 * s);
        grill.setLocalPosition(dims.length * 0.5 * s, (dims.wheelRadius + dims.bodyHeight * 0.5) * s, 0);
        grill.render.meshInstances.forEach((mi: any) => mi.material = grillMat);
        vehicle.addChild(grill);

        // Wheels
        const wheelY = dims.wheelRadius;
        const frontX = dims.length * 0.32;
        const rearX = -dims.length * 0.32;
        const wheelZ = dims.width * 0.45;

        vehicle.addChild(createWheel(frontX, wheelY, wheelZ, dims.wheelRadius));
        vehicle.addChild(createWheel(frontX, wheelY, -wheelZ, dims.wheelRadius));
        vehicle.addChild(createWheel(rearX, wheelY, wheelZ, dims.wheelRadius));
        vehicle.addChild(createWheel(rearX, wheelY, -wheelZ, dims.wheelRadius));

        // Special additions for police/taxi
        if (style === 'police') {
          // Light bar on top
          const lightBar = new pc.Entity('light_bar');
          lightBar.addComponent('render', { type: 'box' });
          lightBar.setLocalScale(dims.length * 0.25 * s, 0.1 * s, dims.width * 0.4 * s);
          lightBar.setLocalPosition(0, (dims.wheelRadius + dims.bodyHeight + dims.cabinHeight + 0.05) * s, 0);
          const lightBarMat = new pc.StandardMaterial();
          lightBarMat.diffuse = new pc.Color(0.2, 0.2, 0.8);
          lightBarMat.emissive = new pc.Color(0, 0, 1);
          lightBarMat.emissiveIntensity = 0.5;
          lightBarMat.update();
          lightBar.render.meshInstances.forEach((mi: any) => mi.material = lightBarMat);
          vehicle.addChild(lightBar);
        }
        if (style === 'taxi') {
          // Taxi sign on top
          const taxiSign = new pc.Entity('taxi_sign');
          taxiSign.addComponent('render', { type: 'box' });
          taxiSign.setLocalScale(0.4 * s, 0.12 * s, 0.2 * s);
          taxiSign.setLocalPosition(0, (dims.wheelRadius + dims.bodyHeight + dims.cabinHeight + 0.06) * s, 0);
          const taxiMat = new pc.StandardMaterial();
          taxiMat.diffuse = new pc.Color(1, 0.9, 0.2);
          taxiMat.emissive = new pc.Color(1, 0.9, 0.2);
          taxiMat.emissiveIntensity = 0.4;
          taxiMat.update();
          taxiSign.render.meshInstances.forEach((mi: any) => mi.material = taxiMat);
          vehicle.addChild(taxiSign);
        }
        break;
      }

      case 'sports_car': {
        // Low, sleek body
        const body = new pc.Entity('body');
        body.addComponent('render', { type: 'box' });
        body.setLocalScale(dims.length * s, dims.bodyHeight * s, dims.width * s);
        body.setLocalPosition(0, dims.wheelRadius * 0.8 * s + dims.bodyHeight / 2 * s, 0);
        body.render.meshInstances.forEach((mi: any) => mi.material = bodyMat);
        vehicle.addChild(body);

        // Sloped front
        const front = new pc.Entity('front');
        front.addComponent('render', { type: 'box' });
        front.setLocalScale(dims.length * 0.3 * s, dims.bodyHeight * 0.6 * s, dims.width * 0.95 * s);
        front.setLocalPosition(dims.length * 0.4 * s, (dims.wheelRadius * 0.8 + dims.bodyHeight * 0.3) * s, 0);
        front.setLocalEulerAngles(0, 0, -8);
        front.render.meshInstances.forEach((mi: any) => mi.material = bodyMat);
        vehicle.addChild(front);

        // Low cabin
        const cabin = new pc.Entity('cabin');
        cabin.addComponent('render', { type: 'box' });
        cabin.setLocalScale(dims.length * 0.35 * s, dims.cabinHeight * s, dims.width * 0.9 * s);
        cabin.setLocalPosition(-dims.length * 0.05 * s, (dims.wheelRadius * 0.8 + dims.bodyHeight + dims.cabinHeight / 2) * s, 0);
        cabin.render.meshInstances.forEach((mi: any) => mi.material = bodyMat);
        vehicle.addChild(cabin);

        // Windshield (very sloped)
        const windshield = new pc.Entity('windshield');
        windshield.addComponent('render', { type: 'box' });
        windshield.setLocalScale(dims.length * 0.01 * s, dims.cabinHeight * 0.9 * s, dims.width * 0.85 * s);
        windshield.setLocalPosition(dims.length * 0.12 * s, (dims.wheelRadius * 0.8 + dims.bodyHeight + dims.cabinHeight * 0.5) * s, 0);
        windshield.setLocalEulerAngles(0, 0, 35);
        windshield.render.meshInstances.forEach((mi: any) => mi.material = glassMat);
        vehicle.addChild(windshield);

        // Headlights (aggressive slits)
        for (const side of [-1, 1]) {
          const headlight = new pc.Entity(`headlight_${side > 0 ? 'left' : 'right'}`);
          headlight.addComponent('render', { type: 'box' });
          headlight.setLocalScale(0.03 * s, 0.05 * s, 0.35 * s);
          headlight.setLocalPosition(dims.length * 0.52 * s, (dims.wheelRadius * 0.8 + dims.bodyHeight * 0.4) * s, side * dims.width * 0.3 * s);
          headlight.render.meshInstances.forEach((mi: any) => mi.material = headlightMat);
          vehicle.addChild(headlight);
        }

        // Taillights
        for (const side of [-1, 1]) {
          const taillight = new pc.Entity(`taillight_${side > 0 ? 'left' : 'right'}`);
          taillight.addComponent('render', { type: 'box' });
          taillight.setLocalScale(0.03 * s, 0.05 * s, 0.3 * s);
          taillight.setLocalPosition(-dims.length * 0.5 * s, (dims.wheelRadius * 0.8 + dims.bodyHeight * 0.5) * s, side * dims.width * 0.32 * s);
          taillight.render.meshInstances.forEach((mi: any) => mi.material = taillightMat);
          vehicle.addChild(taillight);
        }

        // Wheels (larger)
        const wheelY = dims.wheelRadius;
        vehicle.addChild(createWheel(dims.length * 0.35, wheelY, dims.width * 0.5, dims.wheelRadius));
        vehicle.addChild(createWheel(dims.length * 0.35, wheelY, -dims.width * 0.5, dims.wheelRadius));
        vehicle.addChild(createWheel(-dims.length * 0.35, wheelY, dims.width * 0.5, dims.wheelRadius));
        vehicle.addChild(createWheel(-dims.length * 0.35, wheelY, -dims.width * 0.5, dims.wheelRadius));
        break;
      }

      case 'truck': {
        // Truck cab
        const cab = new pc.Entity('cab');
        cab.addComponent('render', { type: 'box' });
        cab.setLocalScale(dims.cabLength * s, dims.cabHeight * s, dims.width * s);
        cab.setLocalPosition(dims.length * 0.35 * s, (dims.wheelRadius + dims.cabHeight / 2) * s, 0);
        cab.render.meshInstances.forEach((mi: any) => mi.material = bodyMat);
        vehicle.addChild(cab);

        // Truck bed
        const bed = new pc.Entity('bed');
        bed.addComponent('render', { type: 'box' });
        bed.setLocalScale(dims.bedLength * s, dims.bedHeight * s, dims.width * s);
        bed.setLocalPosition(-dims.length * 0.15 * s, (dims.wheelRadius + dims.bedHeight / 2) * s, 0);
        const bedMat = new pc.StandardMaterial();
        bedMat.diffuse = new pc.Color(0.2, 0.2, 0.2);
        bedMat.metalness = 0.5;
        bedMat.gloss = 0.4;
        bedMat.useMetalness = true;
        bedMat.update();
        bed.render.meshInstances.forEach((mi: any) => mi.material = bedMat);
        vehicle.addChild(bed);

        // Bed sides (walls)
        for (const side of [-1, 1]) {
          const bedSide = new pc.Entity(`bed_side_${side > 0 ? 'left' : 'right'}`);
          bedSide.addComponent('render', { type: 'box' });
          bedSide.setLocalScale(dims.bedLength * s, dims.bedHeight * 0.5 * s, 0.05 * s);
          bedSide.setLocalPosition(-dims.length * 0.15 * s, (dims.wheelRadius + dims.bedHeight + dims.bedHeight * 0.25) * s, side * dims.width * 0.5 * s);
          bedSide.render.meshInstances.forEach((mi: any) => mi.material = bedMat);
          vehicle.addChild(bedSide);
        }

        // Tailgate
        const tailgate = new pc.Entity('tailgate');
        tailgate.addComponent('render', { type: 'box' });
        tailgate.setLocalScale(0.05 * s, dims.bedHeight * 0.5 * s, dims.width * s);
        tailgate.setLocalPosition(-dims.length * 0.48 * s, (dims.wheelRadius + dims.bedHeight + dims.bedHeight * 0.25) * s, 0);
        tailgate.render.meshInstances.forEach((mi: any) => mi.material = bedMat);
        vehicle.addChild(tailgate);

        // Cab windshield
        const windshield = new pc.Entity('windshield');
        windshield.addComponent('render', { type: 'box' });
        windshield.setLocalScale(0.02 * s, dims.cabHeight * 0.6 * s, dims.width * 0.9 * s);
        windshield.setLocalPosition((dims.length * 0.35 + dims.cabLength * 0.45) * s, (dims.wheelRadius + dims.cabHeight * 0.65) * s, 0);
        windshield.setLocalEulerAngles(0, 0, 15);
        windshield.render.meshInstances.forEach((mi: any) => mi.material = glassMat);
        vehicle.addChild(windshield);

        // Headlights
        for (const side of [-1, 1]) {
          const headlight = new pc.Entity(`headlight_${side > 0 ? 'left' : 'right'}`);
          headlight.addComponent('render', { type: 'box' });
          headlight.setLocalScale(0.05 * s, 0.12 * s, 0.15 * s);
          headlight.setLocalPosition((dims.length * 0.35 + dims.cabLength * 0.5) * s, (dims.wheelRadius + dims.cabHeight * 0.25) * s, side * dims.width * 0.38 * s);
          headlight.render.meshInstances.forEach((mi: any) => mi.material = headlightMat);
          vehicle.addChild(headlight);
        }

        // Taillights
        for (const side of [-1, 1]) {
          const taillight = new pc.Entity(`taillight_${side > 0 ? 'left' : 'right'}`);
          taillight.addComponent('render', { type: 'box' });
          taillight.setLocalScale(0.05 * s, 0.1 * s, 0.12 * s);
          taillight.setLocalPosition(-dims.length * 0.5 * s, (dims.wheelRadius + dims.bedHeight * 0.5) * s, side * dims.width * 0.4 * s);
          taillight.render.meshInstances.forEach((mi: any) => mi.material = taillightMat);
          vehicle.addChild(taillight);
        }

        // Larger wheels for truck
        const wheelY = dims.wheelRadius;
        vehicle.addChild(createWheel(dims.length * 0.35, wheelY, dims.width * 0.5, dims.wheelRadius));
        vehicle.addChild(createWheel(dims.length * 0.35, wheelY, -dims.width * 0.5, dims.wheelRadius));
        vehicle.addChild(createWheel(-dims.length * 0.35, wheelY, dims.width * 0.5, dims.wheelRadius));
        vehicle.addChild(createWheel(-dims.length * 0.35, wheelY, -dims.width * 0.5, dims.wheelRadius));
        break;
      }

      case 'bus': {
        // Long rectangular body
        const body = new pc.Entity('body');
        body.addComponent('render', { type: 'box' });
        body.setLocalScale(dims.length * s, dims.bodyHeight * s, dims.width * s);
        body.setLocalPosition(0, (dims.wheelRadius + dims.bodyHeight / 2) * s, 0);
        body.render.meshInstances.forEach((mi: any) => mi.material = bodyMat);
        vehicle.addChild(body);

        // Roof
        const roof = new pc.Entity('roof');
        roof.addComponent('render', { type: 'box' });
        roof.setLocalScale(dims.length * 0.98 * s, 0.1 * s, dims.width * 0.95 * s);
        roof.setLocalPosition(0, (dims.wheelRadius + dims.bodyHeight + 0.05) * s, 0);
        roof.render.meshInstances.forEach((mi: any) => mi.material = bodyMat);
        vehicle.addChild(roof);

        // Windows (multiple on each side)
        const windowCount = 6;
        for (let i = 0; i < windowCount; i++) {
          for (const side of [-1, 1]) {
            const win = new pc.Entity(`window_${i}_${side > 0 ? 'left' : 'right'}`);
            win.addComponent('render', { type: 'box' });
            win.setLocalScale(dims.length / windowCount * 0.7 * s, dims.bodyHeight * 0.45 * s, 0.02 * s);
            const xOffset = (i - windowCount / 2 + 0.5) * (dims.length / windowCount);
            win.setLocalPosition(xOffset * s, (dims.wheelRadius + dims.bodyHeight * 0.7) * s, side * dims.width * 0.51 * s);
            win.render.meshInstances.forEach((mi: any) => mi.material = glassMat);
            vehicle.addChild(win);
          }
        }

        // Front windshield
        const frontWindow = new pc.Entity('front_window');
        frontWindow.addComponent('render', { type: 'box' });
        frontWindow.setLocalScale(0.02 * s, dims.bodyHeight * 0.5 * s, dims.width * 0.9 * s);
        frontWindow.setLocalPosition(dims.length * 0.51 * s, (dims.wheelRadius + dims.bodyHeight * 0.7) * s, 0);
        frontWindow.render.meshInstances.forEach((mi: any) => mi.material = glassMat);
        vehicle.addChild(frontWindow);

        // Headlights
        for (const side of [-1, 1]) {
          const headlight = new pc.Entity(`headlight_${side > 0 ? 'left' : 'right'}`);
          headlight.addComponent('render', { type: 'sphere' });
          headlight.setLocalScale(0.15 * s, 0.15 * s, 0.08 * s);
          headlight.setLocalPosition(dims.length * 0.51 * s, (dims.wheelRadius + dims.bodyHeight * 0.2) * s, side * dims.width * 0.4 * s);
          headlight.render.meshInstances.forEach((mi: any) => mi.material = headlightMat);
          vehicle.addChild(headlight);
        }

        // Taillights
        for (const side of [-1, 1]) {
          const taillight = new pc.Entity(`taillight_${side > 0 ? 'left' : 'right'}`);
          taillight.addComponent('render', { type: 'box' });
          taillight.setLocalScale(0.05 * s, 0.2 * s, 0.15 * s);
          taillight.setLocalPosition(-dims.length * 0.51 * s, (dims.wheelRadius + dims.bodyHeight * 0.3) * s, side * dims.width * 0.4 * s);
          taillight.render.meshInstances.forEach((mi: any) => mi.material = taillightMat);
          vehicle.addChild(taillight);
        }

        // Wheels (6 wheels - 2 front, 4 rear double)
        vehicle.addChild(createWheel(dims.length * 0.38, dims.wheelRadius, dims.width * 0.48, dims.wheelRadius));
        vehicle.addChild(createWheel(dims.length * 0.38, dims.wheelRadius, -dims.width * 0.48, dims.wheelRadius));
        vehicle.addChild(createWheel(-dims.length * 0.35, dims.wheelRadius, dims.width * 0.48, dims.wheelRadius));
        vehicle.addChild(createWheel(-dims.length * 0.35, dims.wheelRadius, -dims.width * 0.48, dims.wheelRadius));
        vehicle.addChild(createWheel(-dims.length * 0.2, dims.wheelRadius, dims.width * 0.48, dims.wheelRadius));
        vehicle.addChild(createWheel(-dims.length * 0.2, dims.wheelRadius, -dims.width * 0.48, dims.wheelRadius));
        break;
      }

      case 'van':
      case 'ambulance': {
        // Boxy body
        const body = new pc.Entity('body');
        body.addComponent('render', { type: 'box' });
        body.setLocalScale(dims.length * s, dims.bodyHeight * s, dims.width * s);
        body.setLocalPosition(0, (dims.wheelRadius + dims.bodyHeight / 2) * s, 0);
        body.render.meshInstances.forEach((mi: any) => mi.material = bodyMat);
        vehicle.addChild(body);

        // Front cab (sloped slightly)
        const cab = new pc.Entity('cab_front');
        cab.addComponent('render', { type: 'box' });
        cab.setLocalScale(dims.length * 0.15 * s, dims.bodyHeight * 0.7 * s, dims.width * 0.98 * s);
        cab.setLocalPosition(dims.length * 0.55 * s, (dims.wheelRadius + dims.bodyHeight * 0.35) * s, 0);
        cab.setLocalEulerAngles(0, 0, -10);
        cab.render.meshInstances.forEach((mi: any) => mi.material = bodyMat);
        vehicle.addChild(cab);

        // Windshield
        const windshield = new pc.Entity('windshield');
        windshield.addComponent('render', { type: 'box' });
        windshield.setLocalScale(0.02 * s, dims.bodyHeight * 0.45 * s, dims.width * 0.85 * s);
        windshield.setLocalPosition(dims.length * 0.58 * s, (dims.wheelRadius + dims.bodyHeight * 0.7) * s, 0);
        windshield.setLocalEulerAngles(0, 0, 20);
        windshield.render.meshInstances.forEach((mi: any) => mi.material = glassMat);
        vehicle.addChild(windshield);

        // Side windows
        for (const side of [-1, 1]) {
          const sideWin = new pc.Entity(`side_window_${side > 0 ? 'left' : 'right'}`);
          sideWin.addComponent('render', { type: 'box' });
          sideWin.setLocalScale(dims.length * 0.25 * s, dims.bodyHeight * 0.3 * s, 0.02 * s);
          sideWin.setLocalPosition(dims.length * 0.35 * s, (dims.wheelRadius + dims.bodyHeight * 0.75) * s, side * dims.width * 0.51 * s);
          sideWin.render.meshInstances.forEach((mi: any) => mi.material = glassMat);
          vehicle.addChild(sideWin);
        }

        // Headlights
        for (const side of [-1, 1]) {
          const headlight = new pc.Entity(`headlight_${side > 0 ? 'left' : 'right'}`);
          headlight.addComponent('render', { type: 'box' });
          headlight.setLocalScale(0.05 * s, 0.1 * s, 0.18 * s);
          headlight.setLocalPosition(dims.length * 0.55 * s, (dims.wheelRadius + dims.bodyHeight * 0.25) * s, side * dims.width * 0.35 * s);
          headlight.render.meshInstances.forEach((mi: any) => mi.material = headlightMat);
          vehicle.addChild(headlight);
        }

        // Taillights
        for (const side of [-1, 1]) {
          const taillight = new pc.Entity(`taillight_${side > 0 ? 'left' : 'right'}`);
          taillight.addComponent('render', { type: 'box' });
          taillight.setLocalScale(0.05 * s, 0.15 * s, 0.12 * s);
          taillight.setLocalPosition(-dims.length * 0.51 * s, (dims.wheelRadius + dims.bodyHeight * 0.3) * s, side * dims.width * 0.4 * s);
          taillight.render.meshInstances.forEach((mi: any) => mi.material = taillightMat);
          vehicle.addChild(taillight);
        }

        // Wheels
        vehicle.addChild(createWheel(dims.length * 0.35, dims.wheelRadius, dims.width * 0.48, dims.wheelRadius));
        vehicle.addChild(createWheel(dims.length * 0.35, dims.wheelRadius, -dims.width * 0.48, dims.wheelRadius));
        vehicle.addChild(createWheel(-dims.length * 0.35, dims.wheelRadius, dims.width * 0.48, dims.wheelRadius));
        vehicle.addChild(createWheel(-dims.length * 0.35, dims.wheelRadius, -dims.width * 0.48, dims.wheelRadius));

        // Ambulance-specific: lights and cross
        if (style === 'ambulance') {
          // Light bar
          const lightBar = new pc.Entity('light_bar');
          lightBar.addComponent('render', { type: 'box' });
          lightBar.setLocalScale(dims.length * 0.2 * s, 0.1 * s, dims.width * 0.3 * s);
          lightBar.setLocalPosition(dims.length * 0.2 * s, (dims.wheelRadius + dims.bodyHeight + 0.05) * s, 0);
          const redLightMat = new pc.StandardMaterial();
          redLightMat.diffuse = new pc.Color(0.8, 0, 0);
          redLightMat.emissive = new pc.Color(1, 0, 0);
          redLightMat.emissiveIntensity = 0.6;
          redLightMat.update();
          lightBar.render.meshInstances.forEach((mi: any) => mi.material = redLightMat);
          vehicle.addChild(lightBar);

          // Red cross on sides
          for (const side of [-1, 1]) {
            const crossH = new pc.Entity(`cross_h_${side}`);
            crossH.addComponent('render', { type: 'box' });
            crossH.setLocalScale(dims.length * 0.15 * s, 0.02 * s, dims.bodyHeight * 0.25 * s);
            crossH.setLocalPosition(-dims.length * 0.1 * s, (dims.wheelRadius + dims.bodyHeight * 0.5) * s, side * dims.width * 0.52 * s);
            crossH.setLocalEulerAngles(90, 0, 0);
            crossH.render.meshInstances.forEach((mi: any) => mi.material = redLightMat);
            vehicle.addChild(crossH);

            const crossV = new pc.Entity(`cross_v_${side}`);
            crossV.addComponent('render', { type: 'box' });
            crossV.setLocalScale(dims.length * 0.05 * s, 0.02 * s, dims.bodyHeight * 0.4 * s);
            crossV.setLocalPosition(-dims.length * 0.1 * s, (dims.wheelRadius + dims.bodyHeight * 0.5) * s, side * dims.width * 0.52 * s);
            crossV.setLocalEulerAngles(90, 0, 0);
            crossV.render.meshInstances.forEach((mi: any) => mi.material = redLightMat);
            vehicle.addChild(crossV);
          }
        }
        break;
      }

      case 'plane': {
        // Fuselage
        const fuselage = new pc.Entity('fuselage');
        fuselage.addComponent('render', { type: 'capsule' });
        fuselage.setLocalScale(dims.width * s, dims.length * s, dims.width * s);
        fuselage.setLocalPosition(0, dims.height * 0.5 * s, 0);
        fuselage.setLocalEulerAngles(0, 0, 90);
        fuselage.render.meshInstances.forEach((mi: any) => mi.material = bodyMat);
        vehicle.addChild(fuselage);

        // Wings
        const wingMat = new pc.StandardMaterial();
        wingMat.diffuse = parseColor(pc, bodyColor);
        wingMat.metalness = 0.7;
        wingMat.gloss = 0.85;
        wingMat.useMetalness = true;
        wingMat.update();

        for (const side of [-1, 1]) {
          const wing = new pc.Entity(`wing_${side > 0 ? 'left' : 'right'}`);
          wing.addComponent('render', { type: 'box' });
          wing.setLocalScale(dims.length * 0.15 * s, 0.08 * s, dims.wingspan * 0.5 * s);
          wing.setLocalPosition(0, dims.height * 0.45 * s, side * dims.wingspan * 0.3 * s);
          wing.render.meshInstances.forEach((mi: any) => mi.material = wingMat);
          vehicle.addChild(wing);

          // Engine under wing
          const engine = new pc.Entity(`engine_${side > 0 ? 'left' : 'right'}`);
          engine.addComponent('render', { type: 'cylinder' });
          engine.setLocalScale(0.4 * s, 0.6 * s, 0.4 * s);
          engine.setLocalPosition(dims.length * 0.05 * s, dims.height * 0.3 * s, side * dims.wingspan * 0.25 * s);
          engine.setLocalEulerAngles(0, 0, 90);
          const engineMat = new pc.StandardMaterial();
          engineMat.diffuse = new pc.Color(0.3, 0.3, 0.35);
          engineMat.metalness = 0.8;
          engineMat.gloss = 0.7;
          engineMat.useMetalness = true;
          engineMat.update();
          engine.render.meshInstances.forEach((mi: any) => mi.material = engineMat);
          vehicle.addChild(engine);
        }

        // Tail fin (vertical)
        const tailFin = new pc.Entity('tail_fin');
        tailFin.addComponent('render', { type: 'box' });
        tailFin.setLocalScale(dims.length * 0.12 * s, dims.height * 0.4 * s, 0.05 * s);
        tailFin.setLocalPosition(-dims.length * 0.42 * s, dims.height * 0.7 * s, 0);
        tailFin.render.meshInstances.forEach((mi: any) => mi.material = wingMat);
        vehicle.addChild(tailFin);

        // Tail wings (horizontal)
        for (const side of [-1, 1]) {
          const tailWing = new pc.Entity(`tail_wing_${side > 0 ? 'left' : 'right'}`);
          tailWing.addComponent('render', { type: 'box' });
          tailWing.setLocalScale(dims.length * 0.1 * s, 0.04 * s, dims.wingspan * 0.15 * s);
          tailWing.setLocalPosition(-dims.length * 0.42 * s, dims.height * 0.5 * s, side * dims.wingspan * 0.1 * s);
          tailWing.render.meshInstances.forEach((mi: any) => mi.material = wingMat);
          vehicle.addChild(tailWing);
        }

        // Cockpit windows
        const cockpit = new pc.Entity('cockpit');
        cockpit.addComponent('render', { type: 'box' });
        cockpit.setLocalScale(dims.length * 0.08 * s, dims.width * 0.5 * s, dims.width * 0.8 * s);
        cockpit.setLocalPosition(dims.length * 0.35 * s, dims.height * 0.55 * s, 0);
        cockpit.setLocalEulerAngles(0, 0, 15);
        cockpit.render.meshInstances.forEach((mi: any) => mi.material = glassMat);
        vehicle.addChild(cockpit);

        // Landing gear (simplified)
        const gearMat = new pc.StandardMaterial();
        gearMat.diffuse = new pc.Color(0.2, 0.2, 0.2);
        gearMat.metalness = 0.6;
        gearMat.gloss = 0.5;
        gearMat.useMetalness = true;
        gearMat.update();

        // Front gear
        const frontGear = new pc.Entity('front_gear');
        frontGear.addComponent('render', { type: 'cylinder' });
        frontGear.setLocalScale(0.1 * s, 0.4 * s, 0.1 * s);
        frontGear.setLocalPosition(dims.length * 0.35 * s, dims.height * 0.1 * s, 0);
        frontGear.render.meshInstances.forEach((mi: any) => mi.material = gearMat);
        vehicle.addChild(frontGear);

        // Rear gear
        for (const side of [-1, 1]) {
          const rearGear = new pc.Entity(`rear_gear_${side}`);
          rearGear.addComponent('render', { type: 'cylinder' });
          rearGear.setLocalScale(0.15 * s, 0.5 * s, 0.15 * s);
          rearGear.setLocalPosition(-dims.length * 0.1 * s, dims.height * 0.1 * s, side * dims.width * 0.4 * s);
          rearGear.render.meshInstances.forEach((mi: any) => mi.material = gearMat);
          vehicle.addChild(rearGear);
        }
        break;
      }

      case 'helicopter': {
        // Body (rounded)
        const body = new pc.Entity('body');
        body.addComponent('render', { type: 'capsule' });
        body.setLocalScale(dims.width * s, dims.length * 0.6 * s, dims.width * 0.8 * s);
        body.setLocalPosition(0, dims.height * 0.4 * s, 0);
        body.setLocalEulerAngles(0, 0, 90);
        body.render.meshInstances.forEach((mi: any) => mi.material = bodyMat);
        vehicle.addChild(body);

        // Cockpit (glass bubble)
        const cockpit = new pc.Entity('cockpit');
        cockpit.addComponent('render', { type: 'sphere' });
        cockpit.setLocalScale(dims.width * 0.9 * s, dims.width * 0.7 * s, dims.width * 0.8 * s);
        cockpit.setLocalPosition(dims.length * 0.2 * s, dims.height * 0.45 * s, 0);
        cockpit.render.meshInstances.forEach((mi: any) => mi.material = glassMat);
        vehicle.addChild(cockpit);

        // Tail boom
        const tail = new pc.Entity('tail_boom');
        tail.addComponent('render', { type: 'cylinder' });
        tail.setLocalScale(dims.width * 0.2 * s, dims.length * 0.5 * s, dims.width * 0.2 * s);
        tail.setLocalPosition(-dims.length * 0.45 * s, dims.height * 0.4 * s, 0);
        tail.setLocalEulerAngles(0, 0, 85);
        tail.render.meshInstances.forEach((mi: any) => mi.material = bodyMat);
        vehicle.addChild(tail);

        // Tail fin
        const tailFin = new pc.Entity('tail_fin');
        tailFin.addComponent('render', { type: 'box' });
        tailFin.setLocalScale(dims.length * 0.08 * s, dims.height * 0.25 * s, 0.05 * s);
        tailFin.setLocalPosition(-dims.length * 0.65 * s, dims.height * 0.5 * s, 0);
        tailFin.render.meshInstances.forEach((mi: any) => mi.material = bodyMat);
        vehicle.addChild(tailFin);

        // Main rotor hub
        const rotorHub = new pc.Entity('rotor_hub');
        rotorHub.addComponent('render', { type: 'cylinder' });
        rotorHub.setLocalScale(0.3 * s, 0.15 * s, 0.3 * s);
        rotorHub.setLocalPosition(0, dims.height * 0.75 * s, 0);
        rotorHub.render.meshInstances.forEach((mi: any) => mi.material = bodyMat);
        vehicle.addChild(rotorHub);

        // Main rotor blades
        const bladeMat = new pc.StandardMaterial();
        bladeMat.diffuse = new pc.Color(0.2, 0.2, 0.2);
        bladeMat.metalness = 0.5;
        bladeMat.gloss = 0.6;
        bladeMat.useMetalness = true;
        bladeMat.update();

        for (let i = 0; i < 4; i++) {
          const blade = new pc.Entity(`rotor_blade_${i}`);
          blade.addComponent('render', { type: 'box' });
          blade.setLocalScale(dims.rotorRadius * s, 0.02 * s, 0.15 * s);
          blade.setLocalPosition(0, dims.height * 0.78 * s, 0);
          blade.setLocalEulerAngles(0, i * 90, 0);
          blade.render.meshInstances.forEach((mi: any) => mi.material = bladeMat);
          vehicle.addChild(blade);
        }

        // Tail rotor
        const tailRotorHub = new pc.Entity('tail_rotor_hub');
        tailRotorHub.addComponent('render', { type: 'cylinder' });
        tailRotorHub.setLocalScale(0.1 * s, 0.05 * s, 0.1 * s);
        tailRotorHub.setLocalPosition(-dims.length * 0.65 * s, dims.height * 0.4 * s, dims.width * 0.15 * s);
        tailRotorHub.setLocalEulerAngles(90, 0, 0);
        tailRotorHub.render.meshInstances.forEach((mi: any) => mi.material = bodyMat);
        vehicle.addChild(tailRotorHub);

        for (let i = 0; i < 2; i++) {
          const tailBlade = new pc.Entity(`tail_blade_${i}`);
          tailBlade.addComponent('render', { type: 'box' });
          tailBlade.setLocalScale(0.5 * s, 0.02 * s, 0.08 * s);
          tailBlade.setLocalPosition(-dims.length * 0.65 * s, dims.height * 0.4 * s, dims.width * 0.18 * s);
          tailBlade.setLocalEulerAngles(90, i * 90, 0);
          tailBlade.render.meshInstances.forEach((mi: any) => mi.material = bladeMat);
          vehicle.addChild(tailBlade);
        }

        // Skids
        const skidMat = new pc.StandardMaterial();
        skidMat.diffuse = new pc.Color(0.15, 0.15, 0.15);
        skidMat.metalness = 0.7;
        skidMat.gloss = 0.5;
        skidMat.useMetalness = true;
        skidMat.update();

        for (const side of [-1, 1]) {
          const skid = new pc.Entity(`skid_${side > 0 ? 'left' : 'right'}`);
          skid.addComponent('render', { type: 'cylinder' });
          skid.setLocalScale(0.08 * s, dims.length * 0.5 * s, 0.08 * s);
          skid.setLocalPosition(0, dims.height * 0.08 * s, side * dims.width * 0.4 * s);
          skid.setLocalEulerAngles(0, 0, 90);
          skid.render.meshInstances.forEach((mi: any) => mi.material = skidMat);
          vehicle.addChild(skid);

          // Skid struts
          const frontStrut = new pc.Entity(`strut_front_${side}`);
          frontStrut.addComponent('render', { type: 'cylinder' });
          frontStrut.setLocalScale(0.04 * s, dims.height * 0.25 * s, 0.04 * s);
          frontStrut.setLocalPosition(dims.length * 0.15 * s, dims.height * 0.2 * s, side * dims.width * 0.35 * s);
          frontStrut.render.meshInstances.forEach((mi: any) => mi.material = skidMat);
          vehicle.addChild(frontStrut);

          const rearStrut = new pc.Entity(`strut_rear_${side}`);
          rearStrut.addComponent('render', { type: 'cylinder' });
          rearStrut.setLocalScale(0.04 * s, dims.height * 0.25 * s, 0.04 * s);
          rearStrut.setLocalPosition(-dims.length * 0.15 * s, dims.height * 0.2 * s, side * dims.width * 0.35 * s);
          rearStrut.render.meshInstances.forEach((mi: any) => mi.material = skidMat);
          vehicle.addChild(rearStrut);
        }
        break;
      }
    }

    // Add to scene
    app.root.addChild(vehicle);

    // Track for undo
    trackAction({
      type: 'create',
      entityId: vehicle.getGuid(),
      entityName: params.name || 'vehicle'
    });

    // Fire materialize event
    app.fire('hon:entity-materialize', { entity: vehicle, name: vehicle.name });

    return {
      success: true,
      message: `Created ${style} "${params.name}" with detailed body, wheels, windows, and lights`,
      data: { id: vehicle.getGuid(), name: params.name, style }
    };
  }
};

// Helper: Get default color for vehicle style
function getDefaultVehicleColor(style: string): string {
  switch (style) {
    case 'taxi': return '#f5c542';
    case 'police': return '#1a1a2e';
    case 'ambulance': return '#ffffff';
    case 'bus': return '#c9a227';
    case 'truck': return '#2d4a6f';
    case 'sports_car': return '#cc0000';
    case 'plane': return '#e8e8e8';
    case 'helicopter': return '#3d5c5c';
    default: return '#4a4a5a';
  }
}

// Helper: Get vehicle dimensions based on style
function getVehicleDimensions(style: string): any {
  switch (style) {
    case 'car':
    case 'taxi':
    case 'police':
      return { length: 4.5, width: 1.8, bodyHeight: 0.8, cabinHeight: 0.7, wheelRadius: 0.35 };
    case 'sports_car':
      return { length: 4.2, width: 2.0, bodyHeight: 0.5, cabinHeight: 0.5, wheelRadius: 0.38 };
    case 'truck':
      return { length: 5.5, width: 2.0, cabLength: 1.8, cabHeight: 1.6, bedLength: 2.8, bedHeight: 0.6, wheelRadius: 0.45 };
    case 'bus':
      return { length: 12, width: 2.5, bodyHeight: 2.8, wheelRadius: 0.5 };
    case 'van':
    case 'ambulance':
      return { length: 5.5, width: 2.0, bodyHeight: 2.2, wheelRadius: 0.4 };
    case 'plane':
      return { length: 35, width: 3.5, height: 4, wingspan: 30 };
    case 'helicopter':
      return { length: 12, width: 2.5, height: 3.5, rotorRadius: 6 };
    default:
      return { length: 4.5, width: 1.8, bodyHeight: 0.8, cabinHeight: 0.7, wheelRadius: 0.35 };
  }
}

/**
 * Create a detailed streetlight
 */
const createStreetLight: MCPTool = {
  name: 'create_street_light',
  description: 'Create a detailed streetlight with pole, arm, fixture, and actual light source.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name for the streetlight'
      },
      position: {
        type: 'object',
        description: 'Position { x, y, z }'
      },
      style: {
        type: 'string',
        description: 'Streetlight style',
        enum: ['modern', 'classic', 'highway', 'park', 'industrial']
      },
      height: {
        type: 'number',
        description: 'Pole height in meters (default: 6)'
      },
      lightColor: {
        type: 'string',
        description: 'Light color (default: warm white)'
      },
      intensity: {
        type: 'number',
        description: 'Light intensity (default: 1)'
      },
      on: {
        type: 'boolean',
        description: 'Whether the light is on (default: true)'
      }
    },
    required: ['name']
  },
  handler: (params, app, camera): MCPToolResult => {
    const pc = (window as any).pc;
    if (!pc) {
      return { success: false, error: 'PlayCanvas not loaded' };
    }

    const style = params.style || 'modern';
    const height = params.height || 6;
    const lightOn = params.on !== false;
    const intensity = params.intensity || 1;
    const lightColorHex = params.lightColor || '#fff5e0';

    const streetlight = new pc.Entity(params.name || 'streetlight');

    // Position
    if (params.position) {
      streetlight.setPosition(params.position.x || 0, params.position.y || 0, params.position.z || 0);
    } else if (camera) {
      const forward = camera.forward.clone();
      const pos = camera.getPosition().clone().add(forward.mulScalar(5));
      streetlight.setPosition(pos.x, 0, pos.z);
    }

    // Materials
    const poleMat = new pc.StandardMaterial();
    poleMat.diffuse = style === 'classic' ? new pc.Color(0.15, 0.12, 0.08) : new pc.Color(0.25, 0.25, 0.27);
    poleMat.metalness = 0.8;
    poleMat.gloss = 0.6;
    poleMat.useMetalness = true;
    poleMat.update();

    const fixtureMat = new pc.StandardMaterial();
    fixtureMat.diffuse = new pc.Color(0.2, 0.2, 0.22);
    fixtureMat.metalness = 0.7;
    fixtureMat.gloss = 0.5;
    fixtureMat.useMetalness = true;
    fixtureMat.update();

    const glassMat = new pc.StandardMaterial();
    const glassColor = parseColor(pc, lightColorHex);
    glassMat.diffuse = glassColor;
    if (lightOn) {
      glassMat.emissive = glassColor;
      glassMat.emissiveIntensity = 0.8;
    }
    glassMat.opacity = 0.7;
    glassMat.blendType = pc.BLEND_NORMAL;
    glassMat.update();

    switch (style) {
      case 'modern': {
        // Tall thin pole
        const pole = new pc.Entity('pole');
        pole.addComponent('render', { type: 'cylinder' });
        pole.setLocalScale(0.12, height, 0.12);
        pole.setLocalPosition(0, height / 2, 0);
        pole.render.meshInstances.forEach((mi: any) => mi.material = poleMat);
        streetlight.addChild(pole);

        // Curved arm (simplified with angled box)
        const arm = new pc.Entity('arm');
        arm.addComponent('render', { type: 'box' });
        arm.setLocalScale(1.5, 0.08, 0.08);
        arm.setLocalPosition(0.7, height - 0.3, 0);
        arm.setLocalEulerAngles(0, 0, -15);
        arm.render.meshInstances.forEach((mi: any) => mi.material = poleMat);
        streetlight.addChild(arm);

        // Fixture housing
        const fixture = new pc.Entity('fixture');
        fixture.addComponent('render', { type: 'box' });
        fixture.setLocalScale(0.6, 0.12, 0.25);
        fixture.setLocalPosition(1.3, height - 0.5, 0);
        fixture.render.meshInstances.forEach((mi: any) => mi.material = fixtureMat);
        streetlight.addChild(fixture);

        // Light diffuser
        const diffuser = new pc.Entity('diffuser');
        diffuser.addComponent('render', { type: 'box' });
        diffuser.setLocalScale(0.5, 0.03, 0.2);
        diffuser.setLocalPosition(1.3, height - 0.58, 0);
        diffuser.render.meshInstances.forEach((mi: any) => mi.material = glassMat);
        streetlight.addChild(diffuser);

        // Actual light source
        if (lightOn) {
          const light = new pc.Entity('light_source');
          light.addComponent('light', {
            type: 'spot',
            color: glassColor,
            intensity: intensity * 2,
            range: 15,
            innerConeAngle: 40,
            outerConeAngle: 60,
            castShadows: false
          });
          light.setLocalPosition(1.3, height - 0.6, 0);
          light.setLocalEulerAngles(90, 0, 0);
          streetlight.addChild(light);
        }
        break;
      }

      case 'classic': {
        // Ornate pole (tapered)
        const poleBase = new pc.Entity('pole_base');
        poleBase.addComponent('render', { type: 'cylinder' });
        poleBase.setLocalScale(0.25, 0.4, 0.25);
        poleBase.setLocalPosition(0, 0.2, 0);
        poleBase.render.meshInstances.forEach((mi: any) => mi.material = poleMat);
        streetlight.addChild(poleBase);

        const pole = new pc.Entity('pole');
        pole.addComponent('render', { type: 'cylinder' });
        pole.setLocalScale(0.1, height - 0.4, 0.1);
        pole.setLocalPosition(0, height / 2, 0);
        pole.render.meshInstances.forEach((mi: any) => mi.material = poleMat);
        streetlight.addChild(pole);

        // Decorative top
        const top = new pc.Entity('pole_top');
        top.addComponent('render', { type: 'sphere' });
        top.setLocalScale(0.15, 0.1, 0.15);
        top.setLocalPosition(0, height - 0.15, 0);
        top.render.meshInstances.forEach((mi: any) => mi.material = poleMat);
        streetlight.addChild(top);

        // Lantern housing
        const lanternBase = new pc.Entity('lantern_base');
        lanternBase.addComponent('render', { type: 'cylinder' });
        lanternBase.setLocalScale(0.3, 0.05, 0.3);
        lanternBase.setLocalPosition(0, height, 0);
        lanternBase.render.meshInstances.forEach((mi: any) => mi.material = poleMat);
        streetlight.addChild(lanternBase);

        // Glass lantern
        const lantern = new pc.Entity('lantern');
        lantern.addComponent('render', { type: 'box' });
        lantern.setLocalScale(0.25, 0.4, 0.25);
        lantern.setLocalPosition(0, height + 0.22, 0);
        lantern.render.meshInstances.forEach((mi: any) => mi.material = glassMat);
        streetlight.addChild(lantern);

        // Lantern top
        const lanternTop = new pc.Entity('lantern_top');
        lanternTop.addComponent('render', { type: 'cone' });
        lanternTop.setLocalScale(0.35, 0.2, 0.35);
        lanternTop.setLocalPosition(0, height + 0.5, 0);
        lanternTop.render.meshInstances.forEach((mi: any) => mi.material = poleMat);
        streetlight.addChild(lanternTop);

        // Light source
        if (lightOn) {
          const light = new pc.Entity('light_source');
          light.addComponent('light', {
            type: 'point',
            color: glassColor,
            intensity: intensity * 1.5,
            range: 12,
            castShadows: false
          });
          light.setLocalPosition(0, height + 0.2, 0);
          streetlight.addChild(light);
        }
        break;
      }

      case 'highway': {
        // Tall pole
        const pole = new pc.Entity('pole');
        pole.addComponent('render', { type: 'cylinder' });
        pole.setLocalScale(0.2, height, 0.2);
        pole.setLocalPosition(0, height / 2, 0);
        pole.render.meshInstances.forEach((mi: any) => mi.material = poleMat);
        streetlight.addChild(pole);

        // Long horizontal arm
        const arm = new pc.Entity('arm');
        arm.addComponent('render', { type: 'box' });
        arm.setLocalScale(4, 0.15, 0.15);
        arm.setLocalPosition(2, height - 0.1, 0);
        arm.render.meshInstances.forEach((mi: any) => mi.material = poleMat);
        streetlight.addChild(arm);

        // Multiple fixtures along arm
        for (let i = 0; i < 3; i++) {
          const fixture = new pc.Entity(`fixture_${i}`);
          fixture.addComponent('render', { type: 'box' });
          fixture.setLocalScale(0.5, 0.1, 0.3);
          fixture.setLocalPosition(1 + i * 1.2, height - 0.3, 0);
          fixture.render.meshInstances.forEach((mi: any) => mi.material = fixtureMat);
          streetlight.addChild(fixture);

          const diffuser = new pc.Entity(`diffuser_${i}`);
          diffuser.addComponent('render', { type: 'box' });
          diffuser.setLocalScale(0.4, 0.02, 0.25);
          diffuser.setLocalPosition(1 + i * 1.2, height - 0.36, 0);
          diffuser.render.meshInstances.forEach((mi: any) => mi.material = glassMat);
          streetlight.addChild(diffuser);

          if (lightOn) {
            const light = new pc.Entity(`light_${i}`);
            light.addComponent('light', {
              type: 'spot',
              color: glassColor,
              intensity: intensity * 2.5,
              range: 20,
              innerConeAngle: 50,
              outerConeAngle: 70,
              castShadows: false
            });
            light.setLocalPosition(1 + i * 1.2, height - 0.4, 0);
            light.setLocalEulerAngles(90, 0, 0);
            streetlight.addChild(light);
          }
        }
        break;
      }

      case 'park': {
        // Short decorative pole
        const pole = new pc.Entity('pole');
        pole.addComponent('render', { type: 'cylinder' });
        pole.setLocalScale(0.08, height, 0.08);
        pole.setLocalPosition(0, height / 2, 0);
        pole.render.meshInstances.forEach((mi: any) => mi.material = poleMat);
        streetlight.addChild(pole);

        // Globe fixture
        const globe = new pc.Entity('globe');
        globe.addComponent('render', { type: 'sphere' });
        globe.setLocalScale(0.35, 0.35, 0.35);
        globe.setLocalPosition(0, height + 0.15, 0);
        globe.render.meshInstances.forEach((mi: any) => mi.material = glassMat);
        streetlight.addChild(globe);

        // Decorative cap
        const cap = new pc.Entity('cap');
        cap.addComponent('render', { type: 'cone' });
        cap.setLocalScale(0.15, 0.1, 0.15);
        cap.setLocalPosition(0, height + 0.38, 0);
        cap.render.meshInstances.forEach((mi: any) => mi.material = poleMat);
        streetlight.addChild(cap);

        if (lightOn) {
          const light = new pc.Entity('light_source');
          light.addComponent('light', {
            type: 'point',
            color: glassColor,
            intensity: intensity * 1.2,
            range: 10,
            castShadows: false
          });
          light.setLocalPosition(0, height + 0.15, 0);
          streetlight.addChild(light);
        }
        break;
      }

      case 'industrial': {
        // Heavy duty pole
        const pole = new pc.Entity('pole');
        pole.addComponent('render', { type: 'box' });
        pole.setLocalScale(0.2, height, 0.2);
        pole.setLocalPosition(0, height / 2, 0);
        pole.render.meshInstances.forEach((mi: any) => mi.material = poleMat);
        streetlight.addChild(pole);

        // Angled bracket
        const bracket = new pc.Entity('bracket');
        bracket.addComponent('render', { type: 'box' });
        bracket.setLocalScale(0.8, 0.1, 0.1);
        bracket.setLocalPosition(0.35, height - 0.2, 0);
        bracket.setLocalEulerAngles(0, 0, -30);
        bracket.render.meshInstances.forEach((mi: any) => mi.material = poleMat);
        streetlight.addChild(bracket);

        // Large fixture
        const fixture = new pc.Entity('fixture');
        fixture.addComponent('render', { type: 'box' });
        fixture.setLocalScale(0.7, 0.2, 0.35);
        fixture.setLocalPosition(0.7, height - 0.5, 0);
        fixture.render.meshInstances.forEach((mi: any) => mi.material = fixtureMat);
        streetlight.addChild(fixture);

        // Cage/grill
        const cage = new pc.Entity('cage');
        cage.addComponent('render', { type: 'box' });
        cage.setLocalScale(0.6, 0.05, 0.3);
        cage.setLocalPosition(0.7, height - 0.63, 0);
        cage.render.meshInstances.forEach((mi: any) => mi.material = poleMat);
        streetlight.addChild(cage);

        // Glass
        const glass = new pc.Entity('glass');
        glass.addComponent('render', { type: 'box' });
        glass.setLocalScale(0.55, 0.02, 0.25);
        glass.setLocalPosition(0.7, height - 0.6, 0);
        glass.render.meshInstances.forEach((mi: any) => mi.material = glassMat);
        streetlight.addChild(glass);

        if (lightOn) {
          const light = new pc.Entity('light_source');
          light.addComponent('light', {
            type: 'spot',
            color: glassColor,
            intensity: intensity * 3,
            range: 18,
            innerConeAngle: 45,
            outerConeAngle: 65,
            castShadows: false
          });
          light.setLocalPosition(0.7, height - 0.65, 0);
          light.setLocalEulerAngles(90, 0, 0);
          streetlight.addChild(light);
        }
        break;
      }
    }

    // Add to scene
    app.root.addChild(streetlight);

    // Track for undo
    trackAction({
      type: 'create',
      entityId: streetlight.getGuid(),
      entityName: params.name || 'streetlight'
    });

    // Fire materialize event
    app.fire('hon:entity-materialize', { entity: streetlight, name: streetlight.name });

    return {
      success: true,
      message: `Created ${style} streetlight "${params.name}" (${height}m tall)${lightOn ? ' with light on' : ''}`,
      data: { id: streetlight.getGuid(), name: params.name, style, height, lightOn }
    };
  }
};

/**
 * Undo the last action
 */
const undo: MCPTool = {
  name: 'undo',
  description: 'Undo the last action (entity creation). Removes the most recently created object from the scene.',
  parameters: {
    type: 'object',
    properties: {
      count: {
        type: 'number',
        description: 'Number of actions to undo (default: 1)',
        default: 1
      }
    }
  },
  handler: (params, app): MCPToolResult => {
    const count = Math.min(params.count || 1, 10); // Max 10 at once
    const undone: string[] = [];

    for (let i = 0; i < count; i++) {
      const action = popLastAction();
      if (!action) {
        break;
      }

      if (action.type === 'create') {
        // Find and destroy the entity
        const entity = app.root.findByGuid(action.entityId);
        if (entity) {
          entity.destroy();
          undone.push(action.entityName);
        }
      }
      // Future: handle 'modify' and 'delete' action types
    }

    if (undone.length === 0) {
      return {
        success: false,
        error: 'Nothing to undo'
      };
    }

    return {
      success: true,
      message: `Undid ${undone.length} action(s): removed ${undone.join(', ')}`,
      data: { undone, remaining: actionHistory.length }
    };
  }
};

export const entityTools: MCPTool[] = [
  createEntity,
  createCharacter,
  modifyEntity,
  deleteEntity,
  duplicateEntity,
  reparentEntity,
  createEntities,
  createComposite,
  setMaterial,
  createTree,
  createRock,
  createBuilding,
  createVehicle,
  createStreetLight,
  undo
];

// Export helper for use in other modules
export { findEntity, parseColor };

