// Manual smoke check of the game template and stream routes on a deployment
// you own. Run: HON_TEST_BASE_URL=... HON_TEST_ACCESS_TOKEN=... npx tsx scripts/verify-production.ts
import fetch from 'node-fetch';
import { getRemoteTarget } from './remote-target';

const { baseUrl: PROD_URL, headers: REQUEST_HEADERS } = getRemoteTarget();

interface TestResult {
  name: string;
  passed: boolean;
  details: string;
}

async function verifyProduction() {
  console.log(`🔍 Verifying deployment at ${PROD_URL}\n`);
  console.log('='.repeat(70));
  
  const results: TestResult[] = [];
  
  // TEST 1: Template endpoint returns correct format
  console.log('\n📝 Test 1: Template endpoint format...');
  try {
    const res = await fetch(`${PROD_URL}/api/game/generate-template`, {
      method: 'POST',
      headers: REQUEST_HEADERS,
      body: JSON.stringify({ description: 'dodge asteroids' })
    });
    
    console.log(`  Response status: ${res.status}`);
    console.log(`  Response headers: ${res.headers.get('content-type')}`);
    
    const text = await res.text();
    console.log(`  Response preview: ${text.substring(0, 100)}...`);
    
    const data = JSON.parse(text) as any;
    
    const hasGameCode = 'gameCode' in data;
    const hasCorrectSyntax = data.gameCode?.includes('let playerX = 0');
    const noSyntaxErrors = !data.gameCode?.includes('let player.position.x');
    const hasScoreDisplay = data.gameCode?.includes('document.createElement');
    const hasIcosahedron = data.gameCode?.includes('IcosahedronGeometry');
    
    const passed = hasGameCode && hasCorrectSyntax && noSyntaxErrors && hasScoreDisplay && hasIcosahedron;
    
    results.push({
      name: 'Template Format',
      passed,
      details: `  gameCode field: ${hasGameCode ? '✅' : '❌'}\n` +
               `  Correct syntax (let playerX): ${hasCorrectSyntax ? '✅' : '❌'}\n` +
               `  No syntax errors: ${noSyntaxErrors ? '✅' : '❌'}\n` +
               `  Has score display: ${hasScoreDisplay ? '✅' : '❌'}\n` +
               `  Has IcosahedronGeometry: ${hasIcosahedron ? '✅' : '❌'}`
    });
    
    console.log(passed ? '✅ PASS' : '❌ FAIL');
    
  } catch (error: any) {
    results.push({
      name: 'Template Format',
      passed: false,
      details: `  Error: ${error.message}`
    });
    console.log('❌ FAIL');
  }
  
  // TEST 2: Validate actual code structure
  console.log('\n📝 Test 2: Code structure validation...');
  try {
    const res = await fetch(`${PROD_URL}/api/game/generate-template`, {
      method: 'POST',
      headers: REQUEST_HEADERS,
      body: JSON.stringify({ description: 'dodge asteroids' })
    });
    
    const data = await res.json() as any;
    const code = data.gameCode;
    
    const checks = {
      'Has variable declarations': /let playerX = \d+/.test(code),
      'Has player creation': /const player = new THREE\.Mesh/.test(code),
      'Has game loop': /scene\.userData\.update = function\(deltaTime, inputs\)/.test(code),
      'Has score display': /const scoreDisplay = document\.createElement/.test(code),
      'Has cleanup': /scene\.userData\.cleanup = function/.test(code),
      'Uses regular functions': !/scene\.userData\.update = \(/.test(code),
      'Uses correct input format': /inputs\.keys\.w/.test(code),
      'Uses MeshStandardMaterial': /MeshStandardMaterial/.test(code),
      'No incomplete properties': !/emissive,\s*emissiveIntensity/.test(code),
      'Has document.body.appendChild': /document\.body\.appendChild/.test(code),
    };
    
    const passed = Object.values(checks).every(v => v);
    
    results.push({
      name: 'Code Structure',
      passed,
      details: Object.entries(checks)
        .map(([key, val]) => `  ${key}: ${val ? '✅' : '❌'}`)
        .join('\n')
    });
    
    console.log(passed ? '✅ PASS' : '❌ FAIL');
    
  } catch (error: any) {
    results.push({
      name: 'Code Structure',
      passed: false,
      details: `  Error: ${error.message}`
    });
    console.log('❌ FAIL');
  }
  
  // TEST 3: Stream endpoint format
  console.log('\n📝 Test 3: Stream endpoint format...');
  try {
    const res = await fetch(`${PROD_URL}/api/game/generate-stream`, {
      method: 'POST',
      headers: REQUEST_HEADERS,
      body: JSON.stringify({ description: 'dodge asteroids' })
    });
    
    if (res.status === 200) {
      results.push({
        name: 'Stream Endpoint',
        passed: true,
        details: '  Stream endpoint returns 200 OK'
      });
      console.log('✅ PASS');
    } else {
      results.push({
        name: 'Stream Endpoint',
        passed: false,
        details: `  Returned status ${res.status}`
      });
      console.log('❌ FAIL');
    }
    
  } catch (error: any) {
    results.push({
      name: 'Stream Endpoint',
      passed: false,
      details: `  Error: ${error.message}`
    });
    console.log('❌ FAIL');
  }
  
  // TEST 4: All game types work
  console.log('\n📝 Test 4: All game types...');
  const gameTypes = [
    { desc: 'dodge asteroids', type: 'dodger', geometry: 'IcosahedronGeometry' },
    { desc: 'collect coins', type: 'collector', geometry: 'SphereGeometry' },
    { desc: 'shoot enemies', type: 'shooter', geometry: 'ConeGeometry' },
    { desc: 'race through gates', type: 'racer', geometry: 'BoxGeometry' }
  ];
  
  let allTypesPass = true;
  const typeDetails: string[] = [];
  
  for (const test of gameTypes) {
    try {
      const res = await fetch(`${PROD_URL}/api/game/generate-template`, {
        method: 'POST',
        headers: REQUEST_HEADERS,
        body: JSON.stringify({ description: test.desc })
      });
      
      const data = await res.json() as any;
      const hasGeometry = data.gameCode?.includes(test.geometry);
      const hasCorrectSyntax = data.gameCode?.includes('let playerX');
      
      const passed = hasGeometry && hasCorrectSyntax;
      allTypesPass = allTypesPass && passed;
      
      typeDetails.push(`  ${test.type}: ${passed ? '✅' : '❌'} (${test.geometry}: ${hasGeometry ? 'yes' : 'no'})`);
      
    } catch (error) {
      allTypesPass = false;
      typeDetails.push(`  ${test.type}: ❌ Error`);
    }
  }
  
  results.push({
    name: 'All Game Types',
    passed: allTypesPass,
    details: typeDetails.join('\n')
  });
  
  console.log(allTypesPass ? '✅ PASS' : '❌ FAIL');
  
  // SUMMARY
  console.log('\n' + '='.repeat(70));
  console.log('\n📊 SUMMARY\n');
  
  const totalTests = results.length;
  const passedTests = results.filter(r => r.passed).length;
  const failedTests = totalTests - passedTests;
  
  console.log(`Total Tests: ${totalTests}`);
  console.log(`Passed: ${passedTests} ✅`);
  console.log(`Failed: ${failedTests} ${failedTests > 0 ? '❌' : ''}`);
  console.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`);
  
  console.log('\n📋 DETAILED RESULTS:\n');
  
  results.forEach(result => {
    console.log(`${result.passed ? '✅' : '❌'} ${result.name}`);
    console.log(result.details);
    console.log('');
  });
  
  if (passedTests === totalTests) {
    console.log('🎉 All checks passed for this deployment.');
  } else {
    console.log('⚠️  Some tests failed. See details above.');
  }
  
  process.exit(failedTests > 0 ? 1 : 0);
}

verifyProduction().catch(console.error);

