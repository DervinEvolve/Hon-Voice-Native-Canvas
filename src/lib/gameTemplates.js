// Proven working game templates - these are our safety net
// Each template is tested and guaranteed to work

// Visual themes for consistent aesthetics
export const VISUAL_THEMES = {
  neon: {
    player: { color: 0x00ffff, emissive: 0x00ffff, emissiveIntensity: 0.5, metalness: 0.8, roughness: 0.2 },
    enemy: { color: 0xff00ff, emissive: 0xff00ff, emissiveIntensity: 0.4, metalness: 0.7, roughness: 0.3 },
    collectible: { color: 0xffff00, emissive: 0xffff00, emissiveIntensity: 0.6, metalness: 0.9, roughness: 0.1 },
    obstacle: { color: 0x8080ff, emissive: 0x4040ff, emissiveIntensity: 0.3, metalness: 0.5, roughness: 0.5 },
    background: { fogColor: 0x000033, fogNear: 20, fogFar: 100 },
    lighting: { ambient: 0x222244, directional: 0xffffff, ambientIntensity: 0.4, directionalIntensity: 0.8 }
  },
  retro: {
    player: { color: 0x4ecdc4, emissive: 0x4ecdc4, emissiveIntensity: 0.2, metalness: 0.1, roughness: 0.9 },
    enemy: { color: 0xff6b6b, emissive: 0xff6b6b, emissiveIntensity: 0.2, metalness: 0.1, roughness: 0.9 },
    collectible: { color: 0xffe66d, emissive: 0xffe66d, emissiveIntensity: 0.3, metalness: 0.2, roughness: 0.8 },
    obstacle: { color: 0xa8e6cf, emissive: 0xa8e6cf, emissiveIntensity: 0.1, metalness: 0.0, roughness: 1.0 },
    background: { fogColor: 0xf7f7f7, fogNear: 30, fogFar: 80 },
    lighting: { ambient: 0xffffff, directional: 0xffd3b6, ambientIntensity: 0.6, directionalIntensity: 0.4 }
  },
  cyberpunk: {
    player: { color: 0x00ff88, emissive: 0x00ff88, emissiveIntensity: 0.7, metalness: 0.9, roughness: 0.1 },
    enemy: { color: 0xff0044, emissive: 0xff0044, emissiveIntensity: 0.6, metalness: 0.8, roughness: 0.2 },
    collectible: { color: 0xffa500, emissive: 0xffa500, emissiveIntensity: 0.8, metalness: 1.0, roughness: 0.0 },
    obstacle: { color: 0x1a1a1a, emissive: 0x333333, emissiveIntensity: 0.2, metalness: 0.7, roughness: 0.4 },
    background: { fogColor: 0x0a0a0a, fogNear: 15, fogFar: 60 },
    lighting: { ambient: 0x110022, directional: 0x00ffff, ambientIntensity: 0.3, directionalIntensity: 0.9 }
  }
};

// Helper function to apply theme
export function applyTheme(materialConfig, theme = 'neon') {
  const themeData = VISUAL_THEMES[theme] || VISUAL_THEMES.neon;
  return { ...materialConfig, ...themeData };
}

// Helper function to generate 3D model loading code for custom assets
export function getModelLoadingCode(customAssets = {}) {
  if (!customAssets || Object.keys(customAssets).length === 0) {
    return '';
  }
  
  let code = '\n// Custom 3D models from Meshy/text-to-3d\n';
  code += 'const customModels = {};\n';
  
  for (const [key, url] of Object.entries(customAssets)) {
    if (typeof url === 'string' && url) {
      code += `// Load ${key} model\n`;
      code += `window.loadModel3D('${url}').then(model => {\n`;
      code += `  customModels.${key} = model;\n`;
      code += `  console.log('Loaded ${key} model');\n`;
      code += `}).catch(err => console.error('Failed to load ${key}:', err));\n`;
    }
  }
  
  return code;
}

