/**
 * Component Tools for PlayCanvas MCP
 * 
 * Tools for adding physics, animations, scripts, and other components to entities.
 */

import { compileSceneCode } from '../../../config/sceneCodeExecution';
import type { MCPTool, MCPToolResult } from '../index';
import { findEntity } from './entities';

/**
 * Add physics (rigidbody + collision) to an entity
 */
const addPhysics: MCPTool = {
  name: 'add_physics',
  description: 'Add physics simulation to an entity so it can fall, collide, and be affected by forces',
  parameters: {
    type: 'object',
    properties: {
      target: {
        type: 'string',
        description: 'Entity name or ID'
      },
      type: {
        type: 'string',
        description: 'Physics body type',
        enum: ['dynamic', 'static', 'kinematic'],
        default: 'dynamic'
      },
      mass: {
        type: 'number',
        description: 'Mass in kg (only for dynamic bodies)',
        default: 1
      },
      friction: {
        type: 'number',
        description: 'Friction coefficient (0-1)',
        default: 0.5
      },
      restitution: {
        type: 'number',
        description: 'Bounciness (0-1)',
        default: 0.3
      },
      collisionShape: {
        type: 'string',
        description: 'Shape for collision detection',
        enum: ['box', 'sphere', 'capsule', 'cylinder', 'mesh'],
        default: 'box'
      }
    },
    required: ['target']
  },
  handler: (params, app): MCPToolResult => {
    const entity = findEntity(app, params.target);
    
    if (!entity) {
      return { success: false, error: `Could not find entity: ${params.target}` };
    }
    
    // Add collision component
    if (!entity.collision) {
      entity.addComponent('collision', {
        type: params.collisionShape || 'box'
      });
    }
    
    // Add rigidbody component
    if (!entity.rigidbody) {
      entity.addComponent('rigidbody', {
        type: params.type || 'dynamic',
        mass: params.mass ?? 1,
        friction: params.friction ?? 0.5,
        restitution: params.restitution ?? 0.3
      });
    }
    
    return {
      success: true,
      message: `Added ${params.type || 'dynamic'} physics to "${entity.name}"`
    };
  }
};

/**
 * Add animation to an entity
 */
const addAnimation: MCPTool = {
  name: 'add_animation',
  description: 'Add a continuous animation to an entity (spin, bob, orbit, etc.)',
  parameters: {
    type: 'object',
    properties: {
      target: {
        type: 'string',
        description: 'Entity name or ID'
      },
      type: {
        type: 'string',
        description: 'Type of animation',
        enum: ['spin', 'bob', 'orbit', 'pulse', 'sway']
      },
      speed: {
        type: 'number',
        description: 'Animation speed multiplier',
        default: 1
      },
      axis: {
        type: 'string',
        description: 'Axis for rotation/movement',
        enum: ['x', 'y', 'z'],
        default: 'y'
      },
      amplitude: {
        type: 'number',
        description: 'Size of movement (for bob, pulse, sway)',
        default: 1
      }
    },
    required: ['target', 'type']
  },
  handler: (params, app): MCPToolResult => {
    const entity = findEntity(app, params.target);
    
    if (!entity) {
      return { success: false, error: `Could not find entity: ${params.target}` };
    }
    
    const speed = params.speed || 1;
    const amplitude = params.amplitude || 1;
    const axis = params.axis || 'y';
    
    // Store original position/scale for animations
    const originalPos = entity.getPosition().clone();
    const originalScale = entity.getLocalScale().clone();
    let time = 0;
    
    // Create animation update function
    const animationHandler = (dt: number) => {
      time += dt * speed;
      
      switch (params.type) {
        case 'spin':
          const rotSpeed = 90 * speed; // degrees per second
          if (axis === 'x') entity.rotate(rotSpeed * dt, 0, 0);
          else if (axis === 'z') entity.rotate(0, 0, rotSpeed * dt);
          else entity.rotate(0, rotSpeed * dt, 0);
          break;
          
        case 'bob':
          const bobOffset = Math.sin(time * 2) * amplitude;
          if (axis === 'x') entity.setPosition(originalPos.x + bobOffset, originalPos.y, originalPos.z);
          else if (axis === 'z') entity.setPosition(originalPos.x, originalPos.y, originalPos.z + bobOffset);
          else entity.setPosition(originalPos.x, originalPos.y + bobOffset, originalPos.z);
          break;
          
        case 'orbit':
          const orbitRadius = amplitude * 2;
          const orbitX = originalPos.x + Math.cos(time) * orbitRadius;
          const orbitZ = originalPos.z + Math.sin(time) * orbitRadius;
          entity.setPosition(orbitX, originalPos.y, orbitZ);
          break;
          
        case 'pulse':
          const pulseScale = 1 + Math.sin(time * 3) * amplitude * 0.2;
          entity.setLocalScale(
            originalScale.x * pulseScale,
            originalScale.y * pulseScale,
            originalScale.z * pulseScale
          );
          break;
          
        case 'sway':
          const swayAngle = Math.sin(time * 2) * amplitude * 15;
          if (axis === 'x') entity.setEulerAngles(swayAngle, 0, 0);
          else if (axis === 'y') entity.setEulerAngles(0, swayAngle, 0);
          else entity.setEulerAngles(0, 0, swayAngle);
          break;
      }
    };
    
    // Store handler reference for potential removal
    entity._mcpAnimationHandler = animationHandler;
    app.on('update', animationHandler);
    
    return {
      success: true,
      message: `Added ${params.type} animation to "${entity.name}"`
    };
  }
};

/**
 * Remove animation from an entity
 */
const removeAnimation: MCPTool = {
  name: 'remove_animation',
  description: 'Stop and remove animation from an entity',
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
    const entity = findEntity(app, params.target);
    
    if (!entity) {
      return { success: false, error: `Could not find entity: ${params.target}` };
    }
    
    if (entity._mcpAnimationHandler) {
      app.off('update', entity._mcpAnimationHandler);
      delete entity._mcpAnimationHandler;
      return { success: true, message: `Removed animation from "${entity.name}"` };
    }
    
    return { success: false, error: `No animation found on "${entity.name}"` };
  }
};

/**
 * Add a light component to an entity
 */
const addLight: MCPTool = {
  name: 'add_light',
  description: 'Add a light source to an entity',
  parameters: {
    type: 'object',
    properties: {
      target: {
        type: 'string',
        description: 'Entity name or ID (or "new" to create a new light entity)'
      },
      type: {
        type: 'string',
        description: 'Type of light',
        enum: ['point', 'spot', 'directional'],
        default: 'point'
      },
      color: {
        type: 'string',
        description: 'Light color'
      },
      intensity: {
        type: 'number',
        description: 'Light intensity (0-10)',
        default: 1
      },
      range: {
        type: 'number',
        description: 'Light range (for point/spot lights)',
        default: 10
      },
      castShadows: {
        type: 'boolean',
        description: 'Whether the light casts shadows',
        default: false
      }
    },
    required: ['type']
  },
  handler: (params, app, camera): MCPToolResult => {
    const pc = (window as any).pc;
    
    let entity;
    if (!params.target || params.target === 'new') {
      // Create new light entity
      entity = new pc.Entity(`${params.type}_light`);
      
      // Position in front of camera
      if (camera) {
        const forward = camera.forward.clone();
        const pos = camera.getPosition().clone().add(forward.mulScalar(5));
        entity.setPosition(pos.x, pos.y + 2, pos.z);
      }
      
      app.root.addChild(entity);
    } else {
      entity = findEntity(app, params.target);
      if (!entity) {
        return { success: false, error: `Could not find entity: ${params.target}` };
      }
    }
    
    // Parse color
    let color = new pc.Color(1, 1, 1);
    if (params.color) {
      const namedColors: Record<string, [number, number, number]> = {
        red: [1, 0, 0], orange: [1, 0.5, 0], yellow: [1, 1, 0],
        green: [0, 1, 0], blue: [0, 0, 1], purple: [0.5, 0, 0.5],
        white: [1, 1, 1], warm: [1, 0.9, 0.7], cool: [0.7, 0.9, 1]
      };
      if (namedColors[params.color.toLowerCase()]) {
        const [r, g, b] = namedColors[params.color.toLowerCase()];
        color = new pc.Color(r, g, b);
      }
    }
    
    // Add light component
    entity.addComponent('light', {
      type: params.type || 'point',
      color: color,
      intensity: params.intensity ?? 1,
      range: params.range ?? 10,
      castShadows: params.castShadows ?? false
    });
    
    return {
      success: true,
      message: `Added ${params.type || 'point'} light to "${entity.name}"`,
      data: { id: entity.getGuid(), name: entity.name }
    };
  }
};

