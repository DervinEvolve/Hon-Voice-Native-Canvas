// Manual check of /api/game/generate on a deployment you own. Each case starts
// a paid model call. Run: HON_TEST_BASE_URL=... HON_TEST_ACCESS_TOKEN=... npx tsx scripts/test-game-types.ts
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { getRemoteTarget } from './remote-target';

const { baseUrl, headers: REQUEST_HEADERS } = getRemoteTarget();

async function testGameGeneration() {
  // Create output directory
  const outputDir = './test-output';
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const tests = [
    { 
      description: 'dodge asteroids', 
      expectedType: 'dodger',
      shouldHave: ['asteroid', 'IcosahedronGeometry', 'gray']
    },
    { 
      description: 'collect gold coins', 
      expectedType: 'collector',
      shouldHave: ['coin', 'SphereGeometry', 'gold', 'yellow', 'collectible']
    },
    { 
      description: 'shoot enemy ships', 
      expectedType: 'shooter',
      shouldHave: ['shoot', 'projectile', 'enemy', 'spacebar']
    },
    { 
      description: 'race through neon gates', 
      expectedType: 'racer',
      shouldHave: ['gate', 'checkpoint', 'race', 'forward']
    },
  ];
  
  console.log('🧪 Testing Game Generation System\n');
  console.log('='.repeat(60));
  
  const results: any[] = [];
  
  for (const test of tests) {
    console.log(`\n📝 Testing: "${test.description}"`);
    console.log(`   Expected type: ${test.expectedType}`);
    
    try {
      const response = await fetch(`${baseUrl}/api/game/generate`, {
        method: 'POST',
        headers: REQUEST_HEADERS,
        body: JSON.stringify({ description: test.description, provider: 'claude' })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      // Analyze the result
      const analysis = {
        description: test.description,
        expectedType: test.expectedType,
        actualType: result.gameType,
        source: result.source,
        codeLength: result.gameCode?.length || 0,
        hasScore: result.gameCode?.includes('let score') || false,
        hasGameLoop: result.gameCode?.includes('scene.userData.update') || false,
        hasGameOver: result.gameCode?.includes('gameOver') || false,
        typeMatch: result.gameType === test.expectedType,
        issues: [] as string[]
      };
      
      // Check for expected elements
      const codeLower = result.gameCode?.toLowerCase() || '';
      const hasExpectedElements = test.shouldHave.some(item => 
        codeLower.includes(item.toLowerCase())
      );
      
      // Identify issues
      if (!analysis.hasScore) analysis.issues.push('Missing score variable');
      if (!analysis.hasGameLoop) analysis.issues.push('Missing game loop');
      if (!analysis.hasGameOver) analysis.issues.push('Missing game over logic');
      if (!analysis.typeMatch) analysis.issues.push('Wrong game type detected');
      if (analysis.source === 'template') analysis.issues.push('Using fallback template');
      if (!hasExpectedElements) analysis.issues.push('Generic appearance (missing theme elements)');
      
      // Print analysis
      console.log(`   ✓ Source: ${analysis.source}`);
      console.log(`   ✓ Detected type: ${analysis.actualType} ${analysis.typeMatch ? '✅' : '❌'}`);
      console.log(`   ✓ Code length: ${analysis.codeLength} chars`);
      console.log(`   ✓ Has score: ${analysis.hasScore ? '✅' : '❌'}`);
      console.log(`   ✓ Has game loop: ${analysis.hasGameLoop ? '✅' : '❌'}`);
      console.log(`   ✓ Has game over: ${analysis.hasGameOver ? '✅' : '❌'}`);
      console.log(`   ✓ Theme elements: ${hasExpectedElements ? '✅' : '❌'}`);
      
      if (analysis.issues.length > 0) {
        console.log(`   ⚠️  Issues found:`);
        analysis.issues.forEach(issue => console.log(`      - ${issue}`));
      } else {
        console.log(`   ✅ All checks passed!`);
      }
      
      // Save code to file
      const filename = `${test.expectedType}.js`;
      fs.writeFileSync(
        path.join(outputDir, filename),
        result.gameCode || '// No code generated'
      );
      console.log(`   💾 Saved to: test-output/${filename}`);
      
      results.push(analysis);
      
    } catch (error: any) {
      console.log(`   ❌ Error: ${error.message}`);
      results.push({
        description: test.description,
        expectedType: test.expectedType,
        error: error.message,
        issues: ['Request failed']
      });
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('\n📊 SUMMARY\n');
  
  const passed = results.filter(r => r.issues?.length === 0).length;
  const failed = results.length - passed;
  
  console.log(`Total tests: ${results.length}`);
  console.log(`Passed: ${passed} ✅`);
  console.log(`Failed: ${failed} ❌`);
  
  if (failed > 0) {
    console.log('\n❌ FAILING TESTS:');
    results.filter(r => r.issues?.length > 0).forEach(r => {
      console.log(`\n  ${r.description} (${r.expectedType})`);
      r.issues.forEach((issue: string) => console.log(`    - ${issue}`));
    });
  }
  
  // Save full report
  fs.writeFileSync(
    path.join(outputDir, 'test-report.json'),
    JSON.stringify(results, null, 2)
  );
  console.log('\n📄 Full report saved to: test-output/test-report.json');
}

testGameGeneration().catch(console.error);

