import React, { useRef, useState } from 'react';
import { Minus, ChevronDown, Tag } from 'lucide-react';
import { Template, Panel, Comic } from '../../types';
import { useComicStore } from '../../store/useComicStore';
import { CoverUploader } from './CoverUploader';
import { AIControls } from './AIControls';
import { NarrationEditor } from './NarrationEditor';
import { TitleEditor } from './TitleEditor';
import { TemplateSelector } from './TemplateSelector';
import { ImageToVideo } from './ImageToVideo';
import { TextToVideo } from './TextToVideo';
import { FirstLastFrame } from './FirstLastFrame';
import { SpeechToVideo } from './SpeechToVideo';
import honLogo from '../../assets/hon-logo.svg';
import { HiggsfieldSoul } from './HiggsfieldSoul';
import { SceneWeaverPanel } from './SceneWeaverPanel';
import { WorldScenesPanel } from './WorldScenesPanel';


interface CreatorSideMenuProps {
  onTemplateSelect: (template: Template) => void;
  onGenerate?: (prompt: string, model: 'flux' | 'ideogram' | 'flux-dev') => Promise<string>;
  onEdit?: (prompt: string, imageUrl: string) => Promise<void>;
  selectedImageUrl?: string;
  onClearSelection?: () => void;
  onAddPanel?: (panel: Panel) => void;
  currentTemplate: Template | null;
  comic: Comic | null;
  onUpdateTitle: () => void;
  recentGenerations?: any[];
  onSelectGeneration?: () => void;
  onGenerateStory: (prompt: string, generatedUrl: string, type: 'image' | 'video' | 'gif', panel?: Panel) => Promise<void>;
}

