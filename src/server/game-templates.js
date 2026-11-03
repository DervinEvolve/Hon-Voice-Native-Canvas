// Shared game templates for dev server
// This file must use CommonJS syntax for compatibility with server/api.ts

const gameTemplates = {
  fps: {
    id: 'fps',
    name: 'First Person Shooter',
    description: 'WASD movement, mouse look, click to shoot',
    defaultParams: {
      playerSpeed: 5,
      difficulty: 'normal',
      enemySpeed: 2,
      enemyColor: 0xff0000,
      spawnRate: 3
    },
    generate: (params) => `
// FPS Game - ${params.theme || 'Arena Shooter'}
camera.position.set(0, 1.6, 0);

// Add basic lighting
const ambient = new THREE.AmbientLight(0x404040);
scene.add(ambient);
const directional = new THREE.DirectionalLight(0xffffff, 0.5);
directional.position.set(5, 10, 5);
scene.add(directional);

// Add ground plane
const groundGeo = new THREE.PlaneGeometry(100, 100);
const groundMat = new THREE.MeshPhongMaterial({ color: 0x333333 });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// Add some walls
for (let i = 0; i < 8; i++) {
  const wallGeo = new THREE.BoxGeometry(10, 5, 1);
  const wallMat = new THREE.MeshPhongMaterial({ color: 0x666666 });
  const wall = new THREE.Mesh(wallGeo, wallMat);
  const angle = (i / 8) * Math.PI * 2;
  wall.position.set(Math.cos(angle) * 30, 2.5, Math.sin(angle) * 30);
  wall.rotation.y = angle;
  scene.add(wall);
}

// Game variables - must be defined individually
let playerX = 0;
let playerZ = 0;
let yaw = 0;
let pitch = 0;
let score = 0;
let health = 100;
let ammo = 30;

// Arrays
const enemies = [];
const bullets = [];

// Enemy spawner
function spawnEnemy() {
  const geo = new THREE.BoxGeometry(1, 2, 1);
  const mat = new THREE.MeshPhongMaterial({ color: ${params.enemyColor || 0xff0000} });
  const enemy = new THREE.Mesh(geo, mat);
  enemy.position.set(
    (Math.random() - 0.5) * 40,
    1,
    -20 - Math.random() * 20
  );
  enemy.userData.health = ${params.difficulty === 'hard' ? 3 : 1};
  enemy.userData.speed = ${(params.enemySpeed || 2) * 0.01};
  scene.add(enemy);
  enemies.push(enemy);
}

// Shoot function
function shoot() {
  if (ammo <= 0) return;
  ammo--;
  
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
  const speed = ${params.playerSpeed || 5} * dt;
  const moveX = Math.sin(yaw) * speed;
  const moveZ = Math.cos(yaw) * speed;
  
  if (input.keys['KeyW']) {
    playerX -= moveX;
    playerZ -= moveZ;
  }
  if (input.keys['KeyS']) {
    playerX += moveX;
    playerZ += moveZ;
  }
  if (input.keys['KeyA']) {
    playerX -= moveZ;
    playerZ += moveX;
  }
  if (input.keys['KeyD']) {
    playerX += moveZ;
    playerZ -= moveX;
  }
  
  // Mouse look
  if (input.pointerLocked) {
    yaw -= input.mouse.dx * 0.002;
    pitch = Math.max(-1.5, Math.min(1.5, 
      pitch - input.mouse.dy * 0.002
    ));
  }
  
  // Apply camera transform
  camera.position.x = playerX;
  camera.position.z = playerZ;
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;
  
  // Shooting
  if (input.mouse.left && ammo > 0) {
    shoot();
    input.mouse.left = false;
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
          score += 10;
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
    const dx = playerX - enemy.position.x;
    const dz = playerZ - enemy.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    
    if (dist > 2) {
      enemy.position.x += (dx / dist) * enemy.userData.speed;
      enemy.position.z += (dz / dist) * enemy.userData.speed;
    }
    
    // Damage player if too close
    if (dist < 2) {
      health = Math.max(0, health - dt * 10);
    }
  }
  
  // Spawn new enemies
  if (enemies.length < ${params.spawnRate || 3}) {
    if (Math.random() < 0.02) spawnEnemy();
  }
  
  // Ammo regen
  ammo = Math.min(30, ammo + dt * 2);
  
  // Update HUD (using 3D text for now)
  scene.userData.hudText = \`Health: \${Math.floor(health)} | Score: \${score} | Ammo: \${Math.floor(ammo)}\`;
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
  color: ${params.playerColor || 0x00ffff},
  emissive: ${params.playerColor || 0x00ffff},
  emissiveIntensity: 0.2
});
const player = new THREE.Mesh(playerGeo, playerMat);
player.position.set(0, 1, 0);
scene.add(player);

// Camera setup
camera.position.set(0, 15, 20);
camera.lookAt(0, 0, 0);

// Game variables
let x = 0;
let z = 0;
let score = 0;
let combo = 1;
let lastCollect = 0;

// Collectibles array
const coins = [];

// Spawn coin function
function spawnCoin() {
  const geo = new THREE.TorusGeometry(0.5, 0.2, 8, 16);
  const mat = new THREE.MeshPhongMaterial({ 
    color: ${params.objectColor || 0xffff00},
    emissive: ${params.objectColor || 0xffff00},
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
        color: ${params.objectColor || 0xffff00} 
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
for (let i = 0; i < ${params.spawnRate || 10}; i++) {
  spawnCoin();
}

// Game loop
scene.userData.update = ({ time, dt, input }) => {
  // Player movement
  const speed = ${params.playerSpeed || 8} * dt;
  
  if (input.keys['KeyW']) z -= speed;
  if (input.keys['KeyS']) z += speed;
  if (input.keys['KeyA']) x -= speed;
  if (input.keys['KeyD']) x += speed;
  
  // Bounds
  x = Math.max(-15, Math.min(15, x));
  z = Math.max(-15, Math.min(15, z));
  
  player.position.x = x;
  player.position.z = z;
  
  // Spawn more coins
  if (coins.length < ${params.spawnRate || 10}) {
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
      const timeSinceLast = time - lastCollect;
      if (timeSinceLast < 1000) {
        combo = Math.min(5, combo + 0.5);
      } else {
        combo = 1;
      }
      
      score += Math.floor(10 * combo);
      lastCollect = time;
      
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
    name: 'Endless Dodger',
    description: 'Dodge obstacles in an endless runner',
    defaultParams: {
      playerColor: 0xff0000,
      objectColor: 0x00ff00,
      playerSpeed: 10,
      enemySpeed: 5
    },
    generate: (params) => `
// Dodger Game - ${params.theme || 'Endless Runner'}
const playerGeo = new THREE.ConeGeometry(1, 2, 8);
const playerMat = new THREE.MeshPhongMaterial({ 
  color: ${params.playerColor || 0xff0000} 
});
const player = new THREE.Mesh(playerGeo, playerMat);
player.position.set(0, 5, 10);
scene.add(player);

// Camera behind player
camera.position.set(0, 8, 20);
camera.lookAt(0, 5, 0);

// Game variables
let x = 0;
let y = 5;
let gameScore = 0;
let speed = ${params.enemySpeed || 5};
let gameOver = false;

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
    color: ${params.objectColor || 0x00ff00} 
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
  if (gameOver) return;
  
  // Player movement
  const moveSpeed = ${params.playerSpeed || 10} * dt;
  
  if (input.keys['KeyA']) x -= moveSpeed;
  if (input.keys['KeyD']) x += moveSpeed;
  if (input.keys['KeyW'] || input.keys['Space']) y += moveSpeed;
  if (input.keys['KeyS']) y -= moveSpeed;
  
  // Bounds and gravity
  x = Math.max(-10, Math.min(10, x));
  y = Math.max(0.5, Math.min(10, y));
  
  // Apply gravity
  if (y > 0.5) {
    y -= 5 * dt;
  }
  
  player.position.x = x;
  player.position.y = y;
  
  // Spawn obstacles
  if (obstacles.length === 0 || 
      obstacles[obstacles.length - 1].position.z > -40) {
    spawnObstacle();
  }
  
  // Update obstacles
  for (let i = obstacles.length - 1; i >= 0; i--) {
    const obs = obstacles[i];
    obs.position.z += speed * dt;
    
    // Check collision
    const dx = Math.abs(player.position.x - obs.position.x);
    const dy = Math.abs(player.position.y - obs.position.y);
    const dz = Math.abs(player.position.z - obs.position.z);
    
    if (dx < 2 && dy < 2 && dz < 2.5) {
      gameOver = true;
      player.material.color.setHex(0x333333);
    }
    
    // Remove passed obstacles
    if (obs.position.z > 25) {
      scene.remove(obs);
      obstacles.splice(i, 1);
      gameScore += 10;
      
      // Increase difficulty
      speed = Math.min(30, speed + 0.1);
    }
  }
};`
  }
};

module.exports = gameTemplates;
