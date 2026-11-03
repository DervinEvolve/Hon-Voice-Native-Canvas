import { Router } from 'express';
// import HumeClient = require('@humeai/voice'); // CommonJS style failed
import { HumeClient } from "hume"; // Only import HumeClient
import dotenv from 'dotenv';
import fetch from 'node-fetch'; // Import fetch for making the token request

// Environment variables are loaded by the main server file (api.ts)

const router = Router();

// Remove top-level client initialization
// const humeApiKey = process.env.HUME_API_KEY; 
// const humeSecretKey = process.env.HUME_SECRET_KEY;
// let humeClient: Hume.HumeClient | null = null;
// if (humeApiKey && humeSecretKey) { ... }

// Define the POST route for Hume TTS generation
router.post('/tts/hume', async (req, res) => {
  // --- Initialize Hume Client inside the handler --- 
  let humeClient: HumeClient | null = null;
  const humeApiKey = process.env.HUME_API_KEY;
  const humeSecretKey = process.env.HUME_SECRET_KEY;

  if (!humeApiKey || !humeSecretKey) {
    console.error('Hume API Key or Secret Key not found in environment variables inside route handler.');
    return res.status(500).json({ error: 'Hume API keys not configured on server.' });
  }
  
  try {
      humeClient = new HumeClient({ 
        apiKey: humeApiKey,
        secretKey: humeSecretKey,
      });
      console.log('HumeClient initialized successfully inside route handler.');
  } catch (error) {
      console.error('Failed to initialize HumeClient inside route handler:', error);
      return res.status(500).json({ error: 'Failed to initialize Hume client.' });
  }
  // --- End Client Initialization ---

  // Original check remains, just in case initialization somehow resulted in null
  if (!humeClient) {
    return res.status(500).json({ error: 'Hume client initialization failed unexpectedly.' });
  }

  const { text, voiceId, voicePrompt, actingInstruction, voiceSource } = req.body;

  // Basic validation
  if (!text) {
    return res.status(400).json({ error: 'Missing required field: text' });
  }
  // Validate based on source
  if (voiceSource === 'library' && !voiceId) {
    // Make sure voiceId is received for library source
    return res.status(400).json({ error: 'Missing voiceId for library source' });
  }
   if (voiceSource === 'prompt' && !voicePrompt) {
    return res.status(400).json({ error: 'Missing voicePrompt for prompt source' });
  }

  try {
    console.log('Received Hume TTS request:', { text: text.substring(0, 30)+'...', voiceId, voicePrompt, actingInstruction, voiceSource });

    // --- Construct Hume SDK options for synthesizeJson --- 
    const utterance: any = { text }; // Start with the text

    if (voiceSource === 'library') {
      // Frontend now sends the actual ID/UUID in the voiceId field
      // Validate if it looks like a UUID? Optional, but could be useful.
      // const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      // if (!uuidRegex.test(voiceId)) {
      //   console.error(`Invalid library voiceId received (not a UUID): ${voiceId}`);
      //   return res.status(400).json({ error: `Invalid library voice ID format: ${voiceId}` });
      // }

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

    // --- Actual Hume SDK Call --- 
    const jsonResponse = await humeClient.tts.synthesizeJson({ // Use synthesizeJson
        utterances: [utterance] // Pass options within utterances array
    });

    // --- Process JSON Response --- 
    // Check if the response is an object and has the expected nested structure
    if (!jsonResponse || typeof jsonResponse !== 'object' || !jsonResponse.generations || !Array.isArray(jsonResponse.generations) || jsonResponse.generations.length === 0 || !jsonResponse.generations[0].audio) {
        // Log the actual response for debugging if the structure is invalid
        console.error('Invalid response structure received from Hume API:', JSON.stringify(jsonResponse, null, 2)); 
        throw new Error('Hume API returned an unexpected response structure.');
    }

    // Access the audio data correctly from the object structure
    const base64Audio = jsonResponse.generations[0].audio;
    console.log('Hume synthesis successful, received base64 audio (length):', base64Audio.length);

    // Convert base64 to Buffer
    const audioBuffer = Buffer.from(base64Audio, 'base64');

    // --- Send Audio Buffer Response --- 
    res.setHeader('Content-Type', 'audio/wav'); // Assuming default WAV, adjust if MP3/PCM used/needed
    res.send(audioBuffer);

  } catch (error: any) {
    console.error('Error calling Hume TTS API:', error);
    // Ensure we don't try to send error after streaming started
    if (!res.headersSent) { 
        res.status(500).json({ error: error.message || 'Failed to generate Hume TTS audio' });
    }
  }
});

// --- Route for generating Hume Client Access Tokens ---
router.post('/hume/generate-token', async (_req, res) => {
  const humeApiKey = process.env.HUME_API_KEY;
  const humeSecretKey = process.env.HUME_SECRET_KEY;

  if (!humeApiKey) {
    console.error('Hume API Key not found in environment variables.');
    return res.status(500).json({ error: 'Hume API Key not configured on server.' });
  }
  if (!humeSecretKey) {
    console.error('Hume Secret Key not found in environment variables.');
    return res.status(500).json({ error: 'Hume Secret Key not configured on server.' });
  }

  try {
    // --- Restore manual Fetch Access Token using Basic Auth ---
    console.log('Attempting to generate Hume token using manual fetch with Basic Auth...');
    const credentials = Buffer.from(`${humeApiKey}:${humeSecretKey}`).toString('base64');
    const tokenUrl = 'https://api.hume.ai/oauth2-cc/token';

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded', // Required by Hume endpoint
      },
      body: 'grant_type=client_credentials', // Required by Hume endpoint
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
    // --- End Restore manual Fetch Access Token ---

    res.json({ accessToken });

  } catch (error: any) {
    console.error('Error generating Hume access token:', error);
    res.status(500).json({ error: error.message || 'Failed to generate Hume access token' });
  }
});

// --- End Token Route ---

export default router; // Export the router to be used by the main server file 