export const CreatorSideMenu: React.FC<CreatorSideMenuProps> = ({
  onTemplateSelect,
  onGenerate,
  onEdit,
  selectedImageUrl,
  onClearSelection,
  onAddPanel,
  currentTemplate,
  comic,
  onUpdateTitle,
  recentGenerations,
  onSelectGeneration,
  onGenerateStory
}) => {
  const sideMenuRef = useRef<HTMLDivElement>(null);
  
  // Collapsible section states - default to closed on page load
  const [isLayoutTemplateOpen, setIsLayoutTemplateOpen] = useState(false);
  const [isCoverArtOpen, setIsCoverArtOpen] = useState(false);
  const [isVideoGenerationOpen, setIsVideoGenerationOpen] = useState(false);
  const [isCharacterReferenceOpen, setIsCharacterReferenceOpen] = useState(false);
  const [isSoulOpen, setIsSoulOpen] = useState(false);
  const [isImageToVideoOpen, setIsImageToVideoOpen] = useState(false);
  const [isFirstLastOpen, setIsFirstLastOpen] = useState(false);
  const [isAINarrationOpen, setIsAINarrationOpen] = useState(false);
  const [isSceneWeaverOpen, setIsSceneWeaverOpen] = useState(false);
  const [videoMode, setVideoMode] = useState<'t2v' | 'speak'>('t2v');
  const [collapsed, setCollapsed] = useState(false);
  const showObjectTags = useComicStore(state => state.showObjectTags);
  const showSAM3Masks = useComicStore(state => state.showSAM3Masks);
  const toggleCollapsed = () => {
    setCollapsed(prev => {
      const next = !prev;
      try { document.dispatchEvent(new CustomEvent('side-menu-collapsed', { detail: { collapsed: next } })); } catch {}
      return next;
    });
  };

  // Allow external collapse/expand via event
  React.useEffect(() => {
    const onSet = (e: any) => {
      const desired = Boolean(e?.detail?.collapsed);
      setCollapsed(prev => {
        if (prev === desired) return prev;
        try { document.dispatchEvent(new CustomEvent('side-menu-collapsed', { detail: { collapsed: desired } })); } catch {}
        return desired;
      });
    };
    document.addEventListener('side-menu-set-collapsed', onSet as EventListener);
    return () => document.removeEventListener('side-menu-set-collapsed', onSet as EventListener);
  }, []);


  return (
    <>
      {/* Toggle button */}
      <button
        onClick={toggleCollapsed}
        className={`fixed z-50 top-20 ${collapsed ? 'left-2' : 'left-80'} -ml-4 bg-gray-800 text-white rounded-full w-6 h-6 border border-white/10 flex items-center justify-center shadow transition-all`}
        title={collapsed ? 'Expand' : 'Collapse'}
      >
        {collapsed ? '›' : '‹'}
      </button>
      <aside
        className={`${collapsed ? 'w-0 opacity-0 -z-10 pointer-events-none' : 'w-80 opacity-100 z-40 pointer-events-auto'} fixed left-0 top-0 bottom-0 overflow-y-auto bg-gray-900/80 backdrop-blur-xl border-r border-white/10 transform transition-all duration-200`}
        aria-hidden={collapsed}
      >
        <div>
          {/* Hon Logo Section with Title Editor */}
          <div className="bg-gray-800 box-border flex flex-col gap-6 items-start justify-start pb-6 pt-10 px-6">
            <div className="flex flex-row gap-2.5 items-end justify-start w-full">
              <img src={honLogo} alt="Hon Logo" className="h-10" />
            </div>
            
            {/* Title Editor directly integrated */}
            <div className="w-full">
              <TitleEditor />
            </div>
          </div>

            {/* Sections Container */}
            <div className="bg-gray-800 flex flex-col">
              {/* Layout Template */}
              <div className="bg-gray-800 box-border flex flex-col items-start justify-start p-[24px] w-full">
                <button
                  onClick={() => setIsLayoutTemplateOpen(!isLayoutTemplateOpen)}
                  className="box-border flex flex-row items-center justify-between w-full cursor-pointer p-0 hover:opacity-80 transition-opacity"
                >
                  <div className="flex items-center space-x-2">
                    <h2 className="font-['Inter'] font-bold text-[20px] text-white leading-[0] not-italic text-left">
                      Layout Template
                    </h2>
                  </div>
                  <div className="flex flex-col items-center justify-center p-0 w-5 h-5">
                    <ChevronDown className={`w-3 h-3 text-white transition-transform ${isLayoutTemplateOpen ? 'rotate-180' : ''}`} />
                  </div>
                </button>
                {isLayoutTemplateOpen && (
                  <div className="mt-6 w-full">
                    <TemplateSelector 
                      onSelect={onTemplateSelect}
                      selectedTemplate={currentTemplate}
                    />
                  </div>
                )}
              </div>

              {/* Cover Art */}
              <div className="bg-gray-800 box-border flex flex-col items-start justify-start p-[24px] w-full">
                <button
                  onClick={() => setIsCoverArtOpen(!isCoverArtOpen)}
                  className="box-border flex flex-row items-center justify-between w-full cursor-pointer p-0 hover:opacity-80 transition-opacity"
                >
                  <div className="flex items-center space-x-2">
                    <h2 className="font-['Inter'] font-bold text-[20px] text-white leading-[0] not-italic text-left">
                      Cover Art
                    </h2>
                  </div>
                  <div className="flex flex-col items-center justify-center p-0 w-5 h-5">
                    <ChevronDown className={`w-3 h-3 text-white transition-transform ${isCoverArtOpen ? 'rotate-180' : ''}`} />
                  </div>
                </button>
                {isCoverArtOpen && (
                  <div className="mt-6 w-full">
                    <CoverUploader />
                  </div>
                )}
              </div>

              {/* Video Generation */}
              <div className="bg-gray-800 box-border flex flex-col items-start justify-start p-[24px] w-full">
                <button
                  onClick={() => setIsVideoGenerationOpen(!isVideoGenerationOpen)}
                  className="box-border flex flex-row items-center justify-between w-full cursor-pointer p-0 hover:opacity-80 transition-opacity"
                >
                  <div className="flex items-center space-x-2">
                    <h2 className="font-['Inter'] font-bold text-[20px] text-white leading-[0] not-italic text-left">
                      Video Generation
                    </h2>
                  </div>
                  <div className="flex flex-col items-center justify-center p-0 w-5 h-5">
                    <ChevronDown className={`w-3 h-3 text-white transition-transform ${isVideoGenerationOpen ? 'rotate-180' : ''}`} />
                  </div>
                </button>
                {isVideoGenerationOpen && (
                  <div className="mt-6 w-full">
                    <div className="mb-3 flex gap-2">
                      <button
                        onClick={() => setVideoMode('t2v')}
                        className={`px-3 py-1.5 text-xs rounded-md border ${videoMode === 't2v' ? 'bg-purple-600 border-purple-500 text-white' : 'bg-gray-700 border-gray-600 text-gray-300 hover:border-gray-500'}`}
                      >
                        Text to Video
                      </button>
                      <button
                        onClick={() => setVideoMode('speak')}
                        className={`px-3 py-1.5 text-xs rounded-md border ${videoMode === 'speak' ? 'bg-purple-600 border-purple-500 text-white' : 'bg-gray-700 border-gray-600 text-gray-300 hover:border-gray-500'}`}
                      >
                        Talking Video (Higgsfield Speech)
                      </button>
                    </div>
                    <div className="space-y-4">
                      {videoMode === 't2v' ? (
                        <TextToVideo onGenerateStory={onGenerateStory} />
                      ) : (
                        <SpeechToVideo />
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Image Generation */}
              <div className="bg-gray-800 box-border flex flex-col items-start justify-start p-[24px] w-full">
                <button
                  onClick={() => setIsCharacterReferenceOpen(!isCharacterReferenceOpen)}
                  className="box-border flex flex-row items-center justify-between w-full cursor-pointer p-0 hover:opacity-80 transition-opacity"
                >
                  <div className="flex items-center space-x-2">
                    <h2 className="font-['Inter'] font-bold text-[20px] text-white leading-[0] not-italic text-left">
                      Image Generation
                    </h2>
                  </div>
                  <div className="flex flex-col items-center justify-center p-0 w-5 h-5">
                    <ChevronDown className={`w-3 h-3 text-white transition-transform ${isCharacterReferenceOpen ? 'rotate-180' : ''}`} />
                  </div>
                </button>
                {isCharacterReferenceOpen && (
                  <div className="mt-6 w-full">
                    <AIControls
                      onGenerate={onGenerate}
                      onEdit={onEdit}
                      selectedImageUrl={selectedImageUrl}
                      onClearSelection={onClearSelection}
                      onAddPanel={onAddPanel}
                      onGenerateStory={onGenerateStory}
                      recentGenerations={recentGenerations}
                    />
                  </div>
                )}
              </div>

              {/* Character (Higgsfield Soul) */}
              <div className="bg-gray-800 box-border flex flex-col items-start justify-start p-[24px] w-full">
                <button
                  onClick={() => setIsSoulOpen(!isSoulOpen)}
                  className="box-border flex flex-row items-center justify-between w-full cursor-pointer p-0 hover:opacity-80 transition-opacity"
                >
                  <div className="flex items-center space-x-2">
                    <h2 className="font-['Inter'] font-bold text-[20px] text-white leading-tight not-italic text-left">
                      Character Creation (Soul)
                    </h2>
                  </div>
                  <div className="flex flex-col items-center justify-center p-0 w-5 h-5">
                    <ChevronDown className={`w-3 h-3 text-white transition-transform ${isSoulOpen ? 'rotate-180' : ''}`} />
                  </div>
                </button>
                {isSoulOpen && (
                  <div className="mt-6 w-full">
                    <HiggsfieldSoul />
                  </div>
                )}
              </div>

              {/* Image to Video */}
              <div className="bg-gray-800 box-border flex flex-col items-start justify-start p-[24px] w-full">
                <button
                  onClick={() => setIsImageToVideoOpen(!isImageToVideoOpen)}
                  className="box-border flex flex-row items-center justify-between w-full cursor-pointer p-0 hover:opacity-80 transition-opacity"
                >
                  <div className="flex items-center space-x-2">
                    <h2 className="font-['Inter'] font-bold text-[20px] text-white leading-[0] not-italic text-left">
                      Image to Video
                    </h2>
                  </div>
                  <div className="flex flex-col items-center justify-center p-0 w-5 h-5">
                    <ChevronDown className={`w-3 h-3 text-white transition-transform ${isImageToVideoOpen ? 'rotate-180' : ''}`} />
                  </div>
                </button>
                {isImageToVideoOpen && (
                  <div className="mt-6 w-full">
                    <div className="space-y-4">
                      <ImageToVideo onGenerateStory={onGenerateStory} />
                    </div>
                  </div>
                )}
              </div>

              {/* First and Last Frame (Kling Pro) */}
              <div className="bg-gray-800 box-border flex flex-col items-start justify-start p-[24px] w-full">
                <button
                  onClick={() => setIsFirstLastOpen(!isFirstLastOpen)}
                  className="box-border flex flex-row items-center justify-between w-full cursor-pointer p-0 hover:opacity-80 transition-opacity"
                >
                  <div className="flex items-center space-x-2">
                    <h2 className="font-['Inter'] font-bold text-[20px] text-white leading-[0] not-italic text-left">
                      First & Last Frame
                    </h2>
                  </div>
                  <div className="flex flex-col items-center justify-center p-0 w-5 h-5">
                    <ChevronDown className={`w-3 h-3 text-white transition-transform ${isFirstLastOpen ? 'rotate-180' : ''}`} />
                  </div>
                </button>
                {isFirstLastOpen && (
                  <div className="mt-6 w-full">
                    <FirstLastFrame onGenerateStory={onGenerateStory} />
                  </div>
                )}
              </div>

              {/* Scene Weaver */}
              <div className="bg-gray-800 box-border flex flex-col items-start justify-start p-[24px] w-full">
                <button
                  onClick={() => setIsSceneWeaverOpen(!isSceneWeaverOpen)}
                  className="box-border flex flex-row items-center justify-between w-full cursor-pointer p-0 hover:opacity-80 transition-opacity"
                >
                  <div className="flex items-center space-x-2">
                    <h2 className="font-['Inter'] font-bold text-[20px] text-white leading-[0] not-italic text-left">
                      Scene Weaver
                    </h2>
                  </div>
                  <div className="flex flex-col items-center justify-center p-0 w-5 h-5">
                    <ChevronDown className={`w-3 h-3 text-white transition-transform ${isSceneWeaverOpen ? 'rotate-180' : ''}`} />
                  </div>
                </button>
                {isSceneWeaverOpen && (
                  <div className="mt-6 w-full">
                    <SceneWeaverPanel onGenerateStory={onGenerateStory} />
                  </div>
                )}
              </div>

              {/* World Scenes */}
              <WorldScenesPanel />

              {/* AI Narration */}
              <div className="bg-gray-800 box-border flex flex-col items-start justify-start p-[24px] w-full">
                <button
                  onClick={() => setIsAINarrationOpen(!isAINarrationOpen)}
                  className="box-border flex flex-row items-center justify-between w-full cursor-pointer p-0 hover:opacity-80 transition-opacity"
                >
                  <div className="flex items-center space-x-2">
                    <h2 className="font-['Inter'] font-bold text-[20px] text-white leading-[0] not-italic text-left">
                      AI Narration
                    </h2>
                  </div>
                  <div className="flex flex-col items-center justify-center p-0 w-5 h-5">
                    <ChevronDown className={`w-3 h-3 text-white transition-transform ${isAINarrationOpen ? 'rotate-180' : ''}`} />
                  </div>
                </button>
                {isAINarrationOpen && (
                  <div className="mt-6 w-full">
                    <NarrationEditor />
                  </div>
                )}
              </div>

              {/* Canvas Settings - SAM3 Visualization */}
              <div className="bg-gray-800 box-border flex flex-col items-start justify-start p-[24px] w-full border-t border-gray-700/50">
                <div className="text-xs font-medium text-gray-400 mb-3">SAM3 Visualization</div>
                
                {/* Object Tags Toggle */}
                <div className="flex items-center justify-between w-full mb-3">
                  <span className="font-['Inter'] text-sm text-gray-300">
                    Object Tags
                  </span>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      try {
                        const currentValue = useComicStore.getState().showObjectTags;
                        useComicStore.getState().setShowObjectTags(!currentValue);
                      } catch (error) {
                        console.error('[CreatorSideMenu] Error toggling showObjectTags:', error);
                        // Fallback: update store directly
                        useComicStore.setState({ showObjectTags: !showObjectTags });
                      }
                    }}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                      showObjectTags ? 'bg-blue-600' : 'bg-gray-600'
                    }`}
                    role="switch"
                    aria-checked={showObjectTags}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        showObjectTags ? 'translate-x-5' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
                
                {/* Mask Boundaries Toggle */}
                <div className="flex items-center justify-between w-full">
                  <span className="font-['Inter'] text-sm text-gray-300">
                    Mask Boundaries
                  </span>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      try {
                        const currentValue = useComicStore.getState().showSAM3Masks;
                        useComicStore.getState().setShowSAM3Masks(!currentValue);
                      } catch (error) {
                        console.error('[CreatorSideMenu] Error toggling showSAM3Masks:', error);
                        // Fallback: update store directly
                        useComicStore.setState({ showSAM3Masks: !showSAM3Masks });
                      }
                    }}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                      showSAM3Masks ? 'bg-blue-600' : 'bg-gray-600'
                    }`}
                    role="switch"
                    aria-checked={showSAM3Masks}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        showSAM3Masks ? 'translate-x-5' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>
        </div>
      </aside>
    </>
  );
};