/**
 * Apply force to a physics-enabled entity
 */
const applyForce: MCPTool = {
  name: 'apply_force',
  description: 'Apply a force or impulse to a physics-enabled entity',
  parameters: {
    type: 'object',
    properties: {
      target: {
        type: 'string',
        description: 'Entity name or ID'
      },
      force: {
        type: 'object',
        description: 'Force vector { x, y, z }'
      },
      impulse: {
        type: 'boolean',
        description: 'Apply as impulse (instant) vs continuous force',
        default: true
      }
    },
    required: ['target', 'force']
  },
  handler: (params, app): MCPToolResult => {
    const pc = (window as any).pc;
    const entity = findEntity(app, params.target);
    
    if (!entity) {
      return { success: false, error: `Could not find entity: ${params.target}` };
    }
    
    if (!entity.rigidbody) {
      return { success: false, error: `Entity "${entity.name}" has no physics. Add physics first.` };
    }
    
    const force = new pc.Vec3(
      params.force.x || 0,
      params.force.y || 0,
      params.force.z || 0
    );
    
    if (params.impulse !== false) {
      entity.rigidbody.applyImpulse(force);
    } else {
      entity.rigidbody.applyForce(force);
    }
    
    return {
      success: true,
      message: `Applied ${params.impulse !== false ? 'impulse' : 'force'} to "${entity.name}"`
    };
  }
};

/**
 * Add audio/sound to an entity
 */
const addSound: MCPTool = {
  name: 'add_sound',
  description: 'Add spatial audio to an entity',
  parameters: {
    type: 'object',
    properties: {
      target: {
        type: 'string',
        description: 'Entity name or ID'
      },
      type: {
        type: 'string',
        description: 'Type of ambient sound',
        enum: ['ambient', 'effect', 'music']
      },
      volume: {
        type: 'number',
        description: 'Volume (0-1)',
        default: 1
      },
      loop: {
        type: 'boolean',
        description: 'Loop the sound',
        default: true
      },
      spatial: {
        type: 'boolean',
        description: '3D spatial audio',
        default: true
      }
    },
    required: ['target']
  },
  handler: (params, app): MCPToolResult => {
    const entity = findEntity(app, params.target);
    
    if (!entity) {
      return { success: false, error: `Could not find entity: ${params.target}` };
    }
    
    // Note: Actual audio requires audio assets
    // This is a placeholder for the component structure
    if (!entity.sound) {
      entity.addComponent('sound', {
        volume: params.volume ?? 1,
        pitch: 1,
        positional: params.spatial ?? true,
        refDistance: 1,
        maxDistance: 100,
        rollOffFactor: 1,
        distanceModel: 'linear'
      });
    }
    
    return {
      success: true,
      message: `Added sound component to "${entity.name}" (note: requires audio asset to play)`
    };
  }
};

// ============================================================================
// GAME LOGIC TOOLS - Enable Hon to create interactive experiences
// ============================================================================

// Global game state store
interface GameState {
  score: number;
  health: number;
  lives: number;
  level: number;
  isGameOver: boolean;
  isPaused: boolean;
  customVars: Record<string, any>;
}

const globalGameState: GameState = {
  score: 0,
  health: 100,
  lives: 3,
  level: 1,
  isGameOver: false,
  isPaused: false,
  customVars: {}
};

// Store for registered scripts and handlers
const scriptRegistry: Map<string, Function> = new Map();
const collisionHandlers: Map<string, Function> = new Map();
const inputHandlers: Map<string, Function> = new Map();

/**
 * Add a custom behavior script to an entity
 * This is the core tool for game logic - allows Hon to write actual code
 */
const addScript: MCPTool = {
  name: 'add_script',
  description: 'Add custom behavior script to an entity. The script runs every frame and can access entity, app, dt (delta time), input, and gameState.',
  parameters: {
    type: 'object',
    properties: {
      target: {
        type: 'string',
        description: 'Entity name or ID to attach script to'
      },
      scriptName: {
        type: 'string',
        description: 'Unique name for this script'
      },
      updateCode: {
        type: 'string',
        description: 'JavaScript code that runs every frame. Has access to: entity, app, dt, input, gameState, pc (PlayCanvas)'
      },
      initCode: {
        type: 'string',
        description: 'Optional initialization code that runs once when script is added'
      },
      onCollision: {
        type: 'string',
        description: 'Optional code that runs on collision. Has access to: entity, other, contact, gameState'
      },
      onTrigger: {
        type: 'string',
        description: 'Optional code for trigger enter/exit. Has access to: entity, other, gameState'
      }
    },
    required: ['target', 'scriptName', 'updateCode']
  },
  handler: (params, app, camera): MCPToolResult => {
    const pc = (window as any).pc;
    const entity = findEntity(app, params.target);
    
    if (!entity) {
      return { success: false, error: `Could not find entity: ${params.target}` };
    }
    
    // Remove existing script with same name
    if (entity._mcpScripts && entity._mcpScripts[params.scriptName]) {
      app.off('update', entity._mcpScripts[params.scriptName].updateHandler);
    }
    
    // Initialize script storage on entity
    entity._mcpScripts = entity._mcpScripts || {};
    
    // Create input state object
    const input = {
      keys: {} as Record<string, boolean>,
      mouse: { x: 0, y: 0, dx: 0, dy: 0, buttons: 0 },
      pointerLocked: false
    };
    
    // Set up keyboard input
    const keyboard = app.keyboard;
    if (keyboard) {
      keyboard.on('keydown', (e: any) => {
        input.keys[e.key] = true;
        input.keys[e.code] = true;
      });
      keyboard.on('keyup', (e: any) => {
        input.keys[e.key] = false;
        input.keys[e.code] = false;
      });
    }
    
    // Set up mouse input
    const mouse = app.mouse;
    if (mouse) {
      mouse.on('mousemove', (e: any) => {
        input.mouse.x = e.x;
        input.mouse.y = e.y;
        input.mouse.dx = e.dx || 0;
        input.mouse.dy = e.dy || 0;
      });
      mouse.on('mousedown', (e: any) => {
        input.mouse.buttons |= (1 << e.button);
      });
      mouse.on('mouseup', (e: any) => {
        input.mouse.buttons &= ~(1 << e.button);
      });
    }
    
    // Run initialization code if provided
    if (params.initCode) {
      try {
        const initFn = compileSceneCode('entity', 'app', 'pc', 'gameState', 'camera', params.initCode);
        initFn(entity, app, pc, globalGameState, camera);
      } catch (err) {
        console.error('[MCP Script] Init error:', err);
        return { success: false, error: `Script init error: ${(err as Error).message}` };
      }
    }
    
    // Create the update function
    let updateFn: Function;
    try {
      updateFn = compileSceneCode('entity', 'app', 'dt', 'input', 'gameState', 'pc', 'camera', params.updateCode);
    } catch (err) {
      console.error('[MCP Script] Compile error:', err);
      return { success: false, error: `Script compile error: ${(err as Error).message}` };
    }
    
    // Create update handler
    const updateHandler = (dt: number) => {
      if (globalGameState.isPaused || globalGameState.isGameOver) return;
      try {
        updateFn(entity, app, dt, input, globalGameState, pc, camera);
      } catch (err) {
        console.error('[MCP Script] Runtime error:', err);
      }
    };
    
    // Register the update handler
    app.on('update', updateHandler);
    
    // Store script reference
    entity._mcpScripts[params.scriptName] = {
      updateHandler,
      updateFn,
      input
    };
    
    // Set up collision handler if provided
    if (params.onCollision && entity.collision) {
      const collisionFn = compileSceneCode('entity', 'other', 'contact', 'gameState', 'pc', params.onCollision);
      entity.collision.on('collisionstart', (result: any) => {
        try {
          collisionFn(entity, result.other, result.contacts[0], globalGameState, pc);
        } catch (err) {
          console.error('[MCP Script] Collision error:', err);
        }
      });
    }
    
    // Set up trigger handler if provided
    if (params.onTrigger && entity.collision) {
      const triggerFn = compileSceneCode('entity', 'other', 'gameState', 'pc', params.onTrigger);
      entity.collision.on('triggerenter', (other: any) => {
        try {
          triggerFn(entity, other, globalGameState, pc);
        } catch (err) {
          console.error('[MCP Script] Trigger error:', err);
        }
      });
    }
    
    return {
      success: true,
      message: `Added script "${params.scriptName}" to "${entity.name}"`
    };
  }
};