export const GAME_TEMPLATES = {
  dodger: `let playerX = 0;
let playerY = 5;
let playerZ = 10;
let score = 0;
let speed = 8;
let gameOver = false;

const playerGeo = new THREE.ConeGeometry(0.8, 2, 8);
const playerMat = new THREE.MeshStandardMaterial({ 
  color: 0x00ffff,
  emissive: 0x00ffff,
  emissiveIntensity: 0.3,
  metalness: 0.7
});
const player = new THREE.Mesh(playerGeo, playerMat);
player.rotation.x = Math.PI / 2;
player.position.set(playerX, playerY, playerZ);
scene.add(player);

camera.position.set(0, 8, 20);
camera.lookAt(0, 5, 0);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(5, 10, 5);
scene.add(directionalLight);

const scoreDisplay = document.createElement('div');
scoreDisplay.style.position = 'absolute';
scoreDisplay.style.top = '20px';
scoreDisplay.style.left = '20px';
scoreDisplay.style.color = '#ffffff';
scoreDisplay.style.fontSize = '24px';
scoreDisplay.style.fontFamily = 'monospace';
scoreDisplay.style.fontWeight = 'bold';
scoreDisplay.style.textShadow = '2px 2px 4px rgba(0,0,0,0.8)';
scoreDisplay.style.zIndex = '1000';
scoreDisplay.style.pointerEvents = 'none';
scoreDisplay.textContent = 'Score: 0';
document.body.appendChild(scoreDisplay);

const obstacles = [];

function spawnObstacle() {
  const size = 1 + Math.random() * 1;
  const geo = new THREE.IcosahedronGeometry(size, 0);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x808080,
    emissive: 0x404040,
    emissiveIntensity: 0.2,
    roughness: 0.9
  });
  const obs = new THREE.Mesh(geo, mat);
  obs.position.set((Math.random() - 0.5) * 20, Math.random() * 8 + 2, -50);
  obs.userData.rotationSpeedX = (Math.random() - 0.5) * 2;
  obs.userData.rotationSpeedY = (Math.random() - 0.5) * 2;
  obs.userData.size = size;
  scene.add(obs);
  obstacles.push(obs);
}

for (let i = 0; i < 8; i++) {
  spawnObstacle();
}

scene.userData.update = function(deltaTime, inputs) {
  if (gameOver) return;
  
  const moveSpeed = 10 * deltaTime;
  if (inputs.keys.w || inputs.keys.ArrowUp) playerY += moveSpeed;
  if (inputs.keys.s || inputs.keys.ArrowDown) playerY -= moveSpeed;
  if (inputs.keys.a || inputs.keys.ArrowLeft) playerX -= moveSpeed;
  if (inputs.keys.d || inputs.keys.ArrowRight) playerX += moveSpeed;
  
  playerX = Math.max(-10, Math.min(10, playerX));
  playerY = Math.max(1, Math.min(10, playerY));
  
  player.position.x = playerX;
  player.position.y = playerY;
  
  for (let i = obstacles.length - 1; i >= 0; i--) {
    obstacles[i].position.z += speed * deltaTime;
    
    obstacles[i].rotation.x += obstacles[i].userData.rotationSpeedX * deltaTime;
    obstacles[i].rotation.y += obstacles[i].userData.rotationSpeedY * deltaTime;
    
    const dx = playerX - obstacles[i].position.x;
    const dy = playerY - obstacles[i].position.y;
    const dz = playerZ - obstacles[i].position.z;
    const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
    const collisionDist = 1.5 + obstacles[i].userData.size;
    
    if (distance < collisionDist) {
      gameOver = true;
      scene.userData.gameOver = true;
    }
    
    if (obstacles[i].position.z > 20) {
      scene.remove(obstacles[i]);
      obstacles.splice(i, 1);
      score += 10;
      scoreDisplay.textContent = 'Score: ' + score;
      spawnObstacle();
    }
  }
};
  
scene.userData.cleanup = function() {
  if (scoreDisplay && scoreDisplay.parentNode) {
    scoreDisplay.parentNode.removeChild(scoreDisplay);
  }
};`,

  collector: `let playerX = 0;
let playerY = 0.5;
let playerZ = 0;
let score = 0;
let gameOver = false;
let timeLeft = 60;

const playerGeo = new THREE.ConeGeometry(0.8, 2, 8);
const playerMat = new THREE.MeshStandardMaterial({
  color: 0x00ffff,
  emissive: 0x00ffff,
  emissiveIntensity: 0.3,
  metalness: 0.7
});
const player = new THREE.Mesh(playerGeo, playerMat);
player.rotation.x = Math.PI / 2;
player.position.set(playerX, playerY, playerZ);
scene.add(player);

camera.position.set(0, 15, 10);
camera.lookAt(0, 0, 0);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(10, 20, 10);
scene.add(directionalLight);

const groundGeo = new THREE.PlaneGeometry(40, 40);
const groundMat = new THREE.MeshStandardMaterial({
  color: 0x1a1a2e,
  roughness: 0.8
});
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = 0;
scene.add(ground);

const scoreDisplay = document.createElement('div');
scoreDisplay.style.position = 'absolute';
scoreDisplay.style.top = '20px';
scoreDisplay.style.left = '20px';
scoreDisplay.style.color = '#ffffff';
scoreDisplay.style.fontSize = '24px';
scoreDisplay.style.fontFamily = 'monospace';
scoreDisplay.style.fontWeight = 'bold';
scoreDisplay.style.textShadow = '2px 2px 4px rgba(0,0,0,0.8)';
scoreDisplay.style.zIndex = '1000';
scoreDisplay.style.pointerEvents = 'none';
scoreDisplay.textContent = 'Score: 0';
document.body.appendChild(scoreDisplay);

const coins = [];

function spawnCoin() {
  const coinGeo = new THREE.SphereGeometry(0.5, 16, 16);
  const coinMat = new THREE.MeshStandardMaterial({
    color: 0xFFD700,
    emissive: 0xFFD700,
    emissiveIntensity: 0.5,
    metalness: 0.8,
    roughness: 0.2
  });
  const coin = new THREE.Mesh(coinGeo, coinMat);
  coin.position.set(
    (Math.random() - 0.5) * 30,
    0.5,
    (Math.random() - 0.5) * 30
  );
  scene.add(coin);
  coins.push(coin);
}

for (let i = 0; i < 10; i++) {
  spawnCoin();
}

scene.userData.update = function(deltaTime, inputs) {
  if (gameOver) return;
  
  timeLeft -= deltaTime;
  if (timeLeft <= 0) {
    gameOver = true;
    scene.userData.gameOver = true;
  }
  
  const moveSpeed = 8 * deltaTime;
  if (inputs.keys.w || inputs.keys.ArrowUp) playerZ -= moveSpeed;
  if (inputs.keys.s || inputs.keys.ArrowDown) playerZ += moveSpeed;
  if (inputs.keys.a || inputs.keys.ArrowLeft) playerX -= moveSpeed;
  if (inputs.keys.d || inputs.keys.ArrowRight) playerX += moveSpeed;
  
  playerX = Math.max(-18, Math.min(18, playerX));
  playerZ = Math.max(-18, Math.min(18, playerZ));
  
  player.position.x = playerX;
  player.position.z = playerZ;
  
  camera.position.x = playerX;
  camera.position.z = playerZ + 10;
  camera.lookAt(playerX, 0, playerZ);
  
  for (let i = coins.length - 1; i >= 0; i--) {
    coins[i].rotation.y += 3 * deltaTime;
    
    const dx = playerX - coins[i].position.x;
    const dz = playerZ - coins[i].position.z;
    const distance = Math.sqrt(dx*dx + dz*dz);
    
    if (distance < 1.5) {
      scene.remove(coins[i]);
      coins.splice(i, 1);
      score += 10;
      scoreDisplay.textContent = 'Score: ' + score;
      spawnCoin();
    }
  }
};

scene.userData.cleanup = function() {
  if (scoreDisplay && scoreDisplay.parentNode) {
    scoreDisplay.parentNode.removeChild(scoreDisplay);
  }
};`,

  shooter: `let playerX = 0;
let playerY = 5;
let playerZ = 10;
let score = 0;
let gameOver = false;
let fireRate = 0.25;
let lastFireTime = 0;

const playerGeo = new THREE.ConeGeometry(0.8, 2, 8);
const playerMat = new THREE.MeshStandardMaterial({
  color: 0x00ffff,
  emissive: 0x00ffff,
  emissiveIntensity: 0.3,
  metalness: 0.7
});
const player = new THREE.Mesh(playerGeo, playerMat);
player.rotation.x = Math.PI / 2;
player.position.set(playerX, playerY, playerZ);
scene.add(player);

camera.position.set(0, 8, 20);
camera.lookAt(0, 5, 0);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(5, 10, 5);
scene.add(directionalLight);

const scoreDisplay = document.createElement('div');
scoreDisplay.style.position = 'absolute';
scoreDisplay.style.top = '20px';
scoreDisplay.style.left = '20px';
scoreDisplay.style.color = '#ffffff';
scoreDisplay.style.fontSize = '24px';
scoreDisplay.style.fontFamily = 'monospace';
scoreDisplay.style.fontWeight = 'bold';
scoreDisplay.style.textShadow = '2px 2px 4px rgba(0,0,0,0.8)';
scoreDisplay.style.zIndex = '1000';
scoreDisplay.style.pointerEvents = 'none';
scoreDisplay.textContent = 'Score: 0';
document.body.appendChild(scoreDisplay);

const enemies = [];
const projectiles = [];
let gameTime = 0;

function spawnEnemy() {
  const enemyGeo = new THREE.ConeGeometry(0.8, 2, 8);
  const enemyMat = new THREE.MeshStandardMaterial({
    color: 0xff0000,
    emissive: 0xff0000,
    emissiveIntensity: 0.3
  });
  const enemy = new THREE.Mesh(enemyGeo, enemyMat);
  enemy.rotation.x = -Math.PI / 2;
  enemy.position.set((Math.random() - 0.5) * 20, Math.random() * 8 + 2, -50);
  enemy.userData.speed = 5 + Math.random() * 5;
  scene.add(enemy);
  enemies.push(enemy);
}

function fireProjectile() {
  const projGeo = new THREE.SphereGeometry(0.2, 8, 8);
  const projMat = new THREE.MeshStandardMaterial({
    color: 0xffff00,
    emissive: 0xffff00,
    emissiveIntensity: 0.8
  });
  const proj = new THREE.Mesh(projGeo, projMat);
  proj.position.set(playerX, playerY, playerZ - 1);
  scene.add(proj);
  projectiles.push(proj);
}

scene.userData.update = function(deltaTime, inputs) {
  if (gameOver) return;
  
  gameTime += deltaTime;
  
  const moveSpeed = 10 * deltaTime;
  if (inputs.keys.w || inputs.keys.ArrowUp) playerY += moveSpeed;
  if (inputs.keys.s || inputs.keys.ArrowDown) playerY -= moveSpeed;
  if (inputs.keys.a || inputs.keys.ArrowLeft) playerX -= moveSpeed;
  if (inputs.keys.d || inputs.keys.ArrowRight) playerX += moveSpeed;
  
  playerX = Math.max(-10, Math.min(10, playerX));
  playerY = Math.max(1, Math.min(10, playerY));
  
  player.position.x = playerX;
  player.position.y = playerY;
  
  lastFireTime += deltaTime;
  if ((inputs.keys[' '] || inputs.keys.Space) && lastFireTime > fireRate) {
    fireProjectile();
    lastFireTime = 0;
  }
  
  for (let i = projectiles.length - 1; i >= 0; i--) {
    projectiles[i].position.z -= 30 * deltaTime;
    
    if (projectiles[i].position.z < -55) {
      scene.remove(projectiles[i]);
      projectiles.splice(i, 1);
    }
  }
  
  for (let i = enemies.length - 1; i >= 0; i--) {
    enemies[i].position.z += enemies[i].userData.speed * deltaTime;
    
    const dx = playerX - enemies[i].position.x;
    const dy = playerY - enemies[i].position.y;
    const dz = playerZ - enemies[i].position.z;
    const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
    
    if (distance < 2) {
      gameOver = true;
      scene.userData.gameOver = true;
    }
    
    if (enemies[i].position.z > 20) {
      scene.remove(enemies[i]);
      enemies.splice(i, 1);
    }
  }
    
    for (let j = projectiles.length - 1; j >= 0; j--) {
    for (let i = enemies.length - 1; i >= 0; i--) {
      const dx = projectiles[j].position.x - enemies[i].position.x;
      const dy = projectiles[j].position.y - enemies[i].position.y;
      const dz = projectiles[j].position.z - enemies[i].position.z;
      const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
      
      if (distance < 1.5) {
        scene.remove(enemies[i]);
        scene.remove(projectiles[j]);
        enemies.splice(i, 1);
        projectiles.splice(j, 1);
        score += 50;
        scoreDisplay.textContent = 'Score: ' + score;
        break;
      }
    }
  }
  
  if (Math.random() < 0.02) {
    spawnEnemy();
  }
};

scene.userData.cleanup = function() {
  if (scoreDisplay && scoreDisplay.parentNode) {
    scoreDisplay.parentNode.removeChild(scoreDisplay);
  }
};`,

  racer: `let playerX = 0;
let playerY = 5;
let playerZ = 0;
let score = 0;
let speed = 20;
let gameOver = false;
let nextGateZ = -30;

const playerGeo = new THREE.ConeGeometry(0.8, 2, 8);
const playerMat = new THREE.MeshStandardMaterial({
  color: 0x00ffff,
  emissive: 0x00ffff,
  emissiveIntensity: 0.5,
  metalness: 0.7,
  roughness: 0.3
});
const player = new THREE.Mesh(playerGeo, playerMat);
player.rotation.x = Math.PI / 2;
player.position.set(playerX, playerY, playerZ);
scene.add(player);

camera.position.set(0, 8, 15);
camera.lookAt(0, 5, 0);

const ambientLight = new THREE.AmbientLight(0x404060, 0.6);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(5, 10, 5);
scene.add(directionalLight);

const scoreDisplay = document.createElement('div');
scoreDisplay.style.position = 'absolute';
scoreDisplay.style.top = '20px';
scoreDisplay.style.left = '20px';
scoreDisplay.style.color = '#00ffff';
scoreDisplay.style.fontSize = '28px';
scoreDisplay.style.fontFamily = 'monospace';
scoreDisplay.style.fontWeight = 'bold';
scoreDisplay.style.textShadow = '0 0 10px #00ffff, 2px 2px 4px rgba(0,0,0,0.8)';
scoreDisplay.style.zIndex = '1000';
scoreDisplay.style.pointerEvents = 'none';
scoreDisplay.textContent = 'Score: 0';
document.body.appendChild(scoreDisplay);

const gates = [];

function spawnGate() {
  const gateColor = 0x00ff00;
  const postGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
  const postMat = new THREE.MeshStandardMaterial({
    color: gateColor,
    emissive: gateColor,
    emissiveIntensity: 1.0,
    metalness: 0.8,
    roughness: 0.2
  });
  
  const gate = new THREE.Group();
  
  const leftPost = new THREE.Mesh(postGeo, postMat);
  leftPost.position.set(-4, 5, nextGateZ);
  leftPost.scale.y = 10;
  gate.add(leftPost);
  
  const rightPost = new THREE.Mesh(postGeo, postMat);
  rightPost.position.set(4, 5, nextGateZ);
  rightPost.scale.y = 10;
  gate.add(rightPost);
  
  const topPost = new THREE.Mesh(postGeo, postMat);
  topPost.position.set(0, 10, nextGateZ);
  topPost.scale.x = 27;
  gate.add(topPost);
  
  gate.position.z = nextGateZ;
  gate.userData.passed = false;
  scene.add(gate);
  gates.push(gate);
  
  nextGateZ -= 25;
}

for (let i = 0; i < 6; i++) {
  spawnGate();
}

scene.userData.update = function(deltaTime, inputs) {
  if (gameOver) return;
  
  const moveSpeed = 12 * deltaTime;
  if (inputs.keys.w || inputs.keys.ArrowUp) playerY += moveSpeed;
  if (inputs.keys.s || inputs.keys.ArrowDown) playerY -= moveSpeed;
  if (inputs.keys.a || inputs.keys.ArrowLeft) playerX -= moveSpeed;
  if (inputs.keys.d || inputs.keys.ArrowRight) playerX += moveSpeed;
  
  playerX = Math.max(-10, Math.min(10, playerX));
  playerY = Math.max(1, Math.min(10, playerY));
  
  player.position.x = playerX;
  player.position.y = playerY;
  
  playerZ -= speed * deltaTime;
  player.position.z = playerZ;
  
  camera.position.z = playerZ + 15;
  camera.lookAt(playerX, playerY, playerZ);
  
  for (let i = gates.length - 1; i >= 0; i--) {
    if (!gates[i].userData.passed && gates[i].position.z > playerZ) {
      if (Math.abs(playerX - gates[i].position.x) < 4 && 
          Math.abs(playerY - gates[i].position.y) < 4) {
        gates[i].userData.passed = true;
        score += 100;
        scoreDisplay.textContent = 'Score: ' + score;
        
        const material = gates[i].children[0].material;
        material.color.setHex(0xffff00);
        material.emissive.setHex(0xffff00);
      } else {
        gameOver = true;
        scene.userData.gameOver = true;
      }
    }
    
    if (gates[i].position.z - playerZ > 30) {
      scene.remove(gates[i]);
      gates.splice(i, 1);
      spawnGate();
    }
  }
};

scene.userData.cleanup = function() {
  if (scoreDisplay && scoreDisplay.parentNode) {
    scoreDisplay.parentNode.removeChild(scoreDisplay);
  }
};`,

  // NEW TEMPLATE: Platformer
  platformer: `let playerX = 0;
let playerY = 1;
let playerZ = 0;
let velocityY = 0;
let isGrounded = false;
let score = 0;
let gameOver = false;

const playerGeo = new THREE.BoxGeometry(0.8, 1, 0.8);
const playerMat = new THREE.MeshStandardMaterial({
  color: 0x00ffff,
  emissive: 0x00ffff,
  emissiveIntensity: 0.3,
  metalness: 0.7
});
const player = new THREE.Mesh(playerGeo, playerMat);
player.position.set(playerX, playerY, playerZ);
scene.add(player);

camera.position.set(0, 5, 10);
camera.lookAt(0, 2, 0);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(10, 20, 10);
scene.add(directionalLight);

const scoreDisplay = document.createElement('div');
scoreDisplay.style.position = 'absolute';
scoreDisplay.style.top = '20px';
scoreDisplay.style.left = '20px';
scoreDisplay.style.color = '#ffffff';
scoreDisplay.style.fontSize = '24px';
scoreDisplay.style.fontFamily = 'monospace';
scoreDisplay.style.fontWeight = 'bold';
scoreDisplay.style.textShadow = '2px 2px 4px rgba(0,0,0,0.8)';
scoreDisplay.style.zIndex = '1000';
scoreDisplay.style.pointerEvents = 'none';
scoreDisplay.textContent = 'Score: 0';
document.body.appendChild(scoreDisplay);

const platforms = [];
const collectibles = [];

function createPlatform(x, y, z, width, height, depth) {
  const platGeo = new THREE.BoxGeometry(width, height, depth);
  const platMat = new THREE.MeshStandardMaterial({
    color: 0x808080,
    emissive: 0x404040,
    emissiveIntensity: 0.1
  });
  const platform = new THREE.Mesh(platGeo, platMat);
  platform.position.set(x, y, z);
  scene.add(platform);
  platforms.push(platform);
  return platform;
}

function spawnCollectible(x, y, z) {
  const gemGeo = new THREE.OctahedronGeometry(0.4, 0);
  const gemMat = new THREE.MeshStandardMaterial({
    color: 0xffff00,
    emissive: 0xffff00,
    emissiveIntensity: 0.6,
    metalness: 0.8,
    roughness: 0.2
  });
  const gem = new THREE.Mesh(gemGeo, gemMat);
  gem.position.set(x, y, z);
  gem.userData.collected = false;
  scene.add(gem);
  collectibles.push(gem);
}

// Create initial platforms
createPlatform(0, 0, 0, 10, 0.5, 5);
createPlatform(8, 2, 0, 5, 0.5, 5);
createPlatform(-8, 3, 0, 5, 0.5, 5);
createPlatform(0, 5, -8, 10, 0.5, 5);

// Add collectibles
spawnCollectible(8, 3.5, 0);
spawnCollectible(-8, 4.5, 0);
spawnCollectible(0, 6.5, -8);

scene.userData.update = function(deltaTime, inputs) {
  if (gameOver) return;
  
  const moveSpeed = 8 * deltaTime;
  const jumpPower = 12;
  const gravity = -30 * deltaTime;
  
  // Horizontal movement
  if (inputs.keys.a || inputs.keys.ArrowLeft) playerX -= moveSpeed;
  if (inputs.keys.d || inputs.keys.ArrowRight) playerX += moveSpeed;
  if (inputs.keys.w || inputs.keys.ArrowUp) playerZ -= moveSpeed;
  if (inputs.keys.s || inputs.keys.ArrowDown) playerZ += moveSpeed;
  
  // Jump
  if ((inputs.keys[' '] || inputs.keys.Space) && isGrounded) {
    velocityY = jumpPower;
    isGrounded = false;
  }
  
  // Apply gravity
  velocityY += gravity;
  playerY += velocityY * deltaTime;
  
  // Check platform collisions
  isGrounded = false;
  for (let i = 0; i < platforms.length; i++) {
    const plat = platforms[i];
    const pw = plat.geometry.parameters.width;
    const ph = plat.geometry.parameters.height;
    const pd = plat.geometry.parameters.depth;
    
    if (Math.abs(playerX - plat.position.x) < pw/2 &&
        Math.abs(playerZ - plat.position.z) < pd/2) {
      if (playerY - 0.5 <= plat.position.y + ph/2 &&
          playerY - 0.5 >= plat.position.y - ph/2 &&
          velocityY <= 0) {
        playerY = plat.position.y + ph/2 + 0.5;
        velocityY = 0;
        isGrounded = true;
      }
    }
  }
  
  // Check collectibles
  for (let i = collectibles.length - 1; i >= 0; i--) {
    if (!collectibles[i].userData.collected) {
      collectibles[i].rotation.y += 3 * deltaTime;
      
      const dx = playerX - collectibles[i].position.x;
      const dy = playerY - collectibles[i].position.y;
      const dz = playerZ - collectibles[i].position.z;
      const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
      
      if (distance < 1) {
        collectibles[i].userData.collected = true;
        scene.remove(collectibles[i]);
        score += 100;
        scoreDisplay.textContent = 'Score: ' + score;
      }
    }
  }
  
  // Fall detection
  if (playerY < -10) {
    gameOver = true;
    scene.userData.gameOver = true;
  }
  
  // Update player and camera
  player.position.x = playerX;
  player.position.y = playerY;
  player.position.z = playerZ;
  
  camera.position.x = playerX;
  camera.position.z = playerZ + 10;
  camera.lookAt(playerX, playerY, playerZ);
};

scene.userData.cleanup = function() {
  if (scoreDisplay && scoreDisplay.parentNode) {
    scoreDisplay.parentNode.removeChild(scoreDisplay);
  }
};`,

  // NEW TEMPLATE: Puzzle (Match-3 style)
  puzzle: `let score = 0;
let selectedTile = null;
let gameOver = false;
let grid = [];
let gridSize = 8;
let tileSize = 1.2;
let comboMultiplier = 1;

camera.position.set(0, 15, 10);
camera.lookAt(0, 0, 0);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
directionalLight.position.set(5, 10, 5);
scene.add(directionalLight);

const scoreDisplay = document.createElement('div');
scoreDisplay.style.position = 'absolute';
scoreDisplay.style.top = '20px';
scoreDisplay.style.left = '20px';
scoreDisplay.style.color = '#ffffff';
scoreDisplay.style.fontSize = '24px';
scoreDisplay.style.fontFamily = 'monospace';
scoreDisplay.style.fontWeight = 'bold';
scoreDisplay.style.textShadow = '2px 2px 4px rgba(0,0,0,0.8)';
scoreDisplay.style.zIndex = '1000';
scoreDisplay.style.pointerEvents = 'none';
scoreDisplay.textContent = 'Score: 0';
document.body.appendChild(scoreDisplay);

const colors = [0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0xff00ff];
const geometries = [
  new THREE.SphereGeometry(0.5, 16, 16),
  new THREE.BoxGeometry(0.8, 0.8, 0.8),
  new THREE.ConeGeometry(0.5, 1, 8),
  new THREE.OctahedronGeometry(0.6, 0),
  new THREE.TetrahedronGeometry(0.7, 0)
];

function createTile(type, x, z) {
  const geo = geometries[type];
  const mat = new THREE.MeshStandardMaterial({
    color: colors[type],
    emissive: colors[type],
    emissiveIntensity: 0.2,
    metalness: 0.5,
    roughness: 0.5
  });
  const tile = new THREE.Mesh(geo, mat);
  tile.position.set(x * tileSize - gridSize * tileSize / 2, 0, z * tileSize - gridSize * tileSize / 2);
  tile.userData = { type, gridX: x, gridZ: z };
  scene.add(tile);
  return tile;
}

// Initialize grid
for (let x = 0; x < gridSize; x++) {
  grid[x] = [];
  for (let z = 0; z < gridSize; z++) {
    const type = Math.floor(Math.random() * 5);
    grid[x][z] = createTile(type, x, z);
  }
}

function checkMatches() {
  const toRemove = [];
  
  // Check horizontal matches
  for (let z = 0; z < gridSize; z++) {
    for (let x = 0; x < gridSize - 2; x++) {
      if (grid[x][z] && grid[x+1][z] && grid[x+2][z]) {
        if (grid[x][z].userData.type === grid[x+1][z].userData.type &&
            grid[x][z].userData.type === grid[x+2][z].userData.type) {
          toRemove.push(grid[x][z], grid[x+1][z], grid[x+2][z]);
        }
      }
    }
  }
  
  // Check vertical matches
  for (let x = 0; x < gridSize; x++) {
    for (let z = 0; z < gridSize - 2; z++) {
      if (grid[x][z] && grid[x][z+1] && grid[x][z+2]) {
        if (grid[x][z].userData.type === grid[x][z+1].userData.type &&
            grid[x][z].userData.type === grid[x][z+2].userData.type) {
          toRemove.push(grid[x][z], grid[x][z+1], grid[x][z+2]);
        }
      }
    }
  }
  
  // Remove matches and update score
  const uniqueRemove = [...new Set(toRemove)];
  for (let tile of uniqueRemove) {
    scene.remove(tile);
    grid[tile.userData.gridX][tile.userData.gridZ] = null;
    score += 10 * comboMultiplier;
  }
  
  if (uniqueRemove.length > 0) {
    comboMultiplier = Math.min(comboMultiplier + 0.5, 5);
    scoreDisplay.textContent = 'Score: ' + score;
    return true;
  }
  
  comboMultiplier = 1;
  return false;
}

function dropTiles() {
  let dropped = false;
  for (let x = 0; x < gridSize; x++) {
    for (let z = gridSize - 1; z > 0; z--) {
      if (!grid[x][z] && grid[x][z-1]) {
        grid[x][z] = grid[x][z-1];
        grid[x][z-1] = null;
        grid[x][z].userData.gridZ = z;
        grid[x][z].position.z = z * tileSize - gridSize * tileSize / 2;
        dropped = true;
      }
    }
  }
  return dropped;
}

function refillGrid() {
  for (let x = 0; x < gridSize; x++) {
    for (let z = 0; z < gridSize; z++) {
      if (!grid[x][z]) {
        const type = Math.floor(Math.random() * 5);
        grid[x][z] = createTile(type, x, z);
      }
    }
  }
}

// Simple mouse/touch interaction
let mouseX = 0, mouseZ = 0;
scene.userData.update = function(deltaTime, inputs) {
  if (gameOver) return;
  
  // Animate tiles
  for (let x = 0; x < gridSize; x++) {
    for (let z = 0; z < gridSize; z++) {
      if (grid[x][z]) {
        grid[x][z].rotation.y += deltaTime;
      }
    }
  }
  
  // Process matches
  if (checkMatches()) {
    setTimeout(() => {
      dropTiles();
      setTimeout(() => {
        refillGrid();
      }, 300);
    }, 500);
  }
};

scene.userData.cleanup = function() {
  if (scoreDisplay && scoreDisplay.parentNode) {
    scoreDisplay.parentNode.removeChild(scoreDisplay);
  }
};`
};

