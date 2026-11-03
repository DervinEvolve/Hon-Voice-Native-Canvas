import React, { useCallback, useState } from 'react';
import { mediaService } from '../../utils/mediaService';
import { higgsfieldService } from '../../services/higgsfieldService';
import { useComicStore } from '../../store/useComicStore';
import { Panel } from '../../types';
import { nanoid } from 'nanoid';

export const SpeechToVideo: React.FC = () => {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const { currentComic, currentPageIndex, updatePanel } = useComicStore();

  const onDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>, kind: 'image' | 'audio') => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (kind === 'image' && file.type.startsWith('image/')) setImageFile(file);
    if (kind === 'audio' && file.type.startsWith('audio/')) setAudioFile(file);
  }, []);

  const onGenerate = async () => {
    if (!imageFile || !audioFile) {
      setError('Provide both an image and an audio file');
      return;
    }
    setError(null);
    setIsGenerating(true);
    setVideoUrl(null);
    try {
      const imageUrl = await mediaService.upload(imageFile);
      const audioUrl = await mediaService.upload(audioFile);
      const url = await higgsfieldService.speak({ imageUrl, audioUrl, prompt });
      setVideoUrl(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleVideoClick = () => {
    if (!videoUrl || !currentComic || typeof currentPageIndex === 'undefined') return;
    const pages = currentComic.pages?.[currentPageIndex] || [];
    const emptyPanelIndex = pages.findIndex((p: Panel) => !p || !p.url);
    if (emptyPanelIndex !== -1) {
      const panel: Panel = {
        id: nanoid(),
        type: 'video',
        url: videoUrl,
        size: 'medium',
        aspectRatio: 1,
        position: { row: 0, col: 0, rowSpan: 1, colSpan: 1 }
      } as Panel;
      updatePanel(panel, currentPageIndex);
    }
  };

  const handleDragStart = (e: React.DragEvent<HTMLVideoElement>) => {
    if (!videoUrl) return;
    const panel: Panel = {
      id: nanoid(),
      type: 'video',
      url: videoUrl,
      size: 'medium',
      aspectRatio: 1,
      position: { row: 0, col: 0, rowSpan: 1, colSpan: 1 }
    } as Panel;
    e.dataTransfer.setData('application/json', JSON.stringify(panel));
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div
          className="p-4 border-2 border-dashed rounded-lg text-center bg-gray-800 text-gray-300"
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onDrop={(e) => onDrop(e, 'image')}
        >
          {imageFile ? imageFile.name : 'Drop or click to upload image'}
          <input type="file" accept="image/*" className="hidden" id="speak-image" onChange={(e) => e.target.files?.[0] && setImageFile(e.target.files[0])} />
        </div>
        <div
          className="p-4 border-2 border-dashed rounded-lg text-center bg-gray-800 text-gray-300"
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onDrop={(e) => onDrop(e, 'audio')}
        >
          {audioFile ? audioFile.name : 'Drop or click to upload audio'}
          <input type="file" accept="audio/*" className="hidden" id="speak-audio" onChange={(e) => e.target.files?.[0] && setAudioFile(e.target.files[0])} />
        </div>
      </div>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Optional prompt..."
        className="w-full p-2 border rounded-md resize-none focus:ring-2 focus:ring-purple-500 text-white bg-gray-700 border-gray-600 placeholder-gray-400"
        rows={3}
      />

      <button
        onClick={onGenerate}
        disabled={isGenerating || !imageFile || !audioFile}
        className="w-full py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isGenerating ? 'Generating...' : 'Generate Talking Video'}
      </button>

      {error && <div className="text-red-500 text-sm">{error}</div>}
      {videoUrl && (
        <div className="mt-3">
          <video
            src={videoUrl}
            controls
            autoPlay
            loop
            muted
            playsInline
            draggable
            onDragStart={handleDragStart}
            onClick={handleVideoClick}
            className="w-full rounded cursor-move"
          />
          <p className="text-xs text-gray-400 mt-1">Click to add to first empty panel, or drag to any panel</p>
        </div>
      )}
    </div>
  );
};


