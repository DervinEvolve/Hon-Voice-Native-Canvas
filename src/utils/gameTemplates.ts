// Game Template System for Reliable Game Generation
// Each template is a working game with customizable parameters

export interface GameParameters {
  type: 'fps' | 'collector' | 'dodger' | 'shooter' | 'platformer';
  playerColor?: number;
  enemyColor?: number;
  objectColor?: number;
  playerSpeed?: number;
  enemySpeed?: number;
  spawnRate?: number;
  difficulty?: 'easy' | 'medium' | 'hard';
  theme?: string;
}

export interface GameTemplate {
  id: string;
  name: string;
  description: string;
  defaultParams: Partial<GameParameters>;
  generate: (params: GameParameters) => string;
}

// Helper to ensure safe number/color values
const safe = {
  color: (c?: number) => c ?? 0x00ff00,
  speed: (s?: number) => Math.max(1, Math.min(20, s ?? 8)),
  rate: (r?: number) => Math.max(0.5, Math.min(10, r ?? 3))
};

export const gameTemplates: Record<string, GameTemplate> = {
  fps: {
    id: 'fps',
    name: 'First Person Shooter',
    description: 'WASD movement, mouse look, click to shoot',
    defaultParams: {
      playerSpeed: 5,
      enemySpeed: 2,
      enemyColor: 0xff0000,
      spawnRate: 3
    },
    generate: (params) => `
// FPS Game - ${params.theme || 'Arena Shooter'}
camera.position.set(0, 1.6, 0);

// Crosshair
const crosshair = document.createElement('div');
crosshair.style.cssText = 'position:absolute;top:50%;left:50%;width:4px;height:4px;background:white;transform:translate(-50%,-50%);pointer-events:none;z-index:1000;';
document.body.appendChild(crosshair);

// Game state
const state = {
  playerX: 0,
  playerZ: 0,
  yaw: 0,
  pitch: 0,
  score: 0,
  health: 100,
  ammo: 30
};

// Arrays
const enemies = [];
const bullets = [];

// Enemy spawner
function spawnEnemy() {
  const geo = new THREE.BoxGeometry(1, 2, 1);
  const mat = new THREE.MeshPhongMaterial({ color: ${safe.color(params.enemyColor)} });
  const enemy = new THREE.Mesh(geo, mat);
  enemy.position.set(
    (Math.random() - 0.5) * 40,
    1,
    -20 - Math.random() * 20
  );
  enemy.userData.health = ${params.difficulty === 'hard' ? 3 : 1};
  enemy.userData.speed = ${safe.speed(params.enemySpeed)} * 0.01;
  scene.add(enemy);
  enemies.push(enemy);
}

// Shoot function
function shoot() {
  if (state.ammo <= 0) return;
  state.ammo--;
  
  const geo = new THREE.SphereGeometry(0.1);
  const mat = new THREE.MeshPhongMaterial({ 
    color: 0xffff00,
    emissive: 0xffff00,
    emissiveIntensity: 0.5
  });
  const bullet = new THREE.Mesh(geo, mat);
  bullet.position.copy(camera.position);
  
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);
  bullet.userData.velocity = direction.multiplyScalar(50);
  
  scene.add(bullet);
  bullets.push(bullet);
}

// Initial enemies
for (let i = 0; i < ${params.difficulty === 'easy' ? 3 : 5}; i++) {
  spawnEnemy();
}

// Game loop
scene.userData.update = ({ dt, input }) => {
  // Player movement
  const speed = ${safe.speed(params.playerSpeed)} * dt;
  const moveX = Math.sin(state.yaw) * speed;
  const moveZ = Math.cos(state.yaw) * speed;
  
  if (input.keys['KeyW']) {
    state.playerX -= moveX;
    state.playerZ -= moveZ;
  }
  if (input.keys['KeyS']) {
    state.playerX += moveX;
    state.playerZ += moveZ;
  }
  if (input.keys['KeyA']) {
    state.playerX -= moveZ;
    state.playerZ += moveX;
  }
  if (input.keys['KeyD']) {
    state.playerX += moveZ;
    state.playerZ -= moveX;
  }
  
  // Mouse look
  if (input.pointerLocked) {
    state.yaw -= input.mouse.dx * 0.002;
    state.pitch = Math.max(-1.5, Math.min(1.5, 
      state.pitch - input.mouse.dy * 0.002
    ));
  }
  
  // Apply camera transform
  camera.position.x = state.playerX;
  camera.position.z = state.playerZ;
  camera.rotation.y = state.yaw;
  camera.rotation.x = state.pitch;
  
  // Shooting
  if (input.keys['Space']) {
    shoot();
    input.keys['Space'] = false;
  }
  
  // Update bullets
  for (let i = bullets.length - 1; i >= 0; i--) {
    const bullet = bullets[i];
    bullet.position.add(
      bullet.userData.velocity.clone().multiplyScalar(dt)
    );
    
    // Check enemy hits
    for (let j = enemies.length - 1; j >= 0; j--) {
      const enemy = enemies[j];
      if (bullet.position.distanceTo(enemy.position) < 1) {
        enemy.userData.health--;
        scene.remove(bullet);
        bullets.splice(i, 1);
        
        if (enemy.userData.health <= 0) {
          scene.remove(enemy);
          enemies.splice(j, 1);
          state.score += 10;
        }
        break;
      }
    }
    
    // Remove distant bullets
    if (bullet.position.length() > 100) {
      scene.remove(bullet);
      bullets.splice(i, 1);
    }
  }
  
  // Update enemies
  for (const enemy of enemies) {
    // Move towards player
    const dx = state.playerX - enemy.position.x;
    const dz = state.playerZ - enemy.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    
    if (dist > 2) {
      enemy.position.x += (dx / dist) * enemy.userData.speed;
      enemy.position.z += (dz / dist) * enemy.userData.speed;
    }
    
    // Damage player if too close
    if (dist < 2) {
      state.health = Math.max(0, state.health - dt * 10);
    }
  }
  
  // Spawn new enemies
  if (enemies.length < ${params.spawnRate}) {
    if (Math.random() < 0.02) spawnEnemy();
  }
  
  // Ammo regen
  state.ammo = Math.min(30, state.ammo + dt * 2);
};`
  },

  collector: {
    id: 'collector',
    name: 'Coin Collector',
    description: 'Collect coins with WASD movement',
    defaultParams: {
      playerColor: 0x00ffff,
      objectColor: 0xffff00,
      playerSpeed: 8,
      spawnRate: 10
    },
    generate: (params) => `
// Collector Game - ${params.theme || 'Coin Rush'}
const playerGeo = new THREE.SphereGeometry(1, 16, 16);
const playerMat = new THREE.MeshPhongMaterial({ 
  color: ${safe.color(params.playerColor)},
  emissive: ${safe.color(params.playerColor)},
  emissiveIntensity: 0.2
});
const player = new THREE.Mesh(playerGeo, playerMat);
player.position.set(0, 1, 0);
scene.add(player);

// Camera setup
camera.position.set(0, 15, 20);
camera.lookAt(0, 0, 0);

// Game state
const state = {
  x: 0,
  z: 0,
  score: 0,
  combo: 1,
  lastCollect: 0
};

// Collectibles array
const coins = [];

// Spawn coin function
function spawnCoin() {
  const geo = new THREE.TorusGeometry(0.5, 0.2, 8, 16);
  const mat = new THREE.MeshPhongMaterial({ 
    color: ${safe.color(params.objectColor)},
    emissive: ${safe.color(params.objectColor)},
    emissiveIntensity: 0.3
  });
  const coin = new THREE.Mesh(geo, mat);
  coin.position.set(
    (Math.random() - 0.5) * 30,
    1,
    (Math.random() - 0.5) * 30
  );
  coin.rotation.x = Math.PI / 2;
  coin.userData.collected = false;
  scene.add(coin);
  coins.push(coin);
}

// Particle effect
function collectEffect(pos) {
  for (let i = 0; i < 8; i++) {
    const particle = new THREE.Mesh(
      new THREE.SphereGeometry(0.1),
      new THREE.MeshBasicMaterial({ 
        color: ${safe.color(params.objectColor)} 
      })
    );
    particle.position.copy(pos);
    particle.userData.velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 5,
      Math.random() * 5 + 2,
      (Math.random() - 0.5) * 5
    );
    particle.userData.life = 1;
    scene.add(particle);
    
    // Auto cleanup after 1 second
    setTimeout(() => scene.remove(particle), 1000);
  }
}

// Initial coins
for (let i = 0; i < ${safe.rate(params.spawnRate)}; i++) {
  spawnCoin();
}

// Game loop
scene.userData.update = ({ time, dt, input }) => {
  // Player movement
  const speed = ${safe.speed(params.playerSpeed)} * dt;
  
  if (input.keys['KeyW']) state.z -= speed;
  if (input.keys['KeyS']) state.z += speed;
  if (input.keys['KeyA']) state.x -= speed;
  if (input.keys['KeyD']) state.x += speed;
  
  // Bounds
  state.x = Math.max(-15, Math.min(15, state.x));
  state.z = Math.max(-15, Math.min(15, state.z));
  
  player.position.x = state.x;
  player.position.z = state.z;
  
  // Spawn more coins
  if (coins.length < ${safe.rate(params.spawnRate)}) {
    spawnCoin();
  }
  
  // Update coins and check collection
  for (let i = coins.length - 1; i >= 0; i--) {
    const coin = coins[i];
    
    // Rotate coin
    coin.rotation.y += dt * 2;
    
    // Bob up and down
    coin.position.y = 1 + Math.sin(time * 0.003 + i) * 0.2;
    
    // Check collection
    const dist = player.position.distanceTo(coin.position);
    if (dist < 2 && !coin.userData.collected) {
      coin.userData.collected = true;
      
      // Combo scoring
      const timeSinceLast= time - state.lastCollect;
      if (timeSinceLast< 1000) {
        state.combo = Math.min(5, state.combo + 0.5);
      } else {
        state.combo = 1;
      }
      
      state.score += Math.floor(10 * state.combo);
      state.lastCollect = time;
      
      // Effects
      collectEffect(coin.position);
      
      // Remove coin
      scene.remove(coin);
      coins.splice(i, 1);
    }
  }
  
  // Update particles (if any)
  scene.children.forEach(child => {
    if (child.userData.velocity) {
      child.position.add(
        child.userData.velocity.clone().multiplyScalar(dt)
      );
      child.userData.velocity.y -= 10 * dt;
      child.userData.life -= dt;
      if (child.userData.life <= 0) {
        scene.remove(child);
      }
    }
  });
};`
  },

  dodger: {
    id: 'dodger',
    name: 'Obstacle Dodger',
    description: 'Dodge incoming obstacles',
    defaultParams: {
      playerColor: 0xff0000,
      objectColor: 0x00ff00,
      playerSpeed: 10,
      enemySpeed: 5
    },
    generate: (params) => `
// Dodger Game - ${params.theme || 'Endless Runner'}
const playerGeo = new THREE.BoxGeometry(2, 1, 3);
const playerMat = new THREE.MeshPhongMaterial({ 
  color: ${safe.color(params.playerColor)} 
});
const player = new THREE.Mesh(playerGeo, playerMat);
player.position.set(0, 5, 10);
scene.add(player);

// Camera behind player
camera.position.set(0, 8, 20);
camera.lookAt(0, 5, 0);

// Game state
const state = {
  x: 0,
  y: 5,
  score: 0,
  speed: ${safe.speed(params.enemySpeed)},
  gameOver: false
};

// Obstacles array
const obstacles = [];

// Spawn obstacle
function spawnObstacle() {
  const type = Math.random();
  let geo, yPos;
  
  if (type < 0.5) {
    // Ground obstacle
    geo = new THREE.BoxGeometry(2, 2, 2);
    yPos = 1;
  } else {
    // Air obstacle
    geo = new THREE.BoxGeometry(3, 1, 2);
    yPos = 5 + (Math.random() - 0.5) * 4;
  }
  
  const mat = new THREE.MeshPhongMaterial({ 
    color: ${safe.color(params.objectColor)} 
  });
  const obs = new THREE.Mesh(geo, mat);
  obs.position.set(
    (Math.random() - 0.5) * 20,
    yPos,
    -50
  );
  scene.add(obs);
  obstacles.push(obs);
}

// Game loop
scene.userData.update = ({ dt, input }) => {
  if (state.gameOver) return;
  
  // Player movement
  const speed = ${safe.speed(params.playerSpeed)} * dt;
  
  if (input.keys['KeyA']) state.x -= speed;
  if (input.keys['KeyD']) state.x += speed;
  if (input.keys['KeyW'] || input.keys['Space']) state.y += speed;
  if (input.keys['KeyS']) state.y -= speed;
  
  // Bounds and gravity
  state.x = Math.max(-10, Math.min(10, state.x));
  state.y = Math.max(0.5, Math.min(10, state.y));
  
  // Apply gravity
  if (state.y > 0.5) {
    state.y -= 5 * dt;
  }
  
  player.position.x = state.x;
  player.position.y = state.y;
  
  // Spawn obstacles
  if (obstacles.length === 0 || 
      obstacles[obstacles.length - 1].position.z > -40) {
    spawnObstacle();
  }
  
  // Update obstacles
  for (let i = obstacles.length - 1; i >= 0; i--) {
    const obs = obstacles[i];
    obs.position.z += state.speed * dt;
    
    // Check collision
    const dx = Math.abs(player.position.x - obs.position.x);
    const dy = Math.abs(player.position.y - obs.position.y);
    const dz = Math.abs(player.position.z - obs.position.z);
    
    if (dx < 2 && dy < 2 && dz < 2.5) {
      state.gameOver = true;
      player.material.color.setHex(0x333333);
    }
    
    // Remove passed obstacles
    if (obs.position.z > 25) {
      scene.remove(obs);
      obstacles.splice(i, 1);
      state.score += 10;
      
      // Increase difficulty
      state.speed = Math.min(30, state.speed + 0.1);
    }
  }
};`
  }
};