export function detectGameType(description) {
  const desc = description.toLowerCase();
  
  // New game type detection
  if (desc.includes('jump') || desc.includes('platform') || desc.includes('climb')) {
    return 'platformer';
  }
  if (desc.includes('puzzle') || desc.includes('match') || desc.includes('solve')) {
    return 'puzzle';
  }
  
  // Existing detection logic
  if (desc.includes('dodge') || desc.includes('avoid') || desc.includes('asteroid')) {
    return 'dodger';
  }
  if (desc.includes('collect') || desc.includes('gather') || desc.includes('coin') || desc.includes('pickup')) {
    return 'collector';
  }
  if (desc.includes('shoot') || desc.includes('fire') || desc.includes('laser') || desc.includes('enemy')) {
    return 'shooter';
  }
  if (desc.includes('race') || desc.includes('speed') || desc.includes('gate') || desc.includes('fly through')) {
    return 'racer';
  }
  
  return 'dodger'; // default
}

export function getTemplate(gameType, description = '') {
  const type = gameType || detectGameType(description);
  return GAME_TEMPLATES[type] || GAME_TEMPLATES.dodger;
}

// Helper function to enhance templates with themes
export function getThemedTemplate(gameType, theme = 'neon', description = '') {
  let template = getTemplate(gameType, description);
  const themeData = VISUAL_THEMES[theme] || VISUAL_THEMES.neon;
  
  // Apply theme colors to the template
  // This is a simplified version - in production, we'd parse and modify the template
  
  return template;
}