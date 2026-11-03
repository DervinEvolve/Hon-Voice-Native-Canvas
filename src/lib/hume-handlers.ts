import { HumeClient } from "hume";
import fetch from 'node-fetch';

// Shared function for generating Hume access tokens
export async function generateHumeToken(apiKey?: string, secretKey?: string) {
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

    const tokenData = await response.json() as { access_token: string };

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
export async function generateHumeTTS(
  apiKey: string | undefined, 
  secretKey: string | undefined, 
  options: {
    text: string;
    voiceId?: string;
    voicePrompt?: string;
    actingInstruction?: string;
    voiceSource: 'library' | 'prompt';
  }
) {
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
    const humeClient = new HumeClient({ 
      apiKey,
      secretKey,
    });
    console.log('HumeClient initialized successfully for TTS.');

    console.log('Received Hume TTS request:', { 
      text: text.substring(0, 30)+'...', 
      voiceId, 
      voicePrompt, 
      actingInstruction, 
      voiceSource 
    });

    // Construct Hume SDK options for synthesizeJson
    const utterance: any = { text };

    if (voiceSource === 'library') {
      // Specify voice by UUID and explicitly set the provider for library voices
      utterance.voice = { 
        id: voiceId, 
        provider: 'HUME_AI'
      }; 
      
      // If acting instructions are provided with a library voice, use description field
      if (actingInstruction) {
        utterance.description = actingInstruction;
      }
    } else if (voiceSource === 'prompt') {
      // If using prompt, the prompt goes in the description field
      utterance.description = voicePrompt;
      // Do not specify utterance.voice if using prompt to generate voice
      if (!utterance.description && actingInstruction) {
         utterance.description = actingInstruction;
      }
    }

    console.log('Calling HumeClient.tts.synthesizeJson with utterance:', utterance);

    // Actual Hume SDK Call
    const jsonResponse = await humeClient.tts.synthesizeJson({
        utterances: [utterance]
    });

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
  } catch (error: any) {
    console.error('Error calling Hume TTS API:', error);
    throw new Error(error.message || 'Failed to generate Hume TTS audio');
  }
} 