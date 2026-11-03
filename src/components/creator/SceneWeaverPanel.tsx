import React, { useCallback, useMemo, useState } from 'react';
import { Panel } from '../../types';
import { nanoid } from 'nanoid';
import { runwayService } from '../../services/runwayService';
import { videoService } from '../../services/videoService';
import { mediaService } from '../../services/mediaService';

type GenerationState = 'idle' | 'generating' | 'dreaming' | 'inspiring' | 'reasoning' | 'creating-videos' | 'completed';

interface SceneWeaverPanelProps {
  onGenerateStory: (prompt: string, generatedUrl: string, type: 'image' | 'video' | 'gif', panel?: Panel) => Promise<void>;
  onCheckTemplate?: () => boolean;
}

interface ReferenceFile {
  file: File;
  url: string;
  name: string;
}

type ModelType = 'runway' | 'veo31';

export const SceneWeaverPanel: React.FC<SceneWeaverPanelProps> = ({ onGenerateStory, onCheckTemplate }) => {
  const [prompt, setPrompt] = useState('');
  const [generationState, setGenerationState] = useState<GenerationState>('idle');
  const [referenceFiles, setReferenceFiles] = useState<ReferenceFile[]>([]);
  const [selectedModel, setSelectedModel] = useState<ModelType>('veo31');
  const [veo31Resolution, setVeo31Resolution] = useState<'720p' | '1080p'>('720p');
  const [veo31GenerateAudio, setVeo31GenerateAudio] = useState(true);

  const referenceColors = useMemo(() => [
    'text-blue-400',
    'text-purple-400',
    'text-green-400',
    'text-orange-400',
    'text-pink-400',
    'text-indigo-400',
    'text-teal-400',
    'text-red-400',
  ], []);

  const getReferenceColor = (index: number) => referenceColors[index % referenceColors.length];

  const renderColoredPrompt = (text: string) => {
    if (!text || referenceFiles.length === 0) return text;
    const parts = text.split(/(@\w+)/g);
    return parts.map((part, index) => {
      if (part.startsWith('@')) {
        const refName = part.slice(1);
        const refIndex = referenceFiles.findIndex(ref => ref.name.toLowerCase() === refName.toLowerCase());
        if (refIndex !== -1) {
          return (
            <span key={index} className={getReferenceColor(refIndex)}>
              {part}
            </span>
          );
        }
      }
      return <span key={index}>{part}</span>;
    });
  };

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const imageFiles = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/') || f.type.includes('gif'));
    if (!imageFiles.length) return;
    const newRefs = imageFiles.map(file => ({ file, url: URL.createObjectURL(file), name: '' }));
    setReferenceFiles(prev => [...prev, ...newRefs]);
  }, []);

  const getReferenceUrls = async (): Promise<string[]> => {
    const urls: string[] = [];
    for (const ref of referenceFiles) {
      try {
        const cloudUrl = await mediaService.upload(ref.file);
        urls.push(cloudUrl);
      } catch (err) {
        console.error('Reference upload failed', err);
      }
    }
    return urls;
  };

  const handleGenerate = async () => {
    if (!prompt.trim() && referenceFiles.length === 0) return;
    setGenerationState('generating');
    try {
      const referenceUrls = await getReferenceUrls();
      const finalPrompt = prompt.trim();

      if (selectedModel === 'veo31') {
        // Veo 3.1 Reference-to-Video: Single video output from multiple reference images
        setGenerationState('creating-videos');
        
        const submitResponse = await fetch('/api/veo31/reference-to-video', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_urls: referenceUrls,
            prompt: finalPrompt || 'A cinematic scene with natural motion and realistic animations',
            duration: '8s',
            resolution: veo31Resolution,
            generate_audio: veo31GenerateAudio
          })
        });

        if (!submitResponse.ok) {
          const errorData = await submitResponse.json();
          throw new Error(errorData.error || 'Failed to submit Veo 3.1 request');
        }

        const { request_id } = await submitResponse.json();
        console.log('[Scene Weaver] Veo 3.1 request submitted:', request_id);

        // Poll for status
        let attempts = 0;
        const maxAttempts = 120; // 10 minutes

        while (attempts < maxAttempts) {
          attempts++;
          await new Promise(resolve => setTimeout(resolve, 3000));

          const statusResponse = await fetch(`/api/veo31/status?request_id=${request_id}&model_type=reference-to-video`);
          if (!statusResponse.ok) continue;

          const statusData = await statusResponse.json();
          console.log(`[Scene Weaver] Veo 3.1 Status (${attempts}/${maxAttempts}):`, statusData.status);

          if (statusData.status === 'COMPLETED' && statusData.video_url) {
            const videoPanel: Panel = { 
              id: nanoid(), 
              type: 'video', 
              url: statusData.video_url, 
              size: 'medium', 
              aspectRatio: 16/9, 
              position: { row: 0, col: 0 }, 
              caption: finalPrompt 
            };
            await onGenerateStory(finalPrompt, statusData.video_url, 'video', videoPanel);
            
            setGenerationState('completed');
            setTimeout(() => {
              setGenerationState('idle');
              setPrompt('');
              setReferenceFiles([]);
            }, 1500);
            return;
          }

          if (statusData.status === 'FAILED') {
            throw new Error('Veo 3.1 generation failed');
          }
        }

        throw new Error('Veo 3.1 generation timed out');
      } else {
        // Runway workflow: Generate images then convert to videos
        const is2x2Template = onCheckTemplate?.();
        const imageCount = is2x2Template ? 4 : 3;
        const panels: Panel[] = [];

        for (let i = 0; i < imageCount; i++) {
          const stageNames: GenerationState[] = ['generating', 'dreaming', 'inspiring', 'reasoning'];
          setGenerationState(stageNames[i] || 'generating');
          const variationSuffix = i === 0 ? '' : [', different angle', ', close-up view', ', wide shot', ', dynamic pose', ', side view', ', dramatic lighting'][(i - 1) % 6];
          const scenePrompt = `${finalPrompt}${variationSuffix}`;

          const imageUrl = await runwayService.generateImageWithReferences({
            promptText: scenePrompt,
            referenceImages: referenceUrls.map((uri, idx) => ({ uri, tag: `reference${idx + 1}` })),
            ratio: '1024:1024'
          });

          if (imageUrl) {
            let position;
            if (is2x2Template) {
              position = i === 0 ? { row: 0, col: 0 } : i === 1 ? { row: 0, col: 1 } : i === 2 ? { row: 1, col: 0 } : { row: 1, col: 1 };
            } else {
              position = { row: 0, col: i };
            }

            const panel: Panel = { id: nanoid(), type: 'image', url: imageUrl, size: 'medium', aspectRatio: 1, position, caption: '' };
            panels.push(panel);
            await onGenerateStory(scenePrompt, imageUrl, 'image', panel);
          }
        }

        setGenerationState('creating-videos');
        for (let index = 0; index < panels.length; index++) {
          const imagePanel = panels[index];
          try {
            const videoPrompt = `${finalPrompt}, subtle animation and movement`;
            const result = await videoService.generateSeedanceImageToVideo({ imageUrl: imagePanel.url, prompt: videoPrompt, duration: '5', resolution: '720p', cameraFixed: false });
            if (result.videoUrl) {
              const updatedPanel: Panel = { ...imagePanel, type: 'video', url: result.videoUrl };
              await onGenerateStory(`Living: ${finalPrompt}`, result.videoUrl, 'video', updatedPanel);
            }
          } catch (err) {
            console.error('Video conversion failed', err);
          }
        }

        setGenerationState('completed');
        setTimeout(() => {
          setGenerationState('idle');
          setPrompt('');
          setReferenceFiles([]);
        }, 1500);
      }
    } catch (err) {
      console.error('Scene Weaver generation failed', err);
      setGenerationState('idle');
    }
  };

  return (
    <div className="space-y-3">
      <div className="text-xs text-gray-400">Use @name in your prompt</div>

      {/* Model Selector */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">Model</label>
        <select
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value as ModelType)}
          className="w-full p-2 border rounded-md text-white bg-gray-700 border-gray-600"
        >
          <option value="veo31">Veo 3.1 Reference (single video, 8s, 720p/1080p)</option>
          <option value="runway">Runway Gen-3 (multi-panel images → videos)</option>
        </select>
        <p className="text-xs text-gray-400 mt-1">
          {selectedModel === 'veo31' 
            ? 'Generates 1 cinematic video from reference images with natural motion'
            : 'Generates 3-4 images with references, then converts to videos'}
        </p>
      </div>

      {/* Veo 3.1 Settings */}
      {selectedModel === 'veo31' && (
        <div className="bg-gray-800/60 rounded-lg p-3 space-y-3">
          <div className="text-xs font-medium text-gray-300 mb-2">Veo 3.1 Options</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Resolution</label>
              <select
                value={veo31Resolution}
                onChange={(e) => setVeo31Resolution(e.target.value as '720p' | '1080p')}
                className="w-full p-1.5 text-xs border rounded-md text-white bg-gray-700 border-gray-600"
              >
                <option value="720p">720p (HD)</option>
                <option value="1080p">1080p (Full HD)</option>
              </select>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-xs text-gray-300">
                <input
                  type="checkbox"
                  checked={veo31GenerateAudio}
                  onChange={(e) => setVeo31GenerateAudio(e.target.checked)}
                  className="rounded border-gray-600 bg-gray-700 text-purple-600 focus:ring-purple-500"
                />
                Audio (33% more credits)
              </label>
            </div>
          </div>
        </div>
      )}

      {referenceFiles.length > 0 && (
        <div className="bg-gray-800/60 rounded-lg p-3">
          <div className="flex flex-wrap gap-3">
            {referenceFiles.map((ref, index) => (
              <div key={index} className="relative">
                <div className="bg-gray-900 rounded-lg p-3 w-32">
                  <div className="relative mb-2">
                    <img src={ref.url} alt={ref.name} className="w-24 h-24 rounded-lg object-cover mx-auto" />
                    <button
                      onClick={() => {
                        try { URL.revokeObjectURL(ref.url); } catch {}
                        setReferenceFiles(prev => prev.filter((_, i) => i !== index));
                      }}
                      className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-xs hover:bg-red-600"
                    >
                      ×
                    </button>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-gray-500 mb-1">@</div>
                    <input
                      type="text"
                      value={ref.name}
                      onChange={(e) => {
                        const next = [...referenceFiles];
                        next[index].name = e.target.value;
                        setReferenceFiles(next);
                      }}
                      className={`text-xs bg-gray-900 border border-gray-700 rounded px-2 py-1 w-full text-center outline-none focus:border-purple-500 ${getReferenceColor(index)}`}
                      placeholder="Name it"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        className="border-2 border-dashed border-gray-700 rounded-lg p-4 text-center"
      >
        <div className="text-xs text-gray-400">Drag images here or</div>
        <label className="mt-1 inline-block text-xs px-2 py-1 rounded bg-gray-800 border border-gray-700 text-gray-200 cursor-pointer">
          Attach
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              if (!e.target.files) return;
              const files = Array.from(e.target.files);
              const newRefs = files.map(file => ({ file, url: URL.createObjectURL(file), name: '' }));
              setReferenceFiles(prev => [...prev, ...newRefs]);
            }}
          />
        </label>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">Prompt (optional)</label>
        <textarea
          value={prompt}
          onChange={(e) => { if (e.target.value.length <= 1000) setPrompt(e.target.value); }}
          placeholder="Camera movement, style, subject details..."
          className="w-full p-2 border rounded-md text-white bg-gray-700 border-gray-600 placeholder-gray-400 resize-none"
          rows={3}
          maxLength={1000}
        />
      </div>

      <div className="flex items-center justify-between">
        <span className={`text-xs ${prompt.length > 900 ? 'text-red-400' : prompt.length > 800 ? 'text-orange-400' : 'text-gray-400'}`}>{prompt.length}/1000</span>
        <button
          onClick={handleGenerate}
          disabled={generationState !== 'idle' || (!prompt.trim() && referenceFiles.length === 0)}
          className="px-3 py-1.5 text-xs rounded-md border bg-purple-600 border-purple-500 text-white disabled:opacity-50"
        >
          {generationState === 'idle' && 'Generate'}
          {generationState === 'generating' && 'Generating...'}
          {generationState === 'dreaming' && 'Dreaming...'}
          {generationState === 'inspiring' && 'Inspiring...'}
          {generationState === 'reasoning' && 'Reasoning...'}
          {generationState === 'creating-videos' && 'Bringing to life...'}
          {generationState === 'completed' && 'Completed!'}
        </button>
      </div>
    </div>
  );
};


