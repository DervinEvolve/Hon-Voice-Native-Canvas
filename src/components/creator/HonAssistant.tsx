import React, { useState } from 'react';
import { BookOpen, Sparkles, X, Paperclip, ChevronDown, ChevronRight, Wand2, Tag, Image as ImageIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { runwayService } from '../../services/runwayService';
import { videoService } from '../../services/videoService';
import { nanoid } from 'nanoid';
import { Panel } from '../../types';
import { mediaService } from '../../services/mediaService';

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
`;

interface HonAssistantProps {
  onGenerateStory: (prompt: string, generatedUrl: string, type: 'image' | 'video' | 'gif', panel?: Panel) => Promise<void>;
  onPanelContentGenerating: (panelId: string) => void;
  referenceImage?: string | null;
  onCheckTemplate?: () => boolean;
}

interface ReferenceFile {
  file: File;
  url: string;
  name: string;
  type: 'character' | 'location' | 'style';
}

type GenerationState = 'idle' | 'generating' | 'dreaming' | 'inspiring' | 'reasoning' | 'creating-videos' | 'completed';

export const HonAssistant: React.FC<HonAssistantProps> = ({
  onGenerateStory,
  onPanelContentGenerating,
  referenceImage,
  onCheckTemplate
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [generationState, setGenerationState] = useState<GenerationState>('idle');
  const [showTooltip, setShowTooltip] = useState(false);
  const [referenceFiles, setReferenceFiles] = useState<ReferenceFile[]>([]);
  const [showReferences, setShowReferences] = useState(false);
  const [generatedPanels, setGeneratedPanels] = useState<Panel[]>([]);
  
  // Keep track of object URLs to clean up later
  const [objectUrlsToClean, setObjectUrlsToClean] = useState<string[]>([]);
  
  // Color palette for references
  const referenceColors = [
    'text-blue-600',
    'text-purple-600', 
    'text-green-600',
    'text-orange-600',
    'text-pink-600',
    'text-indigo-600',
    'text-teal-600',
    'text-red-600'
  ];
  
  // Get color for reference by index
  const getReferenceColor = (index: number) => {
    return referenceColors[index % referenceColors.length];
  };
  
  // Render prompt with colored @references matching their name colors
  const renderColoredPrompt = (text: string) => {
    if (!text || referenceFiles.length === 0) return text;
    
    const parts = text.split(/(@\w+)/g);
    return parts.map((part, index) => {
      if (part.startsWith('@')) {
        const refName = part.slice(1);
        const refIndex = referenceFiles.findIndex(ref => 
          ref.name.toLowerCase() === refName.toLowerCase()
        );
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


  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    // Filter only image files from the dropped files
    const imageFiles = Array.from(e.dataTransfer.files).filter(
      file => file.type.startsWith('image/') || file.type.includes('gif')
    );
    
    if (imageFiles.length > 0) {
      console.log(`Dropped ${imageFiles.length} image files`);
      const newRefs = imageFiles.map(file => ({
        file,
        url: URL.createObjectURL(file),
        name: "", // Start with empty name so placeholder shows
        type: 'character' as const
      }));
      setReferenceFiles(prev => [...prev, ...newRefs]);
      setShowReferences(true);
    }
  };

  // Parse @references from prompt
  const parseReferences = (text: string): { cleanPrompt: string; references: string[] } => {
    const referenceRegex = /@(\w+)/g;
    const references: string[] = [];
    let match;
    
    while ((match = referenceRegex.exec(text)) !== null) {
      references.push(match[1]);
    }
    
    // Replace @references with actual reference URLs or just remove the @ symbol
    let cleanPrompt = text;
    references.forEach(refName => {
      const referenceFile = referenceFiles.find(ref => 
        ref.name.toLowerCase() === refName.toLowerCase() && ref.name.trim() !== ""
      );
      if (referenceFile) {
        cleanPrompt = cleanPrompt.replace(new RegExp(`@${refName}`, 'gi'), 
          `using reference image of ${referenceFile.name}`);
      } else {
        // If no named reference found, just remove the @ symbol but keep the word
        cleanPrompt = cleanPrompt.replace(new RegExp(`@${refName}`, 'gi'), refName);
      }
    });
    
    return { cleanPrompt, references };
  };

  // Get reference URLs for generation (upload to cloud first)
  const getReferenceUrls = async (): Promise<string[]> => {
    const urls: string[] = [];
    for (const ref of referenceFiles) {
      try {
        const cloudUrl = await mediaService.upload(ref.file);
        urls.push(cloudUrl);
      } catch (error) {
        console.error(`Failed to upload reference ${ref.name}:`, error);
      }
    }
    return urls;
  };

  // Function to convert a file to data URL
  const fileToDataURL = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read image'));
      reader.readAsDataURL(file);
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!prompt.trim() && !referenceFiles.length)) return;

    setGenerationState('generating');
    setGeneratedPanels([]);
    
    try {
      // Always get reference URLs - these must be sent
      const referenceUrls = await getReferenceUrls();
      
      // Always use the original user prompt - never empty
      const finalPrompt = prompt.trim();
      
      console.log('🎯 Starting Runway-powered Living Comic generation:', {
        prompt: finalPrompt,
        referenceUrls: referenceUrls.length,
        referencesAttached: referenceFiles.length
      });

      // Step 1: Generate all image panels first with character consistency
      const panels: Panel[] = [];
      const is2x2Template = onCheckTemplate?.();
      const panelCount = is2x2Template ? 4 : 3;
      
             // Generate image panels with character consistency
       // Use all panels for images, convert to videos later
       const imageCount = is2x2Template ? 4 : 3;
       
       for (let i = 0; i < imageCount; i++) {
         const isFirst = i === 0;
         const stageNames = ['generating', 'dreaming', 'inspiring', 'reasoning'];
         setGenerationState(stageNames[i] as GenerationState);
         
         console.log(`🖼️ Generating image panel ${i + 1}/${imageCount} for ${is2x2Template ? '2x2' : '3-panel'} template...`);
         
         // Use only user-uploaded references for consistency
         const currentRefs = [...referenceUrls];
         
         // Generate simple variations - let Runway references handle consistency
         let scenePrompt;
         if (isFirst) {
           scenePrompt = finalPrompt; // Base prompt
         } else {
           // Simple action/angle variations that work with any number of panels
           const variations = [
             ', different angle',
             ', close-up view', 
             ', wide shot',
             ', dynamic pose',
             ', side view',
             ', dramatic lighting'
           ];
           const variation = variations[(i - 1) % variations.length];
           scenePrompt = `${finalPrompt}${variation}`;
         }
           
         const imageUrl = await runwayService.generateImageWithReferences({
           promptText: scenePrompt,
           referenceImages: currentRefs.map((ref, index) => ({
             uri: ref,
             tag: `reference${index + 1}`
           })),
           ratio: '1024:1024'
         });
         
         if (imageUrl) {
           // Panel positioning logic for different templates
           let position;
           if (is2x2Template) {
             // 2x2 template: fill all 4 positions [0,0], [0,1], [1,0], [1,1]
             position = i === 0 ? { row: 0, col: 0 } :
                       i === 1 ? { row: 0, col: 1 } :
                       i === 2 ? { row: 1, col: 0 } :
                                { row: 1, col: 1 };
           } else {
             // 3-panel template: positions [0,0], [0,1], [0,2]
             position = { row: 0, col: i };
           }
           
           const panel: Panel = {
             id: nanoid(),
             type: 'image',
             url: imageUrl,
             size: 'medium',
             aspectRatio: 1,
             position,
             caption: ''
           };
           
           panels.push(panel);
           await onGenerateStory(scenePrompt, imageUrl, 'image', panel);
           onPanelContentGenerating(panel.id);
           console.log(`✅ Image panel ${i + 1} generated successfully at position [${position.row}, ${position.col}]`);
         }
       }
       
       setGeneratedPanels(panels);
       
               // Step 2: Convert image panels to videos sequentially (one at a time)
        setGenerationState('creating-videos');
        console.log('🎥 Converting image panels to living videos sequentially...');
        
        // Process videos one at a time using Seedance (faster and more reliable than Runway)
        for (let index = 0; index < panels.length; index++) {
          const imagePanel = panels[index];
          try {
            console.log(`🎬 Converting image panel ${index + 1}/${panels.length} to video with Seedance...`);
            
            // Create simple animation prompt for Seedance
            const videoPrompt = `${finalPrompt}, subtle animation and movement`;
            
            const result = await videoService.generateSeedanceImageToVideo({
              imageUrl: imagePanel.url,
              prompt: videoPrompt,
              duration: '5',
              resolution: '720p',
              cameraFixed: false
            });
            
            if (result.videoUrl) {
              // Update the existing panel instead of creating a new one
              const updatedPanel: Panel = {
                ...imagePanel, // Keep all existing properties
                type: 'video', // Change type to video
                url: result.videoUrl // Update with video URL
              };
              
              await onGenerateStory(`Living: ${finalPrompt}`, result.videoUrl, 'video', updatedPanel);
              onPanelContentGenerating(updatedPanel.id);
              console.log(`✅ Image panel ${index + 1} converted to living video with Seedance at position [${imagePanel.position.row}, ${imagePanel.position.col}]`);
            } else {
              console.log(`⚠️ Image panel ${index + 1} will remain as static image - no video URL returned`);
            }
          } catch (error) {
            console.error(`Failed to convert image panel ${index + 1} to video with Seedance:`, error);
            console.log(`⚠️ Image panel ${index + 1} will remain as static image due to error`);
          }
        }
        
        console.log('🎉 Living comic transformation completed - all panels are now animated!');
              
        // Complete the living comic generation
        setGenerationState('completed');
        console.log('🎉 Living comic generation completed!');
        
        setTimeout(() => {
          setGenerationState('idle');
          setPrompt('');
          setReferenceFiles([]);
          setGeneratedPanels([]);
          setIsOpen(false);
        }, 2000);
    } catch (error) {
      console.error('Generation failed:', error);
      setGenerationState('idle');
    }
  };

  const getGenerationText = () => {
    switch (generationState) {
      case 'generating':
        return 'Generating...';
      case 'dreaming':
        return 'Dreaming...';
      case 'inspiring':
        return 'Inspiring...';
      case 'reasoning':
        return 'Reasoning...';
      case 'creating-videos':
        return 'Bringing to life...';
      case 'completed':
        return 'Completed!';
      default:
        return (
          <span className="flex items-center gap-2">
            <Sparkles className="w-4 h-4" />
            Generate
          </span>
        );
    }
  };

  const handleClose = () => {
    setIsOpen(false);
    setGenerationState('idle');
    setPrompt('');
    setReferenceFiles([]);
    
    // Clean up any object URLs to prevent memory leaks
    objectUrlsToClean.forEach(url => {
      try {
        URL.revokeObjectURL(url);
      } catch (e) {
        console.log('Failed to revoke object URL:', e);
      }
    });
    setObjectUrlsToClean([]);
  };

  const startVideoProgressSimulation = () => {
    const interval = setInterval(() => {
      // This function is now empty as the video progress simulation is handled by Runway
    }, 2000);
    
    return () => clearInterval(interval);
  };

  return (
    <div className="relative">
      <style>{gradientStyle}</style>
      <button
        onClick={() => {
          setIsOpen(!isOpen);
          setShowTooltip(false);
        }}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className="relative focus:outline-none"
        title="Tell Hon your story"
      >
        <AnimatePresence>
          {showTooltip && (
            <motion.div
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 5 }}
              transition={{ duration: 0.2 }}
              className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-purple-500 text-white text-sm rounded whitespace-nowrap"
            >
              Tell Hon your story
            </motion.div>
          )}
        </AnimatePresence>
        <div className="rounded-full bg-purple-500 border-2 border-purple-500 w-10 h-10 flex items-center justify-center">
          <BookOpen className="w-5 h-5 text-white" />
        </div>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.form
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute bottom-14 left-1/2 -translate-x-1/2"
            onSubmit={handleSubmit}
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
          >
            {/* Reference Management UI */}
            {referenceFiles.length > 0 && generationState === 'idle' && (
              <div className="bg-white rounded-lg shadow-lg p-3 mb-2 min-w-[300px]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-gray-600">Scene Weaver</span>
                  <span className="text-xs text-gray-400">Use @name in your prompt</span>
                </div>
                <div className="flex flex-wrap gap-3">
                  {referenceFiles.map((ref, index) => (
                    <div key={index} className="relative">
                      <div className="bg-gray-50 rounded-lg p-3 w-32">
                        <div className="relative mb-2">
                          <img 
                            src={ref.url} 
                            alt={ref.name}
                            className="w-24 h-24 rounded-lg object-cover mx-auto"
                          />
                          <button
                            onClick={() => {
                              URL.revokeObjectURL(ref.url);
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
                              const newRefs = [...referenceFiles];
                              newRefs[index].name = e.target.value;
                              setReferenceFiles(newRefs);
                            }}
                            className={`text-sm font-medium bg-white border border-gray-200 rounded px-2 py-1 w-full text-center outline-none focus:border-blue-400 ${getReferenceColor(index)}`}
                            placeholder="Name it"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            <div className="flex items-center gap-3 bg-white rounded-full shadow-lg px-4 py-2 min-w-[450px] max-w-[650px]">
              <div className="flex-1 relative min-w-0">
                <input
                  type="text"
                  value={prompt}
                  onChange={(e) => {
                    if (e.target.value.length <= 1000) {
                      setPrompt(e.target.value);
                    }
                  }}
                  placeholder="Tell Hon your story idea..."
                  className="w-full bg-transparent border-none outline-none text-transparent placeholder-gray-400 z-10 relative"
                  disabled={generationState !== 'idle'}
                  maxLength={1000}
                  style={{ caretColor: '#111827' }}
                />
                {/* Colored text overlay */}
                <div className="absolute inset-0 pointer-events-none flex items-center text-gray-900 z-0">
                  <div className="overflow-hidden w-full whitespace-nowrap text-ellipsis">
                    {prompt ? renderColoredPrompt(prompt) : null}
                  </div>
                </div>
                {/* Placeholder text when empty */}
                {!prompt && (
                  <div className="absolute inset-0 pointer-events-none flex items-center text-gray-400 z-0">
                    Tell Hon your story idea...
                  </div>
                )}
              </div>
              

              
              {/* Hidden file input */}
              <input 
                type="file" 
                id="image-upload"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    const files = Array.from(e.target.files);
                    console.log(`Selected ${files.length} files through the file picker`);
                    const newRefs = files.map(file => ({
                      file,
                      url: URL.createObjectURL(file),
                      name: "", // Start with empty name so placeholder shows
                      type: 'character' as const
                    }));
                    setReferenceFiles(prev => [...prev, ...newRefs]);
                    setShowReferences(true);
                  }
                }}
                disabled={generationState !== 'idle'}
              />
              
              {/* File attachment button with count indicator */}
              <label 
                htmlFor="image-upload"
                className={`cursor-pointer ${referenceFiles.length ? 'text-green-500' : 'text-gray-400 hover:text-gray-600'} ${generationState !== 'idle' ? 'opacity-50 pointer-events-none' : ''} relative`}
                title={referenceFiles.length ? `${referenceFiles.length} image${referenceFiles.length > 1 ? 's' : ''} attached` : "Attach images"}
              >
                <Paperclip className="w-4 h-4" />
                {referenceFiles.length > 0 && (
                  <span className="absolute -top-1 -right-1 bg-green-500 text-white text-[8px] rounded-full w-3 h-3 flex items-center justify-center font-bold">
                    {referenceFiles.length}
                  </span>
                )}
              </label>
              
              {/* Character counter */}
              <span className={`text-xs font-mono ${
                prompt.length > 900 ? 'text-red-500' : 
                prompt.length > 800 ? 'text-orange-500' : 
                'text-gray-400'
              } select-none whitespace-nowrap`}>
                {prompt.length}/1000
              </span>
              
              <button
                type="button"
                onClick={handleClose}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-4 h-4" />
              </button>
              <div className="w-px h-5 bg-gray-200" />
              <button
                type="submit"
                disabled={generationState !== 'idle' || (!prompt.trim() && !referenceFiles.length)}
                className={`flex items-center gap-2 ${
                  generationState !== 'idle' && generationState !== 'completed'
                    ? 'bg-gradient-to-r from-purple-500 via-pink-500 to-blue-500 text-transparent bg-clip-text animate-gradient'
                    : 'text-gray-700 hover:text-gray-900'
                } disabled:opacity-50`}
              >
                {getGenerationText()}
              </button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
};