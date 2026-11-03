import { GAME_TEMPLATES, detectGameType, getTemplate } from '../src/lib/gameTemplates';
import { validateGameCode } from '../src/lib/validateGame';
import fs from 'fs';
import path from 'path';

async function testTemplates() {
  const outputDir = './test-output';
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const tests = [
    { description: 'dodge asteroids', expectedType: 'dodger' },
    { description: 'collect gold coins', expectedType: 'collector' },
    { description: 'shoot enemy ships', expectedType: 'shooter' },
    { description: 'race through neon gates', expectedType: 'racer' },
  ];
  
  console.log('🧪 Testing Game Templates\n');
  console.log('='.repeat(60));
  
  const results: any[] = [];
  
  for (const test of tests) {
    console.log(`\n📝 Testing: "${test.description}"`);
    
    try {
      // Test type detection
      const detectedType = detectGameType(test.description);
      const typeMatch = detectedType === test.expectedType;
      
      console.log(`   Detected type: ${detectedType} ${typeMatch ? '✅' : '❌'}`);
      
      // Get template
      const code = getTemplate(detectedType);
      
      // Validate
      const validation = validateGameCode(code);
      
      const analysis = {
        description: test.description,
        expectedType: test.expectedType,
        detectedType,
        typeMatch,
        codeLength: code.length,
        valid: validation.valid,
        confidenceScore: validation.confidenceScore,
        hasScore: validation.hasScore,
        hasGameLoop: validation.hasGameLoop,
        hasGameOver: code.includes('gameOver'),
        errors: validation.errors,
        warnings: validation.warnings,
        issues: [] as string[]
      };
      
      // Check issues
      if (!typeMatch) analysis.issues.push('Wrong type detected');
      if (!validation.valid) analysis.issues.push(...validation.errors);
      if (validation.confidenceScore < 70) analysis.issues.push('Low confidence score');
      
      // Print results
      console.log(`   Code length: ${analysis.codeLength} chars`);
      console.log(`   Valid: ${analysis.valid ? '✅' : '❌'}`);
      console.log(`   Confidence: ${analysis.confidenceScore}%`);
      console.log(`   Has score: ${analysis.hasScore ? '✅' : '❌'}`);
      console.log(`   Has game loop: ${analysis.hasGameLoop ? '✅' : '❌'}`);
      console.log(`   Has game over: ${analysis.hasGameOver ? '✅' : '❌'}`);
      
      if (validation.errors.length > 0) {
        console.log(`   ❌ Errors:`);
        validation.errors.forEach(err => console.log(`      - ${err}`));
      }
      
      if (validation.warnings.length > 0) {
        console.log(`   ⚠️  Warnings:`);
        validation.warnings.forEach(warn => console.log(`      - ${warn}`));
      }
      
      if (analysis.issues.length === 0) {
        console.log(`   ✅ All checks passed!`);
      }
      
      // Save code
      const filename = `${detectedType}-template.js`;
      fs.writeFileSync(path.join(outputDir, filename), code);
      console.log(`   💾 Saved to: test-output/${filename}`);
      
      results.push(analysis);
      
    } catch (error: any) {
      console.log(`   ❌ Error: ${error.message}`);
      results.push({
        description: test.description,
        error: error.message,
        issues: ['Test failed']
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
      console.log(`\n  ${r.description} (expected: ${r.expectedType})`);
      r.issues.forEach((issue: string) => console.log(`    - ${issue}`));
    });
  }
  
  // Save report
  fs.writeFileSync(
    path.join(outputDir, 'template-test-report.json'),
    JSON.stringify(results, null, 2)
  );
  console.log('\n📄 Full report saved to: test-output/template-test-report.json\n');
  
  return results;
}

testTemplates().catch(console.error);

