// Shared function for generating Hume access tokens
export async function generateHumeToken(apiKey, secretKey) {
  if (!apiKey) {
    throw new Error('Hume API Key not configured on server.');
  }
  if (!secretKey) {
    throw new Error('Hume Secret Key not configured on server.');
  }

  try {
    console.log('Attempting to generate Hume token using manual fetch with Basic Auth...');
    const credentials = Buffer.from(`${apiKey}:${secretKey}`).toString('base64');
    const tokenUrl = 'https://api.hume.ai/oauth2-cc/token';

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`Error fetching Hume token: ${response.status} ${response.statusText}`, errorBody);
      throw new Error(`Failed to fetch Hume access token: ${response.statusText}`);
    }

    const tokenData = await response.json();

    if (!tokenData || !tokenData.access_token) {
      console.error('Invalid token data received from Hume:', tokenData);
      throw new Error('Hume token endpoint returned invalid data.');
    }

    const accessToken = tokenData.access_token;
    console.log('Successfully generated Hume access token using manual fetch.');
    
    return { accessToken };
  } catch (error) {
    console.error('Error generating Hume access token:', error);
    throw error;
  }
}

// Shared function for Hume TTS generation
export async function generateHumeTTS(apiKey, secretKey, options) {
  const { text, voiceId, voicePrompt, actingInstruction, voiceSource } = options;

  if (!apiKey || !secretKey) {
    throw new Error('Hume API keys not configured on server.');
  }

  // Basic validation
  if (!text) {
    throw new Error('Missing required field: text');
  }
  
  // Validate based on source
  if (voiceSource === 'library' && !voiceId) {
    throw new Error('Missing voiceId for library source');
  }
  
  if (voiceSource === 'prompt' && !voicePrompt) {
    throw new Error('Missing voicePrompt for prompt source');
  }

  try {
    // For Vercel, we'll use direct API calls instead of the SDK
    console.log('Received Hume TTS request:', { 
      text: text.substring(0, 30)+'...', 
      voiceId, 
      voicePrompt, 
      actingInstruction, 
      voiceSource 
    });

    // Get access token first
    const tokenResult = await generateHumeToken(apiKey, secretKey);
    const accessToken = tokenResult.accessToken;

    // Construct request payload
    const utterance = { text };

    if (voiceSource === 'library') {
      utterance.voice = { 
        id: voiceId, 
        provider: 'HUME_AI'
      }; 
      
      if (actingInstruction) {
        utterance.description = actingInstruction;
      }
    } else if (voiceSource === 'prompt') {
      utterance.description = voicePrompt;
      if (!utterance.description && actingInstruction) {
         utterance.description = actingInstruction;
      }
    }

    console.log('Calling Hume TTS API with utterance:', utterance);

    // Direct API call to Hume TTS
    const response = await fetch('https://api.hume.ai/v0/tts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        utterances: [utterance]
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`Hume TTS API error: ${response.status} ${response.statusText}`, errorBody);
      throw new Error(`Hume TTS API failed: ${response.statusText}`);
    }

    const jsonResponse = await response.json();

    // Process JSON Response
    if (!jsonResponse || typeof jsonResponse !== 'object' || 
        !jsonResponse.generations || !Array.isArray(jsonResponse.generations) || 
        jsonResponse.generations.length === 0 || !jsonResponse.generations[0].audio) {
        console.error('Invalid response structure received from Hume API:', JSON.stringify(jsonResponse, null, 2)); 
        throw new Error('Hume API returned an unexpected response structure.');
    }

    // Access the audio data correctly from the object structure
    const base64Audio = jsonResponse.generations[0].audio;
    console.log('Hume synthesis successful, received base64 audio (length):', base64Audio.length);

    // Convert base64 to Buffer
    const audioBuffer = Buffer.from(base64Audio, 'base64');

    return audioBuffer;
  } catch (error) {
    console.error('Error calling Hume TTS API:', error);
    throw new Error(error.message || 'Failed to generate Hume TTS audio');
  }
} 