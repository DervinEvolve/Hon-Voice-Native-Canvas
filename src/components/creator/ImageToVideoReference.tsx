import React, { useState, useCallback } from 'react';
import { minimaxVideoService } from '../../services/minimaxVideoService';
import { Upload, Film, X, Wand } from 'lucide-react';
import { Panel, Comic } from '../../types';
import { nanoid } from 'nanoid';
import { useComicStore } from '../../store/useComicStore';

interface ImageToVideoReferenceProps {
  onGenerateStory: (prompt: string, generatedUrl: string, type: 'image' | 'video' | 'gif', panel?: Panel) => Promise<void>;
}

export const ImageToVideoReference: React.FC<ImageToVideoReferenceProps> = ({ onGenerateStory }) => {
  const { currentComic, currentPageIndex, updatePanel } = useComicStore();
  const [referenceImage, setReferenceImage] = useState<File | null>(null);
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!referenceImage || !prompt.trim()) {
      setError('Please provide both a reference image and a prompt');
      return;
    }

    setError(null);
    setIsGenerating(true);
    setVideoUrl(null);

    try {
      // Upload reference image to Cloudinary
      const referenceImageUrl = await minimaxVideoService.uploadImage(referenceImage);
      console.log('Reference image uploaded:', referenceImageUrl);

      // Generate the video using the reference image
      const result = await minimaxVideoService.generateVideo({
        referenceImageUrl,
        prompt: prompt.trim()
      });
      
      if (result.videoUrl) {
        setVideoUrl(result.videoUrl);
        await onGenerateStory(prompt, result.videoUrl, 'video');
      } else {
        throw new Error('No video URL in response');
      }
    } catch (err) {
      console.error('Video generation error:', err);
      setError(err instanceof Error ? err.message : 'Failed to generate video');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleReferenceImageDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      setReferenceImage(file);
    }
  }, []);

  const handleReferenceImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      setReferenceImage(file);
    }
  }, []);

  const handleVideoClick = () => {
    if (!videoUrl || !currentComic || typeof currentPageIndex === 'undefined') return;

    const comic = currentComic as Comic;
    const pages = comic.pages[currentPageIndex] || [];
    const emptyPanelIndex = pages.findIndex(panel => !panel || !panel.url);
    
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

  return (
    <div className="p-6 border-b border-gray-200 dark:border-gray-700">
      {/* Remove the entire header with "Character Reference" text and icon */}
      
      <p className="text-sm text-gray-300 mb-4">
        Upload a reference image of your character to maintain consistent appearance in the generated video.
      </p>
      
      <div className="mb-4">
        <h3 className="text-md font-medium mb-2 text-gray-300">Character Reference Image</h3>
        <div
          onDrop={handleReferenceImageDrop}
          onDragOver={(e) => e.preventDefault()}
          className="border-2 border-dashed border-gray-600 rounded-lg p-4 text-center cursor-pointer"
        >
          <input
            type="file"
            accept="image/*"
            onChange={handleReferenceImageSelect}
            className="hidden"
            id="reference-image-input"
          />
          <label htmlFor="reference-image-input" className="cursor-pointer">
            {referenceImage ? (
              <div className="relative">
                <img
                  src={URL.createObjectURL(referenceImage)}
                  alt="Reference"
                  className="max-w-full h-auto mx-auto"
                />
                <button 
                  onClick={(e) => {
                    e.preventDefault();
                    setReferenceImage(null);
                  }}
                  className="absolute top-2 right-2 bg-red-500 text-white p-1 rounded-full"
                >
                  ×
                </button>
              </div>
            ) : (
              <div className="py-8">
                <Upload className="mx-auto h-12 w-12 text-gray-400" />
                <p className="mt-2 text-sm text-gray-400">
                  Drop or click to upload character reference image
                </p>
              </div>
            )}
          </label>
        </div>
      </div>
      
      <div className="mb-4">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe what you want your character to do in the video..."
          className="w-full p-2 border rounded-md resize-none focus:ring-2 focus:ring-purple-500 text-white bg-gray-700 border-gray-600 placeholder-gray-400"
          rows={4}
        />
      </div>
      
      <div className="flex gap-2">
        <button
          onClick={handleGenerate}
          disabled={isGenerating || !referenceImage || !prompt.trim()}
          className="w-full py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div className="flex items-center justify-center gap-2">
            <Film className="w-5 h-5" />
            {isGenerating ? 'Generating Video...' : 'Generate Video'}
          </div>
        </button>
      </div>

      {error && (
        <div className="text-red-500 text-sm">{error}</div>
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
    </div>
  );
}; 