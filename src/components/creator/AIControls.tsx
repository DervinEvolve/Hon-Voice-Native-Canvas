import { accessHeaders } from '../../services/apiAccess';
import React, { useState, useEffect, useRef } from 'react';
import { Wand2, Pencil, X, Download, Clock, Info, Copy, Box } from 'lucide-react';
import { nanoid } from 'nanoid';
import { Panel } from '../../types';
import { fluxService } from '../../services/fluxService';
import { fluxKreaService, StreamProgressEvent } from '../../services/fluxKreaService';
import { ProgressiveImage } from './ProgressiveImage';
import { ideogramService, IdeogramStyle, IdeogramAspectRatio } from '../../services/ideogramService';
import { imagen4Service, Imagen4Options } from '../../services/imagen4Service';
import { gptImageService, GptTextToImageOptions } from '../../services/gptImageService';
import { runwayTextToImageService } from '../../services/runwayTextToImageService';
import { lumaPhotonFlashService, LumaPhotonFlashOptions } from '../../services/lumaPhotonFlashService';
import { qwenImageService } from '../../services/qwenImageService';
import { recentGenerationsService } from '../../services/recentGenerationsService';
import { useWallet } from '@solana/wallet-adapter-react';
import { dreaminaImageService } from '../../services/dreaminaImageService';
import { nanoBananaService } from '../../services/nanoBananaService';
import { higgsfieldService } from '../../services/higgsfieldService';
// Lazy-load soul styles via dynamic import to reduce initial bundle size
import { seedreamService } from '../../services/seedreamService';
import { wanImageService } from '../../services/wanImageService';
import { hunyuanImageService } from '../../services/hunyuanImageService';
import { reveImageService } from '../../services/reveImageService';
import { ovisImageService, OvisImageSize, OvisAcceleration, OvisOutputFormat } from '../../services/ovisImageService';
import { seedreamV45Service, SeedreamV45ImageSize } from '../../services/seedreamV45Service';
import { imagineartService, ImagineartImageSize, ImagineartOutputFormat } from '../../services/imagineartService';
import { flux2ProService } from '../../services/flux2ProService';
import { longcatImageService } from '../../services/longcatImageService';
import { zImageTurboService } from '../../services/zImageTurboService';
import { userCharactersService } from '../../services/userCharactersService';
import { useComicStore } from '../../store/useComicStore';
import { useImmersiveSceneStore } from '../../store/immersiveSceneStore';

// Define the possible models
type GenerationModel = 'flux' | 'ideogram' | 'flux-2-pro' | 'flux-krea' | 'imagen4' | 'gpt-image-1' | 'runway' | 'luma-photon-flash' | 'qwen-image' | 'dreamina' | 'nano-banana' | 'wan-2.5' | 'higgs-soul' | 'hunyuan-image' | 'reve' | 'ovis-image' | 'seedream-v45' | 'imagineart' | 'longcat' | 'z-image-turbo';

// Model display names for the tooltip
const modelDisplayNames: Record<GenerationModel, string> = {
  'flux': 'Flux LoRA',
  'ideogram': 'Ideogram',
  'flux-2-pro': 'Flux 2 Pro',
  'flux-krea': 'Flux.1 Krea',
  'imagen4': 'Imagen 4',
  'gpt-image-1': 'GPT-Image-1 Mini',
  'runway': 'Runway',
  'luma-photon-flash': 'Luma Photon Flash',
  'qwen-image': 'Qwen Image',
  'dreamina': 'Dreamina 3.1',
  'nano-banana': 'Nano Banana Pro',
  'wan-2.5': 'WAN 2.5 T2I',
  'higgs-soul': 'Higgsfield Soul',
  'hunyuan-image': 'Hunyuan Image v3',
  'reve': 'Reve',
  'ovis-image': 'Ovis Image',
  'seedream-v45': 'Seedream 4.5',
  'imagineart': 'ImagineArt 1.5',
  'longcat': 'Longcat Image',
  'z-image-turbo': 'Z-Image Turbo'
};

interface GeneratedImage {
  url: string;
  prompt: string;
  timestamp: Date;
  model: string;
}

interface AIControlsProps {
  onGenerate?: (prompt: string, model: GenerationModel) => Promise<string>;
  onEdit?: (prompt: string, imageUrl: string) => Promise<void>;
  selectedImageUrl?: string;
  onClearSelection?: () => void;
  onAddPanel?: (panel: Panel) => void;
  onGenerateStory: (prompt: string, generatedUrl: string, type: 'image' | 'video' | 'gif', panel?: Panel) => Promise<void>;
  recentGenerations?: Array<{
    url: string;
    prompt: string;
    timestamp: Date;
    model: string;
    type: string;
    metadata?: Record<string, any>;
  }>;
}

