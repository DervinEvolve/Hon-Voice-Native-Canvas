import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { Panel } from '../../types';
import { X, MessageSquare, Move, Type, AlignLeft, AlignCenter, AlignRight, Plus, Minus, Wand2, Eraser, Undo, Redo, Shuffle, Upload, Trash2, Loader, Shirt, Info, ZoomIn, ZoomOut, RotateCcw, MoveHorizontal, Pencil, Users, Lock, Box, Video, AudioLines } from 'lucide-react';
import { createPortal } from 'react-dom';
import { sfxService } from '../../services/sfxService';
import MediaContent from '../../components/MediaContent';
import { Model3DViewer } from '../../components/media/Model3DViewer';
import { VideoModifyEditor } from './VideoModifyEditor';
import { fluxService } from '../../services/fluxService';
import { briaService } from '../../services/briaService';
import { easelService } from '../../services/easelService';
import { toast } from 'react-toastify';
import { useMediaLoader } from '../../hooks/useMediaLoader';
import { VIRTUAL_TRY_ON_NOT_AVAILABLE } from '../../config/unavailableFeatures';
import { recraftService, RecraftStyle, RecraftImageSize } from '../../services/recraftService';
import { ideogramService, IdeogramStyle, IdeogramAspectRatio } from '../../services/ideogramService';
import { nanoBananaEditService } from '../../services/nanoBananaEditService';
import { mediaService } from '../../utils/mediaService';
import { nanoid } from 'nanoid';
import { useComicStore } from '../../store/useComicStore';
import { useCollaboration } from '../../contexts/CollaborationContext';
import { fluxKontextService } from '../../services/fluxKontextService';
import { hunyuan3dService } from '../../services/hunyuan3dService';
import { PanelProgressOverlay } from './PanelProgressOverlay';
import { gptImageService, GptImageEditOptions } from '../../services/gptImageService';
import { recraftUpscaleService } from '../../services/recraftUpscaleService';
import { GameViewer } from '../../components/media/GameViewer';
import { PanelObjectTags } from './PanelObjectTags';
import { SAM3MaskOverlay } from './SAM3MaskOverlay';


// Add gradient animation style
const gradientStyle = `
  @keyframes gradient {
    0% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
  }
  
  .animate-gradient {
    background-size: 200% auto;
    animation: gradient 3s linear infinite;
  }

  /* Modal fade-in animation - enhanced with scale and transform */
  @keyframes fadeIn {
    from { 
      opacity: 0;
      transform: scale(0.98) translateY(10px);
    }
    to { 
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }

  .modal-fade-in {
    animation: fadeIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  /* Tab content transition - enhanced to match tab text color change */
  @keyframes tabContentFadeIn {
    0% { opacity: 0; transform: translateY(15px); }
    30% { opacity: 0.3; }
    100% { opacity: 1; transform: translateY(0); }
  }

  /* Panel outline animation */
  @keyframes outlinePulse {
    0% { opacity: 0; }
    100% { opacity: 1; }
  }

  .panel-outline-animation {
    animation: outlinePulse 0.3s ease-in-out forwards;
  }

  /* Panel interaction feedback */
  @keyframes panelHoverScale {
    0% { transform: scale(1); }
    100% { transform: scale(1.02); }
  }

  .panel-hover-effect {
    transition: transform 0.2s ease, box-shadow 0.2s ease;
  }

  .panel-hover-effect:hover {
    transform: scale(1.01);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }

  .panel-active-effect {
    transform: scale(0.98);
    transition: transform 0.1s ease;
  }
`;

// Update the Panel type to include captionLink and aiCaption (if not already in types.ts)
interface ExtendedPanel extends Panel {
  captionLink?: string;
  // aiCaption?: string | null; // Ensure Panel in types.ts has aiCaption
}

// Define the types that MediaContent accepts
type MediaContentType = 'image' | 'video' | 'gif' | '3d';
const isMediaContentType = (type: Panel['type']): type is MediaContentType => {
  return ['image', 'video', 'gif', '3d'].includes(type);
};

type EditingTool = 'text' | 'eraser' | 'faceswap' | 'tryon' | '3d' | 'upscale';
type ProcessingState = 'idle' | 'generating' | 'dreaming' | 'inspiring' | 'reasoning' | 'completed';

interface PanelEditorProps {
  panel: ExtendedPanel;
  onUpdate: (panel: ExtendedPanel, pageIndex?: number) => void;
  onRemove: (panelId: string) => void;
  onClose?: () => void;
  onAddPanel?: (panel: Panel) => void;
}

