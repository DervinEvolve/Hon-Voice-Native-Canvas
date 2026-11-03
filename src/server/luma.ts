import { NextRequest } from 'next/server';

// Configure runtime
export const config = {
  runtime: 'edge'
};

// Types
interface LumaRequest {
  prompt: string;
  referenceImage?: string;
  type?: string;
}

// Add timestamp to logs
const log = (message: string, data?: any) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`, data ? data : '');
};

export default async function handler(req: NextRequest) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    // Parse the request body first
    const requestData = await req.json() as LumaRequest & { 
      mode?: string;
      quality?: 'standard' | 'high';
    };
    const { prompt, referenceImage, type = 'image', mode = 'text-to-video', quality = 'high' } = requestData;
    
    log('📥 Incoming request:', { prompt, type, mode, hasReference: !!referenceImage });
    
    if (!process.env.LUMAAI_API_KEY) {
      throw new Error('LUMAAI_API_KEY is not configured');
    }

    // Validate input parameters based on mode
    if (type === 'image' || (type === 'video' && mode !== 'image-to-video')) {
      // For image generation or text-to-video, we need a prompt
      if (!prompt) {
        throw new Error('Prompt is required for this generation type');
      }
    }

    // Handle video generation
    if (type === 'video') {
      // Check if this is an image-to-video request
      if (mode === 'image-to-video') {
        // For image-to-video, we don't need a prompt
        if (!referenceImage) {
          throw new Error('Reference image is required for image-to-video generation');
        }
        
        // Use the v0 API for image-to-video
        const videoResponse = await fetch('https://api.lumalabs.ai/v0/image-to-video', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.LUMAAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            image_url: referenceImage,
            interpolation_level: quality === 'high' ? "high" : "medium",
            num_interpolation_steps: quality === 'high' ? 10 : 5,
            motion_strength: 0.7,
            motion_direction: "zoom_out",
            ...(prompt && { prompt })
          })
        });

        const videoGeneration = await videoResponse.json();
        
        if (!videoGeneration?.id) {
          throw new Error('No generation ID returned');
        }

        log('🎥 Image-to-Video generation started:', videoGeneration.id);

        // Poll for completion
        let result;
        let attempts = 0;
        const maxAttempts = 30;

        while (!result && attempts < maxAttempts) {
          const status = await fetch(`https://api.lumalabs.ai/v0/image-to-video/${videoGeneration.id}`, {
            headers: {
              'Authorization': `Bearer ${process.env.LUMAAI_API_KEY}`
            }
          }).then(res => res.json());

          log('🎥 Image-to-Video status:', status);

          if (status.state === 'completed') {
            result = status;
            break;
          }

          if (status.state === 'failed') {
            throw new Error(status.failure_reason || 'Video generation failed');
          }

          await new Promise(resolve => setTimeout(resolve, 2000));
          attempts++;
        }

        if (!result?.video_url) {
          throw new Error('No video URL in completed result');
        }

        return new Response(JSON.stringify({ url: result.video_url }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } else {
        // Your text-to-video code...
      }
    }

    // Handle image generation (unchanged)
    const generationConfig = {
      prompt,
      model: "photon-1",
      ...(referenceImage && { style_ref: [{ url: referenceImage, weight: 1 }] })
    };

    log('🖼️ Image generation config:', generationConfig);

    try {
      // Create generation using REST API
      const endpoint = type === 'image' ? '/generations/image' : '/generations';
      log('🔄 Making API request to:', `https://api.lumalabs.ai/dream-machine/v1${endpoint}`);

      const generation = await fetch(`https://api.lumalabs.ai/dream-machine/v1${endpoint}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.LUMAAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(generationConfig)
      }).then(async (res) => {
        if (!res.ok) {
          const errorText = await res.text();
          log('⚠️ API Error:', { status: res.status, statusText: res.statusText, body: errorText });
          throw new Error(`Luma API error: ${res.status} ${res.statusText} - ${errorText}`);
        }
        return res.json();
      }).catch(error => {
        log('⚠️ Fetch error:', error);
        throw error;
      });

      if (!generation?.id) {
        throw new Error('No generation ID returned from Luma');
      }

      log('🚀 Generation initiated:', { id: generation.id, type });

      // Poll for completion
      let result;
      let pollCount = 0;
      const POLL_INTERVAL = type === 'image' ? 1000 : 2000;

      while (true) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
        
        const response = await fetch(`https://api.lumalabs.ai/dream-machine/v1/generations/${generation.id}`, {
          headers: {
            'Authorization': `Bearer ${process.env.LUMAAI_API_KEY}`
          }
        });
        result = await response.json();
        pollCount++;

        log('📊 Generation status:', {
          state: result.state,
          pollCount,
          elapsedTime: `${pollCount * POLL_INTERVAL/1000}s`
        });

        if (result.state === 'completed') break;
        if (result.state === 'failed') {
          throw new Error(result.failure_reason || 'Generation failed');
        }
      }

      const url = type === 'image' ? result.assets?.image : result.assets?.video;
      if (!url) {
        throw new Error(`No ${type} URL in result`);
      }

      log('✨ Generation successful:', { type, url });

      return new Response(JSON.stringify({ url }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      log('❌ Generation error:', { error });
      return new Response(
        JSON.stringify({ 
          error: error instanceof Error ? error.message : 'Generation failed',
          type: 'EDGE_ERROR'
        }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  } catch (error) {
    log('❌ Generation error:', { error });
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Generation failed',
        type: 'EDGE_ERROR'
      }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
} 