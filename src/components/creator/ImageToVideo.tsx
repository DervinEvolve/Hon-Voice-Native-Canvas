import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { videoService } from '../../services/videoService';
import { higgsfieldService } from '../../services/higgsfieldService';
// Lazy data for motions: fetched from server when needed
import { runwayService } from '../../services/runwayService';
import { Upload, Film, X, Download, Copy } from 'lucide-react';
import { Panel } from '../../types';
import { nanoid } from 'nanoid';
import { useComicStore } from '../../store/useComicStore';
import { minimaxVideoService } from '../../services/minimaxVideoService';
import { textToVideoService, VideoModel } from '../../services/textToVideoService'; // Use the shared VideoModel
import { klingService } from '../../services/klingService'; // Import the new Kling service
import { recentGenerationsService } from '../../services/recentGenerationsService';
import { useWallet } from '@solana/wallet-adapter-react';

interface ImageToVideoProps {
  onGenerateStory: (prompt: string, generatedUrl: string, type: 'image' | 'video' | 'gif', panel?: Panel) => Promise<void>;
}

// Define the available models
const imageToVideoModels: { value: string; label: string; icon?: React.FC<React.SVGProps<SVGSVGElement>> }[] = [
  { value: 'veo31-image', label: 'Veo 3.1 Fast' },
  { value: 'higgsfield-dop', label: 'Higgsfield DoP' },
  { value: 'hailuo-02-pro', label: 'Hailuo 02 Pro' },
  { value: 'kling-2.5-pro', label: 'Kling 2.5 Turbo Pro' },
  { value: 'seedance', label: 'Seedance' },
  { value: 'vidu-image', label: 'Vidu Image' },
  { value: 'runway', label: 'Runway Gen-4' },
  { value: 'wan-i2v', label: 'WAN i2v' },
  { value: 'marey-i2v', label: 'Marey i2v' },
  { value: 'sora2-i2v', label: 'Sora 2 Pro' },
];

// Model display information
const modelInfo = {
  'veo31-image': {
    name: 'Veo 3.1 Fast',
    description: 'Google\'s fastest - 720p/1080p, natural motion, 8s'
  },
  'hailuo-02-pro': {
    name: 'Hailuo 02 Pro',
    description: '1080p Image Animation'
  },
  'vidu-image': {
    name: 'Vidu Image',
    description: 'High Quality Motion'
  },
  'kling-2.5-pro': {
    name: 'Kling 2.5 Turbo Pro',
    description: 'Advanced Image to Video'
  },
  'fal-veo2': {
    name: 'Veo 2',
    description: 'High Quality Motion'
  },
  'fal-kling2': {
    name: 'Kling 2.0',
    description: 'Enhanced Consistency'
  },
  'higgsfield-dop': {
    name: 'Higgsfield DoP',
    description: 'Image → 5s video with motion presets'
  },
  seedance: {
    name: 'Seedance',
    description: 'Fast, efficient image-to-video'
  },
  runway: {
    name: 'Runway Gen-4',
    description: 'Premium Quality Animation'
  },
  'wan-i2v': {
    name: 'WAN i2v',
    description: 'Turbo image-to-video'
  },
  'marey-i2v': {
    name: 'Marey i2v',
    description: 'Realism v1.5 image-to-video'
  },
  'sora2-i2v': {
    name: 'Sora 2 Pro',
    description: 'Image to Video'
  }
};

