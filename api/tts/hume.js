import { withApiAccess } from "../_lib/api-access.js";
import { generateHumeTTS } from '../hume/hume-handlers.js';

 async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Handle OPTIONS method for preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed, use POST' });
  }

  try {
    const humeApiKey = process.env.HUME_API_KEY;
    const humeSecretKey = process.env.HUME_SECRET_KEY;
    
    const { text, voiceId, voicePrompt, actingInstruction, voiceSource } = req.body;

    const audioBuffer = await generateHumeTTS(humeApiKey, humeSecretKey, {
      text,
      voiceId,
      voicePrompt,
      actingInstruction,
      voiceSource
    });

    // Send Audio Buffer Response
    res.setHeader('Content-Type', 'audio/wav');
    return res.send(audioBuffer);
  } catch (error) {
    console.error('Error in Hume TTS handler:', error);
    // Ensure we don't try to send error after streaming started
    if (!res.headersSent) { 
      return res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Failed to generate Hume TTS audio' 
      });
    }
  }
}

export default withApiAccess(handler, "/api/tts/hume");
