import React, { useState, useCallback } from 'react';
import { pikaVideoService } from '../../services/pikaVideoService';
import { Upload, Film, X, Plus, Wand2, Scissors, Atom } from 'lucide-react';
import { Panel } from '../../types';
import { nanoid } from 'nanoid';
import { useComicStore } from '../../store/useComicStore';

interface PikaVideoProps {
  onGenerateStory: (prompt: string, generatedUrl: string, type: 'image' | 'video' | 'gif', panel?: Panel) => Promise<void>;
}

export const PikaVideo: React.FC<PikaVideoProps> = ({ onGenerateStory }) => {
  const { currentComic, currentPageIndex, updatePanel } = useComicStore();
  const [referenceImages, setReferenceImages] = useState<File[]>([]);
  const [referenceImageUrls, setReferenceImageUrls] = useState<string[]>([]);
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(5);
  const [quality, setQuality] = useState<'standard' | 'high'>('high');
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16' | '1:1' | '4:5' | '5:4' | '3:2' | '2:3'>('16:9');
  const [generationProgress, setGenerationProgress] = useState<string>('');
  const [progressStage, setProgressStage] = useState<string>('');
  const [timeoutSeconds, setTimeoutSeconds] = useState(300); // 5 minutes default

  const handleGenerate = async () => {
    if (referenceImages.length === 0) {
      setError('Please select at least one image');
      return;
    }

    setError(null);
    setIsGenerating(true);
    setVideoUrl(null);
    setGenerationProgress('');
    setProgressStage('Uploading images...');

    try {
      const uploadedUrls: string[] = [];
      
      console.log(`🖼️ Starting to upload ${referenceImages.length} images to media storage...`);
      
      // Upload images to get public URLs
      for (const image of referenceImages) {
        try {
          console.log(`📤 Uploading image: ${image.name} (${(image.size / 1024).toFixed(2)} KB)`);
          setGenerationProgress(`Uploading ${image.name}...`);
          
          // Convert image file to a data URL
          const dataUrl = await readFileAsDataURL(image);
          
          const uploadResponse = await fetch('/api/cloudinary-upload', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file: dataUrl }),
          });
          const upload = await uploadResponse.json();
          if (!uploadResponse.ok || typeof upload.url !== 'string') throw new Error('Reference image upload failed');
          uploadedUrls.push(upload.url);
        } catch (err) {
          console.error('❌ Image upload error:', err);
          throw new Error(`Failed to upload image: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }
      
      console.log(`🎉 All ${uploadedUrls.length} images uploaded successfully`);
      setProgressStage('Generating video...');
      setGenerationProgress('Starting Pika generation...');
      
      console.log(`🎬 Starting Pika video generation with options:`, {
        prompt: prompt || '[No prompt provided]',
        imageCount: uploadedUrls.length,
        quality,
        duration,
        aspectRatio,
        timeoutSeconds: timeoutSeconds
      });

      // Generate the video with Pika service
      const videoUrl = await pikaVideoService.generateVideo(
        prompt, 
        uploadedUrls, 
        {
          quality,
          duration,
          aspectRatio,
          timeoutSeconds, // Use the user-selected timeout
          // Add progress callback
          onProgress: (update) => {
            setGenerationProgress(update);
          }
        }
      );
      
      if (videoUrl) {
        setVideoUrl(videoUrl);
        setProgressStage('Complete!');
        setGenerationProgress('Video generation complete');
        console.log('Pika video generated:', videoUrl);
        
        // Force the video element to reload and display the video
        setTimeout(() => {
          const videoElement = document.querySelector('video') as HTMLVideoElement;
          if (videoElement) {
            videoElement.load();
            videoElement.play().catch(e => console.error('Failed to play video:', e));
          }
        }, 500);
      } else {
        throw new Error('No video URL in response');
      }
    } catch (err) {
      console.error('Pika video generation error:', err);
      setError(err instanceof Error ? err.message : 'Failed to generate video');
      setProgressStage('Error');
      setGenerationProgress('');
    } finally {
      setIsGenerating(false);
    }
  };

  // Helper function to read a file as data URL
  const readFileAsDataURL = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    const imageFiles = files.filter(file => file.type.startsWith('image/'));
    
    if (imageFiles.length > 0) {
      addImagesToCollection(imageFiles);
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const imageFiles = files.filter(file => file.type.startsWith('image/'));
    
    if (imageFiles.length > 0) {
      addImagesToCollection(imageFiles);
    }
  }, []);

  const addImagesToCollection = (files: File[]) => {
    setReferenceImages(prev => [...prev, ...files]);
    
    // Create object URLs for display
    const objectUrls = files.map(file => URL.createObjectURL(file));
    setReferenceImageUrls(prev => [...prev, ...objectUrls]);
  };

  const removeImage = (index: number) => {
    // Revoke the object URL to avoid memory leaks
    if (referenceImageUrls[index]) {
      URL.revokeObjectURL(referenceImageUrls[index]);
    }
    
    setReferenceImages(prev => prev.filter((_, i) => i !== index));
    setReferenceImageUrls(prev => prev.filter((_, i) => i !== index));
  };

  const handleVideoClick = () => {
    if (!videoUrl || !currentComic || typeof currentPageIndex === 'undefined') return;

    const pages = currentComic.pages[currentPageIndex] || [];
    const emptyPanelIndex = pages.findIndex(panel => !panel || !panel.url);
    
    if (emptyPanelIndex !== -1) {
      const panel = {
        id: nanoid(),
        type: 'video' as const,
        url: videoUrl,
        size: 'medium',
        aspectRatio: 1,
        position: { x: 0, y: 0, rowSpan: 1, colSpan: 1 }
      };
      updatePanel(panel, currentPageIndex);
    }
  };

  const handleDragStart = (e: React.DragEvent<HTMLVideoElement>) => {
    if (!videoUrl) return;

    const panel = {
      id: nanoid(),
      type: 'video' as const,
      url: videoUrl,
      size: 'medium',
      aspectRatio: 1,
      position: { x: 0, y: 0, rowSpan: 1, colSpan: 1 }
    };

    e.dataTransfer.setData('application/json', JSON.stringify(panel));
    e.dataTransfer.effectAllowed = 'copy';
  };

  // Clean up object URLs when component unmounts
  React.useEffect(() => {
    return () => {
      referenceImageUrls.forEach(url => {
        URL.revokeObjectURL(url);
      });
    };
  }, [referenceImageUrls]);

  return (
    <div className="border-b border-gray-200 dark:border-gray-700 pb-6">
      <h2 className="text-xl font-semibold mb-4 text-gray-800 dark:text-white flex items-center relative group">
        <div className="mr-2 bg-gradient-to-br from-teal-400 via-purple-500 to-indigo-600 rounded-lg p-1.5 flex items-center justify-center">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-white">
            <path d="M4 9V6C4 4.89543 4.89543 4 6 4H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M20 9V6C20 4.89543 19.1046 4 18 4H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M4 15V18C4 19.1046 4.89543 20 6 20H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M20 15V18C20 19.1046 19.1046 20 18 20H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M9 6L15 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M15 6L9 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        Scene Weaver
        
        <div className="absolute z-50 left-1/2 transform -translate-x-1/2 bottom-full mb-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
          <div className="bg-[#3182CE] text-white text-xs px-2 py-1 rounded shadow-lg whitespace-nowrap">
            Pika v2.2 Scenes Model
            <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-[#3182CE]"></div>
          </div>
        </div>
      </h2>
      
      <div className="mb-4">
        <div 
          className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-4 text-center"
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
        >
          {referenceImageUrls.length > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              {referenceImageUrls.map((url, index) => (
                <div key={index} className="relative">
                  <img
                    src={url}
                    alt={`Reference ${index + 1}`}
                    className="w-full h-auto object-cover rounded"
                  />
                  <button 
                    onClick={() => removeImage(index)}
                    className="absolute top-1 right-1 bg-red-500 text-white p-1 rounded-full"
                    title="Remove image"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              <div className="flex items-center justify-center border-2 border-dashed border-gray-300 dark:border-gray-600 rounded p-4 min-h-[100px]">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileSelect}
                  className="hidden"
                  id="pika-image-input"
                  multiple
                />
                <label 
                  htmlFor="pika-image-input" 
                  className="cursor-pointer flex flex-col items-center"
                >
                  <Plus className="h-8 w-8 text-gray-400" />
                  <span className="text-sm text-gray-500 dark:text-gray-400">Add more</span>
                </label>
              </div>
            </div>
          ) : (
            <div className="py-8">
              <input
                type="file"
                accept="image/*"
                onChange={handleFileSelect}
                className="hidden"
                id="pika-image-input"
                multiple
              />
              <label htmlFor="pika-image-input" className="cursor-pointer">
                <Upload className="mx-auto h-12 w-12 text-gray-400" />
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                  Drop or click to upload images
                </p>
              </label>
            </div>
          )}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Duration</label>
          <select
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          >
            <option value={3}>3 seconds</option>
            <option value={5}>5 seconds</option>
            <option value={8}>8 seconds</option>
            <option value={10}>10 seconds</option>
          </select>
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Quality</label>
          <select
            value={quality}
            onChange={(e) => setQuality(e.target.value as 'standard' | 'high')}
            className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          >
            <option value="standard">Standard (720p)</option>
            <option value="high">High (1080p)</option>
          </select>
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Aspect Ratio</label>
          <select
            value={aspectRatio}
            onChange={(e) => setAspectRatio(e.target.value as any)}
            className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          >
            <option value="16:9">Landscape (16:9)</option>
            <option value="9:16">Portrait (9:16)</option>
            <option value="1:1">Square (1:1)</option>
            <option value="4:5">Portrait (4:5)</option>
            <option value="5:4">Landscape (5:4)</option>
            <option value="3:2">Landscape (3:2)</option>
            <option value="2:3">Portrait (2:3)</option>
          </select>
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Timeout</label>
          <select
            value={timeoutSeconds}
            onChange={(e) => setTimeoutSeconds(Number(e.target.value))}
            className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          >
            <option value={180}>3 minutes</option>
            <option value={300}>5 minutes</option>
            <option value={600}>10 minutes</option>
            <option value={900}>15 minutes</option>
          </select>
        </div>
      </div>
      
      <div className="mb-4">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Enter your prompt (optional)..."
          className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          rows={4}
        />
      </div>
      
      <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-md mb-4 text-sm text-blue-800 dark:text-blue-200">
        <p><strong>Tips:</strong></p>
        <ul className="list-disc pl-5 space-y-1 mt-1">
          <li>Upload 1-3 images for best results</li>
          <li>The quality of your uploaded images affects the output</li>
          <li>Generation can take 3-15 minutes depending on server load</li>
          <li>If generation times out, try increasing the timeout setting</li>
        </ul>
      </div>
      
      <button
        onClick={handleGenerate}
        disabled={isGenerating || referenceImages.length === 0}
        className="w-full py-2 bg-indigo-500 text-white rounded-md hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isGenerating ? 'Weaving Scene...' : 'Weave Scene with Pika'}
      </button>

      {error && (
        <div className="text-red-500 text-sm mt-2">{error}</div>
      )}

      {isGenerating && !error && (
        <div className="space-y-2 mt-4">
          <div className="text-gray-800 dark:text-gray-200 font-medium">{progressStage}</div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
            <div className="bg-indigo-500 h-2.5 rounded-full animate-pulse w-full"></div>
          </div>
          <div className="text-gray-600 dark:text-gray-400 text-sm">{generationProgress}</div>
          <div className="text-gray-600 text-sm text-center mt-1">
            Video generation might take 3-5 minutes. The page will automatically update when complete.
          </div>
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
            draggable="true"
            onClick={handleVideoClick}
            onDragStart={handleDragStart}
            className="w-full rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
            key={videoUrl} // Add a key to force re-render when videoUrl changes
            autoPlay
            loop
            muted
            preload="auto"
          />
          <p className="text-sm text-gray-500 mt-2">
            Click to add to first empty panel, or drag to any panel
          </p>
        </div>
      )}
    </div>
  );
}; 