export const AIControls: React.FC<AIControlsProps> = ({ 
  onGenerate, 
  onEdit, 
  selectedImageUrl, 
  onClearSelection,
  onGenerateStory,
  recentGenerations = []
}) => {
  const { publicKey } = useWallet();
  const isWorldMode = useComicStore(state => state.isWorldMode);
  const addImmersiveObject = useImmersiveSceneStore(state => state.addObject);
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [showGallery, setShowGallery] = useState(false);
  const [hoveredImage, setHoveredImage] = useState<number | null>(null);
  const [expandedPrompt, setExpandedPrompt] = useState<number | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<Record<number, 'left' | 'right'>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimeoutRef = useRef<Map<number, NodeJS.Timeout>>(new Map());
  const [selectedModel, setSelectedModel] = useState<GenerationModel>('flux');
  const [streamingProgress, setStreamingProgress] = useState<string | null>(null);
  const [partialImageUrl, setPartialImageUrl] = useState<string | null>(null);
  const [showIdeogramInfo, setShowIdeogramInfo] = useState(false);
  const [ideogramStyle, setIdeogramStyle] = useState<IdeogramStyle>('auto');
  const [ideogramAspectRatio, setIdeogramAspectRatio] = useState<IdeogramAspectRatio>('1:1');
  const [expandPrompt, setExpandPrompt] = useState(true);
  // Imagen 4 options
  const [imagen4AspectRatio, setImagen4AspectRatio] = useState<'1:1' | '16:9' | '9:16' | '3:4' | '4:3'>('1:1');
  // GPT-Image-1 Mini options
  const [gptOutputFormat, setGptOutputFormat] = useState<'jpeg' | 'png' | 'webp'>('jpeg');
  // Reve options
  const [reveAspectRatio, setReveAspectRatio] = useState<'16:9' | '9:16' | '3:2' | '2:3' | '4:3' | '3:4' | '1:1'>('3:2');
  const [reveOutputFormat, setReveOutputFormat] = useState<'png' | 'jpeg' | 'webp'>('png');
  // Luma Photon Flash options
  const [lumaAspectRatio, setLumaAspectRatio] = useState<'1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '21:9' | '9:21'>('1:1');
  // Higgsfield Soul options
  const [higgsSoulAspect, setHiggsSoulAspect] = useState<'1:1' | '16:9' | '9:16'>('1:1');
  const [higgsSoulId, setHiggsSoulId] = useState<string>('');
  const [higgsSoulStyleId, setHiggsSoulStyleId] = useState<string>('');
  const [higgsSoulStyles, setHiggsSoulStyles] = useState<Array<{ id: string; name: string; description?: string; preview_url?: string }>>([]);
  const [higgsSoulStylesLoaded, setHiggsSoulStylesLoaded] = useState(false);
  const [savedCharacters, setSavedCharacters] = useState<Array<{ id: string; name?: string | null; soul_id?: string | null; image_url?: string | null }>>([]);
  
  // Ovis Image options (optimized for text rendering)
  const [ovisImageSize, setOvisImageSize] = useState<'square_hd' | 'square' | 'portrait_4_3' | 'portrait_16_9' | 'landscape_4_3' | 'landscape_16_9'>('landscape_4_3');
  const [ovisAcceleration, setOvisAcceleration] = useState<'none' | 'regular' | 'high'>('regular');
  const [ovisOutputFormat, setOvisOutputFormat] = useState<'jpeg' | 'png' | 'webp'>('png');
  
  // Seedream v4.5 options
  const [seedreamV45ImageSize, setSeedreamV45ImageSize] = useState<'square_hd' | 'square' | 'portrait_4_3' | 'portrait_16_9' | 'landscape_4_3' | 'landscape_16_9'>('landscape_4_3');
  
  // ImagineArt 1.5 options
  const [imagineartImageSize, setImagineartImageSize] = useState<'square_hd' | 'square' | 'portrait_4_3' | 'portrait_16_9' | 'landscape_4_3' | 'landscape_16_9'>('landscape_4_3');
  const [imagineartOutputFormat, setImagineartOutputFormat] = useState<'jpeg' | 'png' | 'webp'>('webp');

  // Helper: show only image-like items (images and 3D), exclude videos
  const filterImageLike = React.useCallback((items: any[] = []) => {
    try {
      return items.filter((it) => {
        const t = (it as any)?.type;
        const url: string = (it as any)?.url || '';
        if (t === 'video') return false;
        if (/\.(mp4|webm|mov|m4v)$/i.test(url)) return false;
        return true; // allow image, gif, 3d
      });
    } catch { return items as any; }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const rows = await userCharactersService.listForCurrentUser(50);
        setSavedCharacters(rows);
      } catch {}
    })();
  }, []);

  // Use recentGenerations from props if provided, otherwise use local state
  useEffect(() => {
    console.log('AIControls: recentGenerations from props:', recentGenerations);
    if (recentGenerations?.length) {
      console.log('AIControls: Setting generatedImages from props:', recentGenerations);
      setGeneratedImages(filterImageLike(recentGenerations) as any);
      setShowGallery(true);
    }
  }, [recentGenerations, filterImageLike]); // Add recentGenerations as dependency

  // Load saved images from localStorage
  useEffect(() => {
    console.log('AIControls: Loading images from localStorage and Supabase');
    
    try {
      if (recentGenerations && recentGenerations.length > 0) {
        console.log('AIControls: Using recentGenerations from props:', recentGenerations);
        setGeneratedImages(filterImageLike(recentGenerations) as any);
        setShowGallery(true);
      } else {
        // Try to load from the store's localStorage key
        const savedImages = localStorage.getItem('recent-generations');
        console.log('AIControls: Raw localStorage data from store key:', savedImages);
        
        if (savedImages) {
          try {
            const parsedImages = JSON.parse(savedImages);
            console.log('AIControls: Parsed localStorage images:', parsedImages);
            
            if (Array.isArray(parsedImages) && parsedImages.length > 0) {
              // Convert string timestamps back to Date objects and add default model for backwards compatibility
              const formattedImages = parsedImages.map((img: any) => ({
                ...img,
                timestamp: typeof img.timestamp === 'string' ? new Date(img.timestamp) : img.timestamp,
                model: img.model || 'unknown' // Add default model for backwards compatibility
              }));
              
              console.log('AIControls: Setting generatedImages from localStorage with converted timestamps:', formattedImages);
              setGeneratedImages(filterImageLike(formattedImages) as any);
              setShowGallery(true);
            } else {
              console.log('AIControls: Parsed localStorage is empty or not an array');
            }
          } catch (error) {
            console.error('AIControls: Error parsing generatedImages from localStorage:', error);
          }
        } else {
          console.log('AIControls: No saved images found in localStorage');
        }

        // Try to load from Supabase for authenticated users
        (async () => {
          try {
            const dbItems = publicKey
              ? await recentGenerationsService.listForWalletAddress(publicKey.toBase58(), 100)
              : await recentGenerationsService.listForCurrentUser(100);
            if (dbItems.length > 0) {
              const mapped = dbItems
                .filter(item => item.type === 'image')
                .map(item => ({ 
                  url: item.url, 
                  prompt: item.prompt, 
                  timestamp: item.timestamp, 
                  model: item.model,
                  type: item.type,
                  metadata: item.metadata
                }));
              setGeneratedImages(prev => {
                const byUrl = new Map(prev.map(i => [i.url, i]));
                mapped.forEach(i => byUrl.set(i.url, i as any));
                const merged = Array.from(byUrl.values());
                return filterImageLike(merged) as any;
              });
              setShowGallery(true);
            }
          } catch (e) {
            console.warn('AIControls: Failed to load from Supabase (not signed in or error).', e);
          }
        })();
      }
    } catch (error) {
      console.error('AIControls: Error in loading images useEffect:', error);
    }
  }, [recentGenerations, filterImageLike]); // Add recentGenerations as dependency

  // Create a separate effect to handle updates to recentGenerations
  useEffect(() => {
    if (recentGenerations && recentGenerations.length > 0) {
      console.log('AIControls: recentGenerations updated:', recentGenerations);
      // Merge with existing images rather than replacing them
      setGeneratedImages(prev => {
        // Get unique images by URL
        const filteredIncoming = filterImageLike(recentGenerations) as any[];
        const uniqueUrls = new Set([...filteredIncoming, ...prev].map((img: any) => img.url));
        const mergedImages = Array.from(uniqueUrls).map(url => {
          // Find the image object with this URL, preferring recentGenerations first
          return [...filteredIncoming, ...prev].find((img: any) => img.url === url) as GeneratedImage;
        });
        
        console.log('AIControls: Merged generatedImages:', mergedImages);
        return mergedImages as any;
      });
      setShowGallery(true);
    }
  }, [recentGenerations, filterImageLike]);

  // Save images to localStorage whenever generatedImages changes
  useEffect(() => {
    // The store now handles localStorage persistence, so we don't need to duplicate this
    console.log('AIControls: generatedImages updated, count:', generatedImages.length);
  }, [generatedImages]);

  // Log incoming recentGenerations when they change
  useEffect(() => {
    console.log('AIControls: recentGenerations prop changed:', recentGenerations);
  }, [recentGenerations]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      hideTimeoutRef.current.forEach(timeout => clearTimeout(timeout));
      hideTimeoutRef.current.clear();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!prompt.trim()) {
      setError('Please enter a prompt');
      return;
    }
    
    setIsGenerating(true);
    setError(null);
    
    try {
      if (selectedImageUrl && onEdit) {
        await onEdit(prompt, selectedImageUrl);
        setPrompt('');
      } else if (onGenerate) {
        let generatedUrl: string;
        if (selectedModel === 'imagen4') {
          generatedUrl = await imagen4Service.generateImage(prompt, { aspectRatio: imagen4AspectRatio });
        } else if (selectedModel === 'gpt-image-1') {
          generatedUrl = await gptImageService.generateImage(prompt, {
            outputFormat: gptOutputFormat
          });
        } else if (selectedModel === 'runway') {
          generatedUrl = await runwayTextToImageService.generateImage(prompt, {
            ratio: '1024:1024',
            guidance: 7.5
          });
        } else if (selectedModel === 'luma-photon-flash') {
          generatedUrl = await lumaPhotonFlashService.generateImage(prompt, {
            aspectRatio: lumaAspectRatio
          });
        } else if (selectedModel === 'qwen-image') {
          generatedUrl = await qwenImageService.generateImage(prompt, {
            image_size: 'landscape_4_3',
            num_inference_steps: 30,
            guidance_scale: 2.5
          });
        } else if (selectedModel === 'flux-krea') {
          // Use Flux Krea with streaming
          generatedUrl = await fluxKreaService.generateImage(prompt, {
            image_size: 'landscape_4_3',
            num_inference_steps: 28,
            guidance_scale: 4.5,
            acceleration: 'regular',
            stream: true
          }, (event: StreamProgressEvent) => {
            // Handle streaming progress with progressive image
            if (event.type === 'progress') {
              setStreamingProgress(event.message || 'Generating...');
              if (event.partialImageUrl) {
                setPartialImageUrl(event.partialImageUrl);
              }
            } else if (event.type === 'complete') {
              setStreamingProgress(null);
              setPartialImageUrl(null);
            } else if (event.type === 'error') {
              setStreamingProgress(null);
              setPartialImageUrl(null);
              console.error('Flux Krea streaming error:', event.error);
            }
          });
        } else if (selectedModel === 'dreamina') {
          generatedUrl = await dreaminaImageService.generateImage(prompt, {
            image_size: 'landscape_4_3',
            num_inference_steps: 30,
            guidance_scale: 2.5
          });
        } else if (selectedModel === 'nano-banana') {
          generatedUrl = await nanoBananaService.generateImage(prompt, { num_images: 1 });
        } else if (selectedModel === 'flux-2-pro') {
          generatedUrl = await flux2ProService.generateImage(prompt, { image_size: 'landscape_4_3' });
        } else if (selectedModel === 'longcat') {
          generatedUrl = await longcatImageService.generateImage(prompt, { image_size: 'landscape_4_3' });
        } else if (selectedModel === 'z-image-turbo') {
          generatedUrl = await zImageTurboService.generateImage(prompt, { image_size: 'landscape_4_3' });
        } else if (selectedModel === 'wan-2.5') {
          generatedUrl = await wanImageService.textToImage(prompt, { image_size: 'landscape_4_3' });
        } else if (selectedModel === 'hunyuan-image') {
          generatedUrl = await hunyuanImageService.generateImage(prompt, {
            image_size: 'landscape_4_3',
            num_images: 1,
            enable_prompt_expansion: true
          });
        } else if (selectedModel === 'reve') {
          generatedUrl = await reveImageService.generateImage(prompt, {
            aspect_ratio: reveAspectRatio,
            output_format: reveOutputFormat
          });
        } else if (selectedModel === 'higgs-soul') {
          generatedUrl = await higgsfieldService.soulTextToImage(prompt, {
            aspect_ratio: higgsSoulAspect,
            soul_id: higgsSoulId || undefined,
            style_id: higgsSoulStyleId || undefined,
          });
        } else if (selectedModel === 'ovis-image') {
          generatedUrl = await ovisImageService.generateImage(prompt, {
            image_size: ovisImageSize,
            acceleration: ovisAcceleration,
            output_format: ovisOutputFormat,
            num_inference_steps: 28,
            guidance_scale: 5
          });
        } else if (selectedModel === 'seedream-v45') {
          generatedUrl = await seedreamV45Service.generateImage(prompt, {
            image_size: seedreamV45ImageSize,
            num_images: 1
          });
        } else if (selectedModel === 'imagineart') {
          generatedUrl = await imagineartService.generateImage(prompt, {
            image_size: imagineartImageSize,
            output_format: imagineartOutputFormat
          });
        } else {
          generatedUrl = await onGenerate(prompt, selectedModel);
        }
        const newGeneration = {
          url: generatedUrl,
          prompt,
          timestamp: new Date(),
          model: selectedModel,
          metadata: { model: selectedModel }
        } as any;
        // Persist to Supabase in background if user is authenticated
        if (publicKey) {
          // If user is using a wallet-only session, persist by wallet address
          recentGenerationsService.saveForWalletAddress(publicKey.toBase58(), {
            type: 'image',
            url: generatedUrl,
            prompt,
            model: selectedModel
          }).catch(() => {});
        } else {
          // Fallback to Supabase auth user
          recentGenerationsService.saveForCurrentUser({
            type: 'image',
            url: generatedUrl,
            prompt,
            model: selectedModel
          }).catch(() => {});
        }
        setGeneratedImages(prev => {
          if (prev.some(img => img.url === generatedUrl)) {
            return prev;
          }
          return [newGeneration, ...prev];
        });
        setPrompt('');
        setShowGallery(true);
      } else {
        setError('Required action handler (edit/generate) is not configured.');
      }
    } catch (error) {
      console.error('AIControls: Failed during submit:', error);
      const actionVerb = selectedImageUrl ? 'edit' : 'generate';
      setError(`Failed to ${actionVerb} image. Please try again. Details: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownload = async (url: string, prompt: string) => {
    let blobUrl: string | null = null;
    try {
      // Use CORS proxy for external CDN URLs to avoid CORS issues
      const proxyUrl = `/api/download-image?url=${encodeURIComponent(url)}`;
      const response = await fetch(proxyUrl, { headers: await accessHeaders() });
      
      if (!response.ok) {
        throw new Error('Failed to download image');
      }
      
      const blob = await response.blob();
      blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `generated-${prompt.slice(0, 30)}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error('Failed to download image:', error);
      setError(error instanceof Error ? error.message : 'Failed to download image');
    } finally {
      if (blobUrl) {
        window.URL.revokeObjectURL(blobUrl);
      }
    }
  };

  const handleDragStart = (e: React.DragEvent, imageUrl: string) => {
    e.dataTransfer.setData('text/plain', imageUrl);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleImageClick = async (img: GeneratedImage) => {
    const panel: Panel = {
      id: nanoid(),
      type: 'image',
      url: img.url,
      caption: '',
      size: 'medium',
      aspectRatio: 1,
      position: { row: 0, col: 0 }
    };
    await onGenerateStory(img.prompt, img.url, 'image', panel);
    onClearSelection?.();
  };

  // Handle clicking 3D model to add to immersive scene
  const handleAdd3DToImmersiveScene = (img: any) => {
    const modelUrl = img.url; // GLB URL is stored in url field
    // Use prompt as name, truncated for readability
    const modelName = img.prompt?.slice(0, 40) || '3D Model';
    
    // Add the model in front of the camera (z = -3 means 3 units in front)
    // Scale of 1.5 is a good default for Meshy models (they're typically 1-2m tall)
    addImmersiveObject({
      type: 'model',
      name: modelName,
      modelUrl: modelUrl,
      modelPrompt: img.prompt,
      position: { x: 0, y: 0, z: -3 }, // 3 units in front of origin
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1.5, y: 1.5, z: 1.5 }, // Slightly larger for visibility
      visible: true,
    });
    
    console.log('[AIControls] Added 3D model to immersive scene:', modelName, modelUrl);
  };

  // Format timestamp for display
  const formatTimestamp = (timestamp: Date | string) => {
    if (typeof timestamp === 'string') {
      return new Date(timestamp).toLocaleString();
    }
    return timestamp.toLocaleString();
  };

  // Copy prompt to clipboard
  const copyPromptToClipboard = async (prompt: string) => {
    try {
      await navigator.clipboard.writeText(prompt);
      // You could add a toast notification here if you have one
      console.log('Prompt copied to clipboard:', prompt);
    } catch (error) {
      console.error('Failed to copy prompt:', error);
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = prompt;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
    }
  };

  return (
    <div className="space-y-4">
      {/* Model Selection - Responsive Layout */}
      <div className="space-y-2">
        <span className="text-sm font-medium text-gray-300">Model:</span>
        
        {/* Dropdown for narrow screens, Grid for wider screens */}
        <div className="block lg:hidden">
          {/* Mobile/Tablet Dropdown */}
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value as GenerationModel)}
            className="w-full px-3 py-2 text-sm border rounded-md text-gray-200 bg-gray-700 border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
          >
            <option value="flux">Flux LoRA</option>
            <option value="flux-2-pro">Flux 2 Pro</option>
            <option value="ideogram">Ideogram</option>
            <option value="flux-krea">Flux.1 Krea</option>
            <option value="imagen4">Imagen 4</option>
            <option value="gpt-image-1">GPT-Image-1</option>
            <option value="runway">Runway</option>
            <option value="luma-photon-flash">Luma Photon Flash</option>
            <option value="qwen-image">Qwen Image</option>
            <option value="dreamina">Dreamina 3.1</option>
            <option value="nano-banana">Nano Banana Pro</option>
            <option value="hunyuan-image">Hunyuan Image v3</option>
            <option value="reve">Reve</option>
            <option value="higgs-soul">Higgsfield Soul</option>
            <option value="ovis-image">Ovis Image</option>
            <option value="seedream-v45">Seedream 4.5</option>
            <option value="imagineart">ImagineArt 1.5</option>
            <option value="longcat">Longcat Image</option>
            <option value="z-image-turbo">Z-Image Turbo</option>
          </select>
        </div>
        
        {/* Single dropdown for larger screens to avoid overflow issues */}
        <div className="hidden lg:block">
          <div className="relative">
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value as GenerationModel)}
              className="w-full px-3 py-2 text-sm border rounded-md bg-gray-800 text-gray-200 border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              {Object.entries(modelDisplayNames).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Ideogram Options (only show when Ideogram is selected) */}
      {selectedModel === 'ideogram' && (
        <div className="space-y-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
          {/* Style Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Style</label>
            <select
              value={ideogramStyle}
              onChange={(e) => setIdeogramStyle(e.target.value as IdeogramStyle)}
              className="w-full px-3 py-2 border rounded-md text-gray-700 dark:text-gray-200 dark:bg-gray-700 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="auto">Auto</option>
              <option value="general">General</option>
              <option value="realistic">Realistic</option>
              <option value="design">Design</option>
              <option value="render_3D">3D Render</option>
              <option value="anime">Anime</option>
            </select>
          </div>
          
          {/* Aspect Ratio Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Aspect Ratio</label>
            <select
              value={ideogramAspectRatio}
              onChange={(e) => setIdeogramAspectRatio(e.target.value as IdeogramAspectRatio)}
              className="w-full px-3 py-2 border rounded-md text-gray-700 dark:text-gray-200 dark:bg-gray-700 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="1:1">Square (1:1)</option>
              <option value="16:9">Landscape (16:9)</option>
              <option value="9:16">Portrait (9:16)</option>
              <option value="4:3">Landscape (4:3)</option>
              <option value="3:4">Portrait (3:4)</option>
              <option value="3:2">Landscape (3:2)</option>
              <option value="2:3">Portrait (2:3)</option>
            </select>
          </div>

          {/* Expand Prompt Toggle */}
          <div className="flex items-center">
            <input
              type="checkbox"
              id="expand-prompt"
              checked={expandPrompt}
              onChange={(e) => setExpandPrompt(e.target.checked)}
              className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
            />
            <label htmlFor="expand-prompt" className="ml-2 block text-sm text-gray-700 dark:text-gray-300">
              Expand prompt (AI-enhanced)
            </label>
          </div>
        </div>
      )}

      {/* Flux 2 Pro options */}
      {selectedModel === 'flux-2-pro' && (
        <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
          <p className="text-sm text-gray-600 dark:text-gray-400 italic">
            Flux 2 Pro - Next generation Flux with improved quality, speed, and prompt adherence.
          </p>
        </div>
      )}

      {/* Longcat Image options */}
      {selectedModel === 'longcat' && (
        <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
          <p className="text-sm text-gray-600 dark:text-gray-400 italic">
            Longcat Image - High-quality generation with excellent prompt adherence and detail.
          </p>
        </div>
      )}

      {/* Z-Image Turbo options */}
      {selectedModel === 'z-image-turbo' && (
        <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
          <p className="text-sm text-gray-600 dark:text-gray-400 italic">
            Z-Image Turbo - Ultra-fast generation with only 8 inference steps.
          </p>
        </div>
      )}

      {/* Imagen 4 options */}
      {selectedModel === 'imagen4' && (
        <div className="space-y-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Aspect Ratio</label>
            <select
              value={imagen4AspectRatio}
              onChange={e => setImagen4AspectRatio(e.target.value as any)}
              className="w-full px-3 py-2 border rounded-md text-gray-700 dark:text-gray-200 dark:bg-gray-700 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="1:1">Square (1:1)</option>
              <option value="16:9">Landscape (16:9)</option>
              <option value="9:16">Portrait (9:16)</option>
              <option value="4:3">Landscape (4:3)</option>
              <option value="3:4">Portrait (3:4)</option>
            </select>
          </div>
        </div>
      )}

      {/* GPT-Image-1 Mini options */}
      {selectedModel === 'gpt-image-1' && (
        <div className="space-y-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
          <div className="text-sm text-gray-600 dark:text-gray-400 mb-3">
            <p className="font-medium mb-1">GPT-Image-1 Mini</p>
            <p>Efficient image generation combining GPT-5 language capabilities with GPT Image 1 Mini for faster, cost-effective results.</p>
          </div>
          
          {/* Output Format Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Output Format</label>
            <select
              value={gptOutputFormat}
              onChange={(e) => setGptOutputFormat(e.target.value as 'jpeg' | 'png' | 'webp')}
              className="w-full px-3 py-2 border rounded-md text-gray-700 dark:text-gray-200 dark:bg-gray-700 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="jpeg">JPEG</option>
              <option value="png">PNG</option>
              <option value="webp">WebP</option>
            </select>
          </div>
        </div>
      )}

      {/* Reve options */}
      {selectedModel === 'reve' && (
        <div className="space-y-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
          <div className="text-sm text-gray-600 dark:text-gray-400 mb-3">
            <p className="font-medium mb-1">Reve</p>
            <p>Generates detailed visual output with strong aesthetic quality and accurate text rendering.</p>
          </div>
          
          {/* Aspect Ratio Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Aspect Ratio</label>
            <select
              value={reveAspectRatio}
              onChange={(e) => setReveAspectRatio(e.target.value as any)}
              className="w-full px-3 py-2 border rounded-md text-gray-700 dark:text-gray-200 dark:bg-gray-700 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="16:9">16:9 (Landscape)</option>
              <option value="9:16">9:16 (Portrait)</option>
              <option value="3:2">3:2 (Classic)</option>
              <option value="2:3">2:3 (Portrait Classic)</option>
              <option value="4:3">4:3 (Standard)</option>
              <option value="3:4">3:4 (Portrait Standard)</option>
              <option value="1:1">1:1 (Square)</option>
            </select>
          </div>
          
          {/* Output Format Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Output Format</label>
            <select
              value={reveOutputFormat}
              onChange={(e) => setReveOutputFormat(e.target.value as 'png' | 'jpeg' | 'webp')}
              className="w-full px-3 py-2 border rounded-md text-gray-700 dark:text-gray-200 dark:bg-gray-700 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="png">PNG</option>
              <option value="jpeg">JPEG</option>
              <option value="webp">WebP</option>
            </select>
          </div>
        </div>
      )}

      {/* Luma Photon Flash options */}
      {selectedModel === 'luma-photon-flash' && (
        <div className="space-y-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
          <div className="text-sm text-gray-600 dark:text-gray-400 mb-3">
            <p className="font-medium mb-1">Luma Photon Flash</p>
            <p>Ultra-fast creative text-to-image generation with high-quality output and excellent style control.</p>
          </div>
          
          {/* Aspect Ratio Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Aspect Ratio</label>
            <select
              value={lumaAspectRatio}
              onChange={(e) => setLumaAspectRatio(e.target.value as any)}
              className="w-full px-3 py-2 border rounded-md text-gray-700 dark:text-gray-200 dark:bg-gray-700 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="1:1">Square (1:1)</option>
              <option value="16:9">Landscape (16:9)</option>
              <option value="9:16">Portrait (9:16)</option>
              <option value="4:3">Landscape (4:3)</option>
              <option value="3:4">Portrait (3:4)</option>
              <option value="21:9">Ultrawide (21:9)</option>
              <option value="9:21">Tall Portrait (9:21)</option>
            </select>
          </div>
        </div>
      )}

      {/* Higgsfield Soul options */}
      {selectedModel === 'higgs-soul' && (
        <div className="space-y-3 p-3 bg-gray-800 rounded-md text-gray-200">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Aspect Ratio</label>
            <select
              value={higgsSoulAspect}
              onChange={(e) => setHiggsSoulAspect(e.target.value as any)}
              className="w-full px-3 py-2 border rounded-md text-gray-200 bg-gray-700 border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              <option value="1:1">Square (1:1)</option>
              <option value="16:9">Landscape (16:9)</option>
              <option value="9:16">Portrait (9:16)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Soul Style (optional)</label>
            {!higgsSoulStylesLoaded ? (
              <button
                onClick={async () => {
                  try {
                    const mod = await import('../../services/higgsfieldSouls');
                    const list = (mod as any).HIGGSFIELD_SOUL_STYLES || [];
                    if (Array.isArray(list)) setHiggsSoulStyles(list);
                  } catch {}
                  setHiggsSoulStylesLoaded(true);
                }}
                className="mt-1 px-3 py-1.5 text-xs rounded-md border bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700"
              >
                Load Soul Styles
              </button>
            ) : (
              <div className="relative">
                <div className="flex items-center gap-2 overflow-x-auto pb-2 snap-x snap-mandatory">
                  <button
                    onClick={() => setHiggsSoulStyleId('')}
                    className={`min-w-[180px] snap-start p-2 rounded border text-left ${higgsSoulStyleId === '' ? 'border-purple-500 bg-purple-600/20 text-purple-100' : 'border-gray-600 bg-gray-700 text-gray-200 hover:bg-gray-600'}`}
                  >
                    <div className="w-full h-28 flex items-center justify-center bg-gray-700 rounded mb-2 text-xs">Default</div>
                    <div className="text-sm font-medium">None</div>
                  </button>
                  {higgsSoulStyles.map(style => (
                    <button
                      key={style.name + (style.preview_url || '')}
                      onClick={() => setHiggsSoulStyleId(style.id)}
                      title={style.description || style.name}
                      className={`min-w-[180px] snap-start p-2 rounded border text-left ${higgsSoulStyleId === style.id ? 'border-purple-500 bg-purple-600/20 text-purple-100' : 'border-gray-600 bg-gray-700 text-gray-200 hover:bg-gray-600'}`}
                    >
                      {style.preview_url ? (
                        <img src={style.preview_url} alt={style.name} className="w-full h-28 object-cover rounded mb-2" loading="lazy" />
                      ) : (
                        <div className="w-full h-28 rounded bg-gray-600 mb-2" />
                      )}
                      <div className="text-sm font-medium truncate">{style.name}</div>
                      {style.description && (
                        <div className="text-[11px] opacity-70 line-clamp-2">{style.description}</div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Soul ID (optional)</label>
            <input
              type="text"
              value={higgsSoulId}
              onChange={(e) => setHiggsSoulId(e.target.value)}
              placeholder="Provide an existing Soul ID to maintain character"
              className="w-full px-3 py-2 border rounded-md text-gray-200 bg-gray-700 border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>
          {!!savedCharacters.length && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Use Character</label>
              <div className="grid grid-cols-3 gap-2">
                {savedCharacters.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setHiggsSoulId(c.soul_id || '')}
                    className={`p-1 rounded border ${higgsSoulId === (c.soul_id || '') ? 'border-purple-500' : 'border-gray-600'} bg-gray-800`}
                    title={c.name || 'Character'}
                  >
                    {c.image_url ? (
                      <img src={c.image_url} className="w-full h-16 object-cover rounded" />
                    ) : (
                      <div className="w-full h-16 bg-gray-700 rounded" />
                    )}
                    <div className="text-[10px] text-gray-300 mt-1 truncate">{c.name || 'Character'}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Ovis Image options - optimized for text rendering */}
      {selectedModel === 'ovis-image' && (
        <div className="space-y-3 p-3 bg-gray-800 rounded-md text-gray-200">
          <div className="text-sm text-gray-400 mb-3">
            <p className="font-medium mb-1 text-gray-200">Ovis Image</p>
            <p>7B model optimized for quick, high-quality text rendering in images.</p>
          </div>
          
          {/* Image Size Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Image Size</label>
            <select
              value={ovisImageSize}
              onChange={(e) => setOvisImageSize(e.target.value as any)}
              className="w-full px-3 py-2 border rounded-md text-gray-200 bg-gray-700 border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              <option value="square_hd">Square HD</option>
              <option value="square">Square</option>
              <option value="portrait_4_3">Portrait (4:3)</option>
              <option value="portrait_16_9">Portrait (16:9)</option>
              <option value="landscape_4_3">Landscape (4:3)</option>
              <option value="landscape_16_9">Landscape (16:9)</option>
            </select>
          </div>
          
          {/* Acceleration Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Acceleration</label>
            <select
              value={ovisAcceleration}
              onChange={(e) => setOvisAcceleration(e.target.value as any)}
              className="w-full px-3 py-2 border rounded-md text-gray-200 bg-gray-700 border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              <option value="none">None (Best Quality)</option>
              <option value="regular">Regular</option>
              <option value="high">High (Fastest)</option>
            </select>
          </div>
          
          {/* Output Format Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Output Format</label>
            <select
              value={ovisOutputFormat}
              onChange={(e) => setOvisOutputFormat(e.target.value as any)}
              className="w-full px-3 py-2 border rounded-md text-gray-200 bg-gray-700 border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              <option value="png">PNG</option>
              <option value="jpeg">JPEG</option>
              <option value="webp">WebP</option>
            </select>
          </div>
        </div>
      )}

      {/* Seedream v4.5 options */}
      {selectedModel === 'seedream-v45' && (
        <div className="space-y-3 p-3 bg-gray-800 rounded-md text-gray-200">
          <div className="text-sm text-gray-400 mb-3">
            <p className="font-medium mb-1 text-gray-200">Seedream 4.5</p>
            <p>ByteDance's unified architecture for generation and editing. Up to 4MP (2048×2048) at $0.04/image.</p>
          </div>
          
          {/* Image Size Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Image Size</label>
            <select
              value={seedreamV45ImageSize}
              onChange={(e) => setSeedreamV45ImageSize(e.target.value as any)}
              className="w-full px-3 py-2 border rounded-md text-gray-200 bg-gray-700 border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              <option value="square_hd">Square HD</option>
              <option value="square">Square</option>
              <option value="portrait_4_3">Portrait (4:3)</option>
              <option value="portrait_16_9">Portrait (16:9)</option>
              <option value="landscape_4_3">Landscape (4:3)</option>
              <option value="landscape_16_9">Landscape (16:9)</option>
            </select>
          </div>
        </div>
      )}

      {/* ImagineArt 1.5 options */}
      {selectedModel === 'imagineart' && (
        <div className="space-y-3 p-3 bg-gray-800 rounded-md text-gray-200">
          <div className="text-sm text-gray-400 mb-3">
            <p className="font-medium mb-1 text-gray-200">ImagineArt 1.5 Preview</p>
            <p>High-fidelity professional-grade visuals with lifelike realism and accurate text rendering.</p>
          </div>
          
          {/* Image Size Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Image Size</label>
            <select
              value={imagineartImageSize}
              onChange={(e) => setImagineartImageSize(e.target.value as any)}
              className="w-full px-3 py-2 border rounded-md text-gray-200 bg-gray-700 border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              <option value="square_hd">Square HD</option>
              <option value="square">Square</option>
              <option value="portrait_4_3">Portrait (4:3)</option>
              <option value="portrait_16_9">Portrait (16:9)</option>
              <option value="landscape_4_3">Landscape (4:3)</option>
              <option value="landscape_16_9">Landscape (16:9)</option>
            </select>
          </div>
          
          {/* Output Format Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Output Format</label>
            <select
              value={imagineartOutputFormat}
              onChange={(e) => setImagineartOutputFormat(e.target.value as any)}
              className="w-full px-3 py-2 border rounded-md text-gray-200 bg-gray-700 border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              <option value="webp">WebP</option>
              <option value="png">PNG</option>
              <option value="jpeg">JPEG</option>
            </select>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        <label htmlFor="prompt-input" className="sr-only">
          {selectedImageUrl ? "Edit image prompt" : "Generate image prompt"}
        </label>
        <div className="relative">
          <textarea
            id="prompt-input"
            name="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={selectedImageUrl ? "Describe how to edit this image..." : "Describe the image you want to generate..."}
            className="w-full px-4 py-3 rounded-lg border border-gray-600 focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-gray-700 text-gray-200 placeholder-gray-400 resize-none"
            rows={3}
          />
          <div className="absolute bottom-2 right-2 text-xs text-gray-400">
            {prompt.length}/1000
          </div>
        </div>
        <button
          type="submit"
          disabled={isGenerating || !prompt.trim()}
          className="w-full sm:w-auto sm:min-w-[120px] px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all duration-200 font-medium"
        >
          {isGenerating ? (
            <>
              <span className="animate-spin">⌛</span>
              <span>Generating...</span>
            </>
          ) : selectedImageUrl ? (
            <>
              <Pencil className="w-4 h-4" />
              <span>Edit Image</span>
            </>
          ) : (
            <>
              <Wand2 className="w-4 h-4" />
              <span>Generate</span>
            </>
          )}
        </button>
      </form>

      

      {/* Progressive Image Preview for Flux Krea */}
      {selectedModel === 'flux-krea' && (isGenerating || partialImageUrl) && (
        <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            Live Preview - Flux.1 Krea
          </h4>
          <ProgressiveImage
            partialImageUrl={partialImageUrl || undefined}
            isGenerating={isGenerating}
            className="w-full h-48"
          />
        </div>
      )}

      {error && (
        <div className="text-red-500 text-sm mt-2">
          {error}
        </div>
      )}

      {/* Generated Images Gallery */}
      {showGallery && (
        <div className="mt-4 border-t pt-4 overflow-visible">
          <div className="flex justify-between items-center mb-2">
            <div className="flex items-center">
              <Clock size={16} className="text-gray-500 mr-2" />
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Recent Generations ({generatedImages.length})
              </h3>
            </div>
            <button
              onClick={() => setShowGallery(false)}
              className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-400"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {generatedImages.length === 0 ? (
            <div className="text-gray-500 dark:text-gray-400 text-sm italic">
              No images generated yet. Generate an image to see it here.
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2 overflow-visible">
              {generatedImages.map((img, index) => {
                const anyImg: any = img as any;
                const is3d = anyImg?.type === '3d' || (typeof anyImg?.url === 'string' && anyImg.url.endsWith('.glb'));
                const thumb = is3d ? (anyImg?.metadata?.thumbnail || anyImg?.metadata?.poster || anyImg?.metadata?.preview) : undefined;
                const displayUrl = is3d ? (thumb || '/model-placeholder.svg') : img.url;
                // 3D models are clickable in world mode to add to immersive scene
                const canInteract = !is3d;
                const can3DInteract = is3d && isWorldMode;

                return (
                  <div
                    key={`${img.url}-${index}`}
                    className={`relative group overflow-visible ${(canInteract || can3DInteract) ? 'cursor-pointer' : 'cursor-default'}`}
                    draggable={canInteract}
                    onDragStart={(e) => canInteract && handleDragStart(e, img.url)}
                    onClick={() => {
                      if (canInteract) {
                        handleImageClick(img);
                      } else if (can3DInteract) {
                        handleAdd3DToImmersiveScene(anyImg);
                      }
                    }}
                    onMouseEnter={(e) => {
                      // Clear any pending hide timeout for this tooltip
                      const existingTimeout = hideTimeoutRef.current.get(index);
                      if (existingTimeout) {
                        clearTimeout(existingTimeout);
                        hideTimeoutRef.current.delete(index);
                      }
                      
                      setHoveredImage(index);
                      // Calculate tooltip position based on grid column
                      // The tooltip uses absolute positioning:
                      // - left-0: aligns tooltip's left edge with thumbnail's left edge (extends right)
                      // - right-0: aligns tooltip's right edge with thumbnail's right edge (extends left)
                      
                      // Calculate position in grid (0-3 for 4 columns)
                      const column = index % 4;
                      
                      // Slot 1 (column 0) and Slot 4 (column 3) are perfect
                      // Slot 1 uses left-0, Slot 4 uses right-0
                      // Apply same positioning to slots 2 and 3:
                      // - Slot 1 & 2 (columns 0-1): use left-0 alignment
                      // - Slot 3 & 4 (columns 2-3): use right-0 alignment
                      const position: 'left' | 'right' = column >= 2 ? 'right' : 'left';
                      
                      setTooltipPosition(prev => ({ ...prev, [index]: position }));
                    }}
                    onMouseLeave={() => {
                      // Add delay before hiding to allow mouse movement to tooltip or bridge
                      const timeout = setTimeout(() => {
                        setHoveredImage(prev => prev === index ? null : prev);
                        hideTimeoutRef.current.delete(index);
                      }, 200); // 200ms delay gives plenty of time to move to tooltip
                      hideTimeoutRef.current.set(index, timeout);
                    }}
                    title={is3d ? '3D Model' : img.prompt}
                  >
                    <img
                      src={displayUrl}
                      alt={is3d ? '3D model preview' : img.prompt}
                      className={`w-full h-24 object-cover rounded-lg bg-gray-800 ${can3DInteract ? 'ring-2 ring-emerald-500/50' : ''}`}
                      onLoad={() => console.log('AIControls: Thumb loaded:', displayUrl)}
                      onError={(e) => {
                        console.error('Failed to load thumbnail:', displayUrl);
                        e.currentTarget.src = '/model-placeholder.svg';
                      }}
                    />
                    
                    {/* 3D badge - shows "Add to Scene" when in world mode */}
                    {is3d && (
                      <div className={`absolute bottom-1 left-1 px-1.5 py-0.5 rounded text-[9px] font-medium flex items-center gap-1 ${
                        can3DInteract 
                          ? 'bg-emerald-500/90 text-white' 
                          : 'bg-gray-900/80 text-gray-300'
                      }`}>
                        <Box size={8} />
                        {can3DInteract ? 'Add to Scene' : '3D'}
                      </div>
                    )}

                  {/* Tooltip on hover */}
                  {hoveredImage === index && (() => {
                    // Calculate position directly (don't rely on async state update)
                    // Slot 1 (column 0) and Slot 4 (column 3) are perfect
                    // Ensure slots 2 and 3 match slots 1 and 4 exactly:
                    // - Slots 1 & 2 (columns 0-1): left-0 (same visual position as slot 1)
                    // - Slots 3 & 4 (columns 2-3): right-0 (same visual position as slot 4)
                    const column = index % 4;
                    const positionClass = column >= 2 ? 'right-0' : 'left-0';
                    return (
                    <div 
                      className={`absolute z-50 w-72 p-3 text-sm bg-purple-600 text-white rounded shadow-lg bottom-full mb-2 ${positionClass}`}
                      onMouseEnter={() => {
                        // Clear hide timeout when mouse enters tooltip
                        const existingTimeout = hideTimeoutRef.current.get(index);
                        if (existingTimeout) {
                          clearTimeout(existingTimeout);
                          hideTimeoutRef.current.delete(index);
                        }
                        setHoveredImage(index); // Keep tooltip visible
                      }}
                      onMouseLeave={() => {
                        // Add delay before hiding to allow mouse to return to thumbnail
                        const timeout = setTimeout(() => {
                          setHoveredImage(prev => prev === index ? null : prev);
                          hideTimeoutRef.current.delete(index);
                        }, 200);
                        hideTimeoutRef.current.set(index, timeout);
                      }}
                    >
                      <div className="mb-2">
                        <p className="font-semibold">Prompt:</p>
                        <div className={expandedPrompt === index ? 'max-h-40 overflow-y-auto pr-1 text-xs' : 'text-xs'}>
                          {expandedPrompt === index 
                            ? img.prompt 
                            : (img.prompt.length > 50 
                                ? img.prompt.substring(0, 50) + '...' 
                                : img.prompt)}
                        </div>
                        {img.prompt.length > 50 && (
                          <button 
                            onClick={(e) => {
                              e.stopPropagation(); // Prevent click from bubbling to parent elements
                              setExpandedPrompt(expandedPrompt === index ? null : index);
                            }}
                            className="text-xs text-purple-300 hover:text-white mt-1"
                          >
                            {expandedPrompt === index ? 'Show less' : 'Show more'}
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-gray-300">Created: {formatTimestamp(img.timestamp)}</p>
                      {(() => {
                        const modelKey = (img as any).model || (img as any).metadata?.model;
          const modelLabel = modelKey ? (modelDisplayNames[modelKey as GenerationModel] || (modelKey as string)) : ((img as any).metadata?.model || 'Unknown');
                        return (
                          <p className="text-xs text-purple-300">Model: {modelLabel}</p>
                        );
                      })()}
                      <div className="mt-2 flex justify-between items-center">
                        <div className="flex gap-2">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation(); // Prevent click from bubbling
                              copyPromptToClipboard(img.prompt);
                            }}
                            className="text-xs bg-purple-700 hover:bg-purple-800 text-white px-2 py-1 rounded flex items-center gap-1"
                            title="Copy prompt to clipboard"
                          >
                            <Copy size={12} />
                            Copy
                          </button>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation(); // Prevent click from bubbling
                              handleDownload(img.url, img.prompt);
                            }}
                            className="text-xs bg-purple-700 hover:bg-purple-800 text-white px-2 py-1 rounded flex items-center gap-1"
                          >
                            <Download size={12} />
                            Download
                          </button>
                        </div>
                        {canInteract ? (
                          <p className="text-[10px] text-gray-300">Click to add to panel</p>
                        ) : can3DInteract ? (
                          <p className="text-[10px] text-emerald-300 flex items-center gap-1">
                            <Box size={10} /> Click to add to scene
                          </p>
                        ) : (
                          <p className="text-[10px] text-gray-300">3D preview</p>
                        )}
                      </div>
                    </div>
                    );
                  })()}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}; 