/**
 * Remove a script from an entity
 */
const removeScript: MCPTool = {
  name: 'remove_script',
  description: 'Remove a behavior script from an entity',
  parameters: {
    type: 'object',
    properties: {
      target: {
        type: 'string',
        description: 'Entity name or ID'
      },
      scriptName: {
        type: 'string',
        description: 'Name of script to remove'
      }
    },
    required: ['target', 'scriptName']
  },
  handler: (params, app): MCPToolResult => {
    const entity = findEntity(app, params.target);
    
    if (!entity) {
      return { success: false, error: `Could not find entity: ${params.target}` };
    }
    
    if (!entity._mcpScripts || !entity._mcpScripts[params.scriptName]) {
      return { success: false, error: `Script "${params.scriptName}" not found on "${entity.name}"` };
    }
    
    // Remove update handler
    app.off('update', entity._mcpScripts[params.scriptName].updateHandler);
    delete entity._mcpScripts[params.scriptName];
    
    return {
      success: true,
      message: `Removed script "${params.scriptName}" from "${entity.name}"`
    };
  }
};

/**
 * Set or update game state variables
 */
const setGameState: MCPTool = {
  name: 'set_game_state',
  description: 'Set game state variables like score, health, lives, or custom variables',
  parameters: {
    type: 'object',
    properties: {
      score: {
        type: 'number',
        description: 'Set the score'
      },
      health: {
        type: 'number',
        description: 'Set health (0-100)'
      },
      lives: {
        type: 'number',
        description: 'Set number of lives'
      },
      level: {
        type: 'number',
        description: 'Set current level'
      },
      isGameOver: {
        type: 'boolean',
        description: 'Set game over state'
      },
      isPaused: {
        type: 'boolean',
        description: 'Pause or unpause the game'
      },
      customVar: {
        type: 'object',
        description: 'Set a custom variable { name: string, value: any }'
      },
      operation: {
        type: 'string',
        description: 'Operation to perform on numeric values',
        enum: ['set', 'add', 'subtract', 'multiply']
      }
    },
    required: []
  },
  handler: (params): MCPToolResult => {
    const op = params.operation || 'set';
    const changes: string[] = [];
    
    const applyOp = (current: number, value: number): number => {
      switch (op) {
        case 'add': return current + value;
        case 'subtract': return current - value;
        case 'multiply': return current * value;
        default: return value;
      }
    };
    
    if (params.score !== undefined) {
      const oldScore = globalGameState.score;
      globalGameState.score = applyOp(globalGameState.score, params.score);
      changes.push(`score: ${globalGameState.score}`);
      // Fire event to sync with React UI
      const scoreDelta = globalGameState.score - oldScore;
      if (scoreDelta !== 0) {
        app.fire('hon:collectible', { value: scoreDelta, effect: 'score' });
      }
    }

    if (params.health !== undefined) {
      const oldHealth = globalGameState.health;
      globalGameState.health = Math.max(0, Math.min(100, applyOp(globalGameState.health, params.health)));
      changes.push(`health: ${globalGameState.health}`);

      // Fire event to sync with React UI
      const healthDelta = globalGameState.health - oldHealth;
      if (healthDelta < 0) {
        app.fire('hon:damage', { damage: -healthDelta });
      } else if (healthDelta > 0) {
        app.fire('hon:collectible', { value: healthDelta, effect: 'health' });
      }

      // Auto game over on 0 health
      if (globalGameState.health <= 0 && !globalGameState.isGameOver) {
        globalGameState.isGameOver = true;
        changes.push('game over (health depleted)');
      }
    }

    if (params.lives !== undefined) {
      globalGameState.lives = Math.max(0, applyOp(globalGameState.lives, params.lives));
      changes.push(`lives: ${globalGameState.lives}`);

      // Auto game over on 0 lives
      if (globalGameState.lives <= 0 && !globalGameState.isGameOver) {
        globalGameState.isGameOver = true;
        changes.push('game over (no lives)');
      }
    }

    if (params.level !== undefined) {
      globalGameState.level = applyOp(globalGameState.level, params.level);
      changes.push(`level: ${globalGameState.level}`);
    }

    if (params.isGameOver !== undefined) {
      globalGameState.isGameOver = params.isGameOver;
      changes.push(`game over: ${params.isGameOver}`);
      // Fire game over event to sync with React UI
      if (params.isGameOver) {
        app.fire('hon:damage', { damage: globalGameState.health }); // Will trigger game over in React
      }
    }

    if (params.isPaused !== undefined) {
      globalGameState.isPaused = params.isPaused;
      changes.push(`paused: ${params.isPaused}`);
    }

    if (params.customVar) {
      globalGameState.customVars[params.customVar.name] = params.customVar.value;
      changes.push(`${params.customVar.name}: ${params.customVar.value}`);
    }

    return {
      success: true,
      message: `Updated game state: ${changes.join(', ')}`,
      data: { ...globalGameState }
    };
  }
};

/**
 * Get current game state
 */
const getGameState: MCPTool = {
  name: 'get_game_state',
  description: 'Get the current game state (score, health, lives, etc.)',
  parameters: {
    type: 'object',
    properties: {},
    required: []
  },
  handler: (): MCPToolResult => {
    return {
      success: true,
      message: `Score: ${globalGameState.score}, Health: ${globalGameState.health}, Lives: ${globalGameState.lives}, Level: ${globalGameState.level}`,
      data: { ...globalGameState }
    };
  }
};

/**
 * Start game mode - transitions from build mode to play mode
 */
