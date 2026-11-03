import { accessHeaders } from '../../services/apiAccess';
import React, { useCallback, useEffect, useState } from 'react';
import { Upload, Film, X, Download, Copy } from 'lucide-react';
import { klingProService } from '../../services/klingProService';
import { Panel } from '../../types';
import { nanoid } from 'nanoid';
import { useComicStore } from '../../store/useComicStore';
import { recentGenerationsService } from '../../services/recentGenerationsService';
import { useWallet } from '@solana/wallet-adapter-react';

interface FirstLastFrameProps {
  onGenerateStory: (prompt: string, generatedUrl: string, type: 'image' | 'video' | 'gif', panel?: Panel) => Promise<void>;
}

type ModelType = 'kling' | 'veo31';

export const FirstLastFrame: React.FC<FirstLastFrameProps> = ({ onGenerateStory }) => {
  const { currentComic, currentPageIndex, updatePanel, addRecentGeneration } = useComicStore();
  const { publicKey } = useWallet();
  const [selectedModel, setSelectedModel] = useState<ModelType>('kling');
  const [firstImage, setFirstImage] = useState<File | null>(null);
  const [lastImage, setLastImage] = useState<File | null>(null);
  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState<'5' | '10'>('5');
  const [cfgScale, setCfgScale] = useState<number>(0.5);
  const [negative, setNegative] = useState<string>('blur, distort, and low quality');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [recentVideos, setRecentVideos] = useState<Array<{ url: string; prompt: string; timestamp: Date; model: string }>>([]);
  const [showRecent, setShowRecent] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [expandedPrompt, setExpandedPrompt] = useState<number | null>(null);
  
  // Veo 3.1 specific settings
  const [veoResolution, setVeoResolution] = useState<'720p' | '1080p'>('720p');
  const [veoAspectRatio, setVeoAspectRatio] = useState<'auto' | '9:16' | '16:9' | '1:1'>('auto');
  const [generateAudio, setGenerateAudio] = useState(true);

  const handleDrop = (setter: (f: File) => void) => (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) setter(file);
  };
  const handleSelect = (setter: (f: File) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('image/')) setter(file);
  };

  const uploadIfNeeded = async (file: File | null) => file ? klingProService.uploadImage(file) : null;

  const generateWithVeo = async () => {
    const firstUrl = await uploadIfNeeded(firstImage);
    if (!firstUrl) throw new Error('Failed to upload first frame');
    
    const lastUrl = await uploadIfNeeded(lastImage);
    if (!lastImage) throw new Error('Last frame is required for Veo 3.1');
    
    // Submit to Veo 3.1 API
    const submitResponse = await fetch('/api/veo31/first-last-frame', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        first_frame_url: firstUrl,
        last_frame_url: lastUrl,
        prompt: prompt || 'Animate smoothly from first to last frame',
        duration: duration === '5' ? '8s' : '8s', // Veo only supports 8s
        aspect_ratio: veoAspectRatio,
        resolution: veoResolution,
        generate_audio: generateAudio
      })
    });
    
    if (!submitResponse.ok) {
      const errorData = await submitResponse.json();
      throw new Error(errorData.error || 'Failed to submit Veo 3.1 request');
    }
    
    const { request_id } = await submitResponse.json();
    console.log('[Veo 3.1] Request submitted:', request_id);
    
    // Poll for status
    let attempts = 0;
    const maxAttempts = 120; // 10 minutes
    
    while (attempts < maxAttempts) {
      attempts++;
      await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds faster polling
      
      const statusResponse = await fetch(`/api/veo31/status?request_id=${request_id}&model_type=first-last-frame`);
      if (!statusResponse.ok) continue;
      
      const statusData = await statusResponse.json();
      console.log(`[Veo 3.1] Status (${attempts}/${maxAttempts}):`, statusData.status);
      
      if (statusData.status === 'COMPLETED' && statusData.video_url) {
        return statusData.video_url;
      }
      
      if (statusData.status === 'FAILED') {
        throw new Error('Veo 3.1 generation failed');
      }
    }
    
    throw new Error('Veo 3.1 generation timed out');
  };
  
  const generate = async () => {
    if (!firstImage) { setError('Please add a first frame'); return; }
    if (selectedModel === 'veo31' && !lastImage) { 
      setError('Veo 3.1 requires both first and last frames'); 
      return; 
    }
    
    setError(null);
    setIsGenerating(true);
    setVideoUrl(null);
    
    try {
      let url: string;
      let modelName: string;
      
      if (selectedModel === 'veo31') {
        url = await generateWithVeo();
        modelName = 'veo-3.1';
      } else {
        // Kling generation (existing logic)
        const firstUrl = await uploadIfNeeded(firstImage);
        const lastUrl = await uploadIfNeeded(lastImage);
        const { request_id } = await klingProService.submitImageToVideo(firstUrl!, {
          tailImageUrl: lastUrl || undefined,
          duration,
          negative_prompt: negative || undefined,
          cfg_scale: cfgScale,
          prompt: prompt || undefined,
        });
        url = await klingProService.pollStatus(request_id);
        modelName = 'kling-2.1-pro';
      }
      
      setVideoUrl(url);
      await onGenerateStory(prompt, url, 'video');
      
      // Persist as recent generation to database and store
      const base = { type: 'video' as const, url, prompt, model: modelName };
      const metadata = { source: 'first_last_frame', model: selectedModel };
      try { await recentGenerationsService.saveForCurrentUser({ ...base, metadata }); } catch {}
      try { if (publicKey) await recentGenerationsService.saveForWalletAddress(publicKey.toBase58(), { ...base, metadata }); } catch {}
      
      // Add to Zustand store for immediate UI update
      try {
        addRecentGeneration({
          url,
          prompt,
          timestamp: new Date(),
          model: modelName,
          type: 'video',
          metadata
        });
      } catch (e) {
        console.warn('Failed to add to store recent generations:', e);
      }
      
      setRecentVideos(prev => [{ url, prompt, timestamp: new Date(), model: modelName }, ...prev.filter(v => v.url !== url)]);
    } catch (e) {
      console.error('FirstLastFrame error:', e);
      setError(e instanceof Error ? e.message : 'Failed to generate');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleVideoClick = () => {
    if (!videoUrl || !currentComic || typeof currentPageIndex === 'undefined') return;
    const pages = currentComic.pages[currentPageIndex] || [];
    const empty = pages.findIndex(p => !p || !p.url);
    if (empty !== -1) {
      const panel: Panel = { id: nanoid(), type: 'video', url: videoUrl, size: 'medium', aspectRatio: 1, position: { row: 0, col: 0, rowSpan: 1, colSpan: 1 } } as any;
      updatePanel(panel, currentPageIndex);
    }
  };
  const handleDragStart = (e: React.DragEvent<HTMLVideoElement>) => {
    if (!videoUrl) return;
    const panel: Panel = { id: nanoid(), type: 'video', url: videoUrl, size: 'medium', aspectRatio: 1, position: { row: 0, col: 0, rowSpan: 1, colSpan: 1 } } as any;
    e.dataTransfer.setData('application/json', JSON.stringify(panel));
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleThumbDragStart = (e: React.DragEvent<HTMLVideoElement>, url: string) => {
    if (!url) return;
    const panel: Panel = { id: nanoid(), type: 'video', url, size: 'medium', aspectRatio: 1, position: { row: 0, col: 0, rowSpan: 1, colSpan: 1 } } as any;
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
          .filter(r => r.type === 'video' && (r.metadata?.source === 'kling_pro_first_last' || r.metadata?.source === 'first_last_frame'))
          .map(r => ({ url: r.url, prompt: r.prompt, timestamp: r.timestamp, model: r.model }));
        setRecentVideos(filtered);
      } catch (e) {
        console.warn('Failed to load recent Kling Pro first/last generations');
      }
    })();
  }, [publicKey]);

  const Uploader = ({ label, file, setFile, inputId }: { label: string; file: File | null; setFile: (f: File) => void; inputId: string }) => (
    <div className="mb-4">
      <h3 className="text-md font-medium mb-2 text-gray-300">{label}</h3>
      <div onDrop={handleDrop(setFile)} onDragOver={(e) => e.preventDefault()} className="border-2 border-dashed border-gray-600 rounded-lg p-4 text-center cursor-pointer">
        <input type="file" accept="image/*" onChange={handleSelect(setFile)} className="hidden" id={inputId} />
        <label htmlFor={inputId} className="cursor-pointer">
          {file ? (
            <div className="relative">
              <img src={URL.createObjectURL(file)} alt={label} className="max-w-full h-auto mx-auto" />
              <button onClick={(e) => { e.preventDefault(); setFile(null as any); }} className="absolute top-2 right-2 bg-red-500 text-white p-1 rounded-full">×</button>
            </div>
          ) : (
            <div className="py-8">
              <Upload className="mx-auto h-12 w-12 text-gray-400" />
              <p className="mt-2 text-sm text-gray-400">Drop or click to upload</p>
            </div>
          )}
        </label>
      </div>
    </div>
  );

  return (
    <div className="p-6 border-b border-gray-200 dark:border-gray-700">
      <p className="text-sm text-gray-300 mb-4">Animate between first and last frames with AI-powered video generation.</p>
      
      {/* Model Selector */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-300 mb-2">Model</label>
        <select 
          value={selectedModel} 
          onChange={(e) => setSelectedModel(e.target.value as ModelType)} 
          className="w-full p-2 border rounded-md text-white bg-gray-700 border-gray-600"
        >
          <option value="kling">Kling 2.1 Pro (5-10s, optional last frame)</option>
          <option value="veo31">Veo 3.1 (8s, 720p/1080p, requires both frames)</option>
        </select>
        <p className="text-xs text-gray-400 mt-1">
          {selectedModel === 'kling' 
            ? 'Advanced motion control with optional last frame'
            : 'Google\'s Veo 3.1 - cinematic quality, natural motion, requires both frames'}
        </p>
      </div>
      
      <Uploader label="First Frame" file={firstImage} setFile={(f) => setFirstImage(f)} inputId="first-frame-input" />
      <Uploader 
        label={selectedModel === 'veo31' ? 'Last Frame (required)' : 'Last Frame (optional)'} 
        file={lastImage} 
        setFile={(f) => setLastImage(f)} 
        inputId="last-frame-input" 
      />

      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Prompt {selectedModel === 'veo31' && <span className="text-purple-400">(recommended for Veo 3.1)</span>}
          </label>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} className="w-full p-2 border rounded-md resize-none focus:ring-2 focus:ring-purple-500 text-white bg-gray-700 border-gray-600 placeholder-gray-400" placeholder={selectedModel === 'veo31' ? 'Describe how to animate between frames (action, style, camera motion)' : 'Camera movement, style, subject details...'} />
        </div>
        
        {selectedModel === 'kling' ? (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Duration</label>
              <select value={duration} onChange={(e) => setDuration(e.target.value as '5' | '10')} className="w-full p-2 border rounded-md text-white bg-gray-700 border-gray-600">
                <option value="5">5 seconds</option>
                <option value="10">10 seconds</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">CFG Scale</label>
              <input type="number" min={0} max={2} step={0.1} value={cfgScale} onChange={(e) => setCfgScale(parseFloat(e.target.value))} className="w-full p-2 border rounded-md text-white bg-gray-700 border-gray-600" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-300 mb-1">Negative Prompt</label>
              <input type="text" value={negative} onChange={(e) => setNegative(e.target.value)} className="w-full p-2 border rounded-md text-white bg-gray-700 border-gray-600" />
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Resolution</label>
              <select value={veoResolution} onChange={(e) => setVeoResolution(e.target.value as '720p' | '1080p')} className="w-full p-2 border rounded-md text-white bg-gray-700 border-gray-600">
                <option value="720p">720p (HD)</option>
                <option value="1080p">1080p (Full HD)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Aspect Ratio</label>
              <select value={veoAspectRatio} onChange={(e) => setVeoAspectRatio(e.target.value as '9:16' | '16:9' | '1:1' | 'auto')} className="w-full p-2 border rounded-md text-white bg-gray-700 border-gray-600">
                <option value="auto">Auto</option>
                <option value="16:9">16:9 (Landscape)</option>
                <option value="9:16">9:16 (Portrait)</option>
                <option value="1:1">1:1 (Square)</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input 
                  type="checkbox" 
                  checked={generateAudio} 
                  onChange={(e) => setGenerateAudio(e.target.checked)} 
                  className="rounded border-gray-600 bg-gray-700 text-purple-600 focus:ring-purple-500"
                />
                Generate Audio (disable to save 33% credits)
              </label>
            </div>
          </>
        )}
      </div>

      <button onClick={generate} disabled={isGenerating || !firstImage || (selectedModel === 'veo31' && !lastImage)} className="w-full py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed">
        <div className="flex items-center justify-center gap-2">
          <Film className="w-5 h-5" />
          {isGenerating ? 'Generating...' : `Generate with ${selectedModel === 'veo31' ? 'Veo 3.1' : 'Kling 2.1 Pro'}`}
        </div>
      </button>

      {error && <div className="text-red-500 text-sm mt-2">{error}</div>}

      {videoUrl && (
        <div className="video-output mt-4 relative">
          <button onClick={() => setVideoUrl(null)} className="absolute -top-2 -right-2 bg-red-500 text-white p-1 rounded-full shadow-md z-10 hover:bg-red-600 transition-colors" title="Remove video" aria-label="Remove video">
            <X size={14} />
          </button>
          <video src={videoUrl} controls autoPlay loop muted playsInline onLoadedData={(e)=>{try{e.currentTarget.currentTime=0;}catch{}}} onEnded={(e)=>{try{e.currentTarget.currentTime=0;e.currentTarget.play();}catch{}}} draggable onClick={handleVideoClick} onDragStart={handleDragStart} className="w-full rounded-lg cursor-pointer hover:opacity-90 transition-opacity" />
          <p className="text-sm text-gray-400 mt-2">Click to add to first empty panel, or drag to any panel</p>
        </div>
      )}

      {/* Recent First/Last Frame Generations */}
      <div className="mt-6">
        <button
          onClick={() => setShowRecent(v => !v)}
          className="w-full flex items-center justify-between px-2 py-2 text-xs font-medium bg-gray-800 rounded-md border border-gray-700 hover:bg-gray-700"
        >
          <span>Recent Videos (First & Last Frame)</span>
          <Film className={`h-4 w-4 ${showRecent ? 'text-purple-300' : 'text-gray-400'}`} />
        </button>
        {showRecent && (
          <div className="mt-3 grid grid-cols-3 sm:grid-cols-4 gap-2">
            {recentVideos.length === 0 ? (
              <div className="text-gray-500 text-xs italic col-span-full">No recent videos yet.</div>
            ) : (
              recentVideos.map((v, idx) => (
                <div key={`${v.url}-${idx}`} className="relative group cursor-pointer" onMouseEnter={() => setHoveredIndex(idx)} onMouseLeave={() => setHoveredIndex(null)}>
                  <video src={v.url} muted playsInline loop draggable onDragStart={(e) => handleThumbDragStart(e, v.url)} className="w-full h-24 object-cover rounded-lg bg-black" />
                  {hoveredIndex === idx && (
                    <div className="absolute z-50 w-72 p-3 text-sm bg-purple-600 text-white rounded shadow-lg left-0 bottom-full mb-2">
                      <div className="mb-2">
                        <p className="font-semibold">Prompt:</p>
                        <div className={expandedPrompt === idx ? 'max-h-40 overflow-y-auto pr-1 text-xs' : 'text-xs'}>
                          {expandedPrompt === idx ? v.prompt : (v.prompt.length > 50 ? v.prompt.substring(0, 50) + '...' : v.prompt)}
                        </div>
                        {v.prompt.length > 50 && (
                          <button onClick={(e) => { e.stopPropagation(); setExpandedPrompt(expandedPrompt === idx ? null : idx); }} className="text-xs text-purple-200 hover:text-white mt-1">
                            {expandedPrompt === idx ? 'Show less' : 'Show more'}
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-purple-200">Model: {v.model}</p>
                      <p className="text-xs opacity-90">Created: {new Date(v.timestamp as any).toLocaleString()}</p>
                      <div className="mt-2 flex justify-between items-center">
                        <div className="flex gap-2">
                          <button onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(v.prompt); }} className="text-xs bg-purple-700 hover:bg-purple-800 text-white px-2 py-1 rounded flex items-center gap-1" title="Copy prompt to clipboard">
                            <Copy size={12} />
                            Copy
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); handleVideoDownload(v.url, v.prompt); }} className="text-xs bg-purple-700 hover:bg-purple-800 text-white px-2 py-1 rounded flex items-center gap-1" title="Download video">
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


