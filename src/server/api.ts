import dotenv from 'dotenv';
import path from 'path';
import express, { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import cors from 'cors';
import { fal } from '@fal-ai/client';
import { LumaAI } from 'lumaai';
import type { ParamsDictionary } from 'express-serve-static-core';
import { nanoid } from 'nanoid';
import { fileURLToPath } from 'url';
import fileUpload from 'express-fileupload';
import { Blob } from 'buffer';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import { authorizeApiRequest, consumeApiBudget, consumePaidJobBudget } from '../../api/_lib/api-access.js';
import { uploadedMediaData } from '../../api/_lib/asset-source.js';
import { sendNotAvailable, WORLD_SCENE_NOT_AVAILABLE } from '../../api/_lib/not-available.js';
import { jobTokenIssuer, ownedProviderId, sendJobOwnershipError } from '../../api/_lib/job-ownership.js';

// Import Hume API router
import humeApiRouter from './humeApi';

// Import game templates
const gameTemplates = require('./game-templates.js');

// For ESM dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// DEBUG: Check if Hume keys are loaded immediately after dotenv.config
console.log('[DEBUG api.ts] Hume Keys Loaded:', {
  apiKeyExists: !!process.env.HUME_API_KEY,
  secretKeyExists: !!process.env.HUME_SECRET_KEY
});

const app = express();
const router = Router();
app.disable('x-powered-by');

// Basic response hardening for the local API server (JSON only).
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Check before body parsing, uploads, Hume token minting, or provider dispatch.
app.use('/api', async (req, res, next) => {
  try {
    const pathname = req.originalUrl.split('?')[0];
    const context = await authorizeApiRequest(req, res, createClient, pathname, process.env.HON_APP_ORIGIN);
    if (context && await consumeApiBudget(req, res, context.actor, createClient)
      && await consumePaidJobBudget(req, res, context.actor, pathname, createClient)) {
      // Routes that hand out or read job tokens need the verified user.
      res.locals.actor = context.actor;
      next();
    }
  } catch { res.status(503).json({ error: 'API authorization could not be completed' }); }
});

app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? [/\.vercel\.app$/, /localhost/] 
    : '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(fileUpload());

// Mount Hume API routes
app.use('/api', humeApiRouter);

// Configure FAL client
fal.config({
  credentials: process.env.FAL_API_KEY
});

interface EditRequest {
  prompt: string;
  imageUrl: string;
}

interface LumaRequest {
  prompt?: string;
  referenceImage?: string;
  type?: string;
  mode?: string;
  quality?: 'standard' | 'high';
  // Enhanced Luma API parameters
  operation_type?: 'text_to_video' | 'image_to_video' | 'extend_video' | 'reverse_extend' | 'interpolate';
  model?: 'ray-2' | 'ray-flash-2' | 'ray-1-6';
  resolution?: '540p' | '720p' | '1080p' | '4k';
  duration?: '3s' | '5s' | '8s';
  aspect_ratio?: '16:9' | '1:1' | '9:16';
  loop?: boolean;
  start_image_url?: string;
  end_image_url?: string;
  reference_video_id?: string;
  camera_motion?: string;
  concepts?: string[];
  motion_intensity?: 'low' | 'medium' | 'high';
  style_prompt?: string;
  negative_prompt?: string;
  enhance_prompt?: boolean;
  webhook_url?: string;
  target_element_id?: string;
}

console.log('Environment variables:', {
  LUMAAI_API_KEY_EXISTS: !!process.env.LUMAAI_API_KEY,
  LUMAAI_API_KEY_LENGTH: process.env.LUMAAI_API_KEY?.length,
  NODE_ENV: process.env.NODE_ENV
});

// Add timestamp to logs
const log = (message: string, data?: any) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`, data ? data : '');
};

// @ts-ignore - Express route handler return type
router.post<ParamsDictionary, any, EditRequest>('/ai/edit', async (req, res) => {
  try {
    const { prompt, imageUrl } = req.body;

    if (!prompt || !imageUrl) {
      return res.status(400).json({ error: 'Missing prompt or image URL' });
    }

    console.log('Editing image with prompt:', prompt);

    const result = await fal.subscribe('fal-ai/ip-adapter-plus-face', {
      input: {
        prompt,
        image: imageUrl,
        negative_prompt: 'blurry, bad quality, distorted',
        num_inference_steps: 30,
        guidance_scale: 7.5,
        seed: 42
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS") {
          console.log('Edit progress:', update.logs?.map(log => log.message));
        }
      },
    });

    console.log('Edit completed:', result);

    if (!result.data?.images?.[0]?.url) {
      throw new Error('No image URL in response');
    }

    return res.json({ url: result.data.images[0].url });
  } catch (error) {
    console.error('Flux API error:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error occurred' });
  }
});

// Enhanced Luma generation endpoint supporting all capabilities
const lumaGenerateHandler = async (req: Request<ParamsDictionary, any, LumaRequest>, res: Response) => {
  // Check job signing before the provider is charged. A reference to an
  // earlier generation must be this user's own job token.
  let issueJobToken: (providerId: string) => string;
  let referenceId: string | undefined;
  try {
    issueJobToken = jobTokenIssuer(res.locals.actor, 'luma/generation');
    if (req.body?.reference_video_id) referenceId = ownedProviderId(res.locals.actor, 'luma/generation', req.body.reference_video_id);
  } catch (error) { return sendJobOwnershipError(res, error); }

  try {
    const { 
      prompt, 
      referenceImage, 
      type = 'video', 
      mode = 'text-to-video',
      operation_type = 'text_to_video',
      model = 'ray-2',
      resolution = '720p',
      duration = '5s',
      aspect_ratio = '16:9',
      loop = false,
      start_image_url,
      end_image_url,
      reference_video_id,
      camera_motion,
      concepts = [],
      motion_intensity = 'medium',
      style_prompt,
      negative_prompt,
      enhance_prompt = false,
      webhook_url,
      target_element_id  // Add target_element_id support
    } = req.body;
    
    log('LUMAAI_API_KEY check:', !!process.env.LUMAAI_API_KEY);
    log('Enhanced API Request received:', {
      prompt: prompt ? prompt.substring(0, 100) + '...' : 'none',
      operation_type,
      target_element_id,
      hasStartImage: !!start_image_url,
      hasReferenceImage: !!referenceImage
    });

    if (!process.env.LUMAAI_API_KEY) {
      throw new Error('LUMAAI_API_KEY environment variable is required');
    }

    // Enhanced panel reference detection for natural language
    let detectedPanelId = target_element_id;
    let detectedImageUrl = start_image_url || referenceImage;
    let finalOperationType = operation_type;

    console.log(`Analyzing prompt for panel references: "${prompt}"`);
    
    // Parse panel references from natural language
    if (prompt && !detectedPanelId) {
      const panelMatches = [
        { regex: /(?:panel\s+|the\s+)(\d+)(?:st|nd|rd|th)?(?:\s+panel)?/i, group: 1 },
        { regex: /(?:first|1st)\s+panel/i, value: '0' },  // Fix: first panel = index 0
        { regex: /(?:second|2nd)\s+panel/i, value: '1' }, // Fix: second panel = index 1  
        { regex: /(?:third|3rd)\s+panel/i, value: '2' },  // Fix: third panel = index 2
        { regex: /(?:fourth|4th)\s+panel/i, value: '3' }, // Fix: fourth panel = index 3
        { regex: /(?:this|current)\s+panel/i, value: 'current' }
      ];

      for (const match of panelMatches) {
        const result = prompt.match(match.regex);
        if (result) {
          let panelNumber = match.value || result[match.group || 1];
          console.log(`Panel reference detected: "${result[0]}" -> panel ${panelNumber}`);
          
          // Convert 1-based user language to 0-based indexing for numeric references
          // e.g., "panel 1" should become "panel-0", "panel 2" should become "panel-1"
          if (panelNumber !== 'current' && !match.value) {
            // This is a numeric capture from the regex, convert from 1-based to 0-based
            const numericPanel = parseInt(panelNumber, 10);
            if (!isNaN(numericPanel) && numericPanel > 0) {
              panelNumber = (numericPanel - 1).toString();
              console.log(`Converted 1-based numeric reference to 0-based: ${numericPanel} -> ${panelNumber}`);
            }
          }
          
          // Convert panel number to actual panel ID
          if (panelNumber !== 'current') {
            detectedPanelId = `panel-${panelNumber}`;
            console.log(`Panel reference resolved: panel ${panelNumber} -> ${detectedPanelId}`);
          }
          break;
        }
      }
    }

    // Enhanced image-to-video detection
    if (prompt && !detectedImageUrl) {
      const imageToVideoKeywords = [
        'turn this image into',
        'convert this image to',
        'turn the image in',
        'animate this image',
        'make this image move',
        'turn panel',
        'animate panel',
        'convert panel'
      ];

      const hasImageToVideoKeyword = imageToVideoKeywords.some(keyword => 
        prompt.toLowerCase().includes(keyword.toLowerCase())
      );

      if (hasImageToVideoKeyword) {
        console.log(`Image-to-video keywords detected in prompt: "${prompt}"`);
        finalOperationType = 'image_to_video';
        
        // If we detected a panel but no image URL, we need to get it from the comic store
        // For now, log that we need the image URL
        if (detectedPanelId && !detectedImageUrl) {
          console.log(`Need to fetch image URL for panel: ${detectedPanelId}`);
          // In a real implementation, we'd query the comic store here
          // For now, we'll rely on the frontend to provide the image URL
        }
      }
    }

    log('Enhanced detection results:', {
      detectedPanelId,
      detectedImageUrl: detectedImageUrl ? detectedImageUrl.substring(0, 50) + '...' : 'none',
      finalOperationType,
      promptAnalysis: prompt ? 'analyzed' : 'none'
    });

    // If no specific panel detected and it's text-to-video, find an empty panel
    if (!detectedPanelId && finalOperationType === 'text_to_video') {
      console.log('Text-to-video with no specific panel - finding next available empty panel');
      
      // Since we're on the server, we can't access useComicStore directly
      // We'll need to handle this on the client side in the polling system
      // For now, we'll pass a special flag to indicate "find empty panel"
      detectedPanelId = 'AUTO_FIND_EMPTY';
    }

    // Set up the base video config
    let videoConfig: any = {
      prompt: prompt || 'Generate a video',
      aspect_ratio,
      loop,
      ...(model && { model }),
      ...(resolution && { resolution }),
      ...(duration && { duration }),
      ...(camera_motion && { camera_motion }),
      ...(motion_intensity && { motion_intensity }),
      ...(style_prompt && { style_prompt }),
      ...(negative_prompt && { negative_prompt }),
      ...(enhance_prompt && { enhance_prompt }),
      ...(webhook_url && { webhook_url })
    };

    // Handle different operation types with enhanced logic
    switch (finalOperationType) {
      case 'image_to_video':
        if (!detectedImageUrl) {
          throw new Error('Image URL is required for image-to-video generation');
        }
        videoConfig = {
          ...videoConfig,
          keyframes: {
            frame0: {
              type: "image",
              url: detectedImageUrl
            },
            ...(end_image_url && {
              frame1: {
                type: "image", 
                url: end_image_url
              }
            })
          }
        };
        console.log('Configured for image-to-video with keyframes');
        break;

      case 'video_to_video':
        if (!reference_video_id) {
          throw new Error('Reference video ID is required for video-to-video generation');
        }
        videoConfig = {
          ...videoConfig,
          keyframes: {
            frame0: {
              type: "generation",
              id: referenceId
            }
          }
        };
        break;

      default: // text_to_video
        // No additional config needed for text-to-video
        break;
    }

    log('Final video config:', {
      ...videoConfig,
      keyframes: videoConfig.keyframes ? 'configured' : null
    });

    // Use REST API for maximum compatibility with all features
    const response = await fetch('https://api.lumalabs.ai/dream-machine/v1/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.LUMAAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(videoConfig)
    });

    if (!response.ok) {
      const errorText = await response.text();
      log('Luma API error response:', errorText);
      throw new Error(`Luma API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json() as Record<string, any>;
    log('Luma API success:', {
      id: result.id,
      state: result.state,
      video_url: result.video ? result.video.url : 'not ready'
    });

    // Enhanced response with panel update information
    const enhancedResult = {
      ...result,
      id: issueJobToken(result.id),
      // Add metadata for client-side panel updates
      panel_update_info: detectedPanelId ? {
        target_panel_id: detectedPanelId,
        operation_type: finalOperationType,
        should_update_panel: true
      } : null
    };

    log('Enhanced result with panel info:', {
      id: enhancedResult.id,
      panel_update_info: enhancedResult.panel_update_info
    });

    res.json(enhancedResult);

    // Panel updates will be handled client-side via comic store
    // when the polling system detects video completion

  } catch (error) {
    log('Luma generation error:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Unknown error occurred' 
    });
  }
};