const startGame: MCPTool = {
  name: 'start_game',
  description: 'Start the game! Transitions from build mode to play mode. Shows HUD, enables scoring, and activates game mechanics. Call this when the user is ready to play.',
  parameters: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'Optional message to show when game starts'
      }
    },
    required: []
  },
  handler: (params, app): MCPToolResult => {
    // Reset game state to fresh start
    globalGameState.score = 0;
    globalGameState.health = 100;
    globalGameState.lives = 3;
    globalGameState.isGameOver = false;
    globalGameState.isPaused = false;

    // Fire start game event to activate HUD
    app.fire('hon:start-game');

    return {
      success: true,
      message: params.message || 'Game started! Good luck!',
      data: { ...globalGameState }
    };
  }
};

/**
 * Reset game state to initial values
 */
const resetGame: MCPTool = {
  name: 'reset_game',
  description: 'Reset game state to initial values (score, health, lives, etc.)',
  parameters: {
    type: 'object',
    properties: {
      keepLevel: {
        type: 'boolean',
        description: 'Keep current level instead of resetting to 1'
      }
    },
    required: []
  },
  handler: (params): MCPToolResult => {
    globalGameState.score = 0;
    globalGameState.health = 100;
    globalGameState.lives = 3;
    globalGameState.isGameOver = false;
    globalGameState.isPaused = false;
    globalGameState.customVars = {};
    
    if (!params.keepLevel) {
      globalGameState.level = 1;
    }
    
    return {
      success: true,
      message: 'Game state reset to initial values'
    };
  }
};

/**
 * Set up victory/game over conditions that are automatically checked
 */
const setWinCondition: MCPTool = {
  name: 'set_win_condition',
  description: 'Set up automatic victory or game over conditions. The game will check these every frame.',
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        description: 'Type of condition to set',
        enum: ['score', 'enemies_destroyed', 'reach_zone', 'collect_all', 'survive_time', 'custom']
      },
      target: {
        type: 'number',
        description: 'Target value (score amount, enemy count, seconds to survive, etc.)'
      },
      zoneName: {
        type: 'string',
        description: 'For reach_zone: name of the trigger zone entity'
      },
      collectibleTag: {
        type: 'string',
        description: 'For collect_all: tag of collectibles that must all be collected'
      },
      customCheck: {
        type: 'string',
        description: 'For custom: JavaScript code returning true/false. Has access to: gameState, app, pc'
      },
      message: {
        type: 'string',
        description: 'Victory message to show'
      }
    },
    required: ['type']
  },
  handler: (params, app): MCPToolResult => {
    const pc = (window as any).pc;
    const conditionType = params.type;
    const target = params.target || 100;
    let checkFn: (() => boolean) | null = null;
    let description = '';

    switch (conditionType) {
      case 'score':
        checkFn = () => globalGameState.score >= target;
        description = `Score reaches ${target}`;
        break;

      case 'enemies_destroyed':
        // Count enemies remaining
        checkFn = () => {
          const enemies = app.root.findByTag('enemy');
          return enemies.length === 0;
        };
        description = 'All enemies destroyed';
        break;

      case 'reach_zone':
        if (!params.zoneName) {
          return { success: false, error: 'zoneName required for reach_zone condition' };
        }
        // Will be triggered by trigger zone event
        app.on('hon:trigger-enter', (data: any) => {
          if (data.triggerName === params.zoneName && data.other?.tags?.has('player')) {
            app.fire('hon:victory');
          }
        });
        description = `Player reaches ${params.zoneName}`;
        break;

      case 'collect_all':
        const tag = params.collectibleTag || 'collectible';
        checkFn = () => {
          const collectibles = app.root.findByTag(tag);
          return collectibles.length === 0;
        };
        description = `All ${tag} items collected`;
        break;

      case 'survive_time':
        const surviveSeconds = target;
        const startTime = Date.now();
        checkFn = () => {
          const elapsed = (Date.now() - startTime) / 1000;
          return elapsed >= surviveSeconds;
        };
        description = `Survive for ${surviveSeconds} seconds`;
        break;

      case 'custom':
        if (!params.customCheck) {
          return { success: false, error: 'customCheck code required for custom condition' };
        }
        try {
          const customFn = compileSceneCode('gameState', 'app', 'pc', `return ${params.customCheck}`);
          checkFn = () => Boolean(customFn(globalGameState, app, pc));
          description = 'Custom condition';
        } catch (err) {
          return { success: false, error: `Invalid customCheck code: ${err}` };
        }
        break;

      default:
        return { success: false, error: `Unknown condition type: ${conditionType}` };
    }

    // Set up frame-by-frame checking (except reach_zone which uses events)
    if (checkFn) {
      const updateHandler = () => {
        if (globalGameState.isGameOver || globalGameState.isPaused) return;
        if (checkFn && checkFn()) {
          app.off('update', updateHandler);
          app.fire('hon:victory');
          console.log(`[WinCondition] Victory! ${description}`);
        }
      };
      app.on('update', updateHandler);
    }

    return {
      success: true,
      message: `Win condition set: ${description}`,
      data: { type: conditionType, target, description }
    };
  }
};

/**
 * Add collision/trigger detection to an entity
 */