// Extract game type from description using simple keyword matching
export function detectGameType(description: string): GameParameters['type'] {
  const desc = description.toLowerCase();
  
  if (desc.includes('fps') || desc.includes('first person') || desc.includes('shoot')) {
    return 'fps';
  }
  if (desc.includes('collect') || desc.includes('coin') || desc.includes('gather')) {
    return 'collector';
  }
  if (desc.includes('dodge') || desc.includes('avoid') || desc.includes('runner')) {
    return 'dodger';
  }
  if (desc.includes('shoot') || desc.includes('space')) {
    return 'shooter';
  }
  
  // Default to collector as it's simplest
  return 'collector';
}

// Generate a game from a description
export function generateGameFromTemplate(description: string): string {
  const type = detectGameType(description);
  const template = gameTemplates[type];
  
  if (!template) {
    throw new Error(`Unknown game type: ${type}`);
  }
  
  // Extract parameters from description (can be enhanced with LLM)
  const params: GameParameters = {
    type,
    ...template.defaultParams,
    theme: description.slice(0, 50)
  };
  
  // Parse specific requests
  const desc = description.toLowerCase();
  if (desc.includes('fast')) {
    params.playerSpeed = 12;
    params.enemySpeed = 8;
  }
  if (desc.includes('hard') || desc.includes('difficult')) {
    params.difficulty = 'hard';
  }
  if (desc.includes('easy')) {
    params.difficulty = 'easy';
  }
  
  return template.generate(params);
}