// @ts-ignore - Express route handler type issues
router.post('/luma/generate', lumaGenerateHandler);

// @ts-ignore - Express route handler return type
router.get('/health', (_req, res) => {
  return res.json({ status: 'ok' });
});

// Local mirror of api/cloudinary-upload.js. It sits under /api, so the access
// check and request budget above apply. The Cloudinary account and preset come
// from server configuration only; request fields cannot choose them.
app.post('/api/cloudinary-upload', async (req: Request, res: Response): Promise<void> => {
  try {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME || process.env.VITE_CLOUDINARY_CLOUD_NAME;
    const preset = process.env.CLOUDINARY_UPLOAD_PRESET || 'hon_comics';
    if (!cloudName || !/^[a-z0-9_-]{1,64}$/i.test(cloudName)) {
      res.status(503).json({ error: 'Cloudinary upload is not configured' });
      return;
    }

    // Multipart upload (field "file") or JSON { file: data URL }, as the deployed route accepts.
    let fileBlob: Blob;
    let fileName = 'upload';
    const uploaded = req.files?.file;
    if (uploaded) {
      const uploadedFile = Array.isArray(uploaded) ? uploaded[0] : uploaded;
      if (uploadedFile.size > 20 * 1024 * 1024) {
        res.status(413).json({ error: 'Media upload is too large' });
        return;
      }
      fileBlob = new Blob([uploadedFile.data], { type: uploadedFile.mimetype });
      fileName = uploadedFile.name;
    } else {
      let dataUrl: string;
      try { dataUrl = uploadedMediaData(req.body?.file); }
      catch { res.status(400).json({ error: 'A bounded base64 media file is required' }); return; }
      const [header, base64] = dataUrl.split(',', 2);
      fileBlob = new Blob([Buffer.from(base64, 'base64')], { type: header.slice(5, header.indexOf(';')) });
    }

    const formData = new FormData();
    formData.append('file', fileBlob, fileName);
    formData.append('upload_preset', preset);

    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`, {
      method: 'POST',
      body: formData,
      redirect: 'error',
    });
    const data = await response.json() as Record<string, any>;
    if (response.ok) {
      res.json({ url: data.secure_url });
    } else {
      res.status(502).json({ error: 'Upload failed' });
    }
  } catch (error) {
    console.error('Error in Cloudinary proxy:', error);
    res.status(500).json({ error: 'Server error processing upload' });
  }
});

// Add GPT-Image-1 related interfaces
interface GptTextToImageRequest {
  prompt: string;
  options?: {
    image_size?: 'auto' | '1024x1024' | '1536x1024' | '1024x1536';
    quality?: 'auto' | 'low' | 'medium' | 'high';
    background?: 'auto' | 'transparent' | 'opaque';
    num_images?: number;
  };
}

interface GptImageEditRequest {
  prompt: string;
  imageUrl: string;
  options?: {
    image_size?: 'auto' | '1024x1024' | '1536x1024' | '1024x1536';
    quality?: 'auto' | 'low' | 'medium' | 'high';
    num_images?: number;
  };
}

// GPT Text-to-Image endpoint
// @ts-ignore - Express route handler return type
router.post<ParamsDictionary, any, GptTextToImageRequest>('/gpt/text-to-image', async (req, res) => {
  const { prompt, options = {} } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Missing required parameter: prompt is required' });
  }

  try {
    const openAIApiKey = process.env.OPENAI_API_KEY;
    
    if (!openAIApiKey) {
      return res.status(500).json({ error: 'Server configuration error: Missing OpenAI API key' });
    }

    log(`Processing GPT-Image-1 text-to-image: "${prompt}"`);

    const result = await fal.subscribe('fal-ai/gpt-image-1/text-to-image/byok', {
      input: {
        prompt,
        openai_api_key: openAIApiKey,
        image_size: options.image_size || 'auto',
        quality: options.quality || 'auto',
        background: options.background || 'auto',
        num_images: options.num_images || 1
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS") {
          log('GPT-Image-1 text-to-image progress:', update.logs?.map(log => log.message));
        }
      },
    });

    log('GPT-Image-1 text-to-image completed:', result);

    if (!result?.data?.images?.[0]?.url) {
      console.error('Unexpected response format from GPT-Image-1:', result);
      return res.status(500).json({ error: 'Invalid response format from image service' });
    }

    const generatedUrl = result.data.images[0].url;
    log(`GPT-Image-1 text-to-image successful. Result: ${generatedUrl}`);
    
    return res.status(200).json({ url: generatedUrl });

  } catch (error) {
    console.error('Error processing GPT-Image-1 text-to-image:', error);
    return res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Unknown error occurred' 
    });
  }
});

// GPT Image Edit endpoint
// @ts-ignore - Express route handler return type
router.post<ParamsDictionary, any, GptImageEditRequest>('/gpt/edit-image', async (req, res) => {
  const { prompt, imageUrl, options = {} } = req.body;

  if (!prompt || !imageUrl) {
    return res.status(400).json({ error: 'Missing required parameters: prompt and imageUrl are required' });
  }

  try {
    const openAIApiKey = process.env.OPENAI_API_KEY;
    
    if (!openAIApiKey) {
      return res.status(500).json({ error: 'Server configuration error: Missing OpenAI API key' });
    }

    log(`Processing GPT-Image-1 image edit: "${prompt}" for image ${imageUrl.substring(0, 30)}...`);

    const result = await fal.subscribe('fal-ai/gpt-image-1/edit-image/byok', {
      input: {
        image_urls: [imageUrl],
        prompt,
        openai_api_key: openAIApiKey,
        image_size: options.image_size || 'auto',
        quality: options.quality || 'auto',
        num_images: options.num_images || 1
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS") {
          log('GPT-Image-1 edit progress:', update.logs?.map(log => log.message));
        }
      },
    });

    log('GPT-Image-1 edit completed:', result);

    if (!result?.data?.images?.[0]?.url) {
      console.error('Unexpected response format from GPT-Image-1:', result);
      return res.status(500).json({ error: 'Invalid response format from image service' });
    }

    const editedImageUrl = result.data.images[0].url;
    log(`GPT-Image-1 edit successful. Result: ${editedImageUrl}`);
    
    return res.status(200).json({ editedImageUrl });

  } catch (error) {
    console.error('Error processing GPT-Image-1 edit:', error);
    return res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Unknown error occurred' 
    });
  }
});

// Add Moondream2 image captioning endpoint 
// @ts-ignore - Express route handler return type
router.post('/fal/moondream', async (req, res) => {
  try {
    const { imageUrl } = req.body;

    if (!imageUrl) {
      return res.status(400).json({ error: 'Missing imageUrl parameter' });
    }

    // Simple memory cache for faster responses and to reduce API calls
    // In a production environment, you'd use Redis or another proper caching solution
    const CAPTION_CACHE = globalThis.CAPTION_CACHE || (globalThis.CAPTION_CACHE = new Map());
    const cacheKey = imageUrl;
    
    // Check cache first
    if (CAPTION_CACHE.has(cacheKey)) {
      const cachedResult = CAPTION_CACHE.get(cacheKey);
      log('🔍 Retrieved caption from cache for:', imageUrl.substring(0, 30) + '...');
      return res.json(cachedResult);
    }

    log('🔄 [MD3] Caption request for image:', imageUrl.substring(0, 30) + '...');

    const result = await fal.subscribe("fal-ai/moondream3-preview/caption", {
      input: {
        image_url: imageUrl,
        response_format: "json" // Request JSON formatting for structured data
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS") {
          log('🔄 [MD3] caption progress:', update.logs?.map(log => log.message));
        }
      },
    });

    log('✅ [MD3] caption completed:', result);

    if (!result.data) {
      throw new Error('No data in Moondream response');
    }

    // Extract caption from result.data.output or result.data directly
    const caption = result.data.output || 
                    (typeof result.data === 'string' ? result.data : null);
    
    if (!caption) {
      throw new Error('No valid caption in Moondream response');
    }

    // Build response with success flag
    const response = { 
      success: true,
      caption,
      timestamp: new Date().toISOString()
    };

    // Cache the result
    CAPTION_CACHE.set(cacheKey, response);
    log('💾 Cached caption for:', imageUrl.substring(0, 30) + '...');

    return res.json(response);
  } catch (error) {
    console.error('❌ Moondream API error:', error);
    return res.status(500).json({ 
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      caption: null
    });
  }
});

// Add Video Understanding endpoint 
// @ts-ignore - Express route handler return type
router.post('/fal/video-understanding', async (req, res) => {
  try {
    const { videoUrl, prompt } = req.body;

    if (!videoUrl) {
      return res.status(400).json({ error: 'Missing videoUrl parameter' });
    }

    if (!prompt) {
      return res.status(400).json({ error: 'Missing prompt parameter' });
    }

    // Simple memory cache for faster responses and to reduce API calls
    const VIDEO_ANALYSIS_CACHE = globalThis.VIDEO_ANALYSIS_CACHE || (globalThis.VIDEO_ANALYSIS_CACHE = new Map());
    const cacheKey = `${videoUrl}_${prompt}`;
    
    // Check cache first
    if (VIDEO_ANALYSIS_CACHE.has(cacheKey)) {
      const cachedResult = VIDEO_ANALYSIS_CACHE.get(cacheKey);
      log('🔍 Retrieved video analysis from cache for:', videoUrl.substring(0, 30) + '...');
      return res.json(cachedResult);
    }

    log('🔄 Video analysis request for:', videoUrl.substring(0, 30) + '...', 'with prompt:', prompt);

    const result = await fal.subscribe("fal-ai/video-understanding", {
      input: {
        video_url: videoUrl,
        prompt: prompt,
        detailed_analysis: true // Always request detailed analysis
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS") {
          log('🔄 Video understanding progress:', update.logs?.map(log => log.message));
        }
      },
    });

    log('✅ Video understanding completed:', result);

    if (!result.data) {
      throw new Error('No data in video understanding response');
    }

    // Extract analysis from result.data.output
    const analysis = result.data.output;
    
    if (!analysis) {
      throw new Error('No valid analysis in video understanding response');
    }

    // Build response with success flag
    const response = { 
      success: true,
      analysis,
      videoUrl,
      prompt,
      timestamp: new Date().toISOString()
    };

    // Cache the result
    VIDEO_ANALYSIS_CACHE.set(cacheKey, response);
    log('💾 Cached video analysis for:', videoUrl.substring(0, 30) + '...');

    return res.json(response);
  } catch (error) {
    console.error('❌ Video understanding API error:', error);
    return res.status(500).json({ 
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      analysis: null
    });
  }
});

// Status check endpoint for polling video completion
const lumaStatusHandler = async (req: Request<{id: string}>, res: Response) => {
  try {
    const token = req.params.id;
    if (!token) {
      return res.status(400).json({ error: 'Generation ID is required' });
    }
    // Only this user's Luma jobs reach the provider.
    let id: string;
    try { id = ownedProviderId(res.locals.actor, 'luma/generation', token); }
    catch (error) { return sendJobOwnershipError(res, error); }

    if (!process.env.LUMAAI_API_KEY) {
      throw new Error('LUMAAI_API_KEY environment variable is required');
    }

    log(`Checking status for generation: ${id}`);

    // Check status via Luma API
    const response = await fetch(`https://api.lumalabs.ai/dream-machine/v1/generations/${id}`, {
      headers: {
        'Authorization': `Bearer ${process.env.LUMAAI_API_KEY}`,
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      log('Luma status API error:', errorText);
      throw new Error(`Luma status API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json() as Record<string, any>;
    log('Luma status result:', {
      id: result.id,
      state: result.state,
      hasVideo: !!result.video?.url
    });

    // Echo the token so the reply can be polled again.
    res.json({ ...result, id: token });

  } catch (error) {
    log('Status check error:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Status check failed' 
    });
  }
};

// Hunyuan 3D generation endpoint
interface Hunyuan3DRequest {
  inputImageUrl: string;
  options?: {
    seed?: number;
    numInferenceSteps?: number;
    guidanceScale?: number;
    octreeResolution?: number;
    texturedMesh?: boolean;
  };
}

const hunyuan3dHandler = async (req: Request<ParamsDictionary, any, Hunyuan3DRequest>, res: Response) => {
  try {
    const { inputImageUrl, options = {} } = req.body;

    // Validate inputs
    if (!inputImageUrl) {
      return res.status(400).json({ error: 'Input image URL is required' });
    }

    // Check FAL API key
    if (!process.env.FAL_API_KEY) {
      console.error('FAL_API_KEY environment variable not set');
      return res.status(500).json({ error: 'Service configuration error' });
    }

    log('Starting Hunyuan 3D generation:', { inputImageUrl: inputImageUrl.substring(0, 50) + '...', options });

    const result = await fal.subscribe("fal-ai/hunyuan3d-v21", {
      input: {
        input_image_url: inputImageUrl,
        ...(options.seed !== undefined && { seed: options.seed }),
        ...(options.numInferenceSteps !== undefined && { num_inference_steps: options.numInferenceSteps }),
        ...(options.guidanceScale !== undefined && { guidance_scale: options.guidanceScale }),
        ...(options.octreeResolution !== undefined && { octree_resolution: options.octreeResolution }),
        ...(options.texturedMesh !== undefined && { textured_mesh: options.texturedMesh }),
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS") {
          log('Hunyuan 3D generation progress:', update.logs?.map(log => log.message));
        }
      },
    });

    if (!result.data?.model_glb?.url) {
      throw new Error('No GLB model URL in response');
    }

    const responseData = {
      success: true,
      modelGlbUrl: result.data.model_glb.url,
      modelMeshUrl: result.data.model_mesh?.url,
      seed: result.data.seed
    };

    log('Hunyuan 3D generation completed successfully:', { modelGlbUrl: responseData.modelGlbUrl });
    return res.status(200).json(responseData);

  } catch (error) {
    log('Hunyuan 3D API error:', error);
    
    // Provide more specific error messages based on the error type
    let errorMessage = 'Failed to generate 3D model. Please try again later.';
    
    if (error instanceof Error) {
      if (error.message.includes('429')) {
        errorMessage = 'Too many requests to the AI service. Please try again later.';
      } else if (error.message.includes('403')) {
        errorMessage = 'Access denied. Service configuration error.';
      } else if (error.message.includes('413')) {
        errorMessage = 'Image file is too large. Please use a smaller image.';
      } else if (error.message.includes('400')) {
        errorMessage = 'Invalid request. The AI service could not process the image. Try a different image.';
      } else if (error.message.includes('500')) {
        errorMessage = 'AI service error. Please try again later.';
      }
    }
    
    return res.status(500).json({ error: errorMessage });
  }
};

// Legacy endpoint for backwards compatibility - supports both flux-dev and gpt-image-1
// @ts-ignore - Express route handler return type
router.post<ParamsDictionary, any, { prompt: string; model: string; }>('/fal/generate', async (req, res) => {
  const { prompt, model } = req.body;

  if (!prompt || !model) {
    return res.status(400).json({ error: 'Missing required parameters: prompt and model are required' });
  }

  // Define allowed Fal models
  const allowedModels = [
    "fal-ai/luma-upscaler",
    "fal-ai/moondream3-preview/caption",
    "fal-ai/fast-sdxl",
    "fal-ai/luma-lora-creator",
    "fal-ai/kling-video/v2.1/master/text-to-video",
    "fal-ai/kling-video/v2.1/pro/image-to-video"
  ];

  // Check if the requested model is in the allowed list
  if (!allowedModels.includes(model)) {
    return res.status(400).json({ error: `Model '${model}' not supported by this generation endpoint.` });
  }

  try {
    log(`Processing ${model} generation: "${prompt}"...`);

    let result;
    
    if (model === 'flux-dev') {
      // Use Flux-1 Dev for generation
      const falModelId = "fal-ai/flux-1/dev";
      
      log(`Making request to ${falModelId}`);

      result = await fal.subscribe("fal-ai/flux-1/dev", {
        input: {
          prompt: prompt,
          image_size: 'landscape_4_3',
          num_inference_steps: 28,
          guidance_scale: 3.5,
          num_images: 1,
          enable_safety_checker: true,
          output_format: 'jpeg'
        },
        logs: true,
        onQueueUpdate: (update) => {
          if (update.status === "IN_PROGRESS") {
            log(`${model} generation progress:`, update.logs?.map(log => log.message));
          }
        },
      });
    } else {
      // Use GPT-Image-1 with proper BYOK implementation
      const openAIApiKey = process.env.OPENAI_API_KEY;
      
      if (!openAIApiKey) {
        return res.status(500).json({ error: 'Server configuration error: Missing OpenAI API key' });
      }

      result = await fal.subscribe("fal-ai/gpt-image-1/text-to-image/byok", {
        input: {
          prompt: prompt,
          openai_api_key: openAIApiKey,
          image_size: 'auto',
          quality: 'auto', 
          background: 'auto',
          num_images: 1
        },
        logs: true,
        onQueueUpdate: (update) => {
          if (update.status === "IN_PROGRESS") {
            log(`${model} generation progress:`, update.logs?.map(log => log.message));
          }
        },
      });
    }

    log(`${model} generation completed:`, result);

    // fal.subscribe() returns data wrapped in result.data
    if (!result?.data?.images?.[0]?.url) { 
      console.error(`Unexpected response format from ${model}:`, result);
      return res.status(500).json({ error: 'Invalid response format from image service' });
    }

    const generatedUrl = result.data.images[0].url;
    log(`${model} generation successful. Result: ${generatedUrl}`);
    
    // IMPORTANT: Return the URL in a simple { url: ... } object
    // to match what Creator.tsx handleGenerateImage expects.
    return res.status(200).json({ url: generatedUrl });

  } catch (error) {
    console.error(`Error processing ${model} generation:`, error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return res.status(500).json({ 
      error: errorMessage
    });
  }
});

// Game template generation (dev server mirror of serverless api/game/generate-template.js)
// @ts-ignore - Express route handler return type
router.post('/game/generate-template', async (req, res) => {
  const { description, useLLM } = req.body;
  const requestId = `gt_${Date.now()}_${nanoid(6)}`;
  
  try {
    // Detect game type
    const detectGameType = (desc: string) => {
      const d = desc.toLowerCase();
      
      if (d.includes('fps') || d.includes('first person') || d.includes('shoot') || 
          (d.includes('wasd') && d.includes('mouse'))) {
        return 'fps';
      }
      
      if (d.includes('collect') || d.includes('coin') || d.includes('gather') || 
          d.includes('pickup')) {
        return 'collector';
      }
      
      if (d.includes('dodge') || d.includes('avoid') || d.includes('endless') || 
          d.includes('runner')) {
        return 'dodger';
      }
      
      // Default to FPS for action games
      if (d.includes('action') || d.includes('battle')) {
        return 'fps';
      }
      
      return 'collector'; // Safe default
    };

    const gameType = detectGameType(description);
    const template = (gameTemplates as any)[gameType];

    if (!template) {
      throw new Error(`Unknown game type: ${gameType}`);
    }

    let params = template.defaultParams;

    // Use LLM to extract parameters
    if (useLLM) {
      try {
        const prompt = `Extract game parameters from this description: "${description}"
        
Available parameters for ${gameType} game:
${JSON.stringify(template.defaultParams, null, 2)}

Return ONLY a JSON object with parameter overrides. Include only parameters you want to change from defaults.
For colors, use hex numbers like 0xff0000.
For difficulty, use: easy, normal, or hard.`;

        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': process.env.ANTHROPIC_API_KEY!,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 500,
            temperature: 0,
            system: 'You are a helpful assistant that extracts game parameters from descriptions. Return only valid JSON.',
            messages: [{ role: 'user', content: prompt }]
          })
        });

        if (response.ok) {
          const data = await response.json() as any;
          const content = data?.content?.[0]?.text || '';
          
          try {
            const extracted = JSON.parse(content);
            params = { ...template.defaultParams, ...extracted };
            console.log(`[${requestId}] Extracted params:`, params);
          } catch (e) {
            console.log(`[${requestId}] Failed to parse Claude response, using defaults`);
          }
        }
      } catch (e) {
        console.error(`[${requestId}] LLM parameter extraction failed:`, e);
      }
    }

    // Generate game code
    const gameCode = template.generate(params);
    
    res.json({
      success: true,
      gameType,
      params,
      gameCode,
      method: 'template'
    });

  } catch (error: any) {
    console.error(`[${requestId}] Error:`, error);
    res.status(500).json({ 
      error: error.message || 'Failed to generate game',
      gameType: 'unknown'
    });
  }
});

// Game code generation (dev server mirror of serverless api/game/generate.js)
// @ts-ignore - Express route handler return type
router.post('/game/generate', async (req, res) => {
  try {
    const { description, options = {}, provider = 'claude', model } = req.body || {};
    if (!description || typeof description !== 'string') {
      return res.status(400).json({ error: 'Description required' });
    }

    // Align sanitizer with serverless implementation
    const sanitize = (raw: string) => {
      const stripFences = (text: string) => {
        const fenceRegex = /```[a-zA-Z]*\n[\s\S]*?```/g;
        if (fenceRegex.test(text)) {
          const match = text.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
          if (match && match[1]) return match[1];
        }
        return text.replace(/```/g, '');
      };
      let code = stripFences(raw || '').trim();
      code = code
        .replace(/^export\s+default\s+/m, '')
        .replace(/^export\s+\{[\s\S]*?\};?$/m, '')
        .replace(/^import\s+.*$/gm, '')
        .replace(/^\s*function\s+\w+\s*\([^)]*\)\s*\{([\s\S]*)\}\s*$/m, '$1')
        .trim();
      // Unwrap common wrappers that return a function for (THREE, scene, camera, controls)
      const unwrap = (text: string) => {
        const patterns = [
          /^\s*(?:const|let|var)\s+\w+\s*=\s*\(\s*THREE[\s\S]*?\)\s*=>\s*\{([\s\S]*)\}\s*;?\s*$/,
          /^\s*export\s+default\s*\(\s*THREE[\s\S]*?\)\s*=>\s*\{([\s\S]*)\}\s*;?\s*$/,
          /^\s*export\s+default\s+function\s*\w*\s*\(\s*THREE[\s\S]*?\)\s*\{([\s\S]*)\}\s*;?\s*$/,
          /^\s*module\.exports\s*=\s*function\s*\(\s*THREE[\s\S]*?\)\s*\{([\s\S]*)\}\s*;?\s*$/
        ];
        for (const p of patterns) {
          const m = text.match(p);
          if (m && m[1]) return m[1].trim();
        }
        return text;
      };
      code = unwrap(code);
      // Strip common TypeScript features
      code = code
        .replace(/(\(|,)\s*([A-Za-z_$][\w$]*)\s*:\s*[^),=]+/g, '$1 $2')
        .replace(/\b(const|let|var)\s+([A-Za-z_$][\w$]*)\s*:\s*[^=;]+/g, '$1 $2')
        .replace(/\s+as\s+[A-Za-z_$][\w$<>,\[\]\s]*/g, '')
        .replace(/\b(interface|type|enum)\s+[A-Za-z_$][\w$]*[^\{;]*\{[\s\S]*?\}\s*;?/g, '')
        .replace(/([A-Za-z_$][\w$]*)<[^>]*>/g, '$1')
        .replace(/\b(readonly|public|private|protected)\b/g, '');
      const banned = /(document\.|window\.|XMLHttpRequest|eval\(|Function\(|require\()/;
      if (banned.test(code)) {
        code = code
          .replace(/document\.[^;]+;?/g, '')
          .replace(/window\.[^;]+;?/g, '')
          .replace(/XMLHttpRequest\([^)]*\);?/g, '')
          .replace(/eval\([^)]*\);?/g, '')
          .replace(/new Function\([^)]*\);?/g, '')
          .replace(/require\([^)]*\);?/g, '');
      }
      return code;
    };

    let gameCode = '';
    const providerName = String(provider || '').toLowerCase();

    if (providerName === 'claude' || providerName === 'anthropic') {
      const claudeKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
      if (!claudeKey) {
        return res.status(500).json({ error: 'Server configuration error: Missing Claude API key' });
      }
      // Detect game type from description
      const gameType = 'dodger'; // Default for now, could enhance with detection
      
      const systemPrompt = `
EXPERT THREE.JS GAME CODE GENERATOR - DODGER TYPE

# ⚠️ CRITICAL RULES

1. **Declare simple variables at top**: let playerX = 0; (NOT let player.position.x = 0;)
2. **Use arrow function format**: scene.userData.update = ({ time, dt, input }) => {
3. **Input format**: input.keys['KeyW'], input.keys['KeyA'], etc.
4. **ALWAYS set gameOver flag**: When player loses, set BOTH gameOver = true; AND scene.userData.gameOver = true;

# MANDATORY STRUCTURE - FOLLOW THIS EXACTLY:

// ===== STEP 1: Player Setup =====
let playerX = 0;
let playerY = 5;
let playerZ = 0;

const playerGeo = new THREE.BoxGeometry(1, 1, 1);
const playerMat = new THREE.MeshPhongMaterial({ color: 0xff0000 });
const player = new THREE.Mesh(playerGeo, playerMat);
player.position.set(playerX, playerY, playerZ);
scene.add(player);

// ===== STEP 2: Game State =====
let score = 0;
let gameOver = false;

// ===== STEP 3: Arrays =====
const obstacles = [];
const collectibles = [];

// ===== STEP 4: Spawn Functions =====
function spawnObstacle() {
  const geo = new THREE.BoxGeometry(2, 2, 2);
  const mat = new THREE.MeshPhongMaterial({ color: 0x00ff00 });
  const obj = new THREE.Mesh(geo, mat);
  obj.position.set((Math.random() - 0.5) * 20, 2, -50);
  scene.add(obj);
  obstacles.push(obj);
}

function spawnCollectible() {
  const geo = new THREE.SphereGeometry(0.5);
  const mat = new THREE.MeshPhongMaterial({ color: 0xffff00 });
  const obj = new THREE.Mesh(geo, mat);
  obj.position.set((Math.random() - 0.5) * 20, 1, (Math.random() - 0.5) * 20);
  scene.add(obj);
  collectibles.push(obj);
}

// ===== STEP 5: Initial Spawns =====
for (let i = 0; i < 5; i++) {
  spawnObstacle();
}
for (let i = 0; i < 10; i++) {
  spawnCollectible();
}

// ===== STEP 6: Game Loop =====
scene.userData.update = ({ time, dt, input }) => {
  if (gameOver) return;
  
  // Player movement
  const speed = 10 * dt;
  if (input.keys['KeyW']) playerZ -= speed;
  if (input.keys['KeyS']) playerZ += speed;
  if (input.keys['KeyA']) playerX -= speed;
  if (input.keys['KeyD']) playerX += speed;
  
  // Apply bounds
  playerX = Math.max(-15, Math.min(15, playerX));
  playerZ = Math.max(-15, Math.min(15, playerZ));
  
  // Update player visual
  player.position.x = playerX;
  player.position.z = playerZ;
  
  // Move obstacles and check collision
  for (let i = obstacles.length - 1; i >= 0; i--) {
    obstacles[i].position.z += 0.3 * 60 * dt;
    if (obstacles[i].position.z > 20) {
      scene.remove(obstacles[i]);
      obstacles.splice(i, 1);
      score++;
    }
    // Check collision with player
    const dx = playerX - obstacles[i].position.x;
    const dz = playerZ - obstacles[i].position.z;
    const dist = Math.sqrt(dx*dx + dz*dz);
    if (dist < 2) {
      gameOver = true;
      scene.userData.gameOver = true;
    }
  }
  
  // Check collectibles
  for (let i = collectibles.length - 1; i >= 0; i--) {
    const dx = playerX - collectibles[i].position.x;
    const dz = playerZ - collectibles[i].position.z;
    const dist = Math.sqrt(dx*dx + dz*dz);
    if (dist < 2) {
      scene.remove(collectibles[i]);
      collectibles.splice(i, 1);
      score += 10;
    }
  }
  
  // Respawn
  if (obstacles.length < 3) spawnObstacle();
  if (collectibles.length < 10) spawnCollectible();
};

CRITICAL RULES (FAILURE = BROKEN GAME):

1. **Variable Declaration Safety**
   - ALL variables MUST be declared with let/const at the TOP
   - NEVER use a variable before declaring it
   - ✅ CORRECT: let playerX = 0; then player.position.x = playerX;
   - ❌ WRONG: player.position.x = playerX; then let playerX = 0;

2. **Score System (MANDATORY)**
   - Every game MUST have: let score = 0;
   - Update score in game loop

3. **Game Over System (MANDATORY)**
   - Declare: let gameOver = false;
   - On collision/failure: gameOver = true; scene.userData.gameOver = true;
   - In update loop: if (gameOver) return;

4. **Material Properties**
   - One property per key, no duplicates
   - ✅ CORRECT: { color: 0xff0000 }
   - ❌ WRONG: { color: 0xff0000, color: 0x00ff00 }

5. **Input Handling**
   - Use: input.keys['KeyW'], input.keys['KeyA'], input.keys['KeyS'], input.keys['KeyD']
   - Or: input.keys['Space'] for shooting/jumping

6. **No Forbidden APIs**
   - NO localStorage, sessionStorage, document, window
   - NO setTimeout, setInterval (use time/dt in update loop)

7. **Keep It Simple**
   - Maximum 150 lines total
   - Use simple variable names
   - Follow the 6-step template structure EXACTLY

OUTPUT FORMAT:
Return ONLY the JavaScript code. No markdown, no explanations.
Start with: let playerX = 0;

// === EXAMPLE CODE SNIPPETS (for reference, not executed) ===
// FPS SHOOTER EXAMPLE:
// const crosshair = document.createElement('div');
// crosshair.style.cssText = 'position:absolute;top:50%;left:50%;width:4px;height:4px;background:white;transform:translate(-50%,-50%);pointer-events:none;z-index:1000;';
// document.body.appendChild(crosshair);
// const gameState = { playerX: 0, playerZ: 0, yaw: 0, pitch: 0, score: 0, health: 100 };

// === THIRD-PERSON DODGER EXAMPLE ===
// const playerGeo = new THREE.BoxGeometry(2, 1, 3);
// const player = new THREE.Mesh(playerGeo, playerMat);

// === COLLECTOR GAME EXAMPLE ===
// const playerGeo2 = new THREE.SphereGeometry(1, 16, 16);
// const coins = [];

GAME TYPES YOU CAN CREATE:
- FPS shooter (first-person, mouse look, shooting)
- Target practice (stationary or moving targets)
- Wave-based shooter (enemies in waves)
- Endless runner (dodge obstacles)
- Collector (grab coins/rings)
- Space shooter (third-person)
- Maze navigator
- Racing (through gates)
- Ball roller
- Simple platformer

CREATIVE VARIATIONS ALLOWED:
- Different player shapes and colors
- Multiple obstacle types
- Moving/rotating obstacles
- Collectibles with effects
- Speed progression
- Score multipliers
- Simple particle effects (using small meshes)
- Visual feedback (color changes, scaling)

STRICT LIMITS:
- Maximum 200 lines of code
- Define ALL variables before use
- Use only allowed geometries
- Keep it simple and playable
- No audio (causes errors)

Generate fun, working games that follow these patterns exactly.
`;

/* EXAMPLE CODE TEMPLATES (commented out - for reference only)
const enemies = [];
const bullets = [];

function spawnEnemy() {
  const geo = new THREE.BoxGeometry(1, 2, 1);
  const mat = new THREE.MeshPhongMaterial({ color: 0xff0000 });
  const enemy = new THREE.Mesh(geo, mat);
  enemy.position.set((Math.random() - 0.5) * 40, 1, -30 - Math.random() * 20);
  scene.add(enemy);
  enemies.push(enemy);
}

function shoot() {
  const geo = new THREE.SphereGeometry(0.1);
  const mat = new THREE.MeshPhongMaterial({ color: 0xffff00 });
  const bullet = new THREE.Mesh(geo, mat);
  bullet.position.copy(camera.position);
  
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);
  bullet.userData.velocity = direction.multiplyScalar(50);
  
  scene.add(bullet);
  bullets.push(bullet);
}

scene.userData.update = ({ time, dt, input }) => {
  // WASD movement
  const speed = 5 * dt;
  if (input.keys['KeyW']) {
    gameState.playerZ -= speed * Math.cos(gameState.yaw);
    gameState.playerX -= speed * Math.sin(gameState.yaw);
  }
  if (input.keys['KeyS']) {
    gameState.playerZ += speed * Math.cos(gameState.yaw);
    gameState.playerX += speed * Math.sin(gameState.yaw);
  }
  if (input.keys['KeyA']) {
    gameState.playerX -= speed * Math.cos(gameState.yaw);
    gameState.playerZ += speed * Math.sin(gameState.yaw);
  }
  if (input.keys['KeyD']) {
    gameState.playerX += speed * Math.cos(gameState.yaw);
    gameState.playerZ -= speed * Math.sin(gameState.yaw);
  }
  
  // Mouse look
  if (input.pointerLocked) {
    gameState.yaw -= input.mouse.dx * 0.002;
    gameState.pitch -= input.mouse.dy * 0.002;
    gameState.pitch = Math.max(-1.5, Math.min(1.5, gameState.pitch));
  }
  
  camera.position.x = gameState.playerX;
  camera.position.z = gameState.playerZ;
  camera.rotation.y = gameState.yaw;
  camera.rotation.x = gameState.pitch;
  
  // Shoot
  if (input.keys['Space']) {
    shoot();
    input.keys['Space'] = false;
  }
  
  // Move bullets
  for (let i = bullets.length - 1; i >= 0; i--) {
    bullets[i].position.add(bullets[i].userData.velocity.clone().multiplyScalar(dt));
    if (bullets[i].position.length() > 100) {
      scene.remove(bullets[i]);
      bullets.splice(i, 1);
    }
  }
  
  // Spawn enemies
  if (enemies.length < 5) spawnEnemy();
};

// === THIRD-PERSON DODGER ===
const playerGeo = new THREE.BoxGeometry(2, 1, 3);
const playerMat = new THREE.MeshPhongMaterial({ color: 0xff0000 });
const player = new THREE.Mesh(playerGeo, playerMat);
player.position.set(0, 5, 0);
scene.add(player);

const gameState2 = { x: 0, y: 5, score: 0, gameOver: false };
const obstacles = [];

function spawnObstacle() {
  const geo = new THREE.BoxGeometry(2, 2, 2);
  const mat = new THREE.MeshPhongMaterial({ color: 0x00ff00 });
  const obs = new THREE.Mesh(geo, mat);
  obs.position.set((Math.random() - 0.5) * 20, 3, -50);
  scene.add(obs);
  obstacles.push(obs);
}

scene.userData.update = ({ time, dt, input }) => {
  if (gameState2.gameOver) return;
  
  if (input.keys['KeyA']) gameState2.x -= 10 * dt;
  if (input.keys['KeyD']) gameState2.x += 10 * dt;
  if (input.keys['KeyW']) gameState2.y += 10 * dt;
  if (input.keys['KeyS']) gameState2.y -= 10 * dt;
  
  player.position.x = gameState2.x;
  player.position.y = gameState2.y;
  
  if (obstacles.length === 0 || obstacles[obstacles.length - 1].position.z > -40) {
    spawnObstacle();
  }
  
  for (let i = obstacles.length - 1; i >= 0; i--) {
    obstacles[i].position.z += 0.3 * 60 * dt;
    if (obstacles[i].position.z > 20) {
      scene.remove(obstacles[i]);
      obstacles.splice(i, 1);
      gameState2.score++;
    }
  }
};

// === COLLECTOR GAME ===
const playerGeo2 = new THREE.SphereGeometry(1, 16, 16);
const playerMat2 = new THREE.MeshPhongMaterial({ color: 0x00ffff });
const player2 = new THREE.Mesh(playerGeo2, playerMat2);
player2.position.set(0, 1, 0);
scene.add(player2);

const gameState3 = { x: 0, z: 0, score: 0 };
const coins = [];

function spawnCoin() {
  const geo = new THREE.TorusGeometry(0.5, 0.2, 8, 16);
  const mat = new THREE.MeshPhongMaterial({ color: 0xffff00 });
  const coin = new THREE.Mesh(geo, mat);
  coin.position.set((Math.random() - 0.5) * 20, 1, (Math.random() - 0.5) * 20);
  coin.rotation.x = Math.PI / 2;
  scene.add(coin);
  coins.push(coin);
}

scene.userData.update = ({ time, dt, input }) => {
  if (input.keys['KeyW']) gameState3.z -= 8 * dt;
  if (input.keys['KeyS']) gameState3.z += 8 * dt;
  if (input.keys['KeyA']) gameState3.x -= 8 * dt;
  if (input.keys['KeyD']) gameState3.x += 8 * dt;
  
  player2.position.x = gameState3.x;
  player2.position.z = gameState3.z;
  
  if (coins.length < 10) spawnCoin();
  
  for (let i = coins.length - 1; i >= 0; i--) {
    coins[i].rotation.y += dt * 2;
    const dx = player2.position.x - coins[i].position.x;
    const dz = player2.position.z - coins[i].position.z;
    if (Math.sqrt(dx*dx + dz*dz) < 2) {
      scene.remove(coins[i]);
      coins.splice(i, 1);
      gameState3.score++;
    }
  }
};

GAME TYPES YOU CAN CREATE:
- FPS shooter (first-person, mouse look, shooting)
- Target practice (stationary or moving targets)
- Wave-based shooter (enemies in waves)
- Endless runner (dodge obstacles)
- Collector (grab coins/rings)
- Space shooter (third-person)
- Maze navigator
- Racing (through gates)
- Ball roller
- Simple platformer

CREATIVE VARIATIONS ALLOWED:
- Different player shapes and colors
- Multiple obstacle types
- Moving/rotating obstacles
- Collectibles with effects
- Speed progression
- Score multipliers
- Simple particle effects (using small meshes)
- Visual feedback (color changes, scaling)

STRICT LIMITS:
- Maximum 200 lines of code
- Define ALL variables before use
- Use only allowed geometries
- Keep it simple and playable
- No audio (causes errors)

Generate fun, working games that follow these patterns exactly.
END OF EXAMPLE CODE TEMPLATES */

      const payload = {
        model: model || (options as any).model || 'claude-sonnet-4-5-20250929',
        max_tokens: (options as any).max_tokens ?? 1400,
        temperature: (options as any).temperature ?? 0.4,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Build a single-player, panel-embedded Three.js mini-game per spec. Do not mention co-op or multiple players. Description: ${description}` }
        ]
      } as any;
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': claudeKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(payload)
      });
      if (!resp.ok) {
        const t = await resp.text();
        return res.status(500).json({ error: `LLM generation failed: ${t}` });
      }
      const data: any = await resp.json();
      const content = data?.content?.[0]?.text || data?.messages?.[0]?.content || data?.choices?.[0]?.message?.content || '';
      gameCode = sanitize(content);
    } else if (providerName === 'xai' || providerName === 'grok') {
      const xaiKey = process.env.XAI_API_KEY || process.env.XAI_KEY || process.env.GROK_API_KEY;
      if (!xaiKey) {
        return res.status(500).json({ error: 'Server configuration error: Missing XAI API key' });
      }
      const systemPrompt = [
        'You write working Three.js mini-games as plain JavaScript (no TypeScript).',
        'The host provides camera, ambient/directional lights, a ground plane, and a fixed-step game loop.',
        'You MUST only set up content and optionally assign scene.userData.update = (ctx) => { /* logic */ }.',
        'ctx contains: { time, dt, input, rng, THREE, scene, camera }. Do not access window/document.',
        'Return ONLY the function body for (THREE, scene, camera, controls). No markdown, no comments, no imports/exports.',
        'Do NOT call renderer.render. Prefer procedural meshes; no external assets.',
        'Forbidden identifiers: retro, gsap, TWEEN, timeline, ShaderPass, EffectComposer, composer, postprocessing, OrbitControls, SimplexNoise, noise.'
      ].join(' ');
      const payload = {
        model: model || (options as any).model || 'grok-code-fast-1',
        temperature: (options as any).temperature ?? 0.4,
        max_tokens: (options as any).max_tokens ?? 1400,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Build a single-player, panel-embedded Three.js mini-game per spec. Do not mention co-op or multiple players. Description: ${description}` }
        ]
      };
      const resp = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${xaiKey}`
        },
        body: JSON.stringify(payload)
      });
      if (!resp.ok) {
        const t = await resp.text();
        return res.status(500).json({ error: `LLM generation failed: ${t}` });
      }
      const data: any = await resp.json();
      const content = data?.choices?.[0]?.message?.content || '';
      gameCode = sanitize(content);
    } else if (providerName === 'replicate') {
      const replicateKey = process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY || process.env.REPLICATE_KEY;
      if (!replicateKey) {
        return res.status(500).json({ error: 'Server configuration error: Missing Replicate API key' });
      }
      const { default: Replicate } = await import('replicate');
      const replicate = new Replicate({ auth: replicateKey });
      const replicateModel = model || (options as any).model || 'anthropic/claude-4.5-haiku';
      const systemInstr = 'Generate Three.js code for a simple game. Return ONLY plain JavaScript (ES6), NO TypeScript, NO type annotations, NO interfaces/enums. The code must be the body of a function with signature (THREE, scene, camera, controls). No markdown, no comments, no explanations. If animation is needed, set scene.userData.update = (ctx) => { /* per-frame */ }. Never import, never call renderer.render, and avoid DOM APIs.';
      const promptStr = `${systemInstr}\n\nUser description:\n${description}\n\nReturn only raw JavaScript code.`;
      const output: any = await replicate.run(replicateModel, {
        input: {
          prompt: promptStr,
          max_tokens: (options as any).max_tokens ?? 1024,
          temperature: (options as any).temperature ?? 0.7
        }
      });
      if (typeof output === 'string') {
        gameCode = sanitize(output);
      } else if (Array.isArray(output)) {
        gameCode = sanitize(output.filter((x) => typeof x === 'string').join(''));
      } else if (output && typeof output === 'object') {
        const text = (output as any)?.output || (output as any)?.data || (output as any)?.content || '';
        gameCode = sanitize(String(text || ''));
      }
    } else if (providerName === 'openai') {
      const openAIApiKey = process.env.OPENAI_API_KEY;
      if (!openAIApiKey) {
        return res.status(500).json({ error: 'Server configuration error: Missing OpenAI API key' });
      }
      const systemPrompt = [
        'You generate Three.js game snippets.',
        'Return ONLY raw JavaScript, no backticks, no markdown, no explanations.',
        'The code will be used as the body of: (THREE, scene, camera, controls) => { /* your code */ }',
        'Do not declare a function wrapper. Do not import anything. Assume THREE, scene, camera, controls are provided.',
        'Create meshes, lights, and simple gameplay based on the description. Support basic movement/shooting if relevant.',
        'If animation is needed, set scene.userData.update = (ctx) => { /* per-frame updates */ } where ctx contains { time, THREE, scene, camera, controls }. ',
        'Never call renderer.render, never use DOM APIs. Keep it self-contained and safe.'
      ].join(' ');
      const payload = {
        model: model || (options as any).model || 'gpt-4o-mini',
        temperature: (options as any).temperature ?? 0.7,
        max_tokens: (options as any).max_tokens ?? 1200,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Game description: ${description}` }
        ]
      };
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openAIApiKey}`
        },
        body: JSON.stringify(payload)
      });
      if (!resp.ok) {
        const errText = await resp.text();
        return res.status(500).json({ error: `LLM generation failed: ${errText}` });
      }
      const data: any = await resp.json();
      const content = data?.choices?.[0]?.message?.content || '';
      gameCode = sanitize(content);
    } else {
      // Default to xAI behavior to avoid sending invalid models to OpenAI
      const xaiKey = process.env.XAI_API_KEY || process.env.XAI_KEY || process.env.GROK_API_KEY;
      if (!xaiKey) {
        return res.status(500).json({ error: 'Server configuration error: Missing XAI API key' });
      }
      const payload = {
        model: model || (options as any).model || 'grok-code-fast-1',
        temperature: (options as any).temperature ?? 0.4,
        max_tokens: (options as any).max_tokens ?? 1400,
        messages: [
          { role: 'system', content: 'You write working Three.js mini-games as plain JavaScript (no TypeScript). Return ONLY the function body for (THREE, scene, camera, controls). No markdown.' },
          { role: 'user', content: description }
        ]
      };
      const resp = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${xaiKey}`
        },
        body: JSON.stringify(payload)
      });
      if (!resp.ok) {
        const t = await resp.text();
        return res.status(500).json({ error: `LLM generation failed: ${t}` });
      }
      const data: any = await resp.json();
      const content = data?.choices?.[0]?.message?.content || '';
      gameCode = sanitize(content);
    }

    return res.status(200).json({ gameCode });
  } catch (error: any) {
    console.error('Game generation error:', error);
    return res.status(500).json({ error: error?.message || 'Failed to generate game code' });
  }
});

