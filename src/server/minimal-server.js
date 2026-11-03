// ESM-compatible minimal server
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { LumaAI } from 'lumaai';
import path from 'path';
import { fileURLToPath } from 'url';

// Get directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config();

const app = express();
const router = express.Router();
const PORT = process.env.PORT || 3000;

// Configure middleware with simplified CORS for development
app.use(cors({
  origin: '*', // Allow all origins for now
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Increase timeout and body size limits
app.use(express.json({ limit: '50mb' }));  // Increased size limit for base64 images

// Serve the fallback page for when the main app is unavailable
app.use(express.static(path.join(__dirname, '../../public')));

// Add timestamp to logs
const log = (message, data) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`, data ? data : '');
};

// Simple health check endpoint
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Luma generation endpoint
router.post('/luma/generate', async (req, res) => {
  try {
    const { prompt, referenceImage, type = 'image', mode = 'text-to-video', quality = 'high' } = req.body;
    
    log('API Request received:', { 
      prompt: prompt ? `${prompt.substring(0, 30)}...` : undefined, 
      hasReferenceImage: !!referenceImage,
      type, 
      mode,
      quality 
    });
    
    if (!process.env.LUMAAI_API_KEY) {
      log('ERROR: LUMAAI_API_KEY is not configured');
      throw new Error('LUMAAI_API_KEY is not configured');
    }
    
    log('LUMAAI_API_KEY exists:', !!process.env.LUMAAI_API_KEY);
    
    // Only require prompt for text-to-video or image generation, not for image-to-video
    if (mode !== 'image-to-video' && !prompt) {
      return res.status(400).json({ error: 'Prompt is required for text-to-video and image generation' });
    }
    
    // For image-to-video, require referenceImage
    if (mode === 'image-to-video' && !referenceImage) {
      return res.status(400).json({ error: 'Reference image is required for image-to-video generation' });
    }
    
    const lumaClient = new LumaAI({
      authToken: process.env.LUMAAI_API_KEY,
      maxRetries: 2,
      timeout: 60000
    });
    
    log('Luma client created');
    
    try {
      // Handle image generation
      if (type === 'image') {
        // Image generation config
        const imageConfig = {
          prompt,
          model: "photon-1",
          ...(referenceImage && { style_ref: [{ url: referenceImage, weight: 1 }] })
        };
        
        log('Image generation config:', imageConfig);
        log('Using LUMA API KEY:', process.env.LUMAAI_API_KEY.substring(0, 15) + '...');
        
        // Create the image generation
        const generation = await lumaClient.generations.image.create(imageConfig);
        log('Image generation initiated:', { id: generation.id });
        
        // Poll for the result
        let result = await lumaClient.generations.get(generation.id);
        log('Initial generation state:', { state: result.state });
        
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
        
        log('Image generation successful, returning URL:', url);
        return res.json({ url });
      } 
      // Handle image-to-video generation
      else if (type === 'video' && mode === 'image-to-video') {
        if (!referenceImage) {
          throw new Error('Reference image is required for image-to-video generation');
        }
        
        // Check if the referenceImage is a valid URL or base64
        const isBase64 = referenceImage.startsWith('data:');
        const isValidUrl = referenceImage.startsWith('http');
        
        log('Reference image type:', {
          isBase64,
          isValidUrl,
          length: referenceImage.length,
          startsWith: referenceImage.substring(0, 30) + '...'
        });
        
        // IMPORTANT: Luma API requires a URL for the reference image, not base64
        // If we receive base64, we need to handle this case differently
        // For now, we'll just use the URL directly and log a warning if it's base64
        if (isBase64) {
          log('ERROR: Received base64 image for video generation. Luma API requires URL format.');
          return res.status(400).json({ 
            error: 'Reference image must be a URL for video generation, not base64 data'
          });
        }
        
        // Use the original prompt if provided, otherwise use a default
        const defaultPrompt = "Animate this image with natural motion";
        const promptToUse = prompt || defaultPrompt;
        
        log('Using prompt for video generation:', promptToUse);
        
        // Build the configuration for image-to-video using the correct keyframes structure
        // This is the key fix - ensuring we use the proper format for Ray-2 model
        const videoConfig = {
          prompt: promptToUse,
          model: "ray-2",
          keyframes: {
            frame0: {
              type: "image",
              url: referenceImage
            }
          }
        };
        
        log('Image-to-video generation config:', JSON.stringify(videoConfig, null, 2));
        log('Using LUMA API KEY:', process.env.LUMAAI_API_KEY.substring(0, 15) + '...');
        
        // Create the generation using the client
        const generation = await lumaClient.generations.create(videoConfig);
        
        if (!generation.id) {
          throw new Error('No generation ID received from Luma API');
        }
        
        log('Video generation initiated:', { id: generation.id });
        
        // Poll for the result
        let result = await lumaClient.generations.get(generation.id);
        log('Initial result:', { state: result.state, id: result.id });
        
        while (result.state !== 'completed' && result.state !== 'failed') {
          await new Promise(r => setTimeout(r, 3000));
          result = await lumaClient.generations.get(generation.id);
          log('Generation status:', { state: result.state });
          
          if (result.failure_reason) {
            throw new Error(`Luma generation failed: ${result.failure_reason}`);
          }
        }
        
        const url = result.assets?.video;
        if (!url) {
          throw new Error('No video URL in result');
        }
        
        log('Video generation successful, returning URL:', url);
        return res.json({ url });
      }
      // Handle text-to-video generation
      else {
        // Text-to-video generation
        const videoConfig = {
          prompt,
          model: "ray-2",
          ...(referenceImage && { style_ref: [{ url: referenceImage, weight: 1 }] })
        };
        
        log('Text-to-video generation config:', videoConfig);
        const generation = await lumaClient.generations.create(videoConfig);
        
        if (!generation.id) {
          throw new Error('No generation ID received');
        }
        
        log('Generation initiated:', { id: generation.id });
        
        let result = await lumaClient.generations.get(generation.id);
        log('Initial result:', { state: result.state, id: result.id });
        
        while (result.state !== 'completed' && result.state !== 'failed') {
          await new Promise(r => setTimeout(r, 3000));
          result = await lumaClient.generations.get(generation.id);
          log('Generation status:', { state: result.state });
          
          if (result.failure_reason) {
            throw new Error(`Luma generation failed: ${result.failure_reason}`);
          }
        }
        
        const url = result.assets?.video;
        if (!url) {
          throw new Error('No video URL in result');
        }
        
        log('Generation successful, returning URL:', url);
        return res.json({ url });
      }
    } catch (apiError) {
      log('Luma API create error:', apiError);
      throw apiError;
    }
  } catch (error) {
    log('Detailed Luma generation error:', error);
    
    if (error instanceof LumaAI.APIError) {
      log('Luma API Error details:', {
        status: error.status,
        name: error.name,
        message: error.message
      });
      return res.status(error.status).json({
        error: error.message,
        type: error.name
      });
    }
    
    // Extract more info from the error if possible
    const errorDetails = {
      message: error instanceof Error ? error.message : 'Generation failed',
      stack: error instanceof Error ? error.stack : undefined,
      details: JSON.stringify(error, null, 2)
    };
    
    log('Error details:', errorDetails);
    
    res.status(500).json({ 
      error: errorDetails.message,
      details: errorDetails.details
    });
  }
});

// Mount routes
app.use('/api', router);

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
}); 