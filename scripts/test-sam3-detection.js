/**
 * Test script for SAM3 object detection endpoint
 * 
 * Usage:
 *   node scripts/test-sam3-detection.js <image-url>
 * 
 * Use an image you have the rights to use.
 */

const fetch = require('node-fetch');

async function testSAM3Detection(imageUrl) {
  console.log('🧪 Testing SAM3 Detection Endpoint\n');
  console.log('Image URL:', imageUrl);
  console.log('Endpoint: http://localhost:3000/api/roboflow/sam3-detect\n');

  try {
    const response = await fetch('http://localhost:3000/api/roboflow/sam3-detect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ imageUrl }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Request failed:', response.status, response.statusText);
      console.error('Error details:', errorText);
      return;
    }

    const data = await response.json();
    
    console.log('✅ Response received:\n');
    console.log('Success:', data.success);
    console.log('Objects detected:', data.count || 0);
    
    if (data.objects && data.objects.length > 0) {
      console.log('\n📦 Detected Objects:');
      data.objects.forEach((obj, index) => {
        console.log(`  ${index + 1}. ${obj}`);
      });
    } else {
      console.log('\n⚠️  No objects detected');
      if (data.note) {
        console.log('Note:', data.note);
      }
      if (data.error) {
        console.log('Error:', data.error);
      }
    }

    console.log('\n📊 Full Response:');
    console.log(JSON.stringify(data, null, 2));

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('\nMake sure:');
    console.error('1. Your dev server is running (npm run dev)');
    console.error('2. ROBOFLOW_API_KEY is set in .env');
    console.error('3. The image URL is accessible');
  }
}

// Get image URL from command line argument
const imageUrl = process.argv[2];

if (!imageUrl) {
  console.log('Usage: node scripts/test-sam3-detection.js <image-url>');
  console.log('Use an image URL you have the rights to use.');
  process.exit(1);
}

testSAM3Detection(imageUrl);


