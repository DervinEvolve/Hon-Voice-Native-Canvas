import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { validateGameCode } from '../src/lib/validateGame';
import { GAME_GENERATION_SYSTEM_PROMPT } from '../src/lib/gamePrompts';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY,
});

interface TestCase {
  description: string;
  expectedType: string;
  shouldContain: string[];
}

const tests: TestCase[] = [
  {
    description: 'dodge asteroids',
    expectedType: 'dodger',
    shouldContain: ['asteroid', 'dodge']
  },
  {
    description: 'collect gold coins',
    expectedType: 'collector',
    shouldContain: ['coin', 'collect', 'gold']
  },
  {
    description: 'shoot enemy ships',
    expectedType: 'shooter',
    shouldContain: ['shoot', 'enemy', 'projectile']
  },
  {
    description: 'race through neon gates',
    expectedType: 'racer',
    shouldContain: ['race', 'gate']
  }
];

async function testRealGeneration(testCase: TestCase) {
  console.log(`\n📝 Testing: "${testCase.description}"`);
  console.log(`   Expected: ${testCase.expectedType} with visual customization`);
  
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4000,
      temperature: 0.4,
      system: [
        {
          type: "text",
          text: GAME_GENERATION_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" }
        }
      ],
      messages: [
        { 
          role: 'user', 
          content: `Build a ${testCase.expectedType} game. Description: ${testCase.description}` 
        }
      ]
    });

    const generatedCode = response.content[0].text;
    
    // Validate the generated code
    const validation = validateGameCode(generatedCode);
    console.log(`\n   📊 VALIDATION:`);
    console.log(`      Valid: ${validation.valid ? '✅' : '❌'}`);
    console.log(`      Confidence: ${validation.confidence}%`);
    console.log(`      Has score: ${validation.hasScore ? '✅' : '❌'}`);
    console.log(`      Has game loop: ${validation.hasGameLoop ? '✅' : '❌'}`);
    
    if (validation.errors.length > 0) {
      console.log(`\n   ❌ ERRORS:`);
      validation.errors.forEach(err => console.log(`      - ${err}`));
    }
    
    if (validation.warnings.length > 0) {
      console.log(`\n   ⚠️  WARNINGS:`);
      validation.warnings.forEach(warn => console.log(`      - ${warn}`));
    }
    
    // Check for visual customization
    const lowerCode = generatedCode.toLowerCase();
    const foundTerms = testCase.shouldContain.filter(term => lowerCode.includes(term));
    const missingTerms = testCase.shouldContain.filter(term => !lowerCode.includes(term));
    
    console.log(`\n   🎨 VISUAL CUSTOMIZATION:`);
    console.log(`      Customized: ${foundTerms.length > 0 ? '✅' : '❌'}`);
    if (foundTerms.length > 0) {
      console.log(`      Found: ${foundTerms.join(', ')}`);
    }
    if (missingTerms.length > 0) {
      console.log(`      Missing: ${missingTerms.join(', ')}`);
    }
    
    // Log cache usage
    const cacheCreated = response.usage?.cache_creation_input_tokens || 0;
    const cacheRead = response.usage?.cache_read_input_tokens || 0;
    console.log(`\n   💾 CACHE:`);
    console.log(`      Status: ${cacheRead > 0 ? '✅ HIT' : '❌ MISS'}`);
    console.log(`      Created: ${cacheCreated} tokens`);
    console.log(`      Read: ${cacheRead} tokens`);
    
    // Save the generated code
    const filename = `${testCase.expectedType}-generated.js`;
    const filepath = path.join('test-output-real', filename);
    await fs.promises.writeFile(filepath, generatedCode);
    console.log(`\n   💾 Saved to: ./${filepath}`);
    
    return {
      testCase,
      validation,
      generatedCode,
      customized: foundTerms.length > 0,
      cacheHit: cacheRead > 0,
      cacheCreated,
      cacheRead
    };
    
  } catch (error) {
    console.error(`\n   ❌ ERROR: ${error.message}`);
    return null;
  }
}

async function main() {
  console.log('🧪 Testing REAL Claude API Generation');
  
  // Create output directory
  await fs.promises.mkdir('test-output-real', { recursive: true });
  
  console.log('\n' + '='.repeat(70));
  
  const results = [];
  for (const test of tests) {
    const result = await testRealGeneration(test);
    if (result) results.push(result);
  }
  
  console.log('\n' + '='.repeat(70));
  console.log('\n📊 FINAL RESULTS\n');
  
  const validCount = results.filter(r => r.validation.valid).length;
  const customizedCount = results.filter(r => r.customized).length;
  
  console.log(`Total tests: ${tests.length}`);
  console.log(`Valid games: ${validCount}/${tests.length} ${validCount === tests.length ? '✅' : '❌'}`);
  console.log(`Visually customized: ${customizedCount}/${tests.length} ${customizedCount === tests.length ? '✅' : '❌'}`);
  
  console.log(`\n📋 DETAILS:\n`);
  results.forEach(r => {
    const icon = r.validation.valid ? '✅' : '❌';
    console.log(`${icon} ${r.testCase.description}:`);
    console.log(`   Confidence: ${r.validation.confidence}%`);
    console.log(`   Customized: ${r.customized ? '✅' : '❌'}`);
    if (!r.validation.valid) {
      console.log(`   Issues: ${r.validation.errors.join(', ')}`);
    }
    console.log();
  });
  
  // Save report
  await fs.promises.writeFile(
    'test-output-real/generation-report.json',
    JSON.stringify(results, null, 2)
  );
  
  console.log(`📄 Full report: ./test-output-real/generation-report.json`);
  console.log(`📁 Generated code: ./test-output-real/`);
}

main().catch(console.error);
