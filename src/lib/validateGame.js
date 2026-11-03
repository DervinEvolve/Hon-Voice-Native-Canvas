// Game validation and safety checks
// This ensures generated games are safe and functional

export function validateGameCode(code) {
  const errors = [];
  const warnings = [];
  
  // Check for required game loop functions - allow various formats
  const hasUpdateFunction = code.includes('scene.userData.update') || 
                            code.includes('scene.userData.update =') ||
                            code.includes('update =') ||
                            code.includes('function update');
  
  if (!hasUpdateFunction) {
    errors.push('Missing required update function');
  }
  
  if (!code.includes('scene.userData.cleanup')) {
    warnings.push('Missing cleanup function - may cause memory leaks');
  }
  
  // Check for infinite loops
  const loopPatterns = [
    /while\s*\(\s*true\s*\)/,
    /for\s*\(\s*;\s*;\s*\)/,
    /do\s*{[\s\S]*}\s*while\s*\(\s*true\s*\)/
  ];
  
  for (let pattern of loopPatterns) {
    if (pattern.test(code)) {
      errors.push('Potential infinite loop detected');
    }
  }
  
  // Check for dangerous operations - these are CRITICAL errors that block execution
  const criticalPatterns = [
    { pattern: /eval\s*\(/, message: 'eval() is not allowed' },
    { pattern: /new\s+Function\s*\(/, message: 'Function constructor is not allowed' },
    { pattern: /document\.write/, message: 'document.write is not allowed' },
    { pattern: /window\.location/, message: 'Navigation is not allowed' }
  ];
  
  for (let { pattern, message } of criticalPatterns) {
    if (pattern.test(code)) {
      errors.push(message);
    }
  }
  
  // These are warnings, not blocking errors - code can still work
  const warningPatterns = [
    { pattern: /localStorage|sessionStorage/, message: 'Storage access detected (warning only)' },
    { pattern: /fetch|XMLHttpRequest/, message: 'Network requests detected (may be needed for 3D models)' }
  ];
  
  for (let { pattern, message } of warningPatterns) {
    if (pattern.test(code)) {
      warnings.push(message);
    }
  }
  
  // Check for performance issues
  if ((code.match(/new\s+THREE\./g) || []).length > 1000) {
    warnings.push('Creating too many objects may cause performance issues');
  }
  
  // Check for proper variable declarations
  if (!/let|const|var/.test(code)) {
    errors.push('No variables declared - game may not function');
  }
  
  // Check for player entity
  if (!code.includes('player')) {
    warnings.push('No player entity found - game may not be playable');
  }
  
  // Check for proper Three.js usage
  const requiredThreeJS = [
    { pattern: /THREE\.Scene/, message: 'Scene usage' },
    { pattern: /THREE\.Mesh/, message: 'Mesh creation' },
    { pattern: /THREE\..*Light/, message: 'Lighting' }
  ];
  
  const missingThreeJS = [];
  for (let { pattern, message } of requiredThreeJS) {
    if (!pattern.test(code)) {
      missingThreeJS.push(message);
  }
  }
  
  if (missingThreeJS.length > 0) {
    warnings.push(`Missing Three.js components: ${missingThreeJS.join(', ')}`);
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    score: calculateQualityScore(code, errors, warnings)
  };
}

function calculateQualityScore(code, errors, warnings) {
  let score = 100;
  
  // Deduct for errors and warnings
  score -= errors.length * 20;
  score -= warnings.length * 5;
  
  // Bonus for good practices
  if (code.includes('deltaTime')) score += 5; // Frame-rate independent
  if (code.includes('cleanup')) score += 5; // Memory management
  if (code.includes('scoreDisplay')) score += 5; // UI feedback
  if (code.includes('gameOver')) score += 5; // Game state management
  if (code.includes('userData')) score += 5; // Proper Three.js patterns
  
  // Bonus for visual quality
  if (code.includes('emissive')) score += 3; // Enhanced visuals
  if (code.includes('metalness')) score += 3; // PBR materials
  if (code.includes('fog')) score += 2; // Atmospheric effects
  
  return Math.max(0, Math.min(100, score));
}

// Sanitize AI-generated code to ensure it's safe
export function sanitizeGameCode(code) {
  // Remove any potentially dangerous code
  let sanitized = code;
  
  // Remove eval and Function constructor
  sanitized = sanitized.replace(/eval\s*\([^)]*\)/g, '// eval removed for safety');
  sanitized = sanitized.replace(/new\s+Function\s*\([^)]*\)/g, '// Function constructor removed');
  
  // Remove network access
  sanitized = sanitized.replace(/fetch\s*\([^)]*\)/g, '// fetch removed for safety');
  sanitized = sanitized.replace(/XMLHttpRequest/g, '// XMLHttpRequest removed');
  
  // Ensure proper cleanup
  if (!sanitized.includes('scene.userData.cleanup')) {
    sanitized += `
scene.userData.cleanup = function() {
  // Auto-generated cleanup function
  const displays = document.querySelectorAll('div[style*="position: absolute"]');
  displays.forEach(d => {
    if (d.textContent.includes('Score:') || d.textContent.includes('Time:')) {
      d.remove();
    }
  });
};`;
  }
  
  return sanitized;
}

// Auto-fix common issues in generated games
export function autoFixGame(code) {
  let fixed = code;
  
  // Fix missing semicolons
  fixed = fixed.replace(/([^{};])\n(\s*)(let|const|var|if|for|while)/g, '$1;\n$2$3');
  
  // Fix common Three.js mistakes
  fixed = fixed.replace(/new THREE\.Material/g, 'new THREE.MeshBasicMaterial');
  fixed = fixed.replace(/\.position\s*=\s*\[([^\]]+)\]/g, '.position.set($1)');
  fixed = fixed.replace(/\.rotation\s*=\s*\[([^\]]+)\]/g, '.rotation.set($1)');
  
  // Ensure scene is available
  if (!fixed.includes('scene') && fixed.includes('THREE.Scene')) {
    fixed = fixed.replace(/new THREE\.Scene\(\)/, 'scene = new THREE.Scene()');
  }
  
  // Add missing player controls
  if (fixed.includes('player') && !fixed.includes('inputs.keys')) {
    const updateMatch = fixed.match(/scene\.userData\.update\s*=\s*function\s*\([^)]*\)\s*{/);
    if (updateMatch) {
      fixed = fixed.replace(updateMatch[0], updateMatch[0] + `
  // Basic player controls
  const moveSpeed = 5 * deltaTime;
  if (inputs.keys.w || inputs.keys.ArrowUp) player.position.z -= moveSpeed;
  if (inputs.keys.s || inputs.keys.ArrowDown) player.position.z += moveSpeed;
  if (inputs.keys.a || inputs.keys.ArrowLeft) player.position.x -= moveSpeed;
  if (inputs.keys.d || inputs.keys.ArrowRight) player.position.x += moveSpeed;
`);
}
  }
  
  return fixed;
}