export const ImageToVideo: React.FC<ImageToVideoProps> = ({ onGenerateStory }) => {
  const { currentComic, currentPageIndex, updatePanel } = useComicStore();
  const { publicKey } = useWallet();
  const [image, setImage] = useState<File | null>(null);
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  // Add state for the selected model, default to minimax
  const [selectedModel, setSelectedModel] = useState<string>(imageToVideoModels[0].value);
  // Add state for Seedance options
  const [seedanceDuration, setSeedanceDuration] = useState<'5' | '10'>('5');
  const [seedanceResolution, setSeedanceResolution] = useState<'480p' | '720p'>('720p');
  const [seedanceCameraFixed, setSeedanceCameraFixed] = useState(false);
  const [viduMovement, setViduMovement] = useState<'auto' | 'small' | 'medium' | 'large'>('auto');
  // Higgsfield DoP motion preset
  const [higgsMotionId, setHiggsMotionId] = useState<string>('');
  const [higgsMotions, setHiggsMotions] = useState<Array<{ id: string; name: string; description?: string; preview_url?: string; start_end_frame?: boolean }>>([]);
  const [higgsMotionsLoaded, setHiggsMotionsLoaded] = useState(false);
  const [higgsMotionQuery, setHiggsMotionQuery] = useState<string>('');

  const filteredMotions = useMemo(() => {
    if (!higgsMotionQuery.trim()) return higgsMotions;
    const q = higgsMotionQuery.toLowerCase();
    return higgsMotions.filter(m =>
      (m.name && m.name.toLowerCase().includes(q)) ||
      (m.description && m.description.toLowerCase().includes(q))
    );
  }, [higgsMotions, higgsMotionQuery]);
  // WAN i2v controls
  const [wanResolution, setWanResolution] = useState<'480p' | '580p' | '720p'>('720p');
  // Marey i2v controls
  const [mareyDuration, setMareyDuration] = useState<'5s' | '10s'>('5s');
  const [mareyAspect, setMareyAspect] = useState<'1920x1080' | '1080x1920' | '1152x1152' | '1536x1152' | '1152x1536'>('1920x1080');
  const [mareyNegative, setMareyNegative] = useState<string>('');
  const [mareySeed, setMareySeed] = useState<number | undefined>(undefined);
  // Sora2 i2v controls
  const [soraDuration, setSoraDuration] = useState<4 | 8 | 12>(4);
  const [soraResolution, setSoraResolution] = useState<'auto' | '720p' | '1080p'>('auto');
  const [soraAspectRatio, setSoraAspectRatio] = useState<'auto' | '16:9' | '9:16'>('auto');
  // Veo 3.1 i2v controls
  const [veo31Resolution, setVeo31Resolution] = useState<'720p' | '1080p'>('720p');
  const [veo31AspectRatio, setVeo31AspectRatio] = useState<'auto' | '9:16' | '16:9' | '1:1'>('auto');
  const [veo31GenerateAudio, setVeo31GenerateAudio] = useState(true);

  // Recent video generations (Image-to-Video)
  interface RecentVideoGen { url: string; prompt: string; timestamp: Date; model: string }
  const [recentImageVideos, setRecentImageVideos] = useState<RecentVideoGen[]>([]);
  const [showRecentImageVideos, setShowRecentImageVideos] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [expandedPrompt, setExpandedPrompt] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        let rows: Array<{ url: string; prompt: string; timestamp: Date; model: string; type: any; metadata?: Record<string, any> }>; 
        if (publicKey) {
          rows = await recentGenerationsService.listForWalletAddress(publicKey.toBase58(), 50) as any;
        } else {
          rows = await recentGenerationsService.listForCurrentUser(50) as any;
        }
        const filtered = rows
          .filter(r => r.type === 'video' && r.metadata?.source === 'image_to_video')
          .map(r => ({ url: r.url, prompt: r.prompt, timestamp: r.timestamp, model: r.model }));
        setRecentImageVideos(filtered);
      } catch (e) {
        console.warn('Failed to load recent image-to-video generations');
      }
    })();
  }, [publicKey]);

  // Auto-load Higgsfield motions when the model is selected (so the carousel shows immediately)
  useEffect(() => {
    (async () => {
      if (selectedModel === 'higgsfield-dop' && !higgsMotionsLoaded) {
        try {
          const res = await fetch('/api/higgsfield/motions');
          const list = await res.json();
          if (Array.isArray(list)) setHiggsMotions(list);
        } catch {}
        setHiggsMotionsLoaded(true);
      }
    })();
  }, [selectedModel, higgsMotionsLoaded]);

  const pollForCompletion = async (statusPath: string, requestId: string) => {
    // Increase timeout for slower models like Vidu
    const maxPolls = statusPath.includes('vidu') ? 120 : 60; // 10 minutes for Vidu, 5 minutes for others
    const pollInterval = 5000; // 5 seconds
    
    for (let i = 0; i < maxPolls; i++) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));

      try {
        const statusResponse = await fetch(`/api/${statusPath}?requestId=${encodeURIComponent(requestId)}`);
        
        // Check if response is HTML (indicating 404/500 error)
        const contentType = statusResponse.headers.get('content-type');
        if (!statusResponse.ok || !contentType?.includes('application/json')) {
          console.error(`[ImageToVideo] ${statusPath} status endpoint error:`, {
            status: statusResponse.status,
            statusText: statusResponse.statusText,
            contentType
          });
          throw new Error(`Status endpoint error: ${statusResponse.status} ${statusResponse.statusText}`);
        }

        const statusData = await statusResponse.json();
        console.log(`[ImageToVideo] ${statusPath} status response:`, statusData);

        if (statusData.status === 'COMPLETED') {
          // More robust URL extraction
          const findVideoUrl = (obj: any): string | null => {
            if (!obj || typeof obj !== 'object') return null;
            for (const key in obj) {
              if (typeof obj[key] === 'string' && obj[key].includes('http') && (obj[key].endsWith('.mp4') || obj[key].endsWith('.webm'))) {
                return obj[key];
              }
              if (typeof obj[key] === 'object' && obj[key] !== null) {
                const nestedUrl = findVideoUrl(obj[key]);
                if (nestedUrl) return nestedUrl;
              }
            }
            return null;
          };

          const videoUrl = findVideoUrl(statusData.result);
          if (!videoUrl) {
            console.error(`[ImageToVideo] No video URL found in response for ${statusPath}:`, statusData.result);
            console.error(`[ImageToVideo] Full status data for debugging:`, JSON.stringify(statusData, null, 2));
            throw new Error('No video URL in completed job response');
          }
          
          console.log(`📥 Received video URL from ${statusPath}:`, videoUrl);
          return videoUrl;
        } else if (statusData.status === 'ERROR' || statusData.status === 'FAILED') {
          throw new Error(`Video generation failed: ${statusData.error || statusData.message || 'Unknown error'}`);
        }
        
        console.log(`Processing... Status: ${statusData.status} (${i + 1}/${maxPolls})`);
      } catch (error) {
        if (error instanceof Error && error.message.includes('Status endpoint error')) {
          throw error; // Re-throw endpoint errors immediately
        }
        console.warn(`[ImageToVideo] Polling attempt ${i + 1} failed:`, error);
      }
    }
    
    const timeoutMinutes = statusPath.includes('vidu') ? 10 : 5;
    throw new Error(`Video generation timed out after ${timeoutMinutes} minutes.`);
  };

  const handleGenerate = async () => {
    if (!image) {
      setError('Please select an image');
      return;
    }

    setError(null);
    setIsGenerating(true);
    setVideoUrl(null);

    try {
      // Upload image to Cloudinary
      const imageUrl = await videoService.uploadImage(image);
      console.log('Image uploaded:', imageUrl);

      console.log(`Generating video with model: ${selectedModel}`);

      let result: { videoUrl?: string; error?: string };

      // Handle new async models with polling
      if (['hailuo-02-pro', 'vidu-image', 'kling-2.5-pro', 'veo31-image', 'sora2-i2v'].includes(selectedModel)) {
        const apiPathMap = {
          'hailuo-02-pro': 'minimax/image',
          'vidu-image': 'vidu/image-to-video',
          'kling-2.5-pro': 'kling/image-to-video',
          'veo31-image': 'veo31/image-to-video',
          'sora2-i2v': 'sora2/image-to-video'
        };
        const statusPathMap = {
          'hailuo-02-pro': 'minimax/image-status',
          'vidu-image': 'vidu/image-status',
          'kling-2.5-pro': 'kling/image-status',
          'veo31-image': 'veo31/status',
          'sora2-i2v': 'sora2/status?model_type=image-to-video'
        } as any;
        
        const apiModel = apiPathMap[selectedModel];
        const statusPath = statusPathMap[selectedModel];
        
        // Prepare request body based on model
        const requestBody: any = {
          prompt,
          image_url: imageUrl,
        };
        
        // Add model-specific parameters
        if (selectedModel === 'vidu-image') {
          requestBody.movement_amplitude = viduMovement;
        }
        if (selectedModel === 'kling-2.5-pro') {
          requestBody.duration = seedanceDuration;
          requestBody.cfg_scale = 0.5; // Default CFG scale as per Kling API spec
        }
        if (selectedModel === 'veo31-image') {
          requestBody.resolution = veo31Resolution;
          requestBody.aspect_ratio = veo31AspectRatio;
          requestBody.duration = '8s'; // Fixed 8s duration for Veo 3.1
          requestBody.generate_audio = veo31GenerateAudio;
        }
        if (selectedModel === 'sora2-i2v') {
          requestBody.resolution = soraResolution;
          requestBody.aspect_ratio = soraAspectRatio;
          requestBody.duration = soraDuration;
        }

        const submitResponse = await fetch(`/api/${apiModel}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });

        if (submitResponse.status !== 202) {
          const errorData = await submitResponse.json();
          throw new Error(errorData.error || 'Failed to submit video generation job');
        }

        const { request_id } = await submitResponse.json();
        const statusPathFinal = selectedModel === 'sora2-i2v' ? `sora2/status&request_id=${request_id}&model_type=image-to-video` : `${statusPath}&requestId=${request_id}`;
        const videoUrl = selectedModel === 'veo31-image'
          ? await (async () => {
              // Veo 3.1 specific polling with request_id
              for (let i = 0; i < 120; i++) { // 10 minutes max
                await new Promise(r => setTimeout(r, 5000));
                const resp = await fetch(`/api/veo31/status?request_id=${request_id}&model_type=image-to-video`);
                if (!resp.ok) continue;
                const data = await resp.json();
                if (data.status === 'COMPLETED' && data.video_url) {
                  return data.video_url;
                }
                if (data.status === 'FAILED') {
                  throw new Error(data.error || 'Veo 3.1 generation failed');
                }
                console.log(`Veo 3.1 processing... ${i + 1}/120`);
              }
              throw new Error('Veo 3.1 image-to-video timed out after 10 minutes');
            })()
          : selectedModel === 'sora2-i2v'
          ? await (async () => {
              // Sora uses `request_id` param; allow up to 20 minutes
              for (let i = 0; i < 240; i++) {
                await new Promise(r => setTimeout(r, 5000));
                const resp = await fetch(`/api/sora2/status?request_id=${encodeURIComponent(request_id)}&model_type=image-to-video`);
                if (!resp.ok) continue;
                const data = await resp.json();
                if ((data.status === 'COMPLETED' || data.status === 'PROCESSING') && data.result) {
                  const findUrl = (obj: any): string | null => {
                    if (!obj || typeof obj !== 'object') return null;
                    for (const k in obj) {
                      const v = (obj as any)[k];
                      if (typeof v === 'string' && v.includes('http') && (v.endsWith('.mp4') || v.endsWith('.webm'))) return v;
                      if (v && typeof v === 'object') { const u = findUrl(v); if (u) return u; }
                    }
                    return null;
                  };
                  const url = findUrl(data.result);
                  if (url) return url;
                }
              }
              throw new Error('Sora2 image-to-video timed out');
            })()
          : await pollForCompletion(statusPath, request_id);
        result = { videoUrl };
      }
      // Handle Higgsfield DoP
      else if (selectedModel === 'higgsfield-dop') {
        const vurl = await higgsfieldService.imageToVideo(imageUrl, { prompt, motion_id: higgsMotionId || undefined });
        result = { videoUrl: vurl };
      }
      // Handle Runway model with its own polling system
      else if (selectedModel === 'runway') {
        const videoUrl = await runwayService.convertPanelToVideo({
          imageUrl,
          prompt,
          duration: 5,
          ratio: '1280:720'
        });
        result = { videoUrl };
      }
      else if (selectedModel === 'wan-i2v') {
        const response = await fetch('/api/wan/image-to-video', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_url: imageUrl, prompt, resolution: wanResolution })
        });
        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          throw new Error(err.error || 'WAN i2v failed');
        }
        const data = await response.json();
        result = { videoUrl: data.videoUrl };
      }
      else if (selectedModel === 'marey-i2v') {
        const response = await fetch('/api/marey/image-to-video', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_url: imageUrl, prompt, duration: mareyDuration, aspect_ratio: mareyAspect, negative_prompt: mareyNegative || undefined, seed: typeof mareySeed === 'number' ? mareySeed : undefined })
        });
        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          throw new Error(err.error || 'Marey i2v failed');
        }
        const data = await response.json();
        result = { videoUrl: data.videoUrl };
      }
      // Handle Seedance model
      else if (selectedModel === 'seedance') {
        const videoUrl = await videoService.generateSeedanceImageToVideo({
          imageUrl,
          prompt,
          duration: seedanceDuration,
          resolution: seedanceResolution,
          cameraFixed: seedanceCameraFixed
        });
        result = { videoUrl };
      }
      // Handle legacy FAL models (if still needed)
      else if (selectedModel === 'fal-veo2') {
        result = await videoService.generateFalVeo2Video({ 
          imageUrl, 
          prompt 
        }); 
      } else if (selectedModel === 'fal-kling2') {
        result = await videoService.generateFalKling2Video({ 
          imageUrl, 
          prompt 
        });
      }
      else {
        throw new Error(`Unsupported model selected: ${selectedModel}`);
      }

      if (result.videoUrl) {
        setVideoUrl(result.videoUrl);
        // Persist recent generation (user and/or wallet)
        const base = { type: 'video' as const, url: result.videoUrl, prompt, model: selectedModel };
        try { await recentGenerationsService.saveForCurrentUser({ ...base, metadata: { source: 'image_to_video', model: selectedModel } }); } catch {}
        try { if (publicKey) await recentGenerationsService.saveForWalletAddress(publicKey.toBase58(), { ...base, metadata: { source: 'image_to_video', model: selectedModel } }); } catch {}
        setRecentImageVideos(prev => [{ url: result.videoUrl!, prompt, timestamp: new Date(), model: selectedModel }, ...prev.filter(v => v.url !== result.videoUrl)]);
      } else {
        throw new Error(result.error || 'No video URL in response');
      }
    } catch (err) {
      console.error('Video generation error:', err);
      setError(err instanceof Error ? err.message : 'Failed to generate video');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      setImage(file);
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      setImage(file);
    }
  }, []);

  const handleVideoClick = () => {
    // Add checks for currentComic and pages
    if (!videoUrl || typeof currentPageIndex === 'undefined' || !currentComic) {
        console.error("Cannot add video: Invalid comic state.");
        return;
    }
    
    // Access pages only after confirming currentComic exists
    if (!currentComic.pages || !Array.isArray(currentComic.pages[currentPageIndex])) {
        console.error("Cannot add video: Invalid page state.");
        return;
    }

    const pages = currentComic.pages[currentPageIndex];
    
    const emptyPanelIndex = pages.findIndex(panel => !panel || !panel.url);
    
    if (emptyPanelIndex !== -1) {
      const panel: Panel = { // Explicitly type panel
        id: nanoid(),
        type: 'video' as const,
        url: videoUrl,
        caption: '',
        size: 'medium' as const, // Fix type error
        aspectRatio: 1,
        position: { row: 0, col: 0, rowSpan: 1, colSpan: 1 } // Use row/col instead of x/y
      };
      updatePanel(panel, currentPageIndex);
    }
  };

  const handleDragStart = (e: React.DragEvent<HTMLVideoElement>) => {
    if (!videoUrl) return;

    const panel: Panel = {
      id: nanoid(),
      type: 'video' as const,
      url: videoUrl,
      caption: '',
      size: 'medium' as const,
      aspectRatio: 1,
      position: { row: 0, col: 0, rowSpan: 1, colSpan: 1 }
    };

    e.dataTransfer.setData('application/json', JSON.stringify(panel));
    e.dataTransfer.effectAllowed = 'copy';
  };

  // Enable dragging from recent video thumbnails
  const handleThumbDragStart = (e: React.DragEvent<HTMLVideoElement>, url: string) => {
    if (!url) return;
    const panel: Panel = {
      id: nanoid(),
      type: 'video' as const,
      url,
      caption: '',
      size: 'medium' as const,
      aspectRatio: 1,
      position: { row: 0, col: 0, rowSpan: 1, colSpan: 1 }
    };
    e.dataTransfer.setData('application/json', JSON.stringify(panel));
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleVideoDownload = async (url: string, suggestedName: string) => {
    let blobUrl: string | null = null;
    try {
      const proxyUrl = `/api/download-image?url=${encodeURIComponent(url)}`;
      const response = await fetch(proxyUrl);
      if (!response.ok) throw new Error('Failed to download');
      const blob = await response.blob();
      blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `video-${(suggestedName || 'download').slice(0, 40)}.mp4`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('Video download failed:', err);
      setError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      if (blobUrl) window.URL.revokeObjectURL(blobUrl);
    }
  };

  return (
    <div className="p-6 border-b border-gray-200 dark:border-gray-700">
      {/* Remove the entire header with "Image to Video" text and icon */}
      
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-300 mb-3">Select Model</label>
        <div className="grid grid-cols-3 gap-2">
          {imageToVideoModels.map((modelOption) => {
            // Get info for the current model value, provide default if not found
            const info = modelInfo[modelOption.value as keyof typeof modelInfo] || {
              name: modelOption.label,
              description: 'N/A'
            };
            
            const isSelected = selectedModel === modelOption.value;
            
            return (
              <button
                key={modelOption.value}
                onClick={() => setSelectedModel(modelOption.value)}
                className={`p-2 rounded-lg border transition-all ${
                  isSelected
                    ? 'bg-purple-600 border-purple-500 text-white' 
                    : 'bg-gray-700 border-gray-600 hover:border-gray-500 text-gray-300'
                }`}
              >
                <div className="flex flex-col items-center text-center">
                  <span className={`text-xs font-medium ${isSelected ? 'text-white' : 'text-gray-300'}`}>
                    {info.name}
                  </span>
                  <span className={`text-[10px] mt-0.5 ${isSelected ? 'text-purple-200' : 'text-gray-400'}`}>
                    {info.description}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      </div>
      
      <div className="mb-4">
        <div 
          className="border-2 border-dashed border-gray-600 rounded-lg p-4 text-center"
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
        >
          {image ? (
            <div className="relative">
              <img
                src={URL.createObjectURL(image)}
                alt="Uploaded"
                className="max-w-full h-auto mx-auto"
              />
              <button 
                onClick={(e) => {
                  e.preventDefault();
                  setImage(null);
                }}
                className="absolute top-2 right-2 bg-red-500 text-white p-1 rounded-full"
              >
                ×
              </button>
            </div>
          ) : (
            <div className="py-8">
              <input
                type="file"
                accept="image/*"
                onChange={handleFileSelect}
                className="hidden"
                id="image-input"
              />
              <label htmlFor="image-input" className="cursor-pointer">
                <Upload className="mx-auto h-12 w-12 text-gray-400" />
                <p className="mt-2 text-sm text-gray-400">
                  Drop or click to upload image
                </p>
              </label>
            </div>
          )}
        </div>
      </div>

      {/* Higgsfield Motion Presets */}
      {selectedModel === 'higgsfield-dop' && (
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-300 mb-1">Motion Preset</label>
          <input
            type="text"
            value={higgsMotionQuery}
            onFocus={async () => {
              if (!higgsMotionsLoaded) {
                try {
                  const res = await fetch('/api/higgsfield/motions');
                  const list = await res.json();
                  if (Array.isArray(list)) setHiggsMotions(list);
                  setHiggsMotionsLoaded(true);
                } catch { setHiggsMotionsLoaded(true); }
              }
            }}
            onChange={async e => {
              const v = e.target.value;
              setHiggsMotionQuery(v);
              if (!higgsMotionsLoaded) {
                try {
                  const res = await fetch('/api/higgsfield/motions');
                  const list = await res.json();
                  if (Array.isArray(list)) setHiggsMotions(list);
                } catch {}
                setHiggsMotionsLoaded(true);
              }
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                const first = filteredMotions[0];
                if (first) setHiggsMotionId(first.id);
              }
            }}
            placeholder="Search motions by name or description (or paste an ID)"
            className="w-full p-2 border rounded-md text-white bg-gray-700 border-gray-600 placeholder-gray-400"
          />
          {!higgsMotionsLoaded ? (
            <button
              onClick={async () => {
                try {
                  const res = await fetch('/api/higgsfield/motions');
                  const list = await res.json();
                  if (Array.isArray(list)) setHiggsMotions(list);
                } catch {}
                setHiggsMotionsLoaded(true);
              }}
              className="mt-2 px-3 py-1.5 text-xs rounded-md border bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700"
            >
              Load Motion Presets
            </button>
          ) : (
            <div className="relative">
              <div className="flex items-stretch gap-2 overflow-x-auto pb-2 snap-x snap-mandatory">
                {(filteredMotions.length ? filteredMotions : higgsMotions).map(m => (
                  <button
                    key={m.id}
                    title={m.description || m.name}
                    onClick={() => setHiggsMotionId(m.id)}
                    className={`min-w-[200px] snap-start p-2 rounded-md border text-left ${higgsMotionId === m.id ? 'border-purple-500 bg-purple-600/20 text-purple-100' : 'border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700'}`}
                  >
                    {m.preview_url ? (
                      <img src={m.preview_url} alt={m.name} className="w-full h-28 object-cover rounded mb-2" loading="lazy" />
                    ) : (
                      <div className="w-full h-28 rounded bg-gray-700 mb-2" />
                    )}
                    <div className="text-sm font-medium truncate">{m.name}</div>
                    {m.description && (
                      <div className="text-[11px] opacity-70 line-clamp-2">{m.description}</div>
                    )}
                  </button>
                ))}
              </div>
              {filteredMotions.length === 0 && higgsMotionQuery.trim() && (
                <div className="text-xs text-gray-400 mt-1">No motions match "{higgsMotionQuery}"</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Remove ad-hoc featured presets; full catalog above covers all */}

      {/* Remove collapsible manual catalog; superseded by fetched list */}
      
      <div className="mb-4">
        <div className="relative">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Enter your prompt (optional)..."
          className="w-full p-2 border rounded-md resize-none focus:ring-2 focus:ring-purple-500 text-white bg-gray-700 border-gray-600 placeholder-gray-400"
          rows={4}
        />
          {/* Character count display for models with limits */}
          {(selectedModel === 'hailuo-02-pro' || selectedModel === 'vidu-image') && (
            <div className="absolute bottom-2 right-2 text-xs text-gray-400 bg-gray-700 px-2 py-1 rounded">
              {prompt.length}/{selectedModel === 'hailuo-02-pro' ? '2000' : '1500'}
            </div>
          )}
        </div>
        {/* Warning message if prompt is too long */}
        {selectedModel === 'hailuo-02-pro' && prompt.length > 2000 && (
          <div className="text-red-500 text-xs mt-1">
            Prompt too long. Hailuo accepts maximum 2000 characters.
          </div>
        )}
        {selectedModel === 'vidu-image' && prompt.length > 1500 && (
          <div className="text-red-500 text-xs mt-1">
            Prompt too long. Vidu accepts maximum 1500 characters.
          </div>
        )}
      </div>
      
      <button
        onClick={handleGenerate}
        disabled={
          isGenerating || 
          (selectedModel === 'hailuo-02-pro' && prompt.length > 2000) ||
          (selectedModel === 'vidu-image' && prompt.length > 1500)
        }
        className="w-full py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isGenerating ? 'Generating Video...' : 'Generate Video'}
      </button>

      {error && (
        <div className="text-red-500 text-sm">{error}</div>
      )}

      {/* WAN i2v controls */}
      {selectedModel === 'wan-i2v' && (
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-300 mb-1">Resolution</label>
          <select
            value={wanResolution}
            onChange={e => setWanResolution(e.target.value as '480p' | '580p' | '720p')}
            className="w-full p-2 border rounded-md text-white bg-gray-700 border-gray-600"
          >
            <option value="480p">480p</option>
            <option value="580p">580p</option>
            <option value="720p">720p</option>
          </select>
        </div>
      )}

      {/* Veo 3.1 i2v controls */}
      {selectedModel === 'veo31-image' && (
        <div className="mt-4 mb-2">
          <div className="text-xs text-gray-400 mb-2">Veo 3.1 Fast - 8 seconds, natural motion</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Resolution</label>
              <select
                value={veo31Resolution}
                onChange={e => setVeo31Resolution(e.target.value as '720p' | '1080p')}
                className="w-full p-2 border rounded-md text-white bg-gray-700 border-gray-600"
              >
                <option value="720p">720p (HD)</option>
                <option value="1080p">1080p (Full HD)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Aspect Ratio</label>
              <select
                value={veo31AspectRatio}
                onChange={e => setVeo31AspectRatio(e.target.value as 'auto' | '9:16' | '16:9' | '1:1')}
                className="w-full p-2 border rounded-md text-white bg-gray-700 border-gray-600"
              >
                <option value="auto">Auto</option>
                <option value="16:9">16:9 (Landscape)</option>
                <option value="9:16">9:16 (Portrait)</option>
                <option value="1:1">1:1 (Square)</option>
              </select>
            </div>
          </div>
          <div className="mt-3">
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input 
                type="checkbox" 
                checked={veo31GenerateAudio} 
                onChange={(e) => setVeo31GenerateAudio(e.target.checked)} 
                className="rounded border-gray-600 bg-gray-700 text-purple-600 focus:ring-purple-500"
              />
              Generate Audio (disable to save 33% credits)
            </label>
          </div>
          <div className="mt-2 text-[11px] text-gray-500">
            Prompt tip: Describe how to animate the image (action, style, camera motion, ambiance)
          </div>
        </div>
      )}

      {/* Sora 2 i2v controls */}
      {selectedModel === 'sora2-i2v' && (
        <div className="mt-4 mb-2">
          <div className="text-xs text-gray-400 mb-2">Sora 2 Options</div>
          <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Duration</label>
            <select
              value={soraDuration}
              onChange={e => setSoraDuration(Number(e.target.value) as 4 | 8 | 12)}
              className="w-full p-2 border rounded-md text-white bg-gray-700 border-gray-600"
            >
              <option value={4}>4 seconds</option>
              <option value={8}>8 seconds</option>
              <option value={12}>12 seconds</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Resolution</label>
            <select
              value={soraResolution}
              onChange={e => setSoraResolution(e.target.value as 'auto' | '720p' | '1080p')}
              className="w-full p-2 border rounded-md text-white bg-gray-700 border-gray-600"
            >
              <option value="auto">Auto</option>
              <option value="720p">720p</option>
              <option value="1080p">1080p</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Aspect Ratio</label>
            <select
              value={soraAspectRatio}
              onChange={e => setSoraAspectRatio(e.target.value as 'auto' | '16:9' | '9:16')}
              className="w-full p-2 border rounded-md text-white bg-gray-700 border-gray-600"
            >
              <option value="auto">Auto</option>
              <option value="16:9">16:9</option>
              <option value="9:16">9:16</option>
            </select>
          </div>
          </div>
          <div className="mt-2 text-[11px] text-gray-500">Tip: Higher resolution and longer duration increases queue time.</div>
        </div>
      )}

      {/* Marey i2v controls */}
      {selectedModel === 'marey-i2v' && (
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Duration</label>
            <select
              value={mareyDuration}
              onChange={e => setMareyDuration(e.target.value as '5s' | '10s')}
              className="w-full p-2 border rounded-md text-white bg-gray-700 border-gray-600"
            >
              <option value="5s">5 seconds</option>
              <option value="10s">10 seconds</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Aspect Ratio</label>
            <select
              value={mareyAspect}
              onChange={e => setMareyAspect(e.target.value as any)}
              className="w-full p-2 border rounded-md text-white bg-gray-700 border-gray-600"
            >
              <option value="1920x1080">1920x1080</option>
              <option value="1080x1920">1080x1920</option>
              <option value="1152x1152">1152x1152</option>
              <option value="1536x1152">1536x1152</option>
              <option value="1152x1536">1152x1536</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-300 mb-1">Negative Prompt</label>
            <input
              type="text"
              value={mareyNegative}
              onChange={e => setMareyNegative(e.target.value)}
              placeholder="Words to avoid..."
              className="w-full p-2 border rounded-md text-white bg-gray-700 border-gray-600"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Seed</label>
            <input
              type="number"
              value={typeof mareySeed === 'number' ? mareySeed : ''}
              onChange={e => setMareySeed(e.target.value === '' ? undefined : Number(e.target.value))}
              placeholder="-1 for random"
              className="w-full p-2 border rounded-md text-white bg-gray-700 border-gray-600"
            />
          </div>
        </div>
      )}

      {isGenerating && !error && (
        <div className="text-gray-400 text-sm text-center animate-pulse">
          Video generation is in progress. Please wait 3-5 minutes for the best results.
        </div>
      )}

      {videoUrl && (
        <div className="video-output mt-4 relative">
          <button 
            onClick={() => setVideoUrl(null)} 
            className="absolute -top-2 -right-2 bg-red-500 text-white p-1 rounded-full shadow-md z-10 hover:bg-red-600 transition-colors"
            title="Remove video"
            aria-label="Remove video"
          >
            <X size={14} />
          </button>
          <video 
            src={videoUrl} 
            controls 
            autoPlay
            loop
            muted
            playsInline
            onLoadedData={(e)=>{try{e.currentTarget.currentTime=0;}catch{}}}
            onEnded={(e)=>{try{e.currentTarget.currentTime=0;e.currentTarget.play();}catch{}}}
            draggable="true"
            onClick={handleVideoClick}
            onDragStart={handleDragStart}
            className="w-full rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
          />
          <p className="text-sm text-gray-400 mt-2">
            Click to add to first empty panel, or drag to any panel
          </p>
        </div>
      )}

      {/* Recent Image-to-Video Generations */}
      <div className="mt-6">
        <button
          onClick={() => setShowRecentImageVideos(v => !v)}
          className="w-full flex items-center justify-between px-2 py-2 text-xs font-medium bg-gray-800 rounded-md border border-gray-700 hover:bg-gray-700"
        >
          <span>Recent Video Generations (Image-to-Video)</span>
          <Film className={`h-4 w-4 ${showRecentImageVideos ? 'text-purple-300' : 'text-gray-400'}`} />
        </button>
        {showRecentImageVideos && (
          <div className="mt-3 grid grid-cols-3 sm:grid-cols-4 gap-2">
            {recentImageVideos.length === 0 ? (
              <div className="text-gray-500 text-xs italic col-span-full">No recent videos yet.</div>
            ) : (
              recentImageVideos.map((v, idx) => (
                <div
                  key={`${v.url}-${idx}`}
                  className="relative group cursor-pointer"
                  onMouseEnter={() => setHoveredIndex(idx)}
                  onMouseLeave={() => setHoveredIndex(null)}
                >
                  <video
                    src={v.url}
                    muted
                    playsInline
                    loop
                    draggable
                    onDragStart={(e) => handleThumbDragStart(e, v.url)}
                    className="w-full h-24 object-cover rounded-lg bg-black"
                  />

                  {hoveredIndex === idx && (
                    <div className="absolute z-50 w-72 p-3 text-sm bg-purple-600 text-white rounded shadow-lg left-0 bottom-full mb-2">
                      <div className="mb-2">
                        <p className="font-semibold">Prompt:</p>
                        <div className={expandedPrompt === idx ? 'max-h-40 overflow-y-auto pr-1 text-xs' : 'text-xs'}>
                          {expandedPrompt === idx
                            ? v.prompt
                            : (v.prompt.length > 50
                                ? v.prompt.substring(0, 50) + '...'
                                : v.prompt)}
                        </div>
                        {v.prompt.length > 50 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedPrompt(expandedPrompt === idx ? null : idx);
                            }}
                            className="text-xs text-purple-200 hover:text-white mt-1"
                          >
                            {expandedPrompt === idx ? 'Show less' : 'Show more'}
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-purple-200">Model: {v.model}</p>
                      <p className="text-xs opacity-90">Created: {new Date(v.timestamp as any).toLocaleString()}</p>
                      <div className="mt-2 flex justify-between items-center">
                        <div className="flex gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard.writeText(v.prompt);
                            }}
                            className="text-xs bg-purple-700 hover:bg-purple-800 text-white px-2 py-1 rounded flex items-center gap-1"
                            title="Copy prompt to clipboard"
                          >
                            <Copy size={12} />
                            Copy
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleVideoDownload(v.url, v.prompt); }}
                            className="text-xs bg-purple-700 hover:bg-purple-800 text-white px-2 py-1 rounded flex items-center gap-1"
                            title="Download video"
                          >
                            <Download size={12} />
                            Download
                          </button>
                        </div>
                        <p className="text-[10px] opacity-90">Hover to preview</p>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Seedance-specific options */}
      {selectedModel === 'seedance' && (
        <div className="mb-4 grid grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Duration</label>
            <select
              value={seedanceDuration}
              onChange={e => setSeedanceDuration(e.target.value as '5' | '10')}
              className="w-full p-2 border rounded-md text-white bg-gray-700 border-gray-600"
            >
              <option value="5">5 seconds</option>
              <option value="10">10 seconds</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Resolution</label>
            <select
              value={seedanceResolution}
              onChange={e => setSeedanceResolution(e.target.value as '480p' | '720p')}
              className="w-full p-2 border rounded-md text-white bg-gray-700 border-gray-600"
            >
              <option value="480p">480p</option>
              <option value="720p">720p</option>
            </select>
          </div>
          <div className="flex items-center mt-6">
            <input
              type="checkbox"
              checked={seedanceCameraFixed}
              onChange={e => setSeedanceCameraFixed(e.target.checked)}
              className="form-checkbox h-4 w-4 text-teal-600 mr-2"
              id="seedance-camera-fixed"
            />
            <label htmlFor="seedance-camera-fixed" className="text-sm text-gray-300">Fixed Camera</label>
          </div>
        </div>
      )}

      {/* Vidu-specific options */}
      {selectedModel === 'vidu-image' && (
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-300 mb-1">Movement Amplitude</label>
          <select
            value={viduMovement}
            onChange={e => setViduMovement(e.target.value as any)}
            className="w-full p-2 border rounded-md text-white bg-gray-700 border-gray-600"
          >
            <option value="auto">Auto</option>
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
          </select>
        </div>
      )}
    </div>
  );
}; 