// Game code repair (dev server mirror of serverless api/game/repair.js)
// @ts-ignore - Express route handler return type
router.post('/game/repair', async (req, res) => {
  // Minimal default game snippet as a safe fallback
  const DEFAULT_GAME_CODE = `const geometry = new THREE.BoxGeometry(2, 2, 2);
const material = new THREE.MeshStandardMaterial({ color: 0x3366ff });
const cube = new THREE.Mesh(geometry, material);
cube.position.set(0, 0, 0);
scene.add(cube);
const light = new THREE.DirectionalLight(0xffffff, 1.2); light.position.set(3, 5, 2); scene.add(light);
const ambient = new THREE.AmbientLight(0xffffff, 0.45); scene.add(ambient);
camera.position.set(6, 4, 6); camera.lookAt(0, 0, 0);
scene.userData.update = () => { cube.rotation.x += 0.01; cube.rotation.y += 0.015; };`;

  const respondWith = (gameCode: string) => res.status(200).json({ gameCode });

  try {
    const { code, error } = req.body || {};
    if (!code || !error) {
      return res.status(400).json({ error: 'code and error required' });
    }

    // Simple sanitizer aligned with serverless
    const sanitize = (raw: string) => {
      if (!raw) return '';
      let out = String(raw || '').trim();
      const fenced = out.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
      if (fenced && fenced[1]) out = fenced[1].trim(); else out = out.replace(/```/g, '').trim();
      out = out.replace(/^import\s+.*$/gm, '').replace(/^export\s+.*$/gm, '');
      const unwrapPatterns = [
        /^\s*(?:const|let|var)\s+\w+\s*=\s*\(\s*THREE[\s\S]*?\)\s*=>\s*\{([\s\S]*)\}\s*;?\s*$/,
        /^\s*export\s+default\s*\(\s*THREE[\s\S]*?\)\s*=>\s*\{([\s\S]*)\}\s*;?\s*$/,
        /^\s*export\s+default\s+function\s*\w*\s*\(\s*THREE[\s\S]*?\)\s*\{([\s\S]*)\}\s*;?\s*$/,
        /^\s*module\.exports\s*=\s*function\s*\(\s*THREE[\s\S]*?\)\s*\{([\s\S]*)\}\s*;?\s*$/
      ];
      for (const pattern of unwrapPatterns) {
        const match = out.match(pattern);
        if (match && match[1]) { out = match[1].trim(); break; }
      }
      out = out
        .replace(/(\(|,)\s*([A-Za-z_$][\w$]*)\s*:\s*[^),=]+/g, '$1 $2')
        .replace(/\b(const|let|var)\s+([A-Za-z_$][\w$]*)\s*:\s*[^=;]+/g, '$1 $2')
        .replace(/\s+as\s+[A-Za-z_$][\w$<>,\[\]\s]*/g, '')
        .replace(/\b(interface|type|enum)\s+[A-Za-z_$][\w$]*[^\{;]*\{[\s\S]*?\}\s*;?/g, '')
        .replace(/([A-Za-z_$][\w$]*)<[^>]*>/g, '$1')
        .replace(/\b(readonly|public|private|protected)\b/g, '');
      return out.trim();
    };

    const xaiKey = process.env.XAI_API_KEY || process.env.XAI_KEY || process.env.GROK_API_KEY;
    if (!xaiKey) {
      return respondWith(DEFAULT_GAME_CODE);
    }

    const systemPrompt = [
      'You repair JavaScript Three.js snippets for a runtime that calls the result as the body of a function with signature (THREE, scene, camera, controls).',
      'Respond with ONLY valid JavaScript statements, no markdown, no comments, no wrapping function.',
      'Ensure the code adds visible geometry to the provided scene, sets up minimal lighting/camera, and defines scene.userData.update if animation is needed.',
      'Never use imports, exports, DOM APIs, renderer.render, or TypeScript syntax.'
    ].join(' ');

    const userPrompt = [
      'Fix the following snippet so it runs without errors when executed as the body of a function (THREE, scene, camera, controls).',
      `Runtime error: ${error}`,
      'Broken snippet:',
      code,
      'Return only the fixed function body.'
    ].join('\n');

    const payload = {
      model: 'grok-code-fast-1',
      temperature: 0.2,
      max_tokens: 900,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    } as any;

    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${xaiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      return respondWith(DEFAULT_GAME_CODE);
    }

    const data: any = await response.json();
    const raw = data?.choices?.[0]?.message?.content || '';
    const fixed = sanitize(raw);
    if (!fixed) return respondWith(DEFAULT_GAME_CODE);
    return respondWith(fixed);
  } catch (err) {
    return res.status(200).json({ gameCode: DEFAULT_GAME_CODE });
  }
});

// Game code streaming (dev mirror of serverless api/game/generate-stream.js)
// @ts-ignore - Express route handler return type
router.post('/game/generate-stream', async (req, res) => {
  const requestId = `gs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    const { description, options = {}, model } = req.body || {};
    if (!description || typeof description !== 'string') {
      return res.status(400).json({ error: 'Description required', requestId });
    }
    const claudeKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
    if (!claudeKey) {
      return res.status(500).json({ error: 'Server configuration error: Missing Claude API key', requestId });
    }
    const systemPrompt = `
GAME CODE GENERATION RULES:

You are generating simple 3D arcade games using Three.js. Follow this SAFE PATTERN with VARIATION.

EXECUTION CONTEXT:
Your code will be executed as the body of this function:
function(THREE, scene, camera, controls, input) {
  // YOUR CODE GOES HERE
}

Parameters available:
- THREE: Three.js library (r158)
- scene: THREE.Scene (empty - YOU MUST ADD LIGHTS AND OBJECTS)
- camera: THREE.PerspectiveCamera
- controls: Empty object (reserved)
- input: { keys: {}, mouse: { x, y, dx, dy }, pointerLocked: boolean }

CRITICAL: THE SCENE STARTS EMPTY - YOU MUST ADD:
1. LIGHTING - Without lights, everything renders BLACK
2. GROUND/FLOOR - Players need something to stand on or reference
3. VISIBLE OBJECTS - The actual game elements
4. CAMERA POSITIONING - Set camera.position to see the game

REQUIRED STRUCTURE:
1. Player setup (or camera setup for FPS games)
2. Game state object
3. Arrays for obstacles/enemies/collectibles
4. Spawn functions
5. Game loop: scene.userData.update = ({ time, dt, THREE, scene, camera, controls, input }) => { }

VARIABLE NAMING SAFETY (CRITICAL):
- Use simple names: player, enemy, target, bullet, coin, obstacle
- ALWAYS define variables BEFORE using them
- Pattern: geometry → material → mesh → scene.add()
- NO forward references
- NO complex names like jetBody, planeVertices, bodyFrame

ALLOWED GEOMETRIES ONLY:
- THREE.BoxGeometry
- THREE.SphereGeometry
- THREE.CylinderGeometry
- THREE.ConeGeometry
- THREE.PlaneGeometry
- THREE.TorusGeometry (for rings/collectibles)

STRICTLY FORBIDDEN:
- THREE.BufferGeometry
- THREE.BufferAttribute
- Custom vertex manipulation
- geometry.setAttribute()
- Classes or constructors
- Import/export statements
- AudioContext or Web Audio API
- document.createElement (except for UI overlays)

// Examples omitted for brevity here (same as serverless prompt) but follow the exact pattern.

STRICT LIMITS:
- Maximum 200 lines of code
- Define ALL variables before use
- Use only allowed geometries
- Keep it simple and playable
- No audio (causes errors)

Generate fun, working games that follow these patterns exactly.
`;
    const preferModel = process.env.CLAUDE_MODEL || model || (options as any).model;
    const modelCandidates = [preferModel, 'claude-sonnet-4-5-20250929', 'claude-3-5-sonnet-20241022'].filter(Boolean) as string[];
    const basePayload: any = {
      max_tokens: (options as any).max_tokens ?? 1400,
      temperature: (options as any).temperature ?? 0.4,
      stream: true,
      system: systemPrompt,
      messages: [
        { role: 'user', content: description }
      ]
    };
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');
    (res as any).flushHeaders?.();
    let upstream: any; let usedModel = '';
    for (const candidate of modelCandidates) {
      const payload = { ...basePayload, model: candidate };
      upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Accept': 'text/event-stream',
          'Content-Type': 'application/json',
          'x-api-key': claudeKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(payload)
      });
      if (upstream.ok && upstream.body) { usedModel = candidate; break; }
      const errText = await upstream.text();
      res.write(JSON.stringify({ event: 'error', status: upstream.status, model: candidate, bodyHead: (errText||'').slice(0,160) }) + '\n');
    }
    if (!upstream || !upstream.ok || !upstream.body) {
      res.write(JSON.stringify({ event: 'error', status: upstream?.status || 500, message: 'All model candidates failed', requestId }) + '\n');
      return res.end();
    }
    const reader = (upstream.body as any).getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const flushLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (trimmed.startsWith('data:')) {
        try {
          const json = JSON.parse(trimmed.slice(5).trim());
          const delta = json?.delta?.text || json?.text || '';
          if (delta) res.write(JSON.stringify({ event: 'delta', text: delta }) + '\n');
          if (json?.type === 'message_stop') res.write(JSON.stringify({ event: 'done' }) + '\n');
        } catch {}
      }
    };
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop() || '';
      for (const p of parts) flushLine(p);
    }
    if (buffer) flushLine(buffer);
    res.write(JSON.stringify({ event: 'done' }) + '\n');
    return res.end();
  } catch (err: any) {
    try { res.write(JSON.stringify({ event: 'error', message: err?.message || 'stream error', requestId }) + '\n'); } catch {}
    return res.end();
  }
});
// Add Kling 2.1 image-to-video endpoint
// @ts-ignore - Express route handler return type
router.post('/fal/kling-image-to-video', async (req, res) => {
  try {
    const { prompt, image_url, duration = '5' } = req.body;

    if (!prompt || !image_url) {
      return res.status(400).json({ error: 'Missing required parameters: prompt and image_url are required' });
    }

    if (!process.env.FAL_API_KEY) {
      console.error('FAL_API_KEY environment variable not set');
      return res.status(500).json({ error: 'Service configuration error' });
    }
    
    fal.config({
      credentials: process.env.FAL_API_KEY
    });

    log('🚀 Starting Kling 2.1 image-to-video generation:', { prompt: prompt.substring(0, 50) + '...', image_url: image_url.substring(0, 50) + '...' });

    const result = await fal.subscribe("fal-ai/kling-video/v2.1/pro/image-to-video", {
      input: {
        prompt,
        image_url,
        duration,
      },
      logs: true,
    });

    log('✅ Kling 2.1 image-to-video generation completed:', result);
    return res.json(result.data);
  } catch (error: any) {
    log('❌ Kling 2.1 image-to-video failed:', error);
    res.status(500).json({ error: error.message || 'Failed to generate video' });
  }
});

