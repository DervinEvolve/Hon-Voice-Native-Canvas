import { accessHeaders } from '../../services/apiAccess';
import React, { useState, useCallback, useEffect } from 'react';
import { textToVideoService, VideoModel } from '../../services/textToVideoService';
import { X, Sparkles, Wand2, Bolt, Film, Check, Lightbulb, AlignJustify, Camera, Zap, ChevronDown, Download, Cpu, Volume2, VolumeX, Image as ImageIcon, Copy } from 'lucide-react';
import { Panel, Comic } from '../../types';
import { nanoid } from 'nanoid';
import { useComicStore } from '../../store/useComicStore';
import { recentGenerationsService } from '../../services/recentGenerationsService';
import { useWallet } from '@solana/wallet-adapter-react';

interface TextToVideoProps {
  onGenerateStory: (prompt: string, generatedUrl: string, type: 'image' | 'video' | 'gif', panel?: Panel) => Promise<void>;
}

export const TextToVideo: React.FC<TextToVideoProps> = ({ onGenerateStory }) => {
  const { currentComic, currentPageIndex, updatePanel } = useComicStore();
  const { publicKey } = useWallet();
  const [prompt, setPrompt] = useState('');
  const [optimizedPrompt, setOptimizedPrompt] = useState('');
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizationProgress, setOptimizationProgress] = useState('');
  const [showOptimizedPrompt, setShowOptimizedPrompt] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<VideoModel>('pika');
  const [promptCategory, setPromptCategory] = useState<'cinematic' | 'animated' | 'realistic'>('cinematic');
  const [negativePrompt, setNegativePrompt] = useState('blur, low quality, distorted faces');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [duration, setDuration] = useState(5);
  const [quality, setQuality] = useState<'standard' | 'high'>('high');
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16' | '1:1' | '4:3' | '9:21'>('16:9');
  // WAN advanced controls
  const [wanFps, setWanFps] = useState<16 | 24 | 30>(24);
  const [wanNumFrames, setWanNumFrames] = useState<49 | 81 | 121>(81);
  const [wanResolution, setWanResolution] = useState<'720p' | '1080p'>('720p');
  const [generationProgress, setGenerationProgress] = useState<string>('');
  const [timeoutSeconds, setTimeoutSeconds] = useState(600);
  const [cameraFixed, setCameraFixed] = useState(false);
  const [enhancePrompt, setEnhancePrompt] = useState(true);
  const [generateAudio, setGenerateAudio] = useState(true);
  const [viduStyle, setViduStyle] = useState<'general' | 'anime'>('general');
  const [viduMovement, setViduMovement] = useState<'auto' | 'small' | 'medium' | 'large'>('auto');

  // Recent video generations (Text-to-Video)
  interface RecentVideoGen { url: string; prompt: string; timestamp: Date; model: string }
  const [recentTextVideos, setRecentTextVideos] = useState<RecentVideoGen[]>([]);
  const [showRecentTextVideos, setShowRecentTextVideos] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [expandedPrompt, setExpandedPrompt] = useState<number | null>(null);

  // Set duration to 8 seconds when Veo 3.1 is selected
  useEffect(() => {
    if (selectedModel === 'veo31-fast') {
      setDuration(8);
    }
  }, [selectedModel]);

  // Load recent text-to-video generations from Supabase
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
          .filter(r => r.type === 'video' && r.metadata?.source === 'text_to_video')
          .map(r => ({ url: r.url, prompt: r.prompt, timestamp: r.timestamp, model: r.model }));
        setRecentTextVideos(filtered);
      } catch (e) {
        console.warn('Failed to load recent text-to-video generations');
      }
    })();
  }, [publicKey]);

  // Model display information
  const modelInfo = {
    pika: {
      name: 'Pika v2.2',
      description: 'High quality cinematic videos',
      color: 'from-purple-500 via-violet-500 to-purple-600',
      icon: <Sparkles className="h-4 w-4 text-white" />
    },
    luma: {
      name: 'Ray 2 Flash',
      description: 'AI motion animation',
      color: 'from-cyan-400 to-blue-600',
      icon: <Camera className="h-4 w-4 text-white" />
    },
    'veo31-fast': {
      name: 'Veo 3.1 Fast',
      description: 'Google\'s latest - 4-8s, 720p/1080p, audio',
      color: 'from-green-400 to-blue-500',
      icon: <Volume2 className="h-4 w-4 text-white" />
    },
    vidu: {
      name: 'Vidu Q1',
      description: 'High Quality 1080p',
      color: 'from-pink-500 to-rose-500',
      icon: <ImageIcon className="h-4 w-4 text-white" />
    },
    'hailuo-02-pro': {
      name: 'Hailuo 02 Pro',
      description: '1080p Text to Video',
      color: 'from-blue-500 to-indigo-600',
      icon: <Cpu className="h-4 w-4 text-white" />
    },
    'kling-2.5-pro': {
      name: 'Kling 2.5 Turbo Pro',
      description: 'Top-tier T2V (Pro)',
      color: 'from-amber-500 to-orange-600',
      icon: <Zap className="h-4 w-4 text-white" />
    },
    seedance: {
      name: 'Seedance 1.0 Lite',
      description: 'Fast, efficient text-to-video',
      color: 'from-green-400 to-teal-600',
      icon: <Film className="h-4 w-4 text-white" />
    },
    wan: {
      name: 'WAN 2.2',
      description: 'Fast Bytedance T2V',
      color: 'from-fuchsia-500 to-purple-600',
      icon: <Film className="h-4 w-4 text-white" />
    },
    marey: {
      name: 'Marey',
      description: 'Realistic motion, T2V',
      color: 'from-sky-500 to-blue-700',
      icon: <Film className="h-4 w-4 text-white" />
    },
    'sora2-t2v': {
      name: 'Sora 2 Pro',
      description: 'Premium text-to-video',
      color: 'from-purple-500 to-fuchsia-600',
      icon: <Film className="h-4 w-4 text-white" />
    }
  };

  const handleOptimizePrompt = async () => {
    if (!prompt.trim()) {
      setError('Please enter a prompt to optimize');
      return;
    }

    setError(null);
    setIsOptimizing(true);
    setOptimizationProgress('');

    try {
      const result = await textToVideoService.optimizePrompt({
        prompt: prompt.trim(),
        category: promptCategory,
        onProgress: (progress) => {
          setOptimizationProgress(progress);
        }
      });

      setOptimizedPrompt(result);
      setShowOptimizedPrompt(true);
    } catch (err) {
      console.error('Prompt optimization error:', err);
      setError(`Prompt optimization failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setError('Please enter a prompt');
      return;
    }

    setError(null);
    setIsGenerating(true);
    setGenerationProgress('');
    setVideoUrl(null);

    try {
      const videoUrl = await textToVideoService.generateVideo({
        prompt: optimizedPrompt || prompt,
        negativePrompt: negativePrompt,
        model: selectedModel,
        duration: duration,
        aspectRatio: aspectRatio,
        quality: quality,
        seed: undefined,
        timeoutSeconds,
        onProgress: (progress) => {
          setGenerationProgress(progress);
        },
        ...(selectedModel === 'seedance' ? { cameraFixed } : {}),
        ...(selectedModel === 'veo31-fast' ? { enhance_prompt: enhancePrompt, generate_audio: generateAudio } : {}),
        ...(selectedModel === 'vidu' ? { style: viduStyle, movement_amplitude: viduMovement } : {}),
        ...(selectedModel === 'wan' ? { wanFps, wanNumFrames, wanResolution } as any : {})
      });

      setVideoUrl(videoUrl);
      onGenerateStory?.(optimizedPrompt || prompt, videoUrl, 'video');

      // Persist recent generation (user and/or wallet)
      const base = { type: 'video' as const, url: videoUrl, prompt: optimizedPrompt || prompt, model: selectedModel };
      try { await recentGenerationsService.saveForCurrentUser({ ...base, metadata: { source: 'text_to_video', model: selectedModel, duration, aspectRatio } }); } catch {}
      try { if (publicKey) await recentGenerationsService.saveForWalletAddress(publicKey.toBase58(), { ...base, metadata: { source: 'text_to_video', model: selectedModel, duration, aspectRatio } }); } catch {}
      setRecentTextVideos(prev => [{ url: videoUrl, prompt: optimizedPrompt || prompt, timestamp: new Date(), model: selectedModel }, ...prev.filter(v => v.url !== videoUrl)]);
    } catch (err) {
      console.error('Video generation error:', err);
      
      // Provide more helpful error messages based on the model
      let errorMessage = err instanceof Error ? err.message : 'Unknown error';
      
      if (errorMessage.includes('No video URL in response') && selectedModel === 'luma') {
        errorMessage = 'Luma model failed to generate a video. Try using a different model or prompt.';
      } else if (errorMessage.includes('No video URL')) {
        errorMessage = `${selectedModel.charAt(0).toUpperCase() + selectedModel.slice(1)} model failed to generate a video. Try a different model or prompt.`;
      }
      
      setError(errorMessage);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleVideoClick = () => {
    if (!videoUrl || !currentComic || typeof currentPageIndex === 'undefined') return;

    const comic = currentComic as Comic;
    if (comic.pages && Array.isArray(comic.pages[currentPageIndex])) {
      const pages = comic.pages[currentPageIndex] || [];
      const emptyPanelIndex = pages.findIndex((panel: Panel) => !panel || !panel.url);
      
      if (emptyPanelIndex !== -1) {
        const panel: Panel = {
          id: nanoid(),
          type: 'video' as const,
          url: videoUrl,
          size: 'medium' as 'small' | 'medium' | 'large',
          aspectRatio: 1,
          position: {
            row: 0,
            col: 0,
            rowSpan: 1,
            colSpan: 1
          }
        };
        updatePanel(panel, currentPageIndex);
      }
    }
  };

  const handleDragStart = (e: React.DragEvent<HTMLVideoElement>) => {
    if (!videoUrl) return;

    const panel: Panel = {
      id: nanoid(),
      type: 'video' as const,
      url: videoUrl,
      size: 'medium' as 'small' | 'medium' | 'large',
      aspectRatio: 1,
      position: {
        row: 0,
        col: 0,
        rowSpan: 1,
        colSpan: 1
      }
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
      const response = await fetch(proxyUrl, { headers: await accessHeaders() });
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
    <div className="border-b border-gray-200 dark:border-gray-700 pb-6 relative">
      {/* Remove the entire header with "Chapters" text and icon */}
      
      <div className="mb-4">
        <div className="flex items-center">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe your video scene..."
            className="w-full p-2 border rounded-md resize-none focus:ring-2 focus:ring-purple-500 text-white bg-gray-700 border-gray-600 placeholder-gray-400"
            rows={showOptimizedPrompt ? 2 : 4}
          />
        </div>
        
        {/* Character Count and Validation */}
        {(selectedModel === 'hailuo-02-pro' || selectedModel === 'vidu') && (
          <div className="mt-1 text-xs">
            <div className={`flex justify-between ${
              (selectedModel === 'hailuo-02-pro' && prompt.length > 2000) || 
              (selectedModel === 'vidu' && prompt.length > 1500)
                ? 'text-red-600 dark:text-red-400' 
                : 'text-gray-500 dark:text-gray-400'
            }`}>
              <span>
                {selectedModel === 'hailuo-02-pro' && prompt.length > 2000 && '⚠️ Prompt too long! '}
                {selectedModel === 'vidu' && prompt.length > 1500 && '⚠️ Prompt too long! '}
                Character count: {prompt.length}
              </span>
              <span>
                Limit: {selectedModel === 'hailuo-02-pro' ? '2000' : '1500'}
              </span>
            </div>
          </div>
        )}
        
        {/* Prompt Optimization Controls */}
        <div className="flex mt-2 justify-between">
          <div className="flex space-x-2">
            <button
              onClick={handleOptimizePrompt}
              disabled={isOptimizing || !prompt.trim()}
              className="px-3 py-1 bg-gradient-to-r from-fuchsia-500 to-purple-600 text-white rounded flex items-center gap-1 text-xs hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              title="AI will enhance your prompt for better video results"
            >
              {isOptimizing ? (
                <>
                  <div className="animate-spin h-3 w-3 border-2 border-white border-t-transparent rounded-full mr-1"></div>
                  Optimizing...
                </>
              ) : (
                <>
                  <Wand2 className="h-3 w-3 mr-1" />
                  Optimize Prompt
                </>
              )}
            </button>
            <select
              value={promptCategory}
              onChange={(e) => setPromptCategory(e.target.value as any)}
              className="text-xs p-1 border rounded text-white bg-gray-700 border-gray-600"
            >
              <option value="cinematic">Cinematic</option>
              <option value="animated">Animated</option>
              <option value="realistic">Realistic</option>
            </select>
          </div>
          
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="px-2 py-1 text-xs text-gray-300 hover:bg-gray-700 rounded"
          >
            {showAdvanced ? 'Hide Options' : 'Advanced'}
          </button>
        </div>
        
        {isOptimizing && optimizationProgress && (
          <div className="mt-2 text-sm text-indigo-600 dark:text-indigo-400">
            <div className="animate-pulse">{optimizationProgress}</div>
          </div>
        )}
        
        {error && error.includes('prompt optimization') && (
          <div className="mt-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 p-2 rounded">
            <div className="flex items-start">
              <Lightbulb className="h-3 w-3 mr-1 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          </div>
        )}
        
        {/* Optimized Prompt Display */}
        {showOptimizedPrompt && optimizedPrompt && (
          <div className="mt-4 relative border border-indigo-700 bg-indigo-900/20 rounded-md p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center text-xs text-indigo-400 font-medium">
                <Sparkles className="h-3.5 w-3.5 mr-1" />
                <span>AI Optimized Prompt</span>
              </div>
              <div className="flex space-x-1">
                <button
                  onClick={() => {
                    setPrompt(optimizedPrompt);
                    setShowOptimizedPrompt(false);
                  }}
                  className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-2 py-0.5 rounded flex items-center"
                  title="Replace your original prompt with this optimized version"
                >
                  <Check size={12} className="mr-1" />
                  Use this prompt
                </button>
                <button
                  onClick={() => setShowOptimizedPrompt(false)}
                  className="text-gray-400 hover:text-gray-200"
                  title="Discard optimized prompt"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
            <div className="relative">
              <textarea
                value={optimizedPrompt}
                onChange={(e) => setOptimizedPrompt(e.target.value)}
                className="w-full p-2 border rounded-md text-white bg-gray-800 border-gray-600"
                rows={3}
              />
            </div>
          </div>
        )}
      </div>
      
      {/* Model Selection */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-300 mb-2">Select Model</label>
        <div className="grid grid-cols-3 gap-2">
          {(['pika', 'luma', 'kling-2.5-pro', 'seedance', 'hailuo-02-pro', 'veo31-fast', 'vidu', 'wan', 'marey', 'sora2-t2v'] as (VideoModel | 'wan' | 'marey' | 'sora2-t2v')[]).map((model) => (
            <button
              key={model}
              onClick={() => setSelectedModel(model)}
              className={`p-2 rounded-lg border transition-all ${
                selectedModel === model ? 
                'bg-purple-600 border-purple-500 text-white' : 
                'bg-gray-700 border-gray-600 hover:border-gray-500 text-gray-300'
              }`}
            >
              <div className="flex flex-col items-center text-center">
                <span className={`text-xs font-medium ${selectedModel === model ? 'text-white' : 'text-gray-300'}`}>
                  {modelInfo[model] ? modelInfo[model].name : model}
                </span>
                <span className={`text-[10px] mt-0.5 ${selectedModel === model ? 'text-purple-200' : 'text-gray-400'}`}>
                  {modelInfo[model] ? modelInfo[model].description : ''}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Vidu specific options */}
      {selectedModel === 'vidu' && (
        <div className="p-3 bg-gray-800 rounded-md mb-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Style</label>
            <select
              value={viduStyle}
              onChange={(e) => setViduStyle(e.target.value as any)}
              className="w-full px-3 py-2 border rounded-md text-white bg-gray-700 border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              <option value="general">General</option>
              <option value="anime">Anime</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Movement Amplitude</label>
            <select
              value={viduMovement}
              onChange={(e) => setViduMovement(e.target.value as any)}
              className="w-full px-3 py-2 border rounded-md text-white bg-gray-700 border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              <option value="auto">Auto</option>
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </select>
          </div>
        </div>
      )}

      {/* Veo 3.1 Fast specific options */}
      {selectedModel === 'veo31-fast' && (
        <div className="p-3 bg-gray-800 rounded-md mb-4 space-y-3">
          <div className="text-xs font-medium text-gray-300 mb-2">Veo 3.1 Fast Options</div>
          
          {/* Duration and Resolution */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Duration</label>
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="w-full p-1.5 text-xs border rounded-md text-white bg-gray-700 border-gray-600"
              >
                <option value={4}>4 seconds</option>
                <option value={6}>6 seconds</option>
                <option value={8}>8 seconds</option>
              </select>
            </div>
            
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Resolution</label>
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value as 'standard' | 'high')}
                className="w-full p-1.5 text-xs border rounded-md text-white bg-gray-700 border-gray-600"
              >
                <option value="standard">720p (HD)</option>
                <option value="high">1080p (Full HD)</option>
              </select>
            </div>
          </div>
          
          {/* Checkboxes */}
          <div className="space-y-2">
            <div className="flex items-center">
              <input
                type="checkbox"
                id="enhance-prompt-veo3"
                checked={enhancePrompt}
                onChange={(e) => setEnhancePrompt(e.target.checked)}
                className="h-4 w-4 text-purple-600 rounded border-gray-300 focus:ring-purple-500"
              />
              <label htmlFor="enhance-prompt-veo3" className="ml-2 block text-sm text-gray-300">
                Enhance Prompt
              </label>
            </div>
            <div className="flex items-center">
              <input
                type="checkbox"
                id="generate-audio-veo3"
                checked={generateAudio}
                onChange={(e) => setGenerateAudio(e.target.checked)}
                className="h-4 w-4 text-purple-600 rounded border-gray-300 focus:ring-purple-500"
              />
              <label htmlFor="generate-audio-veo3" className="ml-2 block text-sm text-gray-300">
                Generate Audio (disable to save 33% credits)
              </label>
            </div>
          </div>
          
          <div className="text-xs text-gray-500 mt-2">
            Tip: Describe subject, action, style, and camera motion for best results
          </div>
        </div>
      )}
      
      {/* Advanced Settings */}
      {showAdvanced && (
        <div className="mb-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Negative Prompt</label>
            <input
              type="text"
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              placeholder="Things to avoid in the video..."
              className="w-full p-2 border rounded-md text-white bg-gray-700 border-gray-600 placeholder-gray-400 text-sm"
            />
          </div>
          
          <div className="grid grid-cols-2 gap-3">
            <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Duration</label>
            <select
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="w-full p-2 border rounded-md text-white bg-gray-700 border-gray-600 text-sm"
            >
              {selectedModel === 'veo31-fast' ? (
                <>
                  <option value={4}>4 seconds</option>
                  <option value={6}>6 seconds</option>
                  <option value={8}>8 seconds</option>
                </>
              ) : (
                <>
                  <option value={3} disabled={selectedModel === 'seedance'}>3 seconds</option>
                  <option value={4}>4 seconds</option>
                  <option value={5}>5 seconds</option>
                  <option value={8} disabled={selectedModel === 'seedance'}>8 seconds</option>
                  <option value={10}>10 seconds</option>
                  <option value={12}>12 seconds</option>
                </>
              )}
            </select>
            </div>
            
            <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Quality</label>
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value as 'standard' | 'high')}
              className="w-full p-2 border rounded-md text-white bg-gray-700 border-gray-600 text-sm"
            >
              <option value="standard">Standard (480p/720p)</option>
              <option value="high">High (1080p)</option>
            </select>
            </div>
            
            <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Aspect Ratio</label>
            <select
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value as '16:9' | '9:16' | '1:1' | '4:3' | '9:21')}
              className="w-full p-2 border rounded-md text-white bg-gray-700 border-gray-600 text-sm"
            >
              <option value="16:9">Landscape (16:9)</option>
              <option value="9:16">Portrait (9:16)</option>
              <option value="1:1">Square (1:1)</option>
              <option value="4:3" disabled={selectedModel !== 'seedance'}>Classic (4:3)</option>
              <option value="9:21" disabled={selectedModel !== 'seedance'}>Vertical Ultra (9:21)</option>
            </select>
            </div>
            
            <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Timeout</label>
              <select
                value={timeoutSeconds}
                onChange={(e) => setTimeoutSeconds(Number(e.target.value))}
                className="w-full p-2 border rounded-md text-white bg-gray-700 border-gray-600 text-sm"
              >
              <option value={600}>10 minutes</option>
              <option value={900}>15 minutes</option>
              <option value={1200}>20 minutes</option>
              </select>
            </div>
            {selectedModel === 'wan' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">WAN FPS</label>
                  <select
                    value={wanFps}
                    onChange={e => setWanFps(Number(e.target.value) as 16 | 24 | 30)}
                    className="w-full p-2 border rounded-md text-white bg-gray-700 border-gray-600 text-sm"
                  >
                    <option value={16}>16 fps</option>
                    <option value={24}>24 fps</option>
                    <option value={30}>30 fps</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">WAN Frames</label>
                  <select
                    value={wanNumFrames}
                    onChange={e => setWanNumFrames(Number(e.target.value) as 49 | 81 | 121)}
                    className="w-full p-2 border rounded-md text-white bg-gray-700 border-gray-600 text-sm"
                  >
                    <option value={49}>~3s (49)</option>
                    <option value={81}>~5s (81)</option>
                    <option value={121}>~8s (121)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">WAN Resolution</label>
                  <select
                    value={wanResolution}
                    onChange={e => setWanResolution(e.target.value as '720p' | '1080p')}
                    className="w-full p-2 border rounded-md text-white bg-gray-700 border-gray-600 text-sm"
                  >
                    <option value="720p">720p</option>
                    <option value="1080p">1080p</option>
                  </select>
                </div>
              </>
            )}
          </div>
          {selectedModel === 'seedance' && (
            <div>
              <label className="flex items-center space-x-2 text-sm font-medium text-gray-300 mb-1">
                <input
                  type="checkbox"
                  checked={cameraFixed}
                  onChange={e => setCameraFixed(e.target.checked)}
                  className="form-checkbox h-4 w-4 text-teal-600"
                />
                <span>Fixed Camera</span>
              </label>
              <span className="text-xs text-gray-400">Keep camera position fixed (Seedance only)</span>
            </div>
          )}
        </div>
      )}
      
      <div className="bg-blue-900/20 p-3 rounded-md mb-4 text-sm text-blue-200">
        <p><strong>Tips:</strong></p>
        <ul className="list-disc pl-5 space-y-1 mt-1">
          <li>Use the AI prompt optimizer for better video quality</li>
          <li>Try different models for different visual styles</li>
          <li>Generation can take 3-8 minutes depending on server load</li>
          <li>Be specific about camera movements and lighting</li>
        </ul>
      </div>
      
      <button
        key={`generate-button-${modelInfo[selectedModel].name}`}
        onClick={handleGenerate}
        disabled={
          isGenerating || 
          (!prompt.trim() && !optimizedPrompt.trim()) ||
          (selectedModel === 'hailuo-02-pro' && prompt.length > 2000) ||
          (selectedModel === 'vidu' && prompt.length > 1500)
        }
        className={`w-full py-2 rounded-md text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center 
          bg-gradient-to-r ${modelInfo[selectedModel] ? modelInfo[selectedModel].color : ''} hover:opacity-90 shadow-sm`}
      >
        {isGenerating ? (
          <>
            <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full mr-2"></div>
            Generating...
          </>
        ) : (
          <>
            <Film className="h-4 w-4 mr-2" />
            Generate with {modelInfo[selectedModel] ? modelInfo[selectedModel].name : selectedModel}
          </>
        )}
      </button>

      {/* Error Display */}
      {error && (
        <div className="mt-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-2 rounded">
          <div className="flex items-start">
            <X className="h-3 w-3 mr-1 mt-0.5 text-red-500 flex-shrink-0" />
            <span>{error}</span>
          </div>
          {selectedModel === 'luma' && error.includes('Luma model failed') && (
            <p className="mt-1 pl-4 text-xs text-gray-600 dark:text-gray-400">
              The Luma API can be unstable. Pika or Kling models may work better.
            </p>
          )}
        </div>
      )}

      {isGenerating && !error && (
        <div className="space-y-2 mt-4">
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
            <div className="bg-indigo-500 h-2.5 rounded-full animate-pulse w-full"></div>
          </div>
          <div className="text-gray-600 dark:text-gray-400 text-sm">Generating...</div>
          <div className="text-gray-600 text-sm text-center mt-1">
            Video generation might take 3-8 minutes. The page will automatically update when complete.
          </div>
        </div>
      )}

      {videoUrl && (
        <div className="mt-6 flex flex-col items-center">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Generated Video</label>
          <video
            src={videoUrl}
            controls
            autoPlay
            loop
            muted
            draggable
            onDragStart={handleDragStart}
            className="rounded-lg border border-gray-300 dark:border-gray-700 shadow-md max-w-full max-h-64 cursor-move"
            style={{ background: '#000' }}
          />
          <button
            onClick={handleVideoClick}
            className="mt-2 px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs"
          >
            Add to Panel
          </button>
        </div>
      )}

      {/* Recent Text-to-Video Generations */}
      <div className="mt-6">
        <button
          onClick={() => setShowRecentTextVideos(v => !v)}
          className="w-full flex items-center justify-between px-2 py-2 text-xs font-medium bg-gray-800 rounded-md border border-gray-700 hover:bg-gray-700"
        >
          <span>Recent Video Generations (Text-to-Video)</span>
          <ChevronDown className={`h-4 w-4 transition-transform ${showRecentTextVideos ? 'rotate-180' : ''}`} />
        </button>
        {showRecentTextVideos && (
          <div className="mt-3 grid grid-cols-3 sm:grid-cols-4 gap-2">
            {recentTextVideos.length === 0 ? (
              <div className="text-gray-500 text-xs italic col-span-full">No recent videos yet.</div>
            ) : (
              recentTextVideos.map((v, idx) => (
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
    </div>
  );
}; 