const addCollision: MCPTool = {
  name: 'add_collision',
  description: 'Add collision detection to an entity with optional trigger mode',
  parameters: {
    type: 'object',
    properties: {
      target: {
        type: 'string',
        description: 'Entity name or ID'
      },
      shape: {
        type: 'string',
        description: 'Collision shape',
        enum: ['box', 'sphere', 'capsule', 'cylinder'],
        default: 'box'
      },
      isTrigger: {
        type: 'boolean',
        description: 'If true, acts as trigger (no physical collision, just detection)',
        default: false
      },
      halfExtents: {
        type: 'object',
        description: 'Size for box shape { x, y, z }'
      },
      radius: {
        type: 'number',
        description: 'Radius for sphere/capsule/cylinder'
      },
      height: {
        type: 'number',
        description: 'Height for capsule/cylinder'
      },
      group: {
        type: 'string',
        description: 'Collision group name (for filtering)',
        enum: ['player', 'enemy', 'projectile', 'pickup', 'environment', 'trigger']
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
    
    // Remove existing collision
    if (entity.collision) {
      entity.removeComponent('collision');
    }
    
    // Build collision config
    const collisionConfig: any = {
      type: params.shape || 'box'
    };
    
    if (params.halfExtents) {
      collisionConfig.halfExtents = new pc.Vec3(
        params.halfExtents.x || 0.5,
        params.halfExtents.y || 0.5,
        params.halfExtents.z || 0.5
      );
    }
    
    if (params.radius) {
      collisionConfig.radius = params.radius;
    }
    
    if (params.height) {
      collisionConfig.height = params.height;
    }
    
    entity.addComponent('collision', collisionConfig);
    
    // For triggers, add a kinematic rigidbody
    if (params.isTrigger) {
      if (!entity.rigidbody) {
        entity.addComponent('rigidbody', {
          type: 'kinematic'
        });
      }
      entity.collision.on('triggerenter', (other: any) => {
        console.log(`[Trigger] ${entity.name} triggered by ${other.name}`);
      });
    }
    
    // Store group for filtering
    entity._collisionGroup = params.group || 'environment';
    
    return {
      success: true,
      message: `Added ${params.isTrigger ? 'trigger' : 'collision'} (${params.shape || 'box'}) to "${entity.name}"`
    };
  }
};

/**
 * Spawn a projectile from an entity
 */
const spawnProjectile: MCPTool = {
  name: 'spawn_projectile',
  description: 'Spawn a projectile (bullet, missile, etc.) from an entity in a direction',
  parameters: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        description: 'Entity to spawn from (or "camera" for first-person)'
      },
      direction: {
        type: 'string',
        description: 'Direction to fire',
        enum: ['forward', 'up', 'right', 'custom']
      },
      customDirection: {
        type: 'object',
        description: 'Custom direction vector { x, y, z }'
      },
      speed: {
        type: 'number',
        description: 'Projectile speed',
        default: 20
      },
      damage: {
        type: 'number',
        description: 'Damage on hit',
        default: 10
      },
      lifetime: {
        type: 'number',
        description: 'Seconds before auto-destroy',
        default: 3
      },
      size: {
        type: 'number',
        description: 'Projectile size',
        default: 0.1
      },
      color: {
        type: 'string',
        description: 'Projectile color'
      },
      onHit: {
        type: 'string',
        description: 'Code to run on collision. Has access to: projectile, other, gameState'
      }
    },
    required: ['source']
  },
  handler: (params, app, camera): MCPToolResult => {
    const pc = (window as any).pc;
    
    // Get source entity or camera
    let source: any;
    let forward: any;
    
    if (params.source === 'camera' && camera) {
      source = camera;
      forward = camera.forward.clone();
    } else {
      source = findEntity(app, params.source);
      if (!source) {
        return { success: false, error: `Could not find source: ${params.source}` };
      }
      forward = source.forward.clone();
    }
    
    // Calculate direction
    let direction: any;
    switch (params.direction) {
      case 'up':
        direction = source.up.clone();
        break;
      case 'right':
        direction = source.right.clone();
        break;
      case 'custom':
        direction = new pc.Vec3(
          params.customDirection?.x || 0,
          params.customDirection?.y || 0,
          params.customDirection?.z || -1
        ).normalize();
        break;
      default:
        direction = forward.mulScalar(-1); // Forward is -Z
    }
    
    // Create projectile entity
    const projectile = new pc.Entity('projectile');
    
    // Position at source
    const sourcePos = source.getPosition();
    projectile.setPosition(
      sourcePos.x + direction.x * 0.5,
      sourcePos.y + direction.y * 0.5,
      sourcePos.z + direction.z * 0.5
    );
    
    // Add render component (glowing sphere)
    const size = params.size || 0.1;
    projectile.addComponent('render', {
      type: 'sphere'
    });
    projectile.setLocalScale(size, size, size);
    
    // Set color/material
    const colorMap: Record<string, [number, number, number]> = {
      red: [1, 0.2, 0.1], orange: [1, 0.5, 0], yellow: [1, 1, 0.2],
      green: [0.2, 1, 0.2], blue: [0.2, 0.5, 1], purple: [0.8, 0.2, 1],
      white: [1, 1, 1], cyan: [0, 1, 1]
    };
    const [r, g, b] = colorMap[params.color?.toLowerCase() || 'yellow'] || [1, 1, 0.2];
    
    const material = new pc.StandardMaterial();
    material.diffuse = new pc.Color(r, g, b);
    material.emissive = new pc.Color(r * 0.8, g * 0.8, b * 0.8);
    material.update();
    projectile.render.meshInstances[0].material = material;
    
    // Add collision
    projectile.addComponent('collision', {
      type: 'sphere',
      radius: size
    });
    
    projectile.addComponent('rigidbody', {
      type: 'kinematic'
    });
    
    // Store projectile data
    const speed = params.speed || 20;
    const lifetime = params.lifetime || 3;
    const damage = params.damage || 10;
    let age = 0;
    
    // Create onHit handler if provided
    let onHitFn: Function | null = null;
    if (params.onHit) {
      try {
        onHitFn = compileSceneCode('projectile', 'other', 'gameState', 'pc', params.onHit);
      } catch (err) {
        console.error('[Projectile] onHit compile error:', err);
      }
    }
    
    // Update handler
    const updateHandler = (dt: number) => {
      age += dt;
      
      // Move projectile
      const pos = projectile.getPosition();
      projectile.setPosition(
        pos.x + direction.x * speed * dt,
        pos.y + direction.y * speed * dt,
        pos.z + direction.z * speed * dt
      );
      
      // Destroy after lifetime
      if (age > lifetime) {
        app.off('update', updateHandler);
        projectile.destroy();
      }
    };
    
    // Collision handler
    projectile.collision.on('triggerenter', (other: any) => {
      // Skip self and camera
      if (other === source || other.name === 'camera') return;
      
      console.log(`[Projectile] Hit ${other.name}`);
      
      // Run custom onHit
      if (onHitFn) {
        try {
          onHitFn(projectile, other, globalGameState, pc);
        } catch (err) {
          console.error('[Projectile] onHit error:', err);
        }
      }
      
      // Default: apply damage if target has health
      if (other._health !== undefined) {
        other._health -= damage;
        if (other._health <= 0) {
          other.destroy();
        }
      }
      
      // Destroy projectile
      app.off('update', updateHandler);
      projectile.destroy();
    });
    
    app.on('update', updateHandler);
    app.root.addChild(projectile);
    
    return {
      success: true,
      message: `Spawned projectile from "${source.name}" moving ${params.direction || 'forward'}`
    };
  }
};

/**
 * Create a spawner that periodically creates entities
 */
const createSpawner: MCPTool = {
  name: 'create_spawner',
  description: 'Create a spawner that periodically spawns entities (enemies, pickups, etc.)',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name for the spawner'
      },
      template: {
        type: 'string',
        description: 'Type of entity to spawn',
        enum: ['enemy', 'pickup', 'obstacle', 'custom']
      },
      interval: {
        type: 'number',
        description: 'Seconds between spawns',
        default: 2
      },
      maxActive: {
        type: 'number',
        description: 'Maximum spawned entities active at once',
        default: 10
      },
      spawnArea: {
        type: 'object',
        description: 'Area to spawn in { center: {x,y,z}, size: {x,y,z} }'
      },
      onSpawn: {
        type: 'string',
        description: 'Code to run when entity spawns. Has access to: spawned, spawner, gameState'
      },
      entityConfig: {
        type: 'object',
        description: 'Configuration for spawned entities (color, size, health, etc.)'
      }
    },
    required: ['name', 'template']
  },
  handler: (params, app, camera): MCPToolResult => {
    const pc = (window as any).pc;
    
    // Create spawner entity
    const spawner = new pc.Entity(params.name || 'spawner');
    
    // Position spawner
    const area = params.spawnArea || { center: { x: 0, y: 1, z: -10 }, size: { x: 10, y: 0, z: 10 } };
    spawner.setPosition(area.center.x, area.center.y, area.center.z);
    
    const spawned: any[] = [];
    let timeSinceSpawn = 0;
    const interval = params.interval || 2;
    const maxActive = params.maxActive || 10;
    
    // Compile onSpawn handler
    let onSpawnFn: Function | null = null;
    if (params.onSpawn) {
      try {
        onSpawnFn = compileSceneCode('spawned', 'spawner', 'gameState', 'pc', params.onSpawn);
      } catch (err) {
        console.error('[Spawner] onSpawn compile error:', err);
      }
    }
    
    // Spawn function
    const spawnEntity = () => {
      // Clean up destroyed entities
      for (let i = spawned.length - 1; i >= 0; i--) {
        if (!spawned[i].parent) {
          spawned.splice(i, 1);
        }
      }
      
      if (spawned.length >= maxActive) return;
      
      // Create entity based on template
      const entity = new pc.Entity(`${params.template}_${Date.now()}`);
      
      // Random position within spawn area
      const x = area.center.x + (Math.random() - 0.5) * area.size.x;
      const y = area.center.y + (Math.random() - 0.5) * (area.size.y || 0);
      const z = area.center.z + (Math.random() - 0.5) * area.size.z;
      entity.setPosition(x, y, z);
      
      const config = params.entityConfig || {};
      
      // Configure based on template
      switch (params.template) {
        case 'enemy':
          entity.addComponent('render', { type: config.shape || 'box' });
          entity.setLocalScale(config.size || 1, config.size || 1, config.size || 1);
          entity._health = config.health || 20;
          entity._damage = config.damage || 10;
          entity._speed = config.speed || 3;
          
          // Add collision
          entity.addComponent('collision', { type: 'box' });
          entity.addComponent('rigidbody', { type: 'kinematic' });
          break;
          
        case 'pickup':
          entity.addComponent('render', { type: 'sphere' });
          entity.setLocalScale(0.5, 0.5, 0.5);
          entity._value = config.value || 10;
          entity._type = config.type || 'score';
          
          entity.addComponent('collision', { type: 'sphere', radius: 0.5 });
          entity.addComponent('rigidbody', { type: 'kinematic' });
          break;
          
        case 'obstacle':
          entity.addComponent('render', { type: config.shape || 'box' });
          entity.setLocalScale(config.size || 2, config.size || 2, config.size || 2);
          entity._damage = config.damage || 20;
          
          entity.addComponent('collision', { type: 'box' });
          entity.addComponent('rigidbody', { type: 'static' });
          break;
      }
      
      app.root.addChild(entity);
      spawned.push(entity);

      // Fire event for materialize effect (smooth appearance animation)
      app.fire('hon:entity-materialize', { entity, name: entity.name });

      // Run onSpawn handler
      if (onSpawnFn) {
        try {
          onSpawnFn(entity, spawner, globalGameState, pc);
        } catch (err) {
          console.error('[Spawner] onSpawn error:', err);
        }
      }
    };
    
    // Update handler
    const updateHandler = (dt: number) => {
      if (globalGameState.isPaused || globalGameState.isGameOver) return;
      
      timeSinceSpawn += dt;
      if (timeSinceSpawn >= interval) {
        spawnEntity();
        timeSinceSpawn = 0;
      }
    };
    
    spawner._updateHandler = updateHandler;
    spawner._spawned = spawned;
    
    app.on('update', updateHandler);
    app.root.addChild(spawner);
    
    // Spawn first entity immediately
    spawnEntity();
    
    return {
      success: true,
      message: `Created ${params.template} spawner "${params.name}" (interval: ${interval}s, max: ${maxActive})`
    };
  }
};