// GPT-Image-1 text-to-image endpoint (BYOK - Bring Your Own Key)
// @ts-ignore - Express route handler return type
router.post('/gpt/text-to-image', async (req, res) => {
  const { prompt, options = {} } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Missing required parameter: prompt is required' });
  }

  try {
    const openAIApiKey = process.env.OPENAI_API_KEY;
    
    if (!openAIApiKey) {
      return res.status(500).json({ error: 'Server configuration error: Missing OpenAI API key' });
    }

    log(`Processing GPT-Image-1 text-to-image: "${prompt}"`);

    const result = await fal.subscribe('fal-ai/gpt-image-1/text-to-image/byok', {
      input: {
        prompt,
        openai_api_key: openAIApiKey,
        image_size: options.image_size || 'auto',
        quality: options.quality || 'auto',
        background: options.background || 'auto',
        num_images: options.num_images || 1
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS") {
          log('GPT-Image-1 text-to-image progress:', update.logs?.map(log => log.message));
        }
      },
    });

    log('GPT-Image-1 text-to-image completed:', result);

    if (!result?.data?.images?.[0]?.url) {
      console.error('Unexpected response format from GPT-Image-1:', result);
      return res.status(500).json({ error: 'Invalid response format from image service' });
    }

    const generatedUrl = result.data.images[0].url;
    log(`GPT-Image-1 text-to-image successful. Result: ${generatedUrl}`);
    
    return res.status(200).json({ url: generatedUrl });

  } catch (error) {
    console.error('Error processing GPT-Image-1 text-to-image:', error);
    return res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Unknown error occurred' 
    });
  }
});

