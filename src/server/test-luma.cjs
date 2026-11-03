// CommonJS version of the test to avoid ESM issues
const dotenv = require('dotenv');
const path = require('path');
const { LumaAI } = require('lumaai');

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// Add timestamp to logs
const log = (message, data) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`, data ? data : '');
};

async function testLumaAPI() {
  try {
    log('Starting Luma API test');
    log('LUMAAI_API_KEY status:', {
      exists: !!process.env.LUMAAI_API_KEY,
      length: process.env.LUMAAI_API_KEY?.length
    });
    
    if (!process.env.LUMAAI_API_KEY) {
      throw new Error('LUMAAI_API_KEY is not configured');
    }
    
    const lumaClient = new LumaAI({
      authToken: process.env.LUMAAI_API_KEY,
      maxRetries: 2,
      timeout: 60000
    });
    
    log('Luma client created');
    
    // Simple image generation test
    const imageConfig = {
      prompt: "A beautiful sunset over mountains",
      model: "photon-1"
    };
    
    log('Image generation config:', imageConfig);
    const generation = await lumaClient.generations.image.create(imageConfig);
    
    log('Generation initiated:', generation);
    
    if (!generation.id) {
      throw new Error('No generation ID received');
    }
    
    let result = await lumaClient.generations.get(generation.id);
    log('Initial result:', result);
    
    while (result.state !== 'completed' && result.state !== 'failed') {
      await new Promise(r => setTimeout(r, 3000));
      result = await lumaClient.generations.get(generation.id);
      log('Generation status:', { state: result.state });
      
      if (result.failure_reason) {
        throw new Error(`Luma generation failed: ${result.failure_reason}`);
      }
    }
    
    const url = result.assets?.image;
    if (!url) {
      throw new Error('No image URL in result');
    }
    
    log('Generation successful, URL:', url);
    
  } catch (error) {
    log('Luma API test failed:', error);
  }
}

// Run the test
testLumaAPI().then(() => {
  log('Test complete');
}); 