/**
 * Create a player controller with common FPS/third-person mechanics
 */
const createPlayerController: MCPTool = {
  name: 'create_player_controller',
  description: 'Create a player controller with movement, jumping, and optional shooting',
  parameters: {
    type: 'object',
    properties: {
      target: {
        type: 'string',
        description: 'Entity to control (or "camera" for first-person)'
      },
      type: {
        type: 'string',
        description: 'Controller type',
        enum: ['fps', 'third_person', 'top_down', 'platformer'],
        default: 'fps'
      },
      moveSpeed: {
        type: 'number',
        description: 'Movement speed',
        default: 5
      },
      jumpForce: {
        type: 'number',
        description: 'Jump force (0 to disable)',
        default: 8
      },
      canShoot: {
        type: 'boolean',
        description: 'Enable shooting with mouse/space',
        default: false
      },
      shootCooldown: {
        type: 'number',
        description: 'Seconds between shots',
        default: 0.25
      },
      mouseSensitivity: {
        type: 'number',
        description: 'Mouse look sensitivity',
        default: 0.1
      }
    },
    required: ['target']
  },
  handler: (params, app, camera): MCPToolResult => {
    const pc = (window as any).pc;
    
    const target = params.target === 'camera' ? camera : findEntity(app, params.target);
    if (!target) {
      return { success: false, error: `Could not find target: ${params.target}` };
    }
    
    const moveSpeed = params.moveSpeed || 5;
    const jumpForce = params.jumpForce || 8;
    const sensitivity = params.mouseSensitivity || 0.1;
    const shootCooldown = params.shootCooldown || 0.25;
    
    // Input state
    const keys: Record<string, boolean> = {};
    let mouseX = 0, mouseY = 0;
    let yaw = 0, pitch = 0;
    let isGrounded = true;
    let velocityY = 0;
    let lastShootTime = 0;
    
    // Set up input
    const keyboard = app.keyboard;
    keyboard.on('keydown', (e: any) => keys[e.key.toLowerCase()] = true);
    keyboard.on('keyup', (e: any) => keys[e.key.toLowerCase()] = false);
    
    const mouse = app.mouse;
    mouse.on('mousemove', (e: any) => {
      if (document.pointerLockElement) {
        mouseX += e.dx || 0;
        mouseY += e.dy || 0;
      }
    });
    
    // Request pointer lock on click
    app.graphicsDevice.canvas.addEventListener('click', () => {
      app.graphicsDevice.canvas.requestPointerLock?.();
    });
    
    // Update handler
    const updateHandler = (dt: number) => {
      if (globalGameState.isPaused || globalGameState.isGameOver) return;
      
      const time = Date.now() / 1000;
      
      // Mouse look (FPS)
      if (params.type === 'fps' || params.type === 'third_person') {
        yaw -= mouseX * sensitivity;
        pitch -= mouseY * sensitivity;
        pitch = Math.max(-89, Math.min(89, pitch));
        mouseX = 0;
        mouseY = 0;
        
        target.setEulerAngles(pitch, yaw, 0);
      }
      
      // Movement
      const forward = target.forward.clone().mulScalar(-1);
      const right = target.right.clone();
      let moveX = 0, moveZ = 0;
      
      if (keys['w'] || keys['arrowup']) { moveX += forward.x; moveZ += forward.z; }
      if (keys['s'] || keys['arrowdown']) { moveX -= forward.x; moveZ -= forward.z; }
      if (keys['a'] || keys['arrowleft']) { moveX -= right.x; moveZ -= right.z; }
      if (keys['d'] || keys['arrowright']) { moveX += right.x; moveZ += right.z; }
      
      // Normalize and apply
      const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
      if (len > 0) {
        moveX = (moveX / len) * moveSpeed * dt;
        moveZ = (moveZ / len) * moveSpeed * dt;
      }
      
      const pos = target.getPosition();
      
      // Jumping (simple gravity)
      if ((keys[' '] || keys['space']) && isGrounded && jumpForce > 0) {
        velocityY = jumpForce;
        isGrounded = false;
      }
      
      velocityY -= 20 * dt; // Gravity
      let newY = pos.y + velocityY * dt;
      
      // Ground check
      if (newY <= 1.6) { // Player height
        newY = 1.6;
        velocityY = 0;
        isGrounded = true;
      }
      
      target.setPosition(pos.x + moveX, newY, pos.z + moveZ);
      
      // Shooting
      if (params.canShoot && (keys[' '] || keys['space'] || mouse.isPressed(pc.MOUSEBUTTON_LEFT))) {
        if (time - lastShootTime > shootCooldown) {
          // Spawn projectile
          const projectile = new pc.Entity('bullet');
          projectile.setPosition(pos.x, pos.y, pos.z);
          projectile.addComponent('render', { type: 'sphere' });
          projectile.setLocalScale(0.1, 0.1, 0.1);
          
          const dir = forward.clone();
          const speed = 30;
          let age = 0;
          
          const bulletUpdate = (bdt: number) => {
            age += bdt;
            const bpos = projectile.getPosition();
            projectile.setPosition(
              bpos.x + dir.x * speed * bdt,
              bpos.y + dir.y * speed * bdt,
              bpos.z + dir.z * speed * bdt
            );
            if (age > 2) {
              app.off('update', bulletUpdate);
              projectile.destroy();
            }
          };
          
          app.on('update', bulletUpdate);
          app.root.addChild(projectile);
          lastShootTime = time;
        }
      }
    };
    
    target._playerController = updateHandler;
    app.on('update', updateHandler);

    return {
      success: true,
      message: `Created ${params.type || 'fps'} player controller on "${target.name}"`
    };
  }
};

/**
 * Add traffic movement to vehicles in the scene
 * Simple tool - just "add moving traffic" and it works
 */
const addTraffic: MCPTool = {
  name: 'add_traffic',
  description: 'Add movement to vehicles in the scene. Just say "add moving traffic" or "make the cars drive" and vehicles will start moving realistically.',
  parameters: {
    type: 'object',
    properties: {
      speed: {
        type: 'number',
        description: 'Base speed in m/s (default: 8, about 30 km/h city speed)'
      },
      type: {
        type: 'string',
        description: 'Traffic type',
        enum: ['ground', 'air', 'all'],
        default: 'ground'
      },
      loop: {
        type: 'boolean',
        description: 'Loop vehicles back when they reach bounds (default: true)'
      },
      bounds: {
        type: 'number',
        description: 'Distance from center before looping (default: auto-detect from scene)'
      }
    }
  },
  handler: (params, app): MCPToolResult => {
    const pc = (window as any).pc;
    if (!pc) {
      return { success: false, error: 'PlayCanvas not loaded' };
    }

    const baseSpeed = params.speed || 8; // ~30 km/h
    const trafficType = params.type || 'ground';
    const shouldLoop = params.loop !== false;

    // Find all vehicles in scene
    const groundVehicles = ['car', 'taxi', 'police', 'ambulance', 'bus', 'van', 'truck', 'sports'];
    const airVehicles = ['plane', 'helicopter', 'aircraft'];

    const vehicles: any[] = [];
    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    app.root.forEach((entity: any) => {
      if (entity === app.root) return;
      const name = entity.name.toLowerCase();

      const isGround = groundVehicles.some(v => name.includes(v));
      const isAir = airVehicles.some(v => name.includes(v));

      if ((trafficType === 'ground' && isGround) ||
          (trafficType === 'air' && isAir) ||
          (trafficType === 'all' && (isGround || isAir))) {
        vehicles.push({ entity, isAir });

        // Track bounds
        const pos = entity.getPosition();
        minX = Math.min(minX, pos.x);
        maxX = Math.max(maxX, pos.x);
        minZ = Math.min(minZ, pos.z);
        maxZ = Math.max(maxZ, pos.z);
      }
    });

    if (vehicles.length === 0) {
      return { success: false, error: 'No vehicles found in scene. Create some vehicles first.' };
    }

    // Determine bounds for looping
    const sceneBounds = params.bounds || Math.max(maxX - minX, maxZ - minZ, 50) + 20;
    const halfBounds = sceneBounds / 2;

    let groundCount = 0;
    let airCount = 0;

    vehicles.forEach(({ entity, isAir }, index) => {
      // Skip if already has traffic script
      if (entity._trafficScript) return;

      // Determine movement direction from entity rotation
      const rot = entity.getLocalEulerAngles();
      const yaw = rot.y * Math.PI / 180;

      // Calculate forward direction from rotation
      let dirX = Math.sin(yaw);
      let dirZ = Math.cos(yaw);

      // Add speed variation (±20%)
      const speedVariation = 0.8 + Math.random() * 0.4;
      const speed = baseSpeed * speedVariation;

      if (isAir) {
        // Air traffic - circular or linear path
        const isHelicopter = entity.name.toLowerCase().includes('helicopter');
        const startPos = entity.getPosition().clone();
        const startY = startPos.y || 50;
        const circleRadius = 40 + Math.random() * 30;
        let angle = Math.atan2(startPos.x, startPos.z);

        const updateHandler = (dt: number) => {
          if (globalGameState.isPaused) return;

          if (isHelicopter) {
            // Helicopters hover with slight movement
            const pos = entity.getPosition();
            const time = Date.now() / 1000;
            const bobAmount = Math.sin(time * 2 + index) * 0.3;
            const driftX = Math.sin(time * 0.5 + index) * 0.1;
            const driftZ = Math.cos(time * 0.3 + index) * 0.1;
            entity.setPosition(
              startPos.x + driftX,
              startY + bobAmount,
              startPos.z + driftZ
            );
            entity.rotate(0, 10 * dt, 0); // Slow rotation
          } else {
            // Planes fly in circles
            angle += (speed / circleRadius) * dt;
            const x = Math.sin(angle) * circleRadius;
            const z = Math.cos(angle) * circleRadius;
            entity.setPosition(x, startY, z);
            // Face direction of travel
            entity.setEulerAngles(0, (angle * 180 / Math.PI) + 90, 0);
          }
        };

        entity._trafficScript = updateHandler;
        app.on('update', updateHandler);
        airCount++;

      } else {
        // Ground traffic - linear movement
        const updateHandler = (dt: number) => {
          if (globalGameState.isPaused) return;

          const pos = entity.getPosition();
          pos.x += dirX * speed * dt;
          pos.z += dirZ * speed * dt;

          // Loop back if beyond bounds
          if (shouldLoop) {
            if (pos.x > halfBounds) pos.x = -halfBounds;
            if (pos.x < -halfBounds) pos.x = halfBounds;
            if (pos.z > halfBounds) pos.z = -halfBounds;
            if (pos.z < -halfBounds) pos.z = halfBounds;
          }

          entity.setPosition(pos);
        };

        entity._trafficScript = updateHandler;
        app.on('update', updateHandler);
        groundCount++;
      }
    });

    const total = groundCount + airCount;
    let message = `Added traffic movement to ${total} vehicle${total !== 1 ? 's' : ''}`;
    if (groundCount > 0 && airCount > 0) {
      message = `Added traffic: ${groundCount} ground vehicle${groundCount !== 1 ? 's' : ''}, ${airCount} aircraft`;
    }

    return {
      success: true,
      message,
      data: { groundVehicles: groundCount, airVehicles: airCount, baseSpeed, bounds: sceneBounds }
    };
  }
};

/**
 * Stop traffic movement
 */
const stopTraffic: MCPTool = {
  name: 'stop_traffic',
  description: 'Stop all vehicle movement in the scene',
  parameters: {
    type: 'object',
    properties: {}
  },
  handler: (params, app): MCPToolResult => {
    let count = 0;

    app.root.forEach((entity: any) => {
      if (entity._trafficScript) {
        app.off('update', entity._trafficScript);
        delete entity._trafficScript;
        count++;
      }
    });

    if (count === 0) {
      return { success: false, error: 'No moving vehicles found' };
    }

    return {
      success: true,
      message: `Stopped ${count} vehicle${count !== 1 ? 's' : ''}`
    };
  }
};

/**
 * Add pedestrian walking behavior to NPCs in the scene
 * Simple tool - just "add walking pedestrians" and NPCs will walk around
 */