// GPT Image Edit endpoint
// @ts-ignore - Express route handler return type
router.post<ParamsDictionary, any, GptImageEditRequest>('/gpt/edit-image', async (req, res) => {
  const { prompt, imageUrl, options = {} } = req.body;

  if (!prompt || !imageUrl) {
    return res.status(400).json({ error: 'Missing required parameters: prompt and imageUrl are required' });
  }

  try {
    const openAIApiKey = process.env.OPENAI_API_KEY;
    
    if (!openAIApiKey) {
      return res.status(500).json({ error: 'Server configuration error: Missing OpenAI API key' });
    }

    log(`Processing GPT-Image-1 image edit: "${prompt}" for image ${imageUrl.substring(0, 30)}...`);

    const result = await fal.subscribe('fal-ai/gpt-image-1/edit-image/byok', {
      input: {
        image_urls: [imageUrl],
        prompt,
        openai_api_key: openAIApiKey,
        image_size: options.image_size || 'auto',
        quality: options.quality || 'auto',
        num_images: options.num_images || 1
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS") {
          log('GPT-Image-1 edit progress:', update.logs?.map(log => log.message));
        }
      },
    });

    log('GPT-Image-1 edit completed:', result);

    if (!result?.data?.images?.[0]?.url) {
      console.error('Unexpected response format from GPT-Image-1:', result);
      return res.status(500).json({ error: 'Invalid response format from image service' });
    }

    const editedImageUrl = result.data.images[0].url;
    log(`GPT-Image-1 edit successful. Result: ${editedImageUrl}`);
    
    return res.status(200).json({ editedImageUrl });

  } catch (error) {
    console.error('Error processing GPT-Image-1 edit:', error);
    return res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Unknown error occurred' 
    });
  }
});

// Mount routes
app.use('/api', router);

// Mount specific routes outside of router
app.post('/api/luma/generate', lumaGenerateHandler);
app.get('/api/luma/status/:id', lumaStatusHandler);
app.post('/api/hunyuan3d/generate', hunyuan3dHandler);

// World scene generation is not available (mirror of api/luma/generate-scene.js)
app.post('/api/luma/generate-scene', (_req, res) => {
  sendNotAvailable(res, 'generate_world_scene', WORLD_SCENE_NOT_AVAILABLE);
});

// Catch-all for undefined API routes (must be last)
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

const PORT = process.env.PORT || 3000;

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
}

export default app;
