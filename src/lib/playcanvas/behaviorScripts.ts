/**
 * PlayCanvas Behavior Scripts
 * 
 * Runtime scripts that attach to entities for game behaviors.
 * These are registered with PlayCanvas and can be attached via MCP tools.
 */

/**
 * Register all behavior scripts with PlayCanvas
 */
export function registerBehaviorScripts(app: any): void {
  const pc = (window as any).pc;
  if (!pc || !pc.createScript) {
    console.warn('[BehaviorScripts] PlayCanvas not ready');
    return;
  }
  
  // Player Controller Script
  const PlayerController = pc.createScript('playerController');
  
  PlayerController.attributes.add('speed', { type: 'number', default: 10 });
  PlayerController.attributes.add('jumpForce', { type: 'number', default: 8 });
  
  PlayerController.prototype.initialize = function() {
    this.grounded = true;
    this.velocity = new pc.Vec3();
    
    // Listen for collision
    if (this.entity.collision) {
      this.entity.collision.on('collisionstart', (result: any) => {
        // Check if landed on something
        if (result.contacts[0]?.normal?.y > 0.5) {
          this.grounded = true;
        }
      });
    }
  };
  
  PlayerController.prototype.update = function(dt: number) {
    // NOTE: This is a SIMPLE player controller for primitive entities (capsules/boxes).
    // For animated characters, use animatedCharacterController.ts instead.
    // This controller does NOT handle animations - it's for basic physics movement.
    
    const keyboard = this.app.keyboard;
    const speed = this.speed;
    
    let moveX = 0;
    let moveZ = 0;
    
    // WASD movement
    if (keyboard.isPressed(pc.KEY_W) || keyboard.isPressed(pc.KEY_UP)) moveZ -= 1;
    if (keyboard.isPressed(pc.KEY_S) || keyboard.isPressed(pc.KEY_DOWN)) moveZ += 1;
    if (keyboard.isPressed(pc.KEY_A) || keyboard.isPressed(pc.KEY_LEFT)) moveX -= 1;
    if (keyboard.isPressed(pc.KEY_D) || keyboard.isPressed(pc.KEY_RIGHT)) moveX += 1;
    
    // Apply movement
    if (moveX !== 0 || moveZ !== 0) {
      if (this.entity.rigidbody) {
        const velocity = this.entity.rigidbody.linearVelocity;
        this.entity.rigidbody.linearVelocity = new pc.Vec3(
          moveX * speed,
          velocity.y,
          moveZ * speed
        );
      } else {
        this.entity.translateLocal(moveX * speed * dt, 0, moveZ * speed * dt);
      }
    } else if (this.entity.rigidbody) {
      // Dampen horizontal velocity when not moving
      const velocity = this.entity.rigidbody.linearVelocity;
      this.entity.rigidbody.linearVelocity = new pc.Vec3(
        velocity.x * 0.9,
        velocity.y,
        velocity.z * 0.9
      );
    }
    
    // Jump
    if (keyboard.wasPressed(pc.KEY_SPACE) && this.grounded) {
      if (this.entity.rigidbody) {
        this.entity.rigidbody.applyImpulse(new pc.Vec3(0, this.jumpForce, 0));
        this.grounded = false;
      }
    }
    
    // Only update camera if NOT using animated character controller
    // (animated controller has its own camera follow system)
    if (!this.entity.tags.has('animated-character')) {
      const camera = this.app.root.findByName('Camera') || this.app.root.findByTag('camera')[0];
      if (camera) {
        const pos = this.entity.getPosition();
        const cameraPos = camera.getPosition();
        camera.setPosition(
          cameraPos.x + (pos.x - cameraPos.x + 0) * 0.1,
          cameraPos.y + (pos.y + 8 - cameraPos.y) * 0.1,
          cameraPos.z + (pos.z + 12 - cameraPos.z) * 0.1
        );
        camera.lookAt(pos);
      }
    }
  };
  
  // Enemy AI Script
  const EnemyAI = pc.createScript('enemyAI');
  
  EnemyAI.attributes.add('behavior', { type: 'string', default: 'chase' });
  EnemyAI.attributes.add('speed', { type: 'number', default: 5 });
  EnemyAI.attributes.add('range', { type: 'number', default: 15 });
  EnemyAI.attributes.add('damage', { type: 'number', default: 10 });
  
  EnemyAI.prototype.initialize = function() {
    this.target = null;
    this.patrolIndex = 0;
    this.wanderDirection = new pc.Vec3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    this.wanderTimer = 0;
    
    // Find player
    this.target = this.app.root.findByTag('player')[0];
    
    // Listen for collision with player
    if (this.entity.collision) {
      this.entity.collision.on('collisionstart', (result: any) => {
        if (result.other.tags.has('player')) {
          this.app.fire('hon:damage', { 
            target: result.other, 
            source: this.entity,
            damage: this.damage 
          });
        }
      });
    }
  };
  
  EnemyAI.prototype.update = function(dt: number) {
    // Re-find player if lost
    if (!this.target || !this.target.parent) {
      this.target = this.app.root.findByTag('player')[0];
    }
    
    switch (this.behavior) {
      case 'chase':
        this.updateChase(dt);
        break;
      case 'patrol':
        this.updatePatrol(dt);
        break;
      case 'wander':
        this.updateWander(dt);
        break;
      case 'turret':
        this.updateTurret(dt);
        break;
    }
  };
  
  EnemyAI.prototype.updateChase = function(dt: number) {
    if (!this.target) return;
    
    const pos = this.entity.getPosition();
    const targetPos = this.target.getPosition();
    const direction = targetPos.clone().sub(pos);
    const distance = direction.length();
    
    if (distance > 1.5 && distance < this.range) {
      direction.normalize();
      this.entity.translate(
        direction.x * this.speed * dt,
        0,
        direction.z * this.speed * dt
      );
      this.entity.lookAt(targetPos);
    }
  };
  
  EnemyAI.prototype.updateWander = function(dt: number) {
    this.wanderTimer -= dt;
    
    if (this.wanderTimer <= 0) {
      this.wanderDirection = new pc.Vec3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
      this.wanderTimer = 2 + Math.random() * 3;
    }
    
    this.entity.translate(
      this.wanderDirection.x * this.speed * dt,
      0,
      this.wanderDirection.z * this.speed * dt
    );
  };
  
  EnemyAI.prototype.updatePatrol = function(dt: number) {
    // Patrol between fixed points - simplified version
    this.entity.rotate(0, 30 * dt, 0);
    this.entity.translate(0, 0, -this.speed * dt * 0.5);
  };
  
  EnemyAI.prototype.updateTurret = function(dt: number) {
    if (!this.target) return;
    const targetPos = this.target.getPosition();
    this.entity.lookAt(targetPos);
  };
  
  // Collectible Script
  const Collectible = pc.createScript('collectible');
  
  Collectible.attributes.add('value', { type: 'number', default: 10 });
  Collectible.attributes.add('effect', { type: 'string', default: 'score' });
  Collectible.attributes.add('floatAnimation', { type: 'boolean', default: true });
  Collectible.attributes.add('rotateAnimation', { type: 'boolean', default: true });
  
  Collectible.prototype.initialize = function() {
    this.baseY = this.entity.getPosition().y;
    this.time = Math.random() * Math.PI * 2; // Random start phase
    this.collected = false;
    
    // Listen for trigger
    if (this.entity.collision) {
      this.entity.collision.on('triggerenter', (other: any) => {
        if (other.tags.has('player') && !this.collected) {
          this.collect();
        }
      });
    }
  };
  
  Collectible.prototype.update = function(dt: number) {
    if (this.collected) return;
    
    this.time += dt;
    
    // Float animation
    if (this.floatAnimation) {
      const pos = this.entity.getPosition();
      this.entity.setPosition(pos.x, this.baseY + Math.sin(this.time * 2) * 0.3, pos.z);
    }
    
    // Rotate animation
    if (this.rotateAnimation) {
      this.entity.rotate(0, 90 * dt, 0);
    }
  };
  
  Collectible.prototype.collect = function() {
    this.collected = true;
    
    // Fire event
    this.app.fire('hon:collectible', {
      effect: this.effect,
      value: this.value,
      entity: this.entity
    });
    
    // Hide or destroy
    this.entity.enabled = false;
  };
  
  // Projectile Script
  const Projectile = pc.createScript('projectile');
  
  Projectile.attributes.add('speed', { type: 'number', default: 20 });
  Projectile.attributes.add('damage', { type: 'number', default: 10 });
  Projectile.attributes.add('lifetime', { type: 'number', default: 5 });
  
  Projectile.prototype.initialize = function() {
    this.timer = 0;
    this.direction = this.entity.forward.clone().mulScalar(-1);
    
    if (this.entity.collision) {
      this.entity.collision.on('triggerenter', (other: any) => {
        if (!other.tags.has('player') && !other.tags.has('projectile')) {
          this.onHit(other);
        }
      });
    }
  };
  
  Projectile.prototype.update = function(dt: number) {
    // Move forward
    this.entity.translate(
      this.direction.x * this.speed * dt,
      this.direction.y * this.speed * dt,
      this.direction.z * this.speed * dt
    );
    
    // Lifetime
    this.timer += dt;
    if (this.timer >= this.lifetime) {
      this.entity.destroy();
    }
  };
  
  Projectile.prototype.onHit = function(target: any) {
    this.app.fire('hon:projectile-hit', {
      projectile: this.entity,
      target: target,
      damage: this.damage
    });
    this.entity.destroy();
  };
  
  // Trigger Zone Script
  const TriggerZone = pc.createScript('triggerZone');
  
  TriggerZone.attributes.add('onEnterEvent', { type: 'string', default: 'hon:trigger-enter' });
  TriggerZone.attributes.add('onExitEvent', { type: 'string', default: 'hon:trigger-exit' });
  
  TriggerZone.prototype.initialize = function() {
    if (this.entity.collision) {
      this.entity.collision.on('triggerenter', (other: any) => {
        this.app.fire(this.onEnterEvent, {
          trigger: this.entity,
          other: other
        });
      });
      
      this.entity.collision.on('triggerleave', (other: any) => {
        this.app.fire(this.onExitEvent, {
          trigger: this.entity,
          other: other
        });
      });
    }
  };
  
  console.log('[BehaviorScripts] Registered: playerController, enemyAI, collectible, projectile, triggerZone');
}

export default registerBehaviorScripts;

