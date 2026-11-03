import React, { useState, useCallback } from 'react';
import { toast } from 'react-toastify';
import { Upload, X, Loader, Wand2, Info } from 'lucide-react';
import { lumaModifyService, LumaModifyOptions } from '../../services/lumaModifyService';

interface VideoModifyEditorProps {
  videoUrl: string;
  onVideoModified: (modifiedVideoUrl: string) => void;
  onClose: () => void;
  onProcessingStart?: (data: { referenceImage: string; prompt: string; mode: string }) => void;
  onProcessingComplete?: (modifiedVideoUrl: string) => void;
  onProcessingError?: () => void;
  currentProcessingState?: 'idle' | 'processing' | 'completed' | 'error';
  processingData?: {
    referenceImage: string | null;
    prompt: string;
    mode: string;
  };
}

type ProcessingState = 'idle' | 'processing' | 'completed' | 'error';

export const VideoModifyEditor: React.FC<VideoModifyEditorProps> = ({
  videoUrl,
  onVideoModified,
  onClose,
  onProcessingStart,
  onProcessingComplete,
  onProcessingError,
  currentProcessingState = 'idle',
  processingData
}) => {
  console.log('🎬 VideoModifyEditor loaded with videoUrl:', videoUrl);
  
  // Style transfer states
  const [referenceImage, setReferenceImage] = useState<string | null>(
    processingData?.referenceImage || null
  );
  const [prompt, setPrompt] = useState(processingData?.prompt || '');
  const [selectedMode, setSelectedMode] = useState<LumaModifyOptions['mode']>(
    (processingData?.mode as LumaModifyOptions['mode']) || 'adhere_1'
  );
  const [processingState, setProcessingState] = useState<ProcessingState>(
    currentProcessingState === 'processing' ? 'processing' : 'idle'
  );
  const [showModeInfo, setShowModeInfo] = useState(false);

  const availableModes = lumaModifyService.getAvailableModes();

  // Style transfer functions
  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setReferenceImage(event.target.result as string);
        }
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const handleImageDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setReferenceImage(event.target.result as string);
        }
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleModifyVideo = async () => {
    if (!referenceImage) {
      toast.error('Please upload a reference image');
      return;
    }

    setProcessingState('processing');
    
    // Notify parent about processing start
    onProcessingStart?.({
      referenceImage,
      prompt: prompt.trim(),
      mode: selectedMode || 'adhere_1'
    });
    
    try {
      const result = await lumaModifyService.modifyVideo(
        videoUrl, 
        referenceImage, 
        { prompt: prompt.trim() || undefined, mode: selectedMode }
      );
      
      setProcessingState('completed');
      
      // Notify parent about successful completion
      onProcessingComplete?.(result.modifiedVideoUrl);
      
      toast.success('Video modified successfully! Panel updated.', {
        position: 'top-right',
        autoClose: 3000,
      });
      
      // Auto-close modal after success
      setTimeout(() => {
        onClose();
      }, 1500);
      
    } catch (error) {
      console.error('Video modification failed:', error);
      setProcessingState('error');
      
      // Notify parent about error
      onProcessingError?.();
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      toast.error(`Video modification failed: ${errorMessage}`, {
        position: 'top-right',
        autoClose: 5000,
      });
    }
  };

  const getProcessingMessage = () => {
    switch (processingState) {
      case 'processing':
        return '⚡ Processing your video with Ray-2 Flash...';
      case 'completed':
        return '✅ Video modified successfully! Panel updated.';
      case 'error':
        return 'Modification failed. Please try again.';
      default:
        return '';
    }
  };

  return (
    <div className="space-y-4 sm:space-y-5 lg:space-y-6 pb-4">
      {/* Header description */}
      <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3 sm:p-4">
        <div className="flex items-start justify-between">
          <div className="w-full">
            <p className="text-xs sm:text-sm text-purple-700 dark:text-purple-300 mb-2 leading-relaxed">
              <strong>AI Video Restyling with Ray-2 Flash:</strong> Transform your video's aesthetic using a reference image. 
              The AI will restyle the entire video while preserving motion and composition.
            </p>
            <p className="text-xs text-purple-600 dark:text-purple-400">
              🎨 Working on: Current panel video • ⚡ Powered by Luma Ray-2 Flash
            </p>
          </div>
        </div>
      </div>

      {/* Video and Reference Image Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5 lg:gap-6">
        {/* Current Video Preview */}
        <div className="w-full">
          <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Original Video
          </label>
          <div className="relative bg-gray-100 dark:bg-gray-700 rounded-lg overflow-hidden w-full">
            <video 
              src={videoUrl} 
              controls 
              autoPlay
              loop
              preload="metadata"
              muted
              playsInline
              crossOrigin="anonymous"
              className="w-full h-auto aspect-video object-cover max-h-[180px] sm:max-h-[200px] lg:max-h-[240px]"
            />
          </div>
        </div>

        {/* Reference Image Upload */}
        <div className="w-full">
          <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Style Reference <span className="text-red-500">*</span>
          </label>
          <div className="relative w-full">
            {referenceImage ? (
              <div className="relative w-full">
                <img 
                  src={referenceImage} 
                  alt="Style Reference" 
                  className="w-full h-auto aspect-video object-cover rounded-lg border-2 border-dashed border-purple-300 dark:border-purple-600 max-h-[180px] sm:max-h-[200px] lg:max-h-[240px]"
                />
                <button
                  onClick={() => setReferenceImage(null)}
                  className="absolute top-1 right-1 sm:top-2 sm:right-2 p-1 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors"
                  title="Remove image"
                >
                  <X size={14} className="sm:w-4 sm:h-4" />
                </button>
              </div>
            ) : (
              <label 
                className="flex flex-col items-center justify-center w-full h-[120px] sm:h-[140px] lg:h-[180px] cursor-pointer border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                onDrop={handleImageDrop}
                onDragOver={handleDragOver}
              >
                <div className="flex flex-col items-center p-2 sm:p-4 text-center">
                  <Upload className="w-6 h-6 sm:w-8 sm:h-8 text-gray-400 mb-1 sm:mb-2" />
                  <span className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
                    <span className="font-semibold">Click to upload</span> or drag and drop
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400 mt-1">PNG, JPG, WEBP</span>
                </div>
                <input 
                  type="file" 
                  className="hidden" 
                  accept="image/*" 
                  onChange={handleImageUpload}
                />
              </label>
            )}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 leading-relaxed">
            <strong>Style Reference:</strong> Upload an image showing the visual style/aesthetic you want to apply to your video. 
            This should represent lighting, color grading, artistic style, or atmosphere - NOT a replacement scene. 
            Your video's motion and composition will be preserved.
          </p>
        </div>
      </div>

      {/* Controls section */}
      <div className="space-y-4 sm:space-y-5">
        {/* Modification Mode Selection */}
        <div>
          <div className="flex items-center mb-2">
            <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300">
              Modification Strength
            </label>
            <div className="relative ml-2">
              <Info 
                size={14} 
                className="cursor-help text-gray-400 flex-shrink-0"
                onMouseEnter={() => setShowModeInfo(true)}
                onMouseLeave={() => setShowModeInfo(false)}
              />
              {showModeInfo && (
                <div className="absolute bottom-full right-0 sm:left-1/2 sm:transform sm:-translate-x-1/2 mb-2 px-3 py-2 bg-gray-800 text-white text-xs rounded shadow-lg whitespace-normal z-50 w-48 sm:w-64">
                  Choose how much style modification to apply:
                  <br />• <strong>Adhere:</strong> Minimal style changes, motion fully preserved
                  <br />• <strong>Flex:</strong> Balanced style transfer, motion mostly preserved  
                  <br />• <strong>Reimagine:</strong> Major style changes, motion loosely preserved
                </div>
              )}
            </div>
          </div>
          <select
            value={selectedMode}
            onChange={(e) => setSelectedMode(e.target.value as LumaModifyOptions['mode'])}
            className="w-full px-3 py-2 border rounded-md text-gray-700 dark:text-gray-300 dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500 text-xs sm:text-sm"
          >
            {availableModes.map(mode => (
              <option key={mode.value} value={mode.value}>
                {mode.label} - {mode.description}
              </option>
            ))}
          </select>
        </div>

        {/* Optional Prompt */}
        <div>
          <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Additional Instructions (Optional)
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g., 'apply cinematic lighting', 'vintage film look', 'anime art style while preserving motion'..."
            className="w-full px-3 py-2 border rounded-md text-gray-700 dark:text-gray-300 dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none text-xs sm:text-sm"
            rows={3}
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
            Optional: Specify style changes you want while preserving the original motion and composition
          </p>
        </div>
      </div>

      {/* Processing State */}
      {processingState !== 'idle' && (
        <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3 sm:p-4">
          <div className="flex items-start sm:items-center">
            <div className="flex-shrink-0 mr-3 mt-0.5 sm:mt-0">
            {processingState === 'processing' && (
                <Loader size={18} className="sm:w-5 sm:h-5 animate-spin text-purple-500" />
            )}
            {processingState === 'completed' && (
                <div className="w-4 h-4 sm:w-5 sm:h-5 bg-green-500 rounded-full flex items-center justify-center">
                  <X size={10} className="sm:w-3 sm:h-3 text-white rotate-45" />
              </div>
            )}
            {processingState === 'error' && (
                <X size={18} className="sm:w-5 sm:h-5 text-red-500" />
            )}
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 break-words">
              {getProcessingMessage()}
            </span>
          {processingState === 'processing' && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 leading-relaxed">
              You can close this modal and continue working. Your panel will update automatically when complete.
            </p>
          )}
            </div>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row justify-end space-y-2 sm:space-y-0 sm:space-x-3 pt-3 sm:pt-4 border-t border-gray-200 dark:border-gray-600">
        <button
          onClick={onClose}
          className="w-full sm:w-auto px-4 py-2.5 sm:py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 dark:text-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 transition-colors"
        >
          {processingState === 'processing' ? 'Close & Continue Working' : 'Close'}
        </button>
        <button
          onClick={handleModifyVideo}
          disabled={!referenceImage || processingState === 'processing'}
          className="w-full sm:w-auto px-4 py-2.5 sm:py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2 transition-colors text-sm font-medium"
        >
          {processingState === 'processing' ? (
            <>
              <Loader size={14} className="sm:w-4 sm:h-4 animate-spin" />
              <span>Processing...</span>
            </>
          ) : (
            <>
              <Wand2 size={14} className="sm:w-4 sm:h-4" />
              <span>Modify Video</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}; 