const addPedestrians: MCPTool = {
  name: 'add_pedestrians',
  description: 'Make NPC characters walk around the scene. Just say "add walking pedestrians" or "make the robots walk around" and they will animate and move on sidewalks.',
  parameters: {
    type: 'object',
    properties: {
      speed: {
        type: 'number',
        description: 'Walking speed in m/s (default: 1.2, realistic walking pace)'
      },
      bounds: {
        type: 'number',
        description: 'Area to walk within (default: auto-detect from scene)'
      },
      stayOnSidewalks: {
        type: 'boolean',
        description: 'Try to keep pedestrians on sidewalk areas (default: true)'
      }
    }
  },
  handler: (params, app): MCPToolResult => {
    const pc = (window as any).pc;
    if (!pc) {
      return { success: false, error: 'PlayCanvas not loaded' };
    }

    const walkSpeed = params.speed || 1.2; // Average human walking speed
    const stayOnSidewalks = params.stayOnSidewalks !== false;

    // Find all NPCs and character entities
    const npcNames = ['robot', 'npc', 'character', 'pedestrian', 'person', 'human', 'soldier', 'xbot'];
    const npcs: any[] = [];

    // Track scene bounds for looping
    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    app.root.forEach((entity: any) => {
      if (entity === app.root) return;

      const name = entity.name.toLowerCase();
      const hasNpcTag = entity.tags && entity.tags.has('npc');
      const isNpc = hasNpcTag || npcNames.some(n => name.includes(n));

      // Skip if it's a camera or already has pedestrian script
      if (entity.camera || entity._pedestrianScript) return;

      if (isNpc) {
        npcs.push(entity);
        const pos = entity.getPosition();
        minX = Math.min(minX, pos.x);
        maxX = Math.max(maxX, pos.x);
        minZ = Math.min(minZ, pos.z);
        maxZ = Math.max(maxZ, pos.z);
      }
    });

    if (npcs.length === 0) {
      return { success: false, error: 'No NPC characters found in scene. Create some characters first with create_character.' };
    }

    // Determine scene bounds
    const sceneBounds = params.bounds || Math.max(maxX - minX, maxZ - minZ, 30) + 10;
    const halfBounds = sceneBounds / 2;

    let count = 0;

    // Helper to play animation on a character entity
    const playCharacterAnimation = (entity: any, animName: string) => {
      // Characters have model as first child
      const modelEntity = entity.children?.[0];
      if (!modelEntity) return false;

      // Try animation component (legacy)
      if (modelEntity.animation) {
        try {
          // Get available animations from the component
          const animations = modelEntity.animation.animations;
          const clipNames = animations ? Object.keys(animations) : [];

          // debug: console.log('[Pedestrians] Available animations:', clipNames);

          // Look for matching clip
          let clipToPlay = clipNames.find((name: string) => {
            const lower = name.toLowerCase();
            return lower.includes(animName.toLowerCase()) ||
                   lower.includes('walk') ||
                   lower.includes('scene'); // Robot's animation is named "Scene"
          });

          // If looking for idle but not found, try scene (robot's default)
          if (!clipToPlay && animName === 'idle') {
            clipToPlay = clipNames.find((name: string) =>
              name.toLowerCase().includes('scene') ||
              name.toLowerCase().includes('idle')
            );
          }

          // Fallback to first available
          if (!clipToPlay && clipNames.length > 0) {
            clipToPlay = clipNames[0];
          }

          if (clipToPlay) {
            modelEntity.animation.play(clipToPlay, 0.2);
            return true;
          }
        } catch (e) {
          console.warn('[Pedestrians] animation.play failed:', e);
        }
      }

      // Try anim component (state graph)
      if (modelEntity.anim?.baseLayer) {
        try {
          const walkState = animName === 'walk' ? 'Walk_Loop' : 'Idle_Loop';
          modelEntity.anim.baseLayer.transition(walkState, 0.2);
          return true;
        } catch (e) {
          // Ignore
        }
      }

      return false;
    };

    npcs.forEach((entity, index) => {
      if (entity._pedestrianScript) return;

      // Random initial direction
      const angle = Math.random() * Math.PI * 2;
      let dirX = Math.sin(angle);
      let dirZ = Math.cos(angle);

      // Speed variation (±15%)
      const speed = walkSpeed * (0.85 + Math.random() * 0.3);

      // State for direction changes
      let changeTimer = 3 + Math.random() * 5; // Change direction every 3-8 seconds
      let isWalking = true;
      let idleTimer = 0;

      // Start walk animation immediately
      playCharacterAnimation(entity, 'walk');

      const updateHandler = (dt: number) => {
        if (globalGameState.isPaused) return;

        // Handle idle/walk state changes
        if (!isWalking) {
          idleTimer -= dt;
          if (idleTimer <= 0) {
            isWalking = true;
            playCharacterAnimation(entity, 'walk');
            changeTimer = 3 + Math.random() * 5;
          }
          return;
        }

        // Count down to direction change
        changeTimer -= dt;
        if (changeTimer <= 0) {
          // Randomly decide to idle or change direction
          if (Math.random() < 0.3) {
            // Stop and idle
            isWalking = false;
            idleTimer = 1 + Math.random() * 3;
            playCharacterAnimation(entity, 'idle');
            return;
          } else {
            // Change direction
            const newAngle = Math.random() * Math.PI * 2;
            dirX = Math.sin(newAngle);
            dirZ = Math.cos(newAngle);
            changeTimer = 3 + Math.random() * 5;
          }
        }

        // Move
        const pos = entity.getPosition();
        pos.x += dirX * speed * dt;
        pos.z += dirZ * speed * dt;

        // Stay within bounds (turn around at edges)
        if (Math.abs(pos.x) > halfBounds || Math.abs(pos.z) > halfBounds) {
          // Turn back toward center
          dirX = -Math.sign(pos.x) * (0.5 + Math.random() * 0.5);
          dirZ = -Math.sign(pos.z) * (0.5 + Math.random() * 0.5);
          const len = Math.sqrt(dirX * dirX + dirZ * dirZ);
          dirX /= len;
          dirZ /= len;
          changeTimer = 2 + Math.random() * 3;
        }

        // Clamp to bounds
        pos.x = Math.max(-halfBounds, Math.min(halfBounds, pos.x));
        pos.z = Math.max(-halfBounds, Math.min(halfBounds, pos.z));

        entity.setPosition(pos);

        // Face direction of movement
        const targetAngle = Math.atan2(dirX, dirZ) * (180 / Math.PI);
        entity.setEulerAngles(0, targetAngle, 0);
      };

      entity._pedestrianScript = updateHandler;
      app.on('update', updateHandler);
      count++;
    });

    return {
      success: true,
      message: `Added walking behavior to ${count} pedestrian${count !== 1 ? 's' : ''}`,
      data: { count, walkSpeed, bounds: sceneBounds }
    };
  }
};

/**
 * Stop pedestrian movement
 */
const stopPedestrians: MCPTool = {
  name: 'stop_pedestrians',
  description: 'Stop all pedestrian movement in the scene',
  parameters: {
    type: 'object',
    properties: {}
  },
  handler: (params, app): MCPToolResult => {
    let count = 0;

    app.root.forEach((entity: any) => {
      if (entity._pedestrianScript) {
        app.off('update', entity._pedestrianScript);
        delete entity._pedestrianScript;
        app.fire('hon:npc-stop-walking', { entity });
        count++;
      }
    });

    if (count === 0) {
      return { success: false, error: 'No walking pedestrians found' };
    }

    return {
      success: true,
      message: `Stopped ${count} pedestrian${count !== 1 ? 's' : ''}`
    };
  }
};

export const componentTools: MCPTool[] = [
  addPhysics,
  addAnimation,
  removeAnimation,
  addLight,
  applyForce,
  addSound,
  // Game logic tools
  addScript,
  removeScript,
  setGameState,
  getGameState,
  startGame,
  resetGame,
  setWinCondition,
  addCollision,
  spawnProjectile,
  createSpawner,
  createPlayerController,
  // Traffic and pedestrian tools
  addTraffic,
  stopTraffic,
  addPedestrians,
  stopPedestrians
];