export const PanelEditor: React.FC<PanelEditorProps & { compact?: boolean }> = ({
  panel,
  onUpdate,
  onRemove,
  onClose,
  onAddPanel,
  compact = false
}) => {
  // Disable collaboration features temporarily
  const disableCollaboration = true;
  
  // Zustand hook for captions and current page index
  const fetchAndSetPanelAICaption = useComicStore((state) => state.fetchAndSetPanelAICaption);
  const currentPageIndex = useComicStore((state) => state.currentPageIndex);
  
  // Add collaboration context hook
  const { isPanelLocked, lockPanel, unlockPanel, activeCollaborators } = useCollaboration();
  
  // Add state for panel locking
  const [isLockingPanel, setIsLockingPanel] = useState(false);
  const [isOwnLock, setIsOwnLock] = useState(false);
  
  // Find who's editing this panel (if anyone)
  const panelEditor = activeCollaborators.find(c => c.selectedPanelId === panel.id);
  
  const [isDraggingCaption, setIsDraggingCaption] = useState(false);
  const [isEditingCaption, setIsEditingCaption] = useState(false);
  const [isEditingImage, setIsEditingImage] = useState(false);
  const [isEditingVideo, setIsEditingVideo] = useState(false);
  const [editPrompt, setEditPrompt] = useState(''); // Always start empty
  const [processingState, setProcessingState] = useState<ProcessingState>('idle');
  const [caption, setCaption] = useState(''); // Always start empty when opening editor
  const [captionLink, setCaptionLink] = useState(panel.captionLink || '');
  const [captionStyle, setCaptionStyle] = useState({
    fontSize: panel.captionStyle?.fontSize || 16,
    fontFamily: panel.captionStyle?.fontFamily || 'Arial',
    backgroundColor: panel.captionStyle?.backgroundColor || 'black',
    opacity: panel.captionStyle?.opacity ?? 0.75,
    textAlign: panel.captionPosition?.align || 'left',
  });
  const [selectedEditingTool, setSelectedEditingTool] = useState<EditingTool>('text');
  const [isDrawing, setIsDrawing] = useState(false);
  const [maskCanvas, setMaskCanvas] = useState<HTMLCanvasElement | null>(null);
  const [_maskImageUrl, setMaskImageUrl] = useState<string | null>(null);
  const [brushSize, setBrushSize] = useState(20);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const cursorCanvasRef = useRef<HTMLCanvasElement>(null);
  const [showEraserTooltip, setShowEraserTooltip] = useState(false);
  const [showFaceSwapTooltip, setShowFaceSwapTooltip] = useState(false);
  const [showTryOnTooltip, setShowTryOnTooltip] = useState(false);
  const [showTextPromptTooltip, setShowTextPromptTooltip] = useState(false);
  const [maskHistory, setMaskHistory] = useState<ImageData[]>([]);
  // SFX modal state
  const [isSfxModalOpen, setIsSfxModalOpen] = useState(false);
  const [sfxPrompt, setSfxPrompt] = useState('');
  const [sfxSeed, setSfxSeed] = useState<number | ''>('');
  const [sfxNumSamples, setSfxNumSamples] = useState<number>(1);
  const [sfxSubmitting, setSfxSubmitting] = useState(false);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [zoomLevel, setZoomLevel] = useState(1);
  const lastX = useRef<number>(0);
  const lastY = useRef<number>(0);

  // Face swap state
  const [faceImage0, setFaceImage0] = useState<string | null>(null);
  const [faceImage1, setFaceImage1] = useState<string | null>(null);
  const [gender0, setGender0] = useState<'' | 'male' | 'female' | 'non-binary'>('');
  const [gender1, setGender1] = useState<'' | 'male' | 'female' | 'non-binary'>('');
  const [workflowType, setWorkflowType] = useState<'user_hair' | 'target_hair'>('user_hair');
  const [upscale, setUpscale] = useState(true);

  // Add new state variables for the Virtual Try-On feature
  const [humanImage, setHumanImage] = useState<string | null>(null);
  const [garmentImage, setGarmentImage] = useState<string | null>(null);

  // Add new state variables for Recraft
  const [selectedModel, setSelectedModel] = useState<'flux' | 'recraft' | 'ideogram' | 'flux-kontext' | 'gpt-image-1' | 'qwen-edit' | 'nano-banana-edit' | 'seedream-edit'>('flux');
  const [seedreamRefs, setSeedreamRefs] = useState<string[]>([]);
  const nanoInputRef = useRef<HTMLInputElement | null>(null);
  const seedreamInputRef = useRef<HTMLInputElement | null>(null);

  // Robust upload helper (uses base64 JSON to avoid multipart edge cases)
  const uploadImages = async (files: File[]): Promise<string[]> => {
    const urls: string[] = [];
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      try {
        const dataUrl: string = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const resp = await fetch('/api/cloudinary-upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file: dataUrl })
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data?.url) urls.push(data.url);
        }
      } catch (e) {
        console.warn('Upload failed:', e);
      }
    }
    return urls;
  };
  const [nanoEditImages, setNanoEditImages] = useState<string[]>([]);
  const [recraftStyle, setRecraftStyle] = useState<RecraftStyle>('digital_illustration/pixel_art');
  const [recraftImageSize, setRecraftImageSize] = useState<RecraftImageSize>('1024x1024');
  const [showRecraftInfo, setShowRecraftInfo] = useState(false);
  
  // Add new state variables for Ideogram
  const [ideogramStyle, setIdeogramStyle] = useState<IdeogramStyle>('auto');
  const [ideogramAspectRatio, setIdeogramAspectRatio] = useState<IdeogramAspectRatio>('1:1');
  const [showIdeogramInfo, setShowIdeogramInfo] = useState(false);
  const [expandPrompt, setExpandPrompt] = useState(true);
  
  // Text prompt history
  const [textPromptHistory, setTextPromptHistory] = useState<string[]>([]);
  const [textPromptHistoryIndex, setTextPromptHistoryIndex] = useState(-1);
  
  // Face swap history
  const [faceSwapHistory, setFaceSwapHistory] = useState<{
    faceImage0: string | null;
    faceImage1: string | null;
    gender0: '' | 'male' | 'female' | 'non-binary';
    gender1: '' | 'male' | 'female' | 'non-binary';
    workflowType: 'user_hair' | 'target_hair';
    upscale: boolean;
  }[]>([]);
  const [faceSwapHistoryIndex, setFaceSwapHistoryIndex] = useState(-1);
  
  // Virtual try-on history
  const [tryOnHistory, setTryOnHistory] = useState<{
    humanImage: string | null;
    garmentImage: string | null;
  }[]>([]);
  const [tryOnHistoryIndex, setTryOnHistoryIndex] = useState(-1);

  const [isRepositioningImage, setIsRepositioningImage] = useState(false);
  const [imagePosition, setImagePosition] = useState<{ x: number; y: number; scale: number }>(() => {
    return panel.imagePosition || { x: 50, y: 50, scale: 1 };
  });
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  
  // Add new state variables for Flux Kontext
  const [showFluxKontextInfo, setShowFluxKontextInfo] = useState(false);

  // Add new state variables for GPT-Image-1
  const [gptImageSize, setGptImageSize] = useState<'auto' | '1024x1024' | '1536x1024' | '1024x1536'>('auto');
  const [gptQuality, setGptQuality] = useState<'auto' | 'low' | 'medium' | 'high'>('auto');
  const [showGptInfo, setShowGptInfo] = useState(false);

  // Add state and handler for 3D generation
  const [isGenerating3D, setIsGenerating3D] = useState(false);
  const handleQuickGenerate3D = async () => {
    setIsGenerating3D(true);
    setProcessingState('generating');
    try {
      // Call backend service with panel.url (image URL) and default options, texturedMesh: true
      const result = await hunyuan3dService.generate3DModel(panel.url, {
        texturedMesh: true,
        // Use other defaults (steps, guidance, octree, etc.)
      });
      setProcessingState('completed');
      onUpdate({ ...panel, type: '3d', url: result.modelGlbUrl });
    } catch (err) {
      toast.error('Failed to generate 3D model');
      setProcessingState('idle');
    } finally {
      setIsGenerating3D(false);
    }
  };

  // Add to PanelEditor state:
  const [activeTab, setActiveTab] = useState<'main' | 'caption' | '3d'>('main');
  const [hunyuanSeed, setHunyuanSeed] = useState<number | undefined>(undefined);
  const [hunyuanTextured, setHunyuanTextured] = useState(true);
  const [hunyuanSteps, setHunyuanSteps] = useState(80);
  const [hunyuanGuidance, setHunyuanGuidance] = useState(8.5);
  const [hunyuanOctree, setHunyuanOctree] = useState(512);
  const [isGenerating3DAdvanced, setIsGenerating3DAdvanced] = useState(false);

  // Upscaling state
  const [isUpscaling, setIsUpscaling] = useState(false);
  const [upscaleSyncMode, setUpscaleSyncMode] = useState(false);
  const [upscaleSafetyChecker, setUpscaleSafetyChecker] = useState(true);

  // Handler for image upscaling
  const handleUpscaleImage = async () => {
    if (!panel.url || panel.type !== 'image') {
      toast.error('Please select an image to upscale');
      return;
    }

    setIsUpscaling(true);
    setProcessingState('generating');
    try {
      const upscaledImageUrl = await recraftUpscaleService.upscaleImage(panel.url, {
        syncMode: upscaleSyncMode,
        enableSafetyChecker: upscaleSafetyChecker
      });
      setProcessingState('completed');
      onUpdate({ ...panel, url: upscaledImageUrl });
      toast.success('Image upscaled successfully!');
    } catch (err) {
      console.error('Upscaling error:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to upscale image');
      setProcessingState('idle');
    } finally {
      setIsUpscaling(false);
    }
  };

  // Handler for advanced 3D generation
  const handleAdvancedGenerate3D = async () => {
    setIsGenerating3DAdvanced(true);
    setProcessingState('generating');
    try {
      const result = await hunyuan3dService.generate3DModel(panel.url, {
        seed: hunyuanSeed,
        numInferenceSteps: hunyuanSteps,
        guidanceScale: hunyuanGuidance,
        octreeResolution: hunyuanOctree,
        texturedMesh: hunyuanTextured,
      });
      setProcessingState('completed');
      onUpdate({ ...panel, type: '3d', url: result.modelGlbUrl });
    } catch (err) {
      toast.error('Failed to generate 3D model');
      setProcessingState('idle');
    } finally {
      setIsGenerating3DAdvanced(false);
    }
  };

  // Reset editPrompt when opening image editor
  useEffect(() => {
    if (isEditingImage) {
      setEditPrompt(''); // Always start with empty prompt
    }
  }, [isEditingImage]);
  
  // Reset caption when opening caption editor
  useEffect(() => {
    if (isEditingCaption) {
      setCaption(''); // Always start with empty caption
    }
  }, [isEditingCaption]);

  // Notify creator to lock zoom-out and show vertical page manager when editor opens
  useEffect(() => {
    // Editor is considered open when any edit mode is active
    const isOpen = isEditingImage || isEditingCaption || isEditingVideo;
    document.dispatchEvent(new CustomEvent('panel-editor-open-state', { detail: { open: isOpen } }));
  }, [isEditingImage, isEditingCaption, isEditingVideo]);

  // Initialize canvas for eraser tool
  useEffect(() => {
    if (isEditingImage && selectedEditingTool === 'eraser' && canvasRef.current && imageRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      
      if (ctx && imageRef.current.complete) {
        setupCanvas();
      } else {
        imageRef.current.onload = setupCanvas;
      }
    }
  }, [isEditingImage, selectedEditingTool]);

  // Update setupCanvas to account for zoom level
  useEffect(() => {
    if (canvasRef.current && imageRef.current && imageRef.current.complete && selectedEditingTool === 'eraser') {
      setupCanvas();
    }
  }, [zoomLevel, selectedEditingTool]);

  useEffect(() => {
    if (selectedEditingTool === 'eraser' && canvasRef.current && cursorCanvasRef.current) {
      const canvas = canvasRef.current;
      
      // Add mouse move event listener to the canvas for cursor
      const handleMouseMoveForCursor = (e: MouseEvent) => {
        drawBrushCursor(e);
      };
      
      canvas.addEventListener('mousemove', handleMouseMoveForCursor);
      
      return () => {
        canvas.removeEventListener('mousemove', handleMouseMoveForCursor);
      };
    }
  }, [selectedEditingTool, brushSize, zoomLevel]);

  const setupCanvas = async () => {
    if (!canvasRef.current || !imageRef.current) return;
    
    const canvas = canvasRef.current;
    const img = imageRef.current;
    
    // Set canvas dimensions to match the image
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    
    // Get context with willReadFrequently set to true for better performance
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    
    // Create a new canvas for the mask
    const maskCanvasElement = document.createElement('canvas');
    maskCanvasElement.width = canvas.width;
    maskCanvasElement.height = canvas.height;
    const maskCtx = maskCanvasElement.getContext('2d', { willReadFrequently: true });
    
    if (maskCtx) {
      // Fill with black (transparent in the mask)
      maskCtx.fillStyle = 'black';
      maskCtx.fillRect(0, 0, maskCanvasElement.width, maskCanvasElement.height);
      setMaskCanvas(maskCanvasElement);
      
      // Initialize history with empty mask
      const initialMaskData = maskCtx.getImageData(0, 0, maskCanvasElement.width, maskCanvasElement.height);
      setMaskHistory([initialMaskData]);
      setHistoryIndex(0);
      
      // Draw the original image on the canvas
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    }
    
    // Initialize cursor canvas with the same dimensions
    if (cursorCanvasRef.current) {
      const cursorCanvas = cursorCanvasRef.current;
      cursorCanvas.width = canvas.width;
      cursorCanvas.height = canvas.height;
    }
  };

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (!canvasRef.current || !maskCanvas) return;
    
    setIsDrawing(true);
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    
    // Calculate the correct position based on zoom level
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    
    drawOnMask(x, y);
    lastX.current = x;
    lastY.current = y;
  };

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    if (!isDrawing || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    
    // Calculate the correct position based on zoom level
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    
    drawOnMask(x, y);
    lastX.current = x;
    lastY.current = y;
    
    // Draw cursor
    drawBrushCursor(e);
  };

  const handleCanvasMouseUp = () => {
    setIsDrawing(false);
    
    // Save current state to history
    if (maskCanvas) {
      const ctx = maskCanvas.getContext('2d');
      if (ctx) {
        const currentMaskData = ctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
        
        // Remove any forward history if we're not at the end
        const newHistory = maskHistory.slice(0, historyIndex + 1);
        
        // Add current state to history
        setMaskHistory([...newHistory, currentMaskData]);
        setHistoryIndex(newHistory.length);
      }
    }
  };

  const handleCanvasMouseLeave = () => {
    setIsDrawing(false);
    
    // Clear cursor when mouse leaves canvas
    if (cursorCanvasRef.current) {
      const cursorCtx = cursorCanvasRef.current.getContext('2d');
      if (cursorCtx) {
        cursorCtx.clearRect(0, 0, cursorCanvasRef.current.width, cursorCanvasRef.current.height);
      }
    }
  };

  const drawOnMask = (x: number, y: number) => {
    if (!maskCanvas) return;
    
    const ctx = maskCanvas.getContext('2d');
    if (!ctx) return;
    
    // Draw white on the mask (white = area to erase)
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.arc(x, y, brushSize, 0, Math.PI * 2);
    ctx.fill();
    
    // Update the preview on the main canvas
    updateCanvasPreview();
  };

  const updateCanvasPreview = () => {
    if (!canvasRef.current || !maskCanvas || !imageRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw the original image
    ctx.drawImage(imageRef.current, 0, 0, canvas.width, canvas.height);
    
    // Draw the mask with transparency
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#1d4ed8'; // Darker blue (#1d4ed8 is blue-700 in Tailwind)
    
    // Get mask data
    const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
    if (!maskCtx) return;
    
    const maskData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
    const data = maskData.data;
    
    // Create a temporary canvas to draw the mask
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
    if (!tempCtx) return;
    
    // Create an ImageData object for the temporary canvas
    const tempImageData = tempCtx.createImageData(canvas.width, canvas.height);
    const tempData = tempImageData.data;
    
    // Copy mask data to temp canvas, setting darker blue where mask is white
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] === 255) { // If white in mask
        tempData[i] = 29;     // R (29 for #1d4ed8)
        tempData[i + 1] = 78; // G (78 for #1d4ed8)
        tempData[i + 2] = 216; // B (216 for #1d4ed8)
        tempData[i + 3] = 153; // A (60% opacity for better visibility)
      } else {
        tempData[i + 3] = 0; // Transparent
      }
    }
    
    tempCtx.putImageData(tempImageData, 0, 0);
    ctx.drawImage(tempCanvas, 0, 0);
    ctx.globalAlpha = 1.0;
  };

  // Function to draw the brush cursor
  const drawBrushCursor = (e: MouseEvent | React.MouseEvent) => {
    if (!cursorCanvasRef.current || !canvasRef.current) return;
    
    const cursorCanvas = cursorCanvasRef.current;
    const cursorCtx = cursorCanvas.getContext('2d');
    if (!cursorCtx) return;
    
    // Clear previous cursor
    cursorCtx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    
    // Calculate the correct position based on zoom level
    // When zoomed in, the canvas is larger than its display size
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    // Calculate cursor position in canvas coordinates
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    
    // Draw cursor circle
    cursorCtx.beginPath();
    cursorCtx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
    cursorCtx.strokeStyle = 'rgba(0, 0, 255, 0.8)';
    cursorCtx.lineWidth = 2;
    cursorCtx.stroke();
  };

  const handleClearMask = () => {
    if (maskCanvas) {
      const ctx = maskCanvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
      }
    }
    
    // Also clear the cursor canvas
    if (cursorCanvasRef.current) {
      const cursorCtx = cursorCanvasRef.current.getContext('2d');
      if (cursorCtx) {
        cursorCtx.clearRect(0, 0, cursorCanvasRef.current.width, cursorCanvasRef.current.height);
      }
    }
    
    updateCanvasPreview();
  };

  const handleApplyEraser = async () => {
    if (!maskCanvas || !panel.url) return;
    
    setProcessingState('generating');
    
    try {
      // Convert mask canvas to data URL
      const maskDataUrl = maskCanvas.toDataURL('image/png');
      setMaskImageUrl(maskDataUrl);
      
      console.log('Applying eraser with mask:', maskDataUrl.substring(0, 100) + '...');
      console.log('Original image URL:', panel.url);
      
      // Call the Bria Eraser service
      const editedImageUrl = await briaService.eraseObjectFromImage(panel.url, maskDataUrl);
      
      setProcessingState('dreaming');
      
      // Short delay to show the state transition
      await new Promise(resolve => setTimeout(resolve, 500));
      
      console.log('Received edited image URL:', editedImageUrl);
      
      // Update the panel with the edited image
      onUpdate({
        ...panel,
        url: editedImageUrl
      });
      
      setProcessingState('completed');
      
      // Reset state after a short delay
      setTimeout(() => {
        setProcessingState('idle');
        setIsEditingImage(false);
        setSelectedEditingTool('text');
        toast.success('Object erased successfully!');
      }, 1000);
    } catch (error) {
      console.error('Failed to erase object:', error);
      toast.error('Failed to erase object. Please try again.');
      setProcessingState('idle');
    }
  };

  const handleCaptionDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingCaption(true);
  };

  const handleCaptionDrag = (e: React.MouseEvent) => {
    if (!isDraggingCaption || !containerRef.current) return;

    const container = containerRef.current.getBoundingClientRect();
    const x = ((e.clientX - container.left) / container.width) * 100;
    const y = ((e.clientY - container.top) / container.height) * 100;

    onUpdate({
      ...panel,
      captionPosition: {
        ...panel.captionPosition || { vertical: 'bottom', align: captionStyle.textAlign },
        x: Math.max(0, Math.min(100, x)),
        y: Math.max(0, Math.min(100, y)),
      },
    });
  };

  const handleCaptionDragEnd = () => {
    setIsDraggingCaption(false);
  };

  const handleSaveCaption = () => {
    onUpdate({
      ...panel,
      caption,
      captionLink,
      captionPosition: {
        ...panel.captionPosition || { x: 50, y: 90, vertical: 'bottom' },
        align: captionStyle.textAlign,
      },
      captionStyle: {
        fontSize: captionStyle.fontSize,
        fontFamily: captionStyle.fontFamily,
        backgroundColor: captionStyle.backgroundColor,
        opacity: captionStyle.opacity,
      },
    });
    setIsEditingCaption(false);
  };

  const handleFontSizeChange = (delta: number) => {
    setCaptionStyle(prev => ({
      ...prev,
      fontSize: Math.max(12, Math.min(32, prev.fontSize + delta)),
    }));
  };

  const handleOpacityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCaptionStyle(prev => ({
      ...prev,
      opacity: parseFloat(e.target.value),
    }));
  };

  const handleAddPanel = (panel: Panel) => {
    onAddPanel?.(panel);
  };

  const handleAIEdit = async () => {
    if (!editPrompt.trim()) {
      toast.error('Please enter a prompt');
      return;
    }

    setProcessingState('generating');

    try {
      let resultUrl: string;
      
      if (selectedModel === 'recraft') {
        resultUrl = await recraftService.generateImage(editPrompt, {
          style: recraftStyle,
          image_size: recraftImageSize
        });
      } else if (selectedModel === 'ideogram') {
        resultUrl = await ideogramService.generateImage(editPrompt, {
          style: ideogramStyle,
          aspect_ratio: ideogramAspectRatio,
          expand_prompt: expandPrompt
        });
      } else if (selectedModel === 'flux-kontext') {
        try {
          // Use Flux Kontext Max service to edit the existing image
          resultUrl = await fluxKontextService.editImage(editPrompt, panel.url);
        } catch (error) {
          console.error('Flux Kontext edit failed:', error);
          // Show a more descriptive error message
          if (error instanceof Error) {
            toast.error(`Flux Kontext edit failed: ${error.message}. Try a different edit prompt or model.`);
          } else {
            toast.error('Flux Kontext edit failed. Try a different edit prompt or model.');
          }
          setProcessingState('idle');
          return;
        }
      } else if (selectedModel === 'gpt-image-1') {
        try {
          // Use GPT-Image-1 service to edit the existing image
          resultUrl = await gptImageService.editImage(editPrompt, panel.url, {
            imageSize: gptImageSize,
            quality: gptQuality
          });
        } catch (error) {
          console.error('GPT-Image-1 edit failed:', error);
          
          // Show a more descriptive error message
          if (error instanceof Error) {
            toast.error(`GPT-Image-1 edit failed: ${error.message}. Try a different edit prompt or model.`);
          } else {
            toast.error('GPT-Image-1 edit failed. Try a different edit prompt or model.');
          }
          
          setProcessingState('idle');
          return;
        }
      } else if (selectedModel === 'qwen-edit') {
        try {
          const { qwenImageEditService } = await import('../../services/qwenImageEditService');
          resultUrl = await qwenImageEditService.editImage(editPrompt, panel.url, {
            image_size: gptImageSize as any
          } as any);
        } catch (error) {
          console.error('Qwen Image Edit failed:', error);
          if (error instanceof Error) {
            toast.error(`Qwen Image Edit failed: ${error.message}`);
          } else {
            toast.error('Qwen Image Edit failed. Try a different edit prompt or model.');
          }
          setProcessingState('idle');
          return;
        }
      } else if (selectedModel === 'nano-banana-edit') {
        try {
          // Always include the base panel image first, then validated refs
          const validRefs = (nanoEditImages || []).filter(u => typeof u === 'string' && /^https?:\/\//.test(u));
          const dedup = (arr: string[]) => Array.from(new Set(arr));
          const images = dedup([panel.url, ...validRefs]).slice(0, 10);
          resultUrl = await nanoBananaEditService.editImage(editPrompt, images, { num_images: 1 });
        } catch (error) {
          console.error('Nano Banana Pro edit failed:', error);
          if (error instanceof Error) {
            toast.error(`Nano Banana Pro edit failed: ${error.message}`);
          } else {
            toast.error('Nano Banana Pro edit failed. Try a different edit prompt or model.');
          }
          setProcessingState('idle');
          return;
        }
      } else if (selectedModel === 'seedream-edit') {
        try {
          const { seedreamService } = await import('../../services/seedreamService');
          const validRefs = (seedreamRefs || []).filter(u => typeof u === 'string' && /^https?:\/\//.test(u));
          if (validRefs.length > 0) {
            // Use Edit with image_urls (base image first) to mirror FAL playground behavior
            const image_urls = Array.from(new Set([panel.url, ...validRefs])).slice(0, 8);
            resultUrl = await seedreamService.editImage(editPrompt, { image_urls });
          } else {
            // Standard edit of the base image
            resultUrl = await seedreamService.editImage(editPrompt, { image_url: panel.url });
          }
        } catch (error) {
          console.error('Seadream edit failed:', error);
          toast.error(error instanceof Error ? `Seadream edit failed: ${error.message}` : 'Seadream edit failed');
          setProcessingState('idle');
          return;
        }
      } else {
        // Use the existing Flux service
        resultUrl = await fluxService.generateImage(editPrompt);
      }

      setProcessingState('dreaming');
      
      // Short delay to show the state transition
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Update the panel with the new image and store the prompt in the caption field
      onUpdate({
        ...panel,
        url: resultUrl,
        caption: editPrompt // Store the prompt in the caption field
      });

      setProcessingState('completed');
      
      // Reset state after a short delay
      setTimeout(() => {
        setProcessingState('idle');
        setIsEditingImage(false);
        setSelectedEditingTool('text');
        toast.success('Image generated successfully!');
      }, 1000);
    } catch (error) {
      console.error('Failed to generate image:', error);
      
      let errorMessage = 'Failed to generate image. Please try again.';
      
      if (error instanceof Error) {
        errorMessage = `Failed to generate image: ${error.message}. Please try again.`;
      }
      
      toast.error(errorMessage);
      setProcessingState('idle');
    }
  };

  const resetEraserTool = () => {
    if (maskCanvas) {
      const ctx = maskCanvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
      }
    }
    
    if (canvasRef.current && imageRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (ctx && imageRef.current.complete) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(imageRef.current, 0, 0, canvas.width, canvas.height);
      }
    }
  };

  const isVideo = (url: string) => {
    return url?.includes('.mp4') || url?.includes('.webm') || url?.includes('.mov');
  };

  const handleUndo = () => {
    if (historyIndex > 0 && maskCanvas) {
      const newIndex = historyIndex - 1;
      const previousState = maskHistory[newIndex];
      
      const ctx = maskCanvas.getContext('2d');
      if (ctx) {
        ctx.putImageData(previousState, 0, 0);
        setHistoryIndex(newIndex);
        updateCanvasPreview();
      }
    }
  };

  const handleRedo = () => {
    if (historyIndex < maskHistory.length - 1 && maskCanvas) {
      const newIndex = historyIndex + 1;
      const nextState = maskHistory[newIndex];
      
      const ctx = maskCanvas.getContext('2d');
      if (ctx) {
        ctx.putImageData(nextState, 0, 0);
        setHistoryIndex(newIndex);
        updateCanvasPreview();
      }
    }
  };

  // Text prompt undo/redo handlers
  const handleTextPromptUndo = () => {
    if (textPromptHistoryIndex > 0) {
      const newIndex = textPromptHistoryIndex - 1;
      const previousPrompt = textPromptHistory[newIndex];
      setEditPrompt(previousPrompt);
      setTextPromptHistoryIndex(newIndex);
    }
  };

  const handleTextPromptRedo = () => {
    if (textPromptHistoryIndex < textPromptHistory.length - 1) {
      const newIndex = textPromptHistoryIndex + 1;
      const nextPrompt = textPromptHistory[newIndex];
      setEditPrompt(nextPrompt);
      setTextPromptHistoryIndex(newIndex);
    }
  };

  // Save text prompt to history
  const saveTextPromptToHistory = (prompt: string) => {
    // Remove any forward history if we're not at the end
    const newHistory = textPromptHistory.slice(0, textPromptHistoryIndex + 1);
    
    // Only add to history if the prompt is different from the last one
    if (newHistory.length === 0 || newHistory[newHistory.length - 1] !== prompt) {
      const updatedHistory = [...newHistory, prompt];
      setTextPromptHistory(updatedHistory);
      setTextPromptHistoryIndex(updatedHistory.length - 1);
    }
  };

  // Face swap undo/redo handlers
  const handleFaceSwapUndo = () => {
    if (faceSwapHistoryIndex > 0) {
      const newIndex = faceSwapHistoryIndex - 1;
      const previousState = faceSwapHistory[newIndex];
      
      setFaceImage0(previousState.faceImage0);
      setFaceImage1(previousState.faceImage1);
      setGender0(previousState.gender0);
      setGender1(previousState.gender1);
      setWorkflowType(previousState.workflowType);
      setUpscale(previousState.upscale);
      
      setFaceSwapHistoryIndex(newIndex);
    }
  };

  const handleFaceSwapRedo = () => {
    if (faceSwapHistoryIndex < faceSwapHistory.length - 1) {
      const newIndex = faceSwapHistoryIndex + 1;
      const nextState = faceSwapHistory[newIndex];
      
      setFaceImage0(nextState.faceImage0);
      setFaceImage1(nextState.faceImage1);
      setGender0(nextState.gender0);
      setGender1(nextState.gender1);
      setWorkflowType(nextState.workflowType);
      setUpscale(nextState.upscale);
      
      setFaceSwapHistoryIndex(newIndex);
    }
  };

  // Save face swap state to history
  const saveFaceSwapToHistory = () => {
    const currentState = {
      faceImage0,
      faceImage1,
      gender0,
      gender1,
      workflowType,
      upscale
    };
    
    // Remove any forward history if we're not at the end
    const newHistory = faceSwapHistory.slice(0, faceSwapHistoryIndex + 1);
    
    // Only add to history if the state is different from the last one
    if (newHistory.length === 0 || 
        JSON.stringify(newHistory[newHistory.length - 1]) !== JSON.stringify(currentState)) {
      const updatedHistory = [...newHistory, currentState];
      setFaceSwapHistory(updatedHistory);
      setFaceSwapHistoryIndex(updatedHistory.length - 1);
    }
  };

  // Virtual try-on undo/redo handlers
  const handleTryOnUndo = () => {
    if (tryOnHistoryIndex > 0) {
      const newIndex = tryOnHistoryIndex - 1;
      const previousState = tryOnHistory[newIndex];
      
      setHumanImage(previousState.humanImage);
      setGarmentImage(previousState.garmentImage);
      
      setTryOnHistoryIndex(newIndex);
    }
  };

  const handleTryOnRedo = () => {
    if (tryOnHistoryIndex < tryOnHistory.length - 1) {
      const newIndex = tryOnHistoryIndex + 1;
      const nextState = tryOnHistory[newIndex];
      
      setHumanImage(nextState.humanImage);
      setGarmentImage(nextState.garmentImage);
      
      setTryOnHistoryIndex(newIndex);
    }
  };

  // Save try-on state to history
  const saveTryOnToHistory = () => {
    const currentState = {
      humanImage,
      garmentImage
    };
    
    // Remove any forward history if we're not at the end
    const newHistory = tryOnHistory.slice(0, tryOnHistoryIndex + 1);
    
    // Only add to history if the state is different from the last one
    if (newHistory.length === 0 || 
        JSON.stringify(newHistory[newHistory.length - 1]) !== JSON.stringify(currentState)) {
      const updatedHistory = [...newHistory, currentState];
      setTryOnHistory(updatedHistory);
      setTryOnHistoryIndex(updatedHistory.length - 1);
    }
  };

  const handleFaceImageUpload = (imageNumber: 0 | 1) => (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      
      reader.onload = (event) => {
        if (event.target && typeof event.target.result === 'string') {
          if (imageNumber === 0) {
            setFaceImage0(event.target.result);
          } else {
            setFaceImage1(event.target.result);
          }
          // Save to history after updating state
          setTimeout(() => saveFaceSwapToHistory(), 0);
        }
      };
      
      reader.readAsDataURL(file);
    }
  };

  const handleFaceImageDrop = (imageNumber: 0 | 1) => (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      const reader = new FileReader();
      
      reader.onload = (event) => {
        if (event.target && typeof event.target.result === 'string') {
          if (imageNumber === 0) {
            setFaceImage0(event.target.result);
          } else {
            setFaceImage1(event.target.result);
          }
          // Save to history after updating state
          setTimeout(() => saveFaceSwapToHistory(), 0);
        }
      };
      
      reader.readAsDataURL(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleFaceSwap = async () => {
    if (!faceImage0 || !panel.url) {
      toast.error('Please upload at least one face image');
      return;
    }
    
    setProcessingState('generating');
    
    try {
      // Show a loading toast that we'll update with progress
      const loadingToastId = toast.loading('Processing face swap...');
      
      const swappedImageUrl = await easelService.swapFaces(
        faceImage0,
        panel.url,
        {
          gender0,
          faceImage1: faceImage1 || undefined,
          gender1: faceImage1 ? gender1 : undefined,
          workflowType,
          upscale
        }
      );
      
      // Update the loading toast
      toast.update(loadingToastId, { 
        render: 'Face swap completed!', 
        type: 'success',
        isLoading: false,
        autoClose: 3000
      });
      
      setProcessingState('dreaming');
      
      // Short delay to show the state transition
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Update the panel with the face-swapped image
      onUpdate({
        ...panel,
        url: swappedImageUrl
      });
      
      setProcessingState('inspiring');
      
      // Short delay to show the state transition
      await new Promise(resolve => setTimeout(resolve, 500));
      
      setProcessingState('completed');
      
      // Reset state after a short delay
      setTimeout(() => {
        setProcessingState('idle');
        setIsEditingImage(false);
        setSelectedEditingTool('text');
      }, 1000);
    } catch (error) {
      console.error('Failed to swap faces:', error);
      
      // Extract the error message
      const errorMessage = error instanceof Error 
        ? error.message 
        : 'Failed to swap faces. Please try again.';
        
      toast.error(errorMessage);
      setProcessingState('idle');
    }
  };

  // Add handlers for the Virtual Try-On feature
  const handleHumanImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setHumanImage(event.target.result as string);
          // Save to history after updating state
          setTimeout(() => saveTryOnToHistory(), 0);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleGarmentImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setGarmentImage(event.target.result as string);
          // Save to history after updating state
          setTimeout(() => saveTryOnToHistory(), 0);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleHumanImageDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setHumanImage(event.target.result as string);
          // Save to history after updating state
          setTimeout(() => saveTryOnToHistory(), 0);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleGarmentImageDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setGarmentImage(event.target.result as string);
          // Save to history after updating state
          setTimeout(() => saveTryOnToHistory(), 0);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // No try-on provider is connected. This used to send the person's photo to
  // image-to-video with the prompt "virtual try-on" and put the video in the
  // panel; it now says plainly that the feature is not available.
  const handleVirtualTryOn = async () => {
    toast.error(VIRTUAL_TRY_ON_NOT_AVAILABLE);
  };

  // Initialize history when selecting a tool
  const handleToolSelect = (tool: EditingTool) => {
    setSelectedEditingTool(tool);
    
    // Initialize history for the selected tool if it's empty
    if (tool === 'text' && textPromptHistory.length === 0) {
      setTextPromptHistory([editPrompt]);
      setTextPromptHistoryIndex(0);
    } else if (tool === 'faceswap' && faceSwapHistory.length === 0) {
      const initialState = {
        faceImage0,
        faceImage1,
        gender0,
        gender1,
        workflowType,
        upscale
      };
      setFaceSwapHistory([initialState]);
      setFaceSwapHistoryIndex(0);
    } else if (tool === 'tryon' && tryOnHistory.length === 0) {
      const initialState = {
        humanImage,
        garmentImage
      };
      setTryOnHistory([initialState]);
      setTryOnHistoryIndex(0);
    }
  };

  // Helper function to get style category
  const getStyleCategory = (style: RecraftStyle): string => {
    if (style.startsWith('realistic_image')) return 'Realistic';
    if (style.startsWith('digital_illustration')) return 'Digital Illustration';
    if (style.startsWith('vector_illustration')) return 'Vector';
    return 'Other';
  };
  
  // Helper function to get style name
  const getStyleName = (style: RecraftStyle): string => {
    const parts = style.split('/');
    if (parts.length === 1) return parts[0].split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    return parts[1].split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  };
  
  // Group styles by category
  const groupedStyles: Record<string, RecraftStyle[]> = {
    'Realistic': [],
    'Digital Illustration': [],
    'Vector': []
  };
  
  // Populate a subset of styles for each category
  const popularStyles: RecraftStyle[] = [
    'realistic_image',
    'realistic_image/b_and_w',
    'realistic_image/hdr',
    'realistic_image/studio_portrait',
    'digital_illustration',
    'digital_illustration/pixel_art',
    'digital_illustration/hand_drawn',
    'digital_illustration/pixel_art',
    'digital_illustration/hard_comics',
    'vector_illustration',
    'vector_illustration/line_art',
    'vector_illustration/engraving'
  ];
  
  popularStyles.forEach(style => {
    const category = getStyleCategory(style);
    if (groupedStyles[category]) {
      groupedStyles[category].push(style);
    }
  });

  // Helper function to get the processing state text
  const getProcessingStateText = () => {
    switch (processingState) {
      case 'generating':
        return 'Generating...';
      case 'dreaming':
        return 'Dreaming...';
      case 'inspiring':
        return 'Inspiring...';
      case 'reasoning':
        return 'Reasoning...';
      case 'completed':
        return 'Completed!';
      default:
        return 'Apply';
    }
  };

  // Update gender selection handlers to save to history
  const handleGenderChange = (imageNumber: 0 | 1, value: '' | 'male' | 'female' | 'non-binary') => {
    if (imageNumber === 0) {
      setGender0(value);
    } else {
      setGender1(value);
    }
    // Save to history after updating state
    setTimeout(() => saveFaceSwapToHistory(), 0);
  };

  // Update workflow type handler to save to history
  const handleWorkflowTypeChange = (value: 'user_hair' | 'target_hair') => {
    setWorkflowType(value);
    // Save to history after updating state
    setTimeout(() => saveFaceSwapToHistory(), 0);
  };

  // Update upscale handler to save to history
  const handleUpscaleChange = (value: boolean) => {
    setUpscale(value);
    // Save to history after updating state
    setTimeout(() => saveFaceSwapToHistory(), 0);
  };

  // Update imagePosition when panel changes
  useEffect(() => {
    setImagePosition(panel.imagePosition || { x: 50, y: 50, scale: 1 });
  }, [panel.id, panel.imagePosition]);

  // Image repositioning handlers
  const handleImageMouseDown = (e: React.MouseEvent) => {
    if (!isRepositioningImage || panel.type !== 'image') return;
    
    // Prevent default to avoid text selection during drag
    e.preventDefault();
    
    // Only proceed if we're not clicking on a button
    const target = e.target as HTMLElement;
    if (target.closest('button')) return;
    
    setIsDraggingImage(true);
    
    if (containerRef.current) {
      const container = containerRef.current.getBoundingClientRect();
      setStartPos({
        x: e.clientX - container.left,
        y: e.clientY - container.top,
      });
    }
  };

  // Update the handleImageMouseMove function to properly handle dragging
  const handleImageMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingImage || !isRepositioningImage) return;

    // Prevent default to avoid text selection during drag
    e.preventDefault();

    if (containerRef.current) {
      const container = containerRef.current.getBoundingClientRect();
      const deltaX = ((e.clientX - container.left) - startPos.x) / container.width * 100;
      const deltaY = ((e.clientY - container.top) - startPos.y) / container.height * 100;

      setImagePosition(prev => {
        // Calculate the maximum offset based on the scale
        const maxOffset = Math.max(0, (prev.scale - 1) * 50);
        
        // Update position with constraints
        const newX = Math.max(50 - maxOffset, Math.min(50 + maxOffset, prev.x - deltaX));
        const newY = Math.max(50 - maxOffset, Math.min(50 + maxOffset, prev.y - deltaY));
        
        return {
          ...prev,
          x: newX,
          y: newY,
        };
      });

      setStartPos({
        x: e.clientX - container.left,
        y: e.clientY - container.top,
      });
    }
  };

  const handleImageMouseUp = () => {
    if (isDraggingImage) {
      // Save the position to the panel
      onUpdate({
        ...panel,
        imagePosition: imagePosition
      });
      setIsDraggingImage(false);
    }
  };

  // Update the handleImageZoom function to properly handle zooming
  const handleImageZoom = (delta: number) => {
    if (!isRepositioningImage || panel.type !== 'image') return;
    
    setImagePosition(prev => {
      // Calculate new scale with constraints
      const newScale = Math.max(1, Math.min(3, prev.scale + delta));
      
      // Calculate the maximum offset based on the new scale
      const maxOffset = Math.max(0, (newScale - 1) * 50);
      
      // Ensure position stays within bounds with the new scale
      return {
        ...prev,
        scale: newScale,
        x: Math.max(50 - maxOffset, Math.min(50 + maxOffset, prev.x)),
        y: Math.max(50 - maxOffset, Math.min(50 + maxOffset, prev.y)),
      };
    });
    
    // Save the position to the panel immediately to avoid timing issues
    onUpdate({
      ...panel,
      imagePosition: {
        ...imagePosition,
        scale: Math.max(1, Math.min(3, imagePosition.scale + delta))
      }
    });
  };

  const handleImageReset = () => {
    const resetPosition = { x: 50, y: 50, scale: 1 };
    setImagePosition(resetPosition);
    
    // Save the reset position to the panel
    onUpdate({
      ...panel,
      imagePosition: resetPosition
    });
  };
  
  const toggleRepositioningMode = () => {
    // If we're turning off repositioning mode, make sure to save the current position
    if (isRepositioningImage) {
      onUpdate({
        ...panel,
        imagePosition: imagePosition
      });
    }
    setIsRepositioningImage(!isRepositioningImage);
  };

  // Add cleanup effect for blob URLs
  useEffect(() => {
    return () => {
      // Cleanup face image blob URLs
      if (faceImage0?.startsWith('blob:')) {
        URL.revokeObjectURL(faceImage0);
      }
      if (faceImage1?.startsWith('blob:')) {
        URL.revokeObjectURL(faceImage1);
      }
      if (humanImage?.startsWith('blob:')) {
        URL.revokeObjectURL(humanImage);
      }
      if (garmentImage?.startsWith('blob:')) {
        URL.revokeObjectURL(garmentImage);
      }
    };
  }, [faceImage0, faceImage1, humanImage, garmentImage]);

  // Effect to lock panel when editing starts
  useEffect(() => {
    // Skip collaboration features if disabled
    if (disableCollaboration) return;
    
    const acquireLock = async () => {
      if (isEditingImage || isEditingCaption) {
        setIsLockingPanel(true);
        const lockAcquired = await lockPanel(panel.id);
        setIsLockingPanel(false);
        setIsOwnLock(lockAcquired);
      } else if (isOwnLock) {
        unlockPanel(panel.id);
        setIsOwnLock(false);
      }
    };
    
    acquireLock();
    
    // Cleanup: release lock when component unmounts or editing ends
    return () => {
      if (isOwnLock) {
        unlockPanel(panel.id);
        setIsOwnLock(false);
      }
    };
  }, [isEditingImage, isEditingCaption, panel.id, lockPanel, unlockPanel]);
  // Removed isOwnLock from the dependency array to prevent infinite loop

  // Add a visual indicator for locked panels
  const renderLockStatus = () => {
    const isPanelCurrentlyLocked = isPanelLocked(panel.id);
    
    if (isLockingPanel) {
      return (
        <div className="absolute top-2 right-2 z-10">
          <div className="bg-gray-800/80 backdrop-blur-sm p-1.5 rounded-full animate-pulse">
            <Lock className="w-4 h-4 text-yellow-400" />
          </div>
        </div>
      );
    }
    
    if (isPanelCurrentlyLocked && panelEditor) {
      return (
        <div className="absolute top-2 right-2 z-10">
          <div 
            className="bg-gray-800/80 backdrop-blur-sm p-1.5 rounded-full flex items-center space-x-1"
            title={`Being edited by ${panelEditor.username}`}
          >
            <Lock className="w-4 h-4 text-red-400" />
            {panelEditor.avatarUrl ? (
              <img 
                src={panelEditor.avatarUrl} 
                alt={panelEditor.username}
                className="w-4 h-4 rounded-full"
              />
            ) : (
              <Users className="w-4 h-4 text-blue-400" />
            )}
          </div>
        </div>
      );
    }
    
    if (isOwnLock) {
      return (
        <div className="absolute top-2 right-2 z-10">
          <div className="bg-gray-800/80 backdrop-blur-sm p-1.5 rounded-full">
            <Lock className="w-4 h-4 text-green-400" />
          </div>
        </div>
      );
    }
    
    return null;
  };
  
  // Now insert the renderLockStatus function in the appropriate place in the component return statement
  // Look for a good spot to add it - typically near the top of the panel component tree
  
  // Add the renderLockStatus to the component return, look for the main panel container div
  
  // We need to find the main component return statement to add our lock status
  // This is typically a big block near the end of the component that starts with return(...)
  
  // For example, find something like:
  // return (
  //   <div className="relative panel-hover-effect rounded-lg overflow-hidden">
  //     ...
  //   </div>
  // );
  
  // And add the renderLockStatus() call inside that main div
  
  // Since we can't modify the full component, we'll just specify that the renderLockStatus() 
  // function should be added right after the main <div> of the component
  
  // IMPORTANT: The code below is a hint for the editor to place the renderLockStatus() function
  // at the proper location. The actual placement depends on the component structure.
  
  // Check for panel lock before editing
  const startEditing = async () => {
    if (!disableCollaboration && isPanelLocked(panel.id)) {
      toast.warning("This panel is currently being edited by someone else");
      return false;
    }
    return true;
  };
  
  // Modify the handleEditingImage function to check for locks first
  const handleEditingImage = async () => {
    const canEdit = await startEditing();
    if (canEdit) {
      setIsEditingImage(true);
    }
  };
  
  // Modify the handleEditingCaption function to check for locks first
  const handleEditingCaption = async () => {
    const canEdit = await startEditing();
    if (canEdit) {
      setIsEditingCaption(true);
    }
  };
  
  // Replace or enhance original function calls with these lockable versions
  // Original: <button onClick={() => setIsEditingImage(true)}>
  // New: <button onClick={handleEditingImage}>
  
  // Original: <button onClick={() => setIsEditingCaption(true)}>
  // New: <button onClick={handleEditingCaption}>
  
  // These function signature changes should be integrated at the appropriate places in the component

  // UseEffect to fetch AI caption
  useEffect(() => {
    // Only fetch if it's an image panel, has a URL, and doesn't already have an aiCaption
    // AND caption hasn't been attempted before (to avoid endless retries)
    if (panel.type === 'image' && panel.url && !panel.aiCaption && !panel.captionAttempted) {
      console.log(`PanelEditor: Triggering caption fetch for panel ${panel.id} with URL ${panel.url}`);
      // Get the page index from store
      console.log(`Current page index for captioning: ${currentPageIndex}`);
      // Call with the correct parameters
      fetchAndSetPanelAICaption(panel.id, currentPageIndex);
    }
  }, [panel.id, panel.url, panel.type, panel.aiCaption, panel.captionAttempted, fetchAndSetPanelAICaption, currentPageIndex]);

  // moved above to avoid temporal dead zone

  const handleVideoModified = (modifiedVideoUrl: string) => {
    onUpdate({
      ...panel,
      url: modifiedVideoUrl
    });
  };

  // Add video processing state that persists when modal closes
  const [videoProcessingState, setVideoProcessingState] = useState<'idle' | 'processing' | 'completed' | 'error'>('idle');
  const [videoProcessingData, setVideoProcessingData] = useState<{
    referenceImage: string | null;
    prompt: string;
    mode: string;
  }>({
    referenceImage: null,
    prompt: '',
    mode: 'adhere_1'
  });

  const handleVideoProcessingStart = (data: { referenceImage: string; prompt: string; mode: string }) => {
    setVideoProcessingState('processing');
    setVideoProcessingData(data);
  };

  const handleVideoProcessingComplete = (modifiedVideoUrl: string) => {
    setVideoProcessingState('completed');
    handleVideoModified(modifiedVideoUrl);
    
    // Reset state after a delay
    setTimeout(() => {
      setVideoProcessingState('idle');
      setVideoProcessingData({
        referenceImage: null,
        prompt: '',
        mode: 'adhere_1'
      });
    }, 3000);
  };

  const handleVideoProcessingError = () => {
    setVideoProcessingState('error');
    
    // Reset state after a delay
    setTimeout(() => {
      setVideoProcessingState('idle');
    }, 5000);
  };

  return (
    <>
    <div 
      ref={containerRef}
        className="relative w-full h-full group panel-hover-effect"
        onMouseMove={isRepositioningImage ? handleImageMouseMove : handleCaptionDrag}
        onMouseDown={(e) => {
          if (isRepositioningImage) {
            handleImageMouseDown(e);
          } else {
            // Add active effect on mouse down
            e.currentTarget.classList.add('panel-active-effect');
          }
        }}
        onMouseUp={(e) => {
          if (isRepositioningImage) {
            handleImageMouseUp();
          } else {
            handleCaptionDragEnd();
          }
          // Remove active effect on mouse up
          e.currentTarget.classList.remove('panel-active-effect');
        }}
        onMouseLeave={(e) => {
          if (isRepositioningImage) {
            handleImageMouseUp();
          } else {
            handleCaptionDragEnd();
          }
          // Remove active effect on mouse leave
          e.currentTarget.classList.remove('panel-active-effect');
        }}
      >
        <style>{gradientStyle}</style>
        <div className="relative w-full h-full overflow-hidden">
        {/* Conditional rendering for media types, with dedicated 3D viewer */} 
        {isMediaContentType(panel.type) ? (
          <>
            <MediaContent
              url={panel.url}
              type={panel.type} // 'image' | 'video' | 'gif'
              className="w-full h-full"
              onError={() => console.error('Failed to load panel media:', panel.url)}
              style={
                panel.type === 'image'
                  ? (compact
                      ? {
                          objectFit: 'contain',
                          objectPosition: 'center',
                          transform: 'none'
                        }
                      : {
                  objectFit: 'cover',
                  objectPosition: `${imagePosition.x}% ${imagePosition.y}%`,
                  transform: `scale(${imagePosition.scale})`,
                  transformOrigin: 'center',
                  transition: isDraggingImage ? 'none' : 'transform 0.2s',
                  cursor: isRepositioningImage ? 'move' : 'default'
                        })
                  : undefined
              }
            />
            {panel.type === 'image' && <PanelObjectTags panel={panel} position="top-left" focusMode={true} />}
            {panel.type === 'image' && <SAM3MaskOverlay panel={panel} />}
          </>
        ) : panel.type === '3d' ? (
          <Model3DViewer
            src={panel.url}
            alt="3D Model"
            className="w-full h-full"
            autoRotate
            cameraControls
            loading="eager"
          />
        ) : panel.type === 'game' ? (
          <GameViewer
            gameCode={panel.gameCode || ''}
            className="w-full h-full"
            panelId={panel.id}
          />
        ) : (
          <div className="text-gray-400 flex items-center justify-center h-full">
            Panel Type: {panel.type}
          </div>
        )}
      </div>

      {/* Panel controls */}
        <div className={`absolute top-2 right-2 flex space-x-2 transition-opacity z-20 ${compact ? '' : 'opacity-0 group-hover:opacity-100'}`}>
          {!compact && panel.type === 'image' && (
            <>
              {/* 3D Quick Generate Icon */}
              <button
                onClick={handleQuickGenerate3D}
                className={`p-1.5 bg-white/90 hover:bg-purple-500 hover:text-white text-gray-600 rounded-full shadow-lg transition-colors ${isGenerating3D ? 'cursor-wait' : ''}`}
                title={isGenerating3D ? "Generating 3D Model..." : "Generate 3D Model from Image"}
                disabled={isGenerating3D}
              >
                {isGenerating3D ? (
                  <Loader size={16} className="animate-spin" />
                ) : (
                  <Box size={16} />
                )}
              </button>
              <button
                onClick={toggleRepositioningMode}
                className={`p-1.5 ${isRepositioningImage ? 'bg-purple-600 text-white' : 'bg-white/90 text-gray-600'} rounded-full shadow-lg hover:bg-purple-700 hover:text-white transition-colors`}
                title={isRepositioningImage ? "Exit repositioning mode" : "Reposition image"}
              >
                <MoveHorizontal size={16} />
              </button>
            </>
          )}
          {!compact && panel.type === 'image' && (
            <button
              onClick={() => !isRepositioningImage && setIsEditingImage(true)}
              className={`p-1.5 ${isRepositioningImage ? 'bg-gray-300 cursor-not-allowed' : 'bg-white/90 hover:bg-white'} rounded-full shadow-lg transition-colors`}
              title={isRepositioningImage ? "Exit repositioning mode first" : "Edit with AI"}
              disabled={isRepositioningImage}
            >
              <Wand2 size={16} className={`${isRepositioningImage ? 'text-gray-400' : 'text-gray-600'}`} />
            </button>
          )}
          {!compact && panel.type === 'video' && (
            <button
              onClick={() => setIsEditingVideo(true)}
              className="p-1.5 bg-white/90 hover:bg-purple-500 hover:text-white text-gray-600 rounded-full shadow-lg transition-colors"
              title={videoProcessingState === 'processing' ? "Video modification in progress..." : "Modify video with AI"}
              disabled={videoProcessingState === 'processing'}
            >
              <Video size={16} className={videoProcessingState === 'processing' ? 'animate-spin' : ''} />
            </button>
          )}
          {!compact && panel.type === 'video' && (
            <button
              onClick={() => {
                setIsSfxModalOpen(true);
                setSfxPrompt((panel.aiCaption || panel.caption || '').trim());
              }}
              className="p-1.5 bg-white/90 hover:bg-white rounded-full shadow-lg transition-colors"
              title="Add sound effects"
            >
              <AudioLines size={16} className="text-gray-700" />
            </button>
          )}
          <button
            onClick={() => !isRepositioningImage && setIsEditingCaption(true)}
            className={`p-1.5 ${isRepositioningImage ? 'bg-gray-300 cursor-not-allowed' : 'bg-white/90 hover:bg-white'} rounded-full shadow-lg transition-colors`}
            title={isRepositioningImage ? "Exit repositioning mode first" : "Add caption"}
            disabled={isRepositioningImage}
          >
            <MessageSquare size={16} className={`${isRepositioningImage ? 'text-gray-400' : 'text-gray-600'}`} />
          </button>
          <button
            onClick={() => !isRepositioningImage && (onClose ? onClose() : onRemove(panel.id))}
            className={`p-1.5 ${isRepositioningImage ? 'bg-gray-300 cursor-not-allowed' : 'bg-red-500 hover:bg-red-600 text-white'} rounded-full shadow-lg transition-colors`}
            title={isRepositioningImage ? "Exit repositioning mode first" : "Remove panel"}
            disabled={isRepositioningImage}
          >
            <X size={16} />
          </button>
        </div>

        {/* Repositioning controls */}
        {!compact && isRepositioningImage && panel.type === 'image' && (
          <div className="absolute bottom-2 left-1/2 transform -translate-x-1/2 flex space-x-2 bg-white/90 rounded-full shadow-lg p-1 z-10">
            <button
              onClick={() => handleImageZoom(-0.1)}
              className="p-1.5 hover:bg-gray-200 rounded-full transition-colors"
              title="Zoom out"
            >
              <ZoomOut size={16} className="text-gray-600" />
            </button>
            <button
              onClick={() => handleImageZoom(0.1)}
              className="p-1.5 hover:bg-gray-200 rounded-full transition-colors"
              title="Zoom in"
            >
              <ZoomIn size={16} className="text-gray-600" />
            </button>
            <button
              onClick={handleImageReset}
              className="p-1.5 hover:bg-gray-200 rounded-full transition-colors"
              title="Reset position"
            >
              <RotateCcw size={16} className="text-gray-600" />
            </button>
            <button
              onClick={() => setIsRepositioningImage((v) => !v)}
              className={`px-2 py-1 rounded text-xs ${isRepositioningImage ? 'bg-purple-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
              title={isRepositioningImage ? 'Exit Pan Mode' : 'Pan Image'}
            >
              {isRepositioningImage ? 'Pan: On' : 'Pan'}
            </button>
          </div>
        )}

      {/* Caption */}
      {panel.caption && panel.captionPosition && (
        <div
            className={`absolute max-w-[90%] p-2 rounded shadow-lg ${isRepositioningImage ? 'cursor-not-allowed opacity-50' : 'cursor-move'}
            ${isDraggingCaption ? 'ring-2 ring-blue-500' : ''}`}
          style={{
            left: `${panel.captionPosition.x}%`,
            top: `${panel.captionPosition.y}%`,
            transform: 'translate(-50%, -50%)',
            backgroundColor: `${panel.captionStyle?.backgroundColor === 'black' ? 
              `rgba(0,0,0,${panel.captionStyle?.opacity ?? 0.75})` : 
              `rgba(255,255,255,${panel.captionStyle?.opacity ?? 0.75})`}`,
            color: panel.captionStyle?.backgroundColor === 'black' ? 'white' : 'black',
            fontSize: `${panel.captionStyle?.fontSize || 16}px`,
            fontFamily: panel.captionStyle?.fontFamily || 'Arial',
            textAlign: panel.captionPosition.align,
              pointerEvents: isRepositioningImage ? 'none' : 'auto'
          }}
            onMouseDown={isRepositioningImage ? undefined : handleCaptionDragStart}
        >
            <div className={`absolute -top-6 left-1/2 transform -translate-x-1/2 text-white/75 ${isRepositioningImage ? 'hidden' : ''}`}>
            <Move size={16} />
          </div>
          <div>
          {panel.caption}
            {panel.captionLink && (
              <div className="mt-1 flex items-center text-xs" style={{ 
                color: panel.captionStyle?.backgroundColor === 'black' ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)'
              }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                </svg>
                <span className="truncate" style={{ maxWidth: '150px' }}>Link added</span>
              </div>
            )}
          </div>
        </div>
      )}

        {/* Repositioning mode overlay */}
        {isRepositioningImage && panel.type === 'image' && (
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-2 left-2 bg-purple-600 text-white px-2 py-1 rounded-md text-xs font-medium panel-outline-animation">
              Repositioning Mode
            </div>
            <div className="absolute inset-0 border-2 border-purple-600 rounded-md panel-outline-animation"></div>
          </div>
        )}
      </div>

      {/* Panel Progress Overlay for Hon Assistant image generation */}
      <PanelProgressOverlay panelId={panel.id} />

      {/* Modals moved outside the panel container */}
      {isEditingImage && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] modal-fade-in">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-4xl">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Edit Image</h3>
            
            {/* Tool Selection Tabs */}
            <div className="flex border-b border-gray-200 mb-6 relative">
              <button
                className={`px-4 py-2 font-medium text-sm tab-button ${selectedEditingTool === 'text' ? 'text-purple-600' : 'text-gray-500 hover:text-gray-700'}`}
                onClick={() => setSelectedEditingTool('text')}
              >
                <div className="flex items-center space-x-2 relative">
                  <Wand2 size={16} className={`tab-button-icon ${selectedEditingTool === 'text' ? 'text-purple-600' : ''}`} />
                  <span>Text Prompt</span>
                </div>
              </button>
              <button
                className={`px-4 py-2 font-medium text-sm tab-button ${selectedEditingTool === 'eraser' ? 'text-purple-600' : 'text-gray-500 hover:text-gray-700'}`}
                onClick={() => setSelectedEditingTool('eraser')}
              >
                <div className="flex items-center space-x-2 relative">
                  <Eraser size={16} className={`tab-button-icon ${selectedEditingTool === 'eraser' ? 'text-purple-600' : ''}`} />
                  <span>Erase Objects</span>
                </div>
              </button>
              <button
                className={`px-4 py-2 font-medium text-sm tab-button ${selectedEditingTool === 'faceswap' ? 'text-purple-600' : 'text-gray-500 hover:text-gray-700'}`}
                onClick={() => setSelectedEditingTool('faceswap')}
              >
                <div className="flex items-center space-x-2 relative">
                  <Shuffle size={16} className={`tab-button-icon ${selectedEditingTool === 'faceswap' ? 'text-purple-600' : ''}`} />
                  <span>Face Swap</span>
                </div>
              </button>
              <button
                className={`px-4 py-2 font-medium text-sm tab-button ${selectedEditingTool === 'tryon' ? 'text-purple-600' : 'text-gray-500 hover:text-gray-700'}`}
                onClick={() => setSelectedEditingTool('tryon')}
              >
                <div className="flex items-center space-x-2 relative">
                  <Shirt size={16} className={`tab-button-icon ${selectedEditingTool === 'tryon' ? 'text-purple-600' : ''}`} />
                  <span>Virtual Try-On (not available)</span>
                </div>
              </button>
              {/* 3D Tab */}
              <button
                className={`px-4 py-2 font-medium text-sm tab-button ${selectedEditingTool === '3d' ? 'text-purple-600' : 'text-gray-500 hover:text-gray-700'}`}
                onClick={() => setSelectedEditingTool('3d')}
                disabled={panel.type !== 'image'}
              >
                <div className="flex items-center space-x-2 relative">
                  <Box size={16} className={`tab-button-icon ${selectedEditingTool === '3d' ? 'text-purple-600' : ''}`} />
                  <span>3D</span>
                </div>
              </button>
              {/* Upscaling Tab */}
              <button
                className={`px-4 py-2 font-medium text-sm tab-button ${selectedEditingTool === 'upscale' ? 'text-purple-600' : 'text-gray-500 hover:text-gray-700'}`}
                onClick={() => setSelectedEditingTool('upscale')}
                disabled={panel.type !== 'image'}
              >
                <div className="flex items-center space-x-2 relative">
                  <ZoomIn size={16} className={`tab-button-icon ${selectedEditingTool === 'upscale' ? 'text-purple-600' : ''}`} />
                  <span>Upscaling</span>
                </div>
              </button>
            </div>
            
            {/* Text-based Editing Tool */}
            <div className={`tab-content ${selectedEditingTool === 'text' ? 'active' : ''}`}>
              {selectedEditingTool === 'text' && (
                <div className="mb-4">
                  <div className="w-full h-64 bg-gray-100 rounded-lg mb-4 overflow-hidden tab-item">
                    <img 
                      src={panel.url} 
                      alt="Panel to edit" 
                      className="w-full h-full object-contain"
                    />
                  </div>
                  
                  <div className="flex flex-col space-y-4">
                    {/* Model Selection */}
                    <div className="flex items-center space-x-4 mb-2 tab-item">
                      <span className="text-sm font-medium text-gray-700">Model:</span>
                      <div className="flex space-x-2">
                        <button
                          onClick={() => setSelectedModel('flux')}
                          className={`px-3 py-1 text-sm rounded-md ${
                            selectedModel === 'flux'
                              ? 'bg-purple-600 text-white'
                              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                          }`}
                        >
                          Flux
                        </button>
                        <button
                          onClick={() => setSelectedModel('recraft')}
                          className={`px-3 py-1 text-sm rounded-md flex items-center ${
                            selectedModel === 'recraft'
                              ? 'bg-purple-600 text-white'
                              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                          }`}
                        >
                          Recraft V3
                          <div className="relative ml-1">
                            <Info 
                              size={14} 
                              className="cursor-help"
                              onMouseEnter={() => setShowRecraftInfo(true)}
                              onMouseLeave={() => setShowRecraftInfo(false)}
                            />
                            {showRecraftInfo && (
                              <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-1.5 bg-gray-800 text-white text-xs rounded shadow-lg whitespace-normal z-50 w-64 min-w-max">
                                Recraft V3 offers high-quality image generation with various style options.
                              </div>
                            )}
                          </div>
                        </button>
                        <button
                          onClick={() => setSelectedModel('ideogram')}
                          className={`px-3 py-1 text-sm rounded-md flex items-center ${
                            selectedModel === 'ideogram'
                              ? 'bg-purple-600 text-white'
                              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                          }`}
                        >
                          Ideogram
                          <div className="relative ml-1">
                            <Info 
                              size={14} 
                              className="cursor-help"
                              onMouseEnter={() => setShowIdeogramInfo(true)}
                              onMouseLeave={() => setShowIdeogramInfo(false)}
                            />
                            {showIdeogramInfo && (
                              <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-1.5 bg-gray-800 text-white text-xs rounded shadow-lg whitespace-normal z-50 w-64 min-w-max">
                                Ideogram offers high-quality image generation with excellent text rendering capabilities.
                              </div>
                            )}
                          </div>
                        </button>
                        <button
                          onClick={() => setSelectedModel('flux-kontext')}
                          className={`px-3 py-1 text-sm rounded-md flex items-center ${
                            selectedModel === 'flux-kontext'
                              ? 'bg-purple-600 text-white'
                              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                          }`}
                        >
                          Flux Kontext
                          <div className="relative ml-1">
                            <Info 
                              size={14} 
                              className="cursor-help"
                              onMouseEnter={() => setShowFluxKontextInfo(true)}
                              onMouseLeave={() => setShowFluxKontextInfo(false)}
                            />
                            {showFluxKontextInfo && (
                              <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-1.5 bg-gray-800 text-white text-xs rounded shadow-lg whitespace-normal z-50 w-64 min-w-max">
                                FLUX.1 Kontext Max - Advanced image editing model with superior prompt adherence and typography.
                              </div>
                            )}
                          </div>
                        </button>
                        <button
                          onClick={() => setSelectedModel('gpt-image-1')}
                          className={`px-3 py-1 text-sm rounded-md flex items-center ${
                            selectedModel === 'gpt-image-1'
                              ? 'bg-purple-600 text-white'
                              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                          }`}
                        >
                          GPT-1
                          <div className="relative ml-1">
                            <Info 
                              size={14} 
                              className="cursor-help"
                              onMouseEnter={() => setShowGptInfo(true)}
                              onMouseLeave={() => setShowGptInfo(false)}
                            />
                            {showGptInfo && (
                              <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-1.5 bg-gray-800 text-white text-xs rounded shadow-lg whitespace-normal z-50 w-64 min-w-max">
                                OpenAI GPT-Image-1 - Advanced image editing with exceptional understanding and detail quality.
                              </div>
                            )}
                          </div>
                        </button>
                        <button
                          onClick={() => setSelectedModel('qwen-edit')}
                          className={`px-3 py-1 text-sm rounded-md flex items-center ${
                            selectedModel === 'qwen-edit'
                              ? 'bg-purple-600 text-white'
                              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                          }`}
                        >
                          Qwen Edit
                        </button>
                        <button
                          onClick={() => setSelectedModel('nano-banana-edit')}
                          className={`px-3 py-1 text-sm rounded-md ${
                            selectedModel === 'nano-banana-edit'
                              ? 'bg-blue-500 text-white'
                              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                          }`}
                        >
                          Nano Banana Pro Edit
                        </button>
                <button
                  onClick={() => setSelectedModel('seedream-edit')}
                  className={`px-3 py-1 text-sm rounded-md ${
                    selectedModel === 'seedream-edit'
                      ? 'bg-purple-600 text-white'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  Seedream 4.5
                        </button>
                      </div>
                    </div>

                    {/* Recraft Options (only show when Recraft is selected) */}
                    {selectedModel === 'recraft' && (
                      <div className="space-y-3 p-3 bg-gray-50 rounded-md tab-item">
                        {/* Style Selection */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Style</label>
                          <select
                            value={recraftStyle}
                            onChange={(e) => setRecraftStyle(e.target.value as RecraftStyle)}
                            className="w-full px-3 py-2 border rounded-md text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            {Object.entries(groupedStyles).map(([category, styles]) => (
                              <optgroup key={category} label={category}>
                                {styles.map(style => (
                                  <option key={style} value={style}>
                                    {getStyleName(style)}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                        </div>
                        
                        {/* Image Size Selection */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Image Size</label>
                          <select
                            value={recraftImageSize as string}
                            onChange={(e) => setRecraftImageSize(e.target.value as RecraftImageSize)}
                            className="w-full px-3 py-2 border rounded-md text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="square_hd">Square HD</option>
                            <option value="square">Square</option>
                            <option value="portrait_4_3">Portrait 4:3</option>
                            <option value="portrait_16_9">Portrait 16:9</option>
                            <option value="landscape_4_3">Landscape 4:3</option>
                            <option value="landscape_16_9">Landscape 16:9</option>
                          </select>
                        </div>
                      </div>
                    )}

                    {/* Nano Banana Edit Options */}
                    {selectedModel === 'nano-banana-edit' && (
                      <div className="space-y-3 p-3 bg-gray-50 rounded-md tab-item max-h-[50vh] overflow-y-auto">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Reference Images</label>
                          <div
                            className="w-full p-4 border-2 border-dashed rounded-md bg-white text-gray-600 cursor-pointer"
                            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                            onDrop={async (e) => {
                              e.preventDefault();
                              const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
                              if (!files.length) return;
                              const uploaded = await uploadImages(files);
                              if (uploaded.length) setNanoEditImages(prev => [...prev, ...uploaded]);
                            }}
                            onClick={() => nanoInputRef.current?.click()}
                          >
                            Drag & drop images here or click to upload
                            <input ref={nanoInputRef} type="file" accept="image/*" multiple className="hidden" onChange={async (e) => {
                              const files = Array.from(e.target.files || []);
                              if (!files.length) return;
                              const uploaded = await uploadImages(files);
                              if (uploaded.length) setNanoEditImages(prev => [...prev, ...uploaded]);
                              e.currentTarget.value = '';
                            }} />
                          </div>
                          {!!nanoEditImages.length && (
                            <div className="mt-2 grid grid-cols-4 gap-2">
                              {nanoEditImages.map((u, i) => (
                                <div key={i} className="relative">
                                  <img src={u} className="w-full h-16 object-cover rounded" />
                                  <button
                                    type="button"
                                    className="absolute -top-2 -right-2 bg-white text-gray-700 rounded-full w-6 h-6 shadow"
                                    onClick={() => setNanoEditImages(prev => prev.filter((_, idx) => idx !== i))}
                                  >×</button>
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="mt-1 text-xs text-gray-500">Using {nanoEditImages.length} reference image{nanoEditImages.length === 1 ? '' : 's'} (base image is always included).</div>
                        </div>
                      </div>
                    )}

                    {/* Seadream Edit Options */}
                    {selectedModel === 'seedream-edit' && (
                      <div className="space-y-3 p-3 bg-gray-50 rounded-md tab-item max-h-[50vh] overflow-y-auto">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Reference Images</label>
                          <div
                            className="w-full p-4 border-2 border-dashed rounded-md bg-white text-gray-600 cursor-pointer"
                            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                            onDrop={async (e) => {
                              e.preventDefault();
                              const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
                              if (!files.length) return;
                              const uploaded = await uploadImages(files);
                              if (uploaded.length) setSeedreamRefs(prev => [...prev, ...uploaded]);
                            }}
                            onClick={() => seedreamInputRef.current?.click()}
                          >
                            Drag & drop images here or click to upload
                            <input ref={seedreamInputRef} type="file" accept="image/*" multiple className="hidden" onChange={async (e) => {
                              const files = Array.from(e.target.files || []);
                              if (!files.length) return;
                              const uploaded = await uploadImages(files);
                              if (uploaded.length) setSeedreamRefs(prev => [...prev, ...uploaded]);
                              e.currentTarget.value = '';
                            }} />
                          </div>
                          {!!seedreamRefs.length && (
                            <div className="mt-2 grid grid-cols-4 gap-2">
                              {seedreamRefs.map((u, i) => (
                                <div key={i} className="relative">
                                  <img src={u} className="w-full h-16 object-cover rounded" />
                                  <button
                                    type="button"
                                    className="absolute -top-2 -right-2 bg-white text-gray-700 rounded-full w-6 h-6 shadow"
                                    onClick={() => setSeedreamRefs(prev => prev.filter((_, idx) => idx !== i))}
                                  >×</button>
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="mt-1 text-xs text-gray-500">If references are added, we generate with Seedream using them (base image is included as a reference).</div>
                        </div>
                      </div>
                    )}
                    {selectedModel === 'ideogram' && (
                      <div className="space-y-3 p-3 bg-gray-50 rounded-md tab-item">
                        {/* Style Selection */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Style</label>
                          <select
                            value={ideogramStyle}
                            onChange={(e) => setIdeogramStyle(e.target.value as IdeogramStyle)}
                            className="w-full px-3 py-2 border rounded-md text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                          <label className="block text-sm font-medium text-gray-700 mb-1">Aspect Ratio</label>
                          <select
                            value={ideogramAspectRatio}
                            onChange={(e) => setIdeogramAspectRatio(e.target.value as IdeogramAspectRatio)}
                            className="w-full px-3 py-2 border rounded-md text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                            id="panel-expand-prompt"
                            checked={expandPrompt}
                            onChange={(e) => setExpandPrompt(e.target.checked)}
                            className="h-4 w-4 text-purple-600 rounded border-gray-300 focus:ring-purple-500"
                          />
                          <label htmlFor="panel-expand-prompt" className="ml-2 block text-sm text-gray-700">
                            Expand prompt (AI-enhanced)
                          </label>
                        </div>
                      </div>
                    )}

                    {/* Gemini Flash Edit Options removed */}

                    <textarea
                      value={editPrompt}
                      onChange={(e) => {
                        setEditPrompt(e.target.value);
                        saveTextPromptToHistory(e.target.value);
                      }}
                      className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-800 tab-item"
                      rows={3}
                      placeholder={selectedModel === 'flux'
                           ? "Describe how you want to edit this image..."
                           : (selectedModel === 'gpt-image-1' || selectedModel === 'qwen-edit')
                             ? "Describe your edit in natural language..."
                             : "Describe the image you want to generate..."
                       }
                      disabled={processingState !== 'idle' && processingState !== 'completed'}
                    />
                    
                    {/* Undo/Redo Buttons for Text Prompt */}
                    <div className="flex space-x-2 mb-2 tab-item">
                      <button
                        onClick={handleTextPromptUndo}
                        disabled={textPromptHistoryIndex <= 0}
                        className={`px-3 py-1 text-sm ${textPromptHistoryIndex <= 0 ? 'bg-gray-100 text-gray-400' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'} rounded flex items-center`}
                        title="Undo"
                      >
                        <Undo size={16} className="mr-1" /> Undo
                      </button>
                      <button
                        onClick={handleTextPromptRedo}
                        disabled={textPromptHistoryIndex >= textPromptHistory.length - 1}
                        className={`px-3 py-1 text-sm ${textPromptHistoryIndex >= textPromptHistory.length - 1 ? 'bg-gray-100 text-gray-400' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'} rounded flex items-center`}
                        title="Redo"
                      >
                        <Redo size={16} className="mr-1" /> Redo
                      </button>
                    </div>
                    
                    {/* Quick Prompt Buttons */}
                    <div className="flex flex-wrap gap-2 tab-item">
                      <button
                        onClick={() => setEditPrompt(prev => prev + " Oil Painting")}
                        className="px-3 py-1 bg-gray-200 text-gray-700 rounded-md text-sm hover:bg-gray-300"
                      >
                        Oil Painting
                      </button>
                      <button
                        onClick={() => setEditPrompt(prev => prev + " B&W")}
                        className="px-3 py-1 bg-gray-200 text-gray-700 rounded-md text-sm hover:bg-gray-300"
                      >
                        B&W
                      </button>
                      <button
                        onClick={() => setEditPrompt(prev => prev + " Comic Style")}
                        className="px-3 py-1 bg-gray-200 text-gray-700 rounded-md text-sm hover:bg-gray-300"
                      >
                        Comic Style
                      </button>
                      <button
                        onClick={() => setEditPrompt(prev => prev + " Dramatic Lighting")}
                        className="px-3 py-1 bg-gray-200 text-gray-700 rounded-md text-sm hover:bg-gray-300"
                      >
                        Dramatic Lighting
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            
            {/* Eraser Tool */}
            <div className={`tab-content ${selectedEditingTool === 'eraser' ? 'active' : ''}`}>
              {selectedEditingTool === 'eraser' && (
                <div className="mb-4 flex flex-col">
                  <div 
                    className="relative w-full bg-gray-100 rounded-lg mb-4 overflow-auto tab-item" 
                    style={{ 
                      maxHeight: "calc(60vh - 100px)", // Limit height to ensure controls remain visible
                    }}
                  >
                    <div
                      className="relative"
                      style={{ 
                        aspectRatio: imageRef.current ? imageRef.current.naturalWidth / imageRef.current.naturalHeight : 16/9,
                        transform: `scale(${zoomLevel})`,
                        transformOrigin: "top left",
                        width: `${100 * zoomLevel}%`,
                      }}
                    >
                      <img 
                        ref={imageRef}
                        src={panel.url} 
                        alt="Panel to edit" 
                        className="absolute top-0 left-0 w-full h-full object-contain"
                        style={{ opacity: 1 }}
                        onLoad={setupCanvas}
                      />
                      <canvas
                        ref={canvasRef}
                        className="absolute top-0 left-0 w-full h-full"
                        onMouseDown={handleCanvasMouseDown}
                        onMouseMove={handleCanvasMouseMove}
                        onMouseUp={handleCanvasMouseUp}
                        onMouseLeave={handleCanvasMouseLeave}
                      />
                      <canvas
                        ref={cursorCanvasRef}
                        className="absolute top-0 left-0 w-full h-full pointer-events-none"
                      />
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between mb-4 tab-item">
                    <div className="flex items-center space-x-2">
                      <label className="text-sm font-medium text-gray-700">Brush Size:</label>
                      <input
                        type="range"
                        min="5"
                        max="50"
                        value={brushSize}
                        onChange={(e) => setBrushSize(parseInt(e.target.value))}
                        className="w-32 accent-purple-600"
                      />
                      <span className="text-sm text-gray-600">{brushSize}px</span>
                    </div>
                    
                    <div className="flex items-center space-x-2">
                      <label className="text-sm font-medium text-gray-700">Zoom:</label>
                      <button
                        onClick={() => setZoomLevel(Math.max(0.25, zoomLevel - 0.25))}
                        className="p-1 bg-gray-200 rounded hover:bg-gray-300 text-gray-700"
                        title="Zoom Out"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="11" cy="11" r="8"></circle>
                          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                          <line x1="8" y1="11" x2="14" y2="11"></line>
                        </svg>
                      </button>
                      <span className="text-sm text-gray-600">{Math.round(zoomLevel * 100)}%</span>
                      <button
                        onClick={() => setZoomLevel(Math.min(2, zoomLevel + 0.25))}
                        className="p-1 bg-gray-200 rounded hover:bg-gray-300 text-gray-700"
                        title="Zoom In"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="11" cy="11" r="8"></circle>
                          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                          <line x1="11" y1="8" x2="11" y2="14"></line>
                          <line x1="8" y1="11" x2="14" y2="11"></line>
                        </svg>
                      </button>
                      <button
                        onClick={() => setZoomLevel(1)}
                        className="px-2 py-1 bg-gray-200 rounded hover:bg-gray-300 text-gray-700 text-xs"
                        title="Reset Zoom"
                      >
                        Reset
                      </button>
                      <button
                        onClick={() => setIsRepositioningImage((v) => !v)}
                        className={`px-2 py-1 rounded text-xs ${isRepositioningImage ? 'bg-purple-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                        title={isRepositioningImage ? 'Exit Pan Mode' : 'Pan Image'}
                      >
                        {isRepositioningImage ? 'Pan: On' : 'Pan'}
                      </button>
                    </div>
                  </div>
                  
                  <div className="flex space-x-2 mb-4 tab-item">
                    <button
                      onClick={handleUndo}
                      disabled={historyIndex <= 0}
                      className={`px-3 py-1 text-sm ${historyIndex <= 0 ? 'bg-gray-100 text-gray-400' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'} rounded`}
                      title="Undo"
                    >
                      <Undo size={16} />
                    </button>
                    <button
                      onClick={handleRedo}
                      disabled={historyIndex >= maskHistory.length - 1}
                      className={`px-3 py-1 text-sm ${historyIndex >= maskHistory.length - 1 ? 'bg-gray-100 text-gray-400' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'} rounded`}
                      title="Redo"
                    >
                      <Redo size={16} />
                    </button>
                    <button
                      onClick={handleClearMask}
                      className="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                    >
                      Clear Selection
                    </button>
                  </div>
                  
                  <p className="text-sm text-gray-600 mb-2 tab-item">
                    Paint over the areas you want to erase. The blue overlay shows what will be removed.
                  </p>
                </div>
              )}
            </div>

            {/* Face Swap Tool */}
            <div className={`tab-content ${selectedEditingTool === 'faceswap' ? 'active' : ''}`}>
              {selectedEditingTool === 'faceswap' && (
                <div className="mb-4 flex flex-col">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 tab-item">
                    {/* Target Image Preview */}
                    <div className="flex flex-col">
                      <h4 className="text-sm font-medium text-gray-700 mb-1">Target Image (Your Panel)</h4>
                      <div className="w-full h-48 bg-gray-100 rounded-lg overflow-hidden">
                        <img 
                          src={panel.url} 
                          alt="Target image" 
                          className="w-full h-full object-contain"
                        />
                      </div>
                    </div>

                    {/* Face Image Upload Section */}
                    <div className="flex flex-col">
                      <h4 className="text-sm font-medium text-gray-700 mb-1">Face Image 1 (Required)</h4>
                      <div className="w-full h-48 bg-gray-100 rounded-lg overflow-hidden relative">
                        {faceImage0 ? (
                          <div className="relative w-full h-full">
                            <img 
                              src={faceImage0} 
                              alt="Face image 1" 
                              className="w-full h-full object-contain"
                            />
                            <button
                              onClick={() => setFaceImage0(null)}
                              className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full hover:bg-red-600"
                              title="Remove image"
                            >
                              <X size={16} />
                            </button>
                          </div>
                        ) : (
                          <label 
                            className="flex flex-col items-center justify-center w-full h-full cursor-pointer border-2 border-dashed border-gray-300 rounded-lg hover:bg-gray-50"
                            onDrop={handleFaceImageDrop(0)}
                            onDragOver={handleDragOver}
                          >
                            <div className="flex flex-col items-center justify-center pt-3 pb-3">
                              <Upload className="w-8 h-8 text-gray-400 mb-1" />
                              <p className="mb-1 text-sm text-gray-500">
                                <span className="font-semibold">Click to upload</span> or drag and drop
                              </p>
                              <p className="text-xs text-gray-500">PNG, JPG or WEBP</p>
                            </div>
                            <input 
                              type="file" 
                              className="hidden" 
                              accept="image/*" 
                              onChange={handleFaceImageUpload(0)}
                            />
                          </label>
                        )}
                      </div>
                      
                      {/* Gender Selection for Face 1 */}
                      <div className="mt-1">
                        <label className="block text-xs font-medium text-gray-700 mb-1">Gender (Optional)</label>
                        <select
                          value={gender0}
                          onChange={(e) => handleGenderChange(0, e.target.value as '' | 'male' | 'female' | 'non-binary')}
                          className="w-full px-2 py-1 text-sm border rounded-md text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">Not specified</option>
                          <option value="male">Male</option>
                          <option value="female">Female</option>
                          <option value="non-binary">Non-binary</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-4 mb-4 tab-item">
                    {/* Optional Second Face */}
                    <div className="flex-1 min-w-[250px]">
                      <div className="flex items-center justify-between mb-1">
                        <h4 className="text-sm font-medium text-gray-700">Face Image 2 (Optional)</h4>
                        {faceImage1 && (
                          <button
                            onClick={() => {
                              setFaceImage1(null);
                              setGender1('');
                            }}
                            className="text-xs text-red-500 hover:text-red-700"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                      
                      {faceImage1 ? (
                        <div className="flex items-start space-x-2">
                          <div className="w-20 h-20 bg-gray-100 rounded-lg overflow-hidden">
                            <img 
                              src={faceImage1} 
                              alt="Face image 2" 
                              className="w-full h-full object-contain"
                            />
                          </div>
                          
                          <div className="flex-1">
                            <label className="block text-xs font-medium text-gray-700 mb-1">Gender (Optional)</label>
                            <select
                              value={gender1}
                              onChange={(e) => handleGenderChange(1, e.target.value as '' | 'male' | 'female' | 'non-binary')}
                              className="w-full px-2 py-1 text-sm border rounded-md text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                              <option value="">Not specified</option>
                              <option value="male">Male</option>
                              <option value="female">Female</option>
                              <option value="non-binary">Non-binary</option>
                            </select>
                          </div>
                        </div>
                      ) : (
                        <label 
                          className="flex items-center justify-center w-full h-16 cursor-pointer border-2 border-dashed border-gray-300 rounded-lg hover:bg-gray-50"
                          onDrop={handleFaceImageDrop(1)}
                          onDragOver={handleDragOver}
                        >
                          <div className="flex items-center space-x-2">
                            <Upload className="w-5 h-5 text-gray-400" />
                            <span className="text-sm text-gray-500">Upload a second face (optional)</span>
                          </div>
                          <input 
                            type="file" 
                            className="hidden" 
                            accept="image/*" 
                            onChange={handleFaceImageUpload(1)}
                          />
                        </label>
                      )}
                    </div>

                    {/* Advanced Options */}
                    <div className="flex-1 min-w-[250px] bg-gray-50 p-3 rounded-lg">
                      <h4 className="text-sm font-medium text-gray-700 mb-2">Advanced Options</h4>
                      
                      <div className="space-y-2">
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Hair Style</label>
                          <div className="flex space-x-4">
                            <label className="flex items-center">
                              <input
                                type="radio"
                                name="workflowType"
                                checked={workflowType === 'user_hair'}
                                onChange={() => handleWorkflowTypeChange('user_hair')}
                                className="mr-1"
                              />
                              <span className="text-xs text-gray-700">Keep face image hair</span>
                            </label>
                            <label className="flex items-center">
                              <input
                                type="radio"
                                name="workflowType"
                                checked={workflowType === 'target_hair'}
                                onChange={() => handleWorkflowTypeChange('target_hair')}
                                className="mr-1"
                              />
                              <span className="text-xs text-gray-700">Keep target image hair</span>
                            </label>
                          </div>
                        </div>
                        
                        <div>
                          <label className="flex items-center">
                            <input
                              type="checkbox"
                              checked={upscale}
                              onChange={(e) => handleUpscaleChange(e.target.checked)}
                              className="mr-1"
                            />
                            <span className="text-xs text-gray-700">Upscale result for better quality</span>
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-yellow-50 border-l-4 border-yellow-400 p-2 mb-4 text-xs tab-item">
                    <div className="flex">
                      <div className="flex-shrink-0">
                        <svg className="h-4 w-4 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <div className="ml-2">
                        <p className="text-xs text-yellow-700">
                          <strong>Tips for best results:</strong>
                        </p>
                        <ul className="list-disc ml-4 mt-1 text-xs text-yellow-700">
                          <li>Use clear, front-facing photos with good lighting</li>
                          <li>Avoid images with sunglasses or heavy shadows</li>
                          <li>For best results, use similar head positions in both images</li>
                          <li>If you get an error, try a different image or adjust the settings</li>
                        </ul>
                      </div>
                    </div>
                  </div>

                  {/* Undo/Redo Buttons for Face Swap */}
                  <div className="flex space-x-2 mb-4 tab-item">
                    <button
                      onClick={handleFaceSwapUndo}
                      disabled={faceSwapHistoryIndex <= 0}
                      className={`px-3 py-1 text-sm ${faceSwapHistoryIndex <= 0 ? 'bg-gray-100 text-gray-400' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'} rounded flex items-center`}
                      title="Undo"
                    >
                      <Undo size={16} className="mr-1" /> Undo
                    </button>
                    <button
                      onClick={handleFaceSwapRedo}
                      disabled={faceSwapHistoryIndex >= faceSwapHistory.length - 1}
                      className={`px-3 py-1 text-sm ${faceSwapHistoryIndex >= faceSwapHistory.length - 1 ? 'bg-gray-100 text-gray-400' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'} rounded flex items-center`}
                      title="Redo"
                    >
                      <Redo size={16} className="mr-1" /> Redo
                    </button>
                  </div>
                </div>
              )}
            </div>
            
            {/* Virtual Try-On Tool */}
            <div className={`tab-content ${selectedEditingTool === 'tryon' ? 'active' : ''}`}>
              {selectedEditingTool === 'tryon' && (
                <div className="mb-4 flex flex-col">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 tab-item">
                    {/* Human Image Upload Section */}
                    <div className="flex flex-col">
                      <h4 className="text-sm font-medium text-gray-700 mb-1">Human Image (Required)</h4>
                      <div className="w-full h-48 bg-gray-100 rounded-lg overflow-hidden relative">
                        {humanImage ? (
                          <div className="relative w-full h-full">
                            <img 
                              src={humanImage} 
                              alt="Human image" 
                              className="w-full h-full object-contain"
                            />
                            <button
                              onClick={() => setHumanImage(null)}
                              className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full hover:bg-red-600"
                              title="Remove image"
                            >
                              <X size={16} />
                            </button>
                          </div>
                        ) : (
                          <label 
                            className="flex flex-col items-center justify-center w-full h-full cursor-pointer border-2 border-dashed border-gray-300 rounded-lg hover:bg-gray-50"
                            onDrop={handleHumanImageDrop}
                            onDragOver={handleDragOver}
                          >
                            <div className="flex flex-col items-center justify-center pt-3 pb-3">
                              <Upload className="w-8 h-8 text-gray-400 mb-1" />
                              <p className="mb-1 text-sm text-gray-500">
                                <span className="font-semibold">Click to upload</span> or drag and drop
                              </p>
                              <p className="text-xs text-gray-500">PNG, JPG or WEBP</p>
                            </div>
                            <input 
                              type="file" 
                              className="hidden" 
                              accept="image/*" 
                              onChange={handleHumanImageUpload}
                            />
                          </label>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-1">Upload a clear full-body image of a person</p>
                    </div>

                    {/* Garment Image Upload Section */}
                    <div className="flex flex-col">
                      <h4 className="text-sm font-medium text-gray-700 mb-1">Garment Image (Required)</h4>
                      <div className="w-full h-48 bg-gray-100 rounded-lg overflow-hidden relative">
                        {garmentImage ? (
                          <div className="relative w-full h-full">
                            <img 
                              src={garmentImage} 
                              alt="Garment image" 
                              className="w-full h-full object-contain"
                            />
                            <button
                              onClick={() => setGarmentImage(null)}
                              className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full hover:bg-red-600"
                              title="Remove image"
                            >
                              <X size={16} />
                            </button>
                          </div>
                        ) : (
                          <label 
                            className="flex flex-col items-center justify-center w-full h-full cursor-pointer border-2 border-dashed border-gray-300 rounded-lg hover:bg-gray-50"
                            onDrop={handleGarmentImageDrop}
                            onDragOver={handleDragOver}
                          >
                            <div className="flex items-center space-x-2">
                              <Upload className="w-8 h-8 text-gray-400 mb-1" />
                              <span className="text-sm text-gray-500">
                                <span className="font-semibold">Click to upload</span> or drag and drop
                              </span>
                            </div>
                            <input 
                              type="file" 
                              className="hidden" 
                              accept="image/*" 
                              onChange={handleGarmentImageUpload}
                            />
                          </label>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-1">Upload an image of a garment on a plain background</p>
                    </div>
                  </div>

                  <div className="bg-yellow-50 border-l-4 border-yellow-400 p-2 mb-4 text-xs tab-item">
                    <div className="flex">
                      <div className="flex-shrink-0">
                        <svg className="h-4 w-4 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <div className="ml-2">
                        <p className="text-xs text-yellow-700">
                          For best results, use a full-body human image with a neutral pose and a garment image with a clean background.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Undo/Redo Buttons for Try-On */}
                  <div className="flex space-x-2 mb-4 tab-item">
                    <button
                      onClick={handleTryOnUndo}
                      disabled={tryOnHistoryIndex <= 0}
                      className={`px-3 py-1 text-sm ${tryOnHistoryIndex <= 0 ? 'bg-gray-100 text-gray-400' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'} rounded flex items-center`}
                      title="Undo"
                    >
                      <Undo size={16} className="mr-1" /> Undo
                    </button>
                    <button
                      onClick={handleTryOnRedo}
                      disabled={tryOnHistoryIndex >= tryOnHistory.length - 1}
                      className={`px-3 py-1 text-sm ${tryOnHistoryIndex >= tryOnHistory.length - 1 ? 'bg-gray-100 text-gray-400' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'} rounded flex items-center`}
                      title="Redo"
                    >
                      <Redo size={16} className="mr-1" /> Redo
                    </button>
                  </div>
                </div>
              )}
            </div>
            
            {/* 3D Tool */}
            <div className={`tab-content ${selectedEditingTool === '3d' ? 'active' : ''}`}>
              {selectedEditingTool === '3d' && panel.type === 'image' && (
                <div className="mb-4 flex flex-col space-y-4">
                  <div className="flex flex-wrap gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Seed (optional)</label>
                      <input type="number" value={hunyuanSeed ?? ''} onChange={e => setHunyuanSeed(e.target.value ? Number(e.target.value) : undefined)} className="w-32 px-2 py-1 border rounded-md text-gray-700" placeholder="Random" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Steps</label>
                      <input type="number" value={hunyuanSteps} min={10} max={100} onChange={e => setHunyuanSteps(Number(e.target.value))} className="w-24 px-2 py-1 border rounded-md text-gray-700" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Guidance</label>
                      <input type="number" value={hunyuanGuidance} min={1} max={20} step={0.1} onChange={e => setHunyuanGuidance(Number(e.target.value))} className="w-24 px-2 py-1 border rounded-md text-gray-700" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Octree Resolution</label>
                      <input type="number" value={hunyuanOctree} min={64} max={1024} step={64} onChange={e => setHunyuanOctree(Number(e.target.value))} className="w-28 px-2 py-1 border rounded-md text-gray-700" />
                    </div>
                    <div className="flex items-center mt-6">
                      <input type="checkbox" id="texturedMesh" checked={hunyuanTextured} onChange={e => setHunyuanTextured(e.target.checked)} className="mr-2" />
                      <label htmlFor="texturedMesh" className="text-sm text-gray-700">Textured Mesh</label>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Upscaling Tool */}
            <div className={`tab-content ${selectedEditingTool === 'upscale' ? 'active' : ''}`}>
              {selectedEditingTool === 'upscale' && panel.type === 'image' && (
                <div className="mb-4 flex flex-col space-y-4">
                  <div className="w-full h-64 bg-gray-100 rounded-lg mb-4 overflow-hidden tab-item">
                    <img 
                      src={panel.url} 
                      alt="Image to upscale" 
                      className="w-full h-full object-contain"
                    />
                  </div>
                  
                  <div className="space-y-4 p-4 bg-gray-50 rounded-lg">
                    <div className="text-sm text-gray-700">
                      <h3 className="font-medium mb-2">Recraft Crisp Upscale</h3>
                      <p className="text-xs text-gray-600 mb-4">
                        Enhance your image with crisp upscaling technology. This will boost resolution while refining small details and faces.
                      </p>
                    </div>
                    
                    <div className="flex flex-wrap gap-4">
                      <div className="flex items-center">
                        <input 
                          type="checkbox" 
                          id="syncMode" 
                          checked={upscaleSyncMode} 
                          onChange={e => setUpscaleSyncMode(e.target.checked)} 
                          className="mr-2" 
                        />
                        <label htmlFor="syncMode" className="text-sm text-gray-700">Sync Mode (slower but direct response)</label>
                      </div>
                      
                      <div className="flex items-center">
                        <input 
                          type="checkbox" 
                          id="safetyChecker" 
                          checked={upscaleSafetyChecker} 
                          onChange={e => setUpscaleSafetyChecker(e.target.checked)} 
                          className="mr-2" 
                        />
                        <label htmlFor="safetyChecker" className="text-sm text-gray-700">Enable Safety Checker</label>
                      </div>
                    </div>
                    
                    <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                      <div className="flex items-center text-blue-800 text-sm">
                        <ZoomIn size={16} className="mr-2" />
                        <span className="font-medium">Enhancement Preview</span>
                      </div>
                      <p className="text-blue-700 text-xs mt-1">
                        The upscaled image will replace the current panel content with enhanced resolution and details.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
            
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => {
                  setIsEditingImage(false);
                  setSelectedEditingTool('text');
                  setProcessingState('idle');
                }}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
                disabled={processingState !== 'idle' && processingState !== 'completed'}
              >
                Cancel
              </button>
              <button
                onClick={
                  selectedEditingTool === 'eraser' 
                    ? handleApplyEraser 
                    : selectedEditingTool === 'faceswap'
                      ? handleFaceSwap
                      : selectedEditingTool === 'tryon'
                        ? handleVirtualTryOn
                        : selectedEditingTool === '3d'
                          ? handleAdvancedGenerate3D
                          : selectedEditingTool === 'upscale'
                            ? handleUpscaleImage
                            : handleAIEdit
                }
                className={`px-4 py-2 rounded-md flex items-center space-x-2 ${
                  processingState !== 'idle' && processingState !== 'completed'
                    ? 'bg-white border border-gray-300'
                    : 'bg-purple-600 text-white hover:bg-purple-700'
                }`}
                disabled={
                  (selectedEditingTool === 'text' && !editPrompt.trim()) || 
                  (selectedEditingTool === 'faceswap' && !faceImage0) || 
                  (selectedEditingTool === 'tryon' && (!humanImage || !garmentImage)) || 
                  (selectedEditingTool === '3d' && (isGenerating3DAdvanced || !panel.url)) ||
                  (selectedEditingTool === 'upscale' && (isUpscaling || !panel.url)) ||
                  processingState !== 'idle' && processingState !== 'completed'
                }
              >
                {processingState !== 'idle' && processingState !== 'completed' ? (
                  <div className="flex items-center space-x-2 bg-gradient-to-r from-purple-500 via-pink-500 to-blue-500 text-transparent bg-clip-text animate-gradient">
                    {selectedEditingTool === 'eraser' && <Eraser size={16} />}
                    {selectedEditingTool === 'faceswap' && <Shuffle size={16} />}
                    {selectedEditingTool === 'tryon' && <Shirt size={16} />}
                    {selectedEditingTool === '3d' && <Box size={16} />}
                    {selectedEditingTool === 'upscale' && <ZoomIn size={16} />}
                    {selectedEditingTool === 'text' && <Wand2 size={16} />}
                    <span>{getProcessingStateText()}</span>
                  </div>
                ) : selectedEditingTool === 'eraser' ? (
                  <>
                    <Eraser size={16} />
                    <span>Apply Eraser</span>
                  </>
                ) : selectedEditingTool === 'faceswap' ? (
                  <>
                    <Shuffle size={16} />
                    <span>Apply Face Swap</span>
                  </>
                ) : selectedEditingTool === 'tryon' ? (
                  <>
                    <Shirt size={16} />
                    <span>Apply Virtual Try-On</span>
                  </>
                ) : selectedEditingTool === '3d' ? (
                  <>
                    <Box size={16} />
                    <span>{isGenerating3DAdvanced ? 'Generating 3D Model...' : 'Generate 3D Model'}</span>
                  </>
                ) : selectedEditingTool === 'upscale' ? (
                  <>
                    <ZoomIn size={16} />
                    <span>{isUpscaling ? 'Upscaling Image...' : 'Upscale Image'}</span>
                  </>
                ) : (
                  <>
                    {selectedModel === 'flux-kontext' ? (
                      <>
                        <Pencil size={16} />
                        <span>Apply Edit</span>
                      </>
                    ) : selectedModel === 'gpt-image-1' ? (
                      <>
                        <Pencil size={16} />
                        <span>Apply Edit</span>
                      </>
                    ) : selectedModel === 'qwen-edit' ? (
                      <>
                        <Pencil size={16} />
                        <span>Apply Edit</span>
                      </>
                    ) : selectedModel === 'nano-banana-edit' ? (
                      <>
                        <Pencil size={16} />
                        <span>Apply Edit</span>
                      </>
                    ) : selectedModel === 'seedream-edit' ? (
                      <>
                        <Pencil size={16} />
                        <span>Apply Edit</span>
                      </>
                    ) : (
                      <>
                        <Wand2 size={16} />
                        <span>Generate</span>
                      </>
                    )}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SFX Modal */}
      {isSfxModalOpen && panel.type === 'video' && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] modal-fade-in">
          <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl p-6 w-full max-w-lg">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Add Sound Effects</h3>
              <button onClick={() => setIsSfxModalOpen(false)} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Prompt</label>
                <textarea
                  value={sfxPrompt}
                  onChange={(e) => setSfxPrompt(e.target.value)}
                  rows={3}
                  className="w-full p-2 border rounded-md resize-none focus:ring-2 focus:ring-purple-500 text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700"
                  placeholder="Describe the actions and environment for SFX (no music, no speech)"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-1">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Seed</label>
                  <input
                    type="number"
                    value={sfxSeed === '' ? '' : sfxSeed}
                    onChange={(e) => setSfxSeed(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full p-2 border rounded-md text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700"
                    placeholder="optional"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Samples</label>
                  <select
                    value={sfxNumSamples}
                    onChange={(e) => setSfxNumSamples(parseInt(e.target.value, 10))}
                    className="w-full p-2 border rounded-md text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700"
                  >
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  onClick={() => setIsSfxModalOpen(false)}
                  className="px-3 py-2 rounded-md bg-gray-200 text-gray-800 hover:bg-gray-300 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                  disabled={sfxSubmitting}
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    try {
                      setSfxSubmitting(true);
                      const videoEls = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[];
                      const vidEl = videoEls.find(v => v.currentSrc === panel.url || v.src === panel.url) || null;
                      const dur = vidEl && isFinite(vidEl.duration) ? Math.floor(vidEl.duration) : undefined;
                      const muxed = await sfxService.addSoundtrack(panel.url, dur, {
                        panelId: panel.id,
                        ...(sfxPrompt.trim() ? { text_prompt: sfxPrompt.trim() } : {}),
                        ...(sfxSeed !== '' ? { seed: Number(sfxSeed) } : {}),
                        ...(sfxNumSamples ? { num_samples: sfxNumSamples } : {}),
                      });
                      onUpdate({ ...panel, url: muxed });
                      setIsSfxModalOpen(false);
                    } catch (e) {
                      console.error('SFX failed:', e);
                      (window as any).toast?.error?.(e instanceof Error ? e.message : 'SFX failed');
                    } finally {
                      setSfxSubmitting(false);
                    }
                  }}
                  className="px-3 py-2 rounded-md bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-60"
                  disabled={sfxSubmitting}
                >
                  {sfxSubmitting ? 'Generating…' : 'Generate'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isEditingCaption && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] modal-fade-in">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-2xl">
            <div className="mb-4">
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={3}
                placeholder="Add caption..."
                style={{
                  fontFamily: captionStyle.fontFamily,
                  fontSize: `${captionStyle.fontSize}px`,
                  color: 'black',
                  maxHeight: '100px',
                  overflowY: 'auto'
                }}
              />
            </div>
            
            {/* Link URL input */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Add Link URL (optional)
              </label>
              <input
                type="url"
                value={captionLink}
                onChange={(e) => setCaptionLink(e.target.value)}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="https://example.com/product"
                style={{ color: 'black' }}
              />
              <p className="mt-1 text-xs text-gray-500">
                Add a URL to make this caption clickable (e.g., link to a product)
              </p>
            </div>

            {/* Font controls */}
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">Font Style</label>
                <select
                  value={captionStyle.fontFamily}
                  onChange={(e) => setCaptionStyle(prev => ({ ...prev, fontFamily: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-md"
                  style={{ color: 'black' }}
                >
                  <option value="Arial">Arial</option>
                  <option value="Times New Roman">Times New Roman</option>
                  <option value="Comic Sans MS">Comic Sans MS</option>
                  <option value="Impact">Impact</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">Background</label>
                <div className="flex space-x-2">
                  <button
                    onClick={() => setCaptionStyle(prev => ({ ...prev, backgroundColor: 'black' }))}
                    className={`flex-1 px-3 py-2 rounded-md border ${
                      captionStyle.backgroundColor === 'black' ? 'bg-gray-900 text-white' : 'bg-white'
                    }`}
                  >
                    Black
                  </button>
                  <button
                    onClick={() => setCaptionStyle(prev => ({ ...prev, backgroundColor: 'white' }))}
                    className={`flex-1 px-3 py-2 rounded-md border ${
                      captionStyle.backgroundColor === 'white' ? 'bg-white text-black border-gray-900' : 'bg-gray-100'
                    }`}
                  >
                    White
                  </button>
                </div>
              </div>
            </div>

            {/* Size and opacity controls */}
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">Font Size</label>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => setCaptionStyle(prev => ({ ...prev, fontSize: Math.max(10, prev.fontSize - 2) }))}
                    className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-200 hover:bg-gray-300"
                    style={{ color: 'black' }}
                  >
                    -
                  </button>
                  <span className="text-sm font-medium" style={{ color: 'black' }}>{captionStyle.fontSize}px</span>
                  <button
                    onClick={() => setCaptionStyle(prev => ({ ...prev, fontSize: Math.min(36, prev.fontSize + 2) }))}
                    className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-200 hover:bg-gray-300"
                    style={{ color: 'black' }}
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  Background Opacity: {Math.round(captionStyle.opacity * 100)}%
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={captionStyle.opacity}
                  onChange={handleOpacityChange}
                  className="w-full"
                />
              </div>
            </div>

            {/* Text alignment */}
            <div className="flex space-x-4 mb-4">
              <button
                onClick={() => setCaptionStyle(prev => ({ ...prev, textAlign: 'left' }))}
                className={`p-2 rounded ${captionStyle.textAlign === 'left' ? 'bg-purple-600 text-white' : 'bg-gray-100'}`}
              >
                <AlignLeft size={16} />
              </button>
              <button
                onClick={() => setCaptionStyle(prev => ({ ...prev, textAlign: 'center' }))}
                className={`p-2 rounded ${captionStyle.textAlign === 'center' ? 'bg-purple-600 text-white' : 'bg-gray-100'}`}
              >
                <AlignCenter size={16} />
              </button>
              <button
                onClick={() => setCaptionStyle(prev => ({ ...prev, textAlign: 'right' }))}
                className={`p-2 rounded ${captionStyle.textAlign === 'right' ? 'bg-purple-600 text-white' : 'bg-gray-100'}`}
              >
                <AlignRight size={16} />
              </button>
            </div>

            {/* Preview */}
            <div className="mb-4 p-4 bg-gray-100 rounded-lg">
              <div
                className="p-2 rounded"
                style={{
                  backgroundColor: captionStyle.backgroundColor === 'black' ? 
                    `rgba(0,0,0,${captionStyle.opacity})` : 
                    `rgba(255,255,255,${captionStyle.opacity})`,
                  color: captionStyle.backgroundColor === 'black' ? 'white' : 'black',
                  fontFamily: captionStyle.fontFamily,
                  fontSize: `${captionStyle.fontSize}px`,
                  textAlign: captionStyle.textAlign as any,
                }}
              >
                {caption || 'Preview text'}
                {captionLink && (
                  <div className="mt-1 flex items-center text-xs" style={{ 
                    color: captionStyle.backgroundColor === 'black' ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)'
                  }}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                    </svg>
                    <span className="truncate" style={{ maxWidth: '200px' }}>{captionLink}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end space-x-2">
              <button
                onClick={() => setIsEditingCaption(false)}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveCaption}
                className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700"
              >
                Save Caption
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Video Editing Modal - Responsive (rendered via portal to avoid clipping by transformed ancestors) */}
      {isEditingVideo && createPortal(
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] modal-fade-in p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-4xl max-h-[95vh] flex flex-col">
            <div className="flex justify-between items-center p-6 pb-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-medium text-gray-900 dark:text-white">Modify Video with AI</h3>
              <button
                onClick={() => setIsEditingVideo(false)}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                title="Close modal"
                aria-label="Close video modification modal"
              >
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <VideoModifyEditor
                videoUrl={panel.url}
                onVideoModified={handleVideoModified}
                onClose={() => setIsEditingVideo(false)}
                onProcessingStart={handleVideoProcessingStart}
                onProcessingComplete={handleVideoProcessingComplete}
                onProcessingError={handleVideoProcessingError}
                currentProcessingState={videoProcessingState}
                processingData={videoProcessingData}
              />
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};