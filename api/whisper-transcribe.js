import { withApiAccess } from "./_lib/api-access.js";
/**
 * Whisper-1 transcription endpoint
 * Accepts audio file and returns transcribed text
 *
 * POST /api/whisper-transcribe
 * Content-Type: multipart/form-data
 * Body: audio file (webm, mp3, wav, m4a, etc.)
 */
 async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error('[Whisper] Missing OPENAI_API_KEY');
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }

    // For Vercel, we need to read the raw body and parse multipart manually
    // or expect base64 encoded audio in JSON body
    const contentType = req.headers['content-type'] || '';

    let audioBuffer;
    let filename = 'audio.webm';
    let mimeType = 'audio/webm';

    if (contentType.includes('application/json')) {
      // Handle JSON body with base64 audio
      const body = req.body;
      if (!body || !body.audio) {
        return res.status(400).json({ error: 'No audio data provided' });
      }

      // Decode base64 audio
      const base64Data = body.audio.replace(/^data:audio\/\w+;base64,/, '');
      audioBuffer = Buffer.from(base64Data, 'base64');
      filename = body.filename || 'audio.webm';
      mimeType = body.mimeType || 'audio/webm';
    } else if (contentType.includes('multipart/form-data')) {
      // For multipart, collect chunks into buffer
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      // Simple multipart parser - find the file content
      const boundary = contentType.split('boundary=')[1];
      if (!boundary) {
        return res.status(400).json({ error: 'Invalid multipart boundary' });
      }

      const parts = buffer.toString('binary').split('--' + boundary);
      for (const part of parts) {
        if (part.includes('filename=')) {
          // Extract filename
          const filenameMatch = part.match(/filename="([^"]+)"/);
          if (filenameMatch) filename = filenameMatch[1];

          // Extract content type
          const ctMatch = part.match(/Content-Type:\s*([^\r\n]+)/i);
          if (ctMatch) mimeType = ctMatch[1].trim();

          // Find the content (after double CRLF)
          const contentStart = part.indexOf('\r\n\r\n');
          if (contentStart !== -1) {
            const content = part.slice(contentStart + 4);
            // Remove trailing boundary markers
            const cleanContent = content.replace(/\r\n--.*$/, '');
            audioBuffer = Buffer.from(cleanContent, 'binary');
          }
          break;
        }
      }

      if (!audioBuffer) {
        return res.status(400).json({ error: 'No audio file found in multipart data' });
      }
    } else {
      return res.status(400).json({ error: 'Unsupported content type. Use JSON with base64 audio or multipart/form-data' });
    }

    console.log('[Whisper] Transcribing audio:', {
      filename,
      size: audioBuffer.length,
      mimeType
    });

    // Create FormData for OpenAI API using fetch-compatible approach
    const formData = new FormData();
    const blob = new Blob([audioBuffer], { type: mimeType });
    formData.append('file', blob, filename);
    formData.append('model', 'whisper-1');
    formData.append('language', 'en');
    formData.append('response_format', 'json');

    // Call OpenAI Whisper API
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Whisper] OpenAI API error:', response.status, errorText);
      return res.status(response.status).json({
        error: 'Transcription failed',
        details: errorText
      });
    }

    const result = await response.json();

    console.log('[Whisper] Transcription complete:', {
      textLength: result.text?.length,
      preview: result.text?.substring(0, 100)
    });

    return res.status(200).json({
      success: true,
      text: result.text || '',
    });

  } catch (error) {
    console.error('[Whisper] Error:', error);
    return res.status(500).json({
      error: 'Transcription failed',
      details: error.message
    });
  }
}

export default withApiAccess(handler, "/api/whisper-transcribe");
