import { create } from 'zustand';
import type { StateCreator, StoreApi } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { nanoid } from 'nanoid';
import { Comic, Panel, NarrationSettings, PageNarration, Template as TemplateType } from '../types';
import { mediaService } from '../services/mediaService';
import { comicService } from '../services/comicService';
import { moodboardState } from '../utils/moodboardState';

type Template = TemplateType | null;

// Helper function to ensure a comic has required fields
const ensureRequiredFields = (comic: Partial<Comic>): Comic => {
  const result: Comic = {
    id: comic.id || nanoid(),
    title: comic.title || '',
    creator: comic.creator || '',
    creatorWallet: comic.creatorWallet || '',
    coverImage: comic.coverImage || '',
    coverType: comic.coverType || 'image',
    pages: comic.pages || [[]],
    pageTemplates: comic.pageTemplates || [],
    narrations: comic.narrations || {},
    createdAt: comic.createdAt || new Date(),
    lastModified: comic.lastModified || new Date(),
  };
  return result;
};

// First, add the type for the store state
export interface State {
  publishedComics: Comic[];
  draftComics: Comic[];
  currentComic: Comic | null;
  currentPageIndex: number;
  isCreatorMode: boolean;
  mediaLoadingStates: Record<string, boolean>;
  showMyComics: boolean;
  selectedPanelId: string | null;
  selectedPanelIds?: string[]; // multi-select for board mode
  currentUserAction: any | null;
  panelGenerationProgress: Record<string, { isGenerating: boolean; progress: string; partialImageUrl?: string; }>;
  // Panels currently being uploaded to Cloudinary (show blur effect)
  panelCloudinaryUpload: Record<string, boolean>;
  // Vision overlays from Isaac-01 keyed by panelId
  visionOverlays: Record<string, {
    responseStyle: 'text' | 'box' | 'point' | 'polygon';
    boxes?: Array<{ x: number; y: number; width: number; height: number; label?: string; score?: number }>;
    points?: Array<{ x: number; y: number; label?: string; score?: number }>;
    polygons?: Array<{ points: Array<{ x: number; y: number }>; label?: string; score?: number }>;
    updatedAt: number;
  }>;
  // World mode state
  isWorldMode: boolean;
  worldSettings: {
    splatUrl: string | null;
    sourceImageUrl?: string | null;
    scale: number;
    initialPosition?: { x: number; y: number; z: number };
    selectedSceneId: string | null;
    mapQuery: string;
    mapTarget?: {
      query: string;
      lat: number;
      lng: number;
      altitude: number;
      heading: number;
      tilt: number;
      range: number;
      resolvedName?: string;
      types?: string[];
    } | null;
    mapStatus: 'idle' | 'resolving' | 'ready' | 'error';
    mapError: string | null;
    mapView?: {
      lat: number;
      lng: number;
      altitude: number;
      heading: number;
      tilt: number;
      range: number;
    } | null;
  };
  worldModePreference: 'immersive' | 'map';
  // Preferred AI model for game generation (can be changed via voice)
  preferredGameModel: 'gemini' | 'claude';
  worldScenes: Array<{
    id: string;
    name: string;
    source: 'upload' | 'generated';
    status: 'ready' | 'processing' | 'error' | 'uploading';
    fileUrl?: string | null;
    thumbnailUrl?: string | null;
    createdAt: string;
    metadata?: Record<string, any>;
    errorMessage?: string;
  }>;
  // 3D models placed on the world map
  world3DModels: Array<{
    id: string;
    modelUrl: string;
    thumbnailUrl?: string;
    prompt: string;
    position: { lat: number; lng: number; altitude: number };
    orientation?: { heading: number; tilt: number; roll: number };
    scale: number;
    altitudeMode?: 'clamp-to-ground' | 'relative-to-ground' | 'relative-to-mesh' | 'absolute';
    createdAt: string;
  }>;
  recentGenerations: Array<{ url: string; prompt: string; timestamp: Date; model: string; type: string; metadata?: Record<string, any> }>;
  // User authentication data for Hon personalization
  user: { id: string; email?: string } | null;
  walletAddress: string | null;
  // UI preferences
  showObjectTags: boolean; // Show/hide SAM3 detected object tags
  showSAM3Masks: boolean; // Show/hide SAM3 mask boundaries and overlays
  // Highlighted objects per panel (for object-specific editing)
  highlightedObjects: Record<string, string[]>; // panelId -> array of object names
  panelMaskData: Record<string, Record<string, {
    box?: number[];
    score?: number | null;
    mask_url?: string | null;
    updatedAt: number;
  }>>;
}

// Actions Interface
interface ComicStoreActions {
  setCurrentComic: (comic: Comic | null) => void;
  initializeComic: (comic: Comic) => void;
  updateComicTitle: (title: string) => void;
  updateComicCover: (cover: { url: string; type: 'image' | 'video' | 'gif' }) => void;
  addPanel: (panel: Panel, pageIndex: number) => void;
  updatePanel: (panel: Panel, pageIndex: number) => Promise<void>;
  removePanel: (panelId: string, pageIndex: number) => void;
  reorderPanels: (start: number, end: number, pageIndex: number) => void;
  addPage: () => void;
  removePage: (pageIndex: number) => void;
  setCurrentPageIndex: (index: number) => void;
  publishComic: (comic: Comic) => Promise<Comic>;
  unpublishComic: (comicId: string) => void;
  toggleCreatorMode: () => void;
  editComic: (comic: Comic) => void;
  saveDraft: (comic: Comic) => Promise<Comic>;
  deleteDraft: (comicId: string) => void;
  loadDraft: (comicId: string) => void;
  setMediaLoaded: (panelId: string, loaded: boolean) => void;
  updatePanelNarration: (panelId: string, pageIndex: number, narration: NarrationSettings) => void;
  updatePageNarration: (pageIndex: number, narration: PageNarration) => void;
  getPageNarration: (pageIndex: number) => PageNarration | undefined;
  setPageTemplate: (template: Template, pageIndex: number) => void;
  addNewPage: () => void;
  setPageNarration: ({ text, voiceId, pageIndex }: { 
    text: string;
    voiceId: string;
    pageIndex: number;
  }) => void;
  setShowMyComics: (show: boolean) => void;
  savePage: (pageIndex: number, panels: Panel[], template: Template | null) => void;
  init: () => void;
  fetchAndSetPanelAICaption: (panelId: string, pageIndex: number) => Promise<void>;
  captionAllCurrentPagePanels: () => Promise<void>;
  setSelectedPanelId: (panelId: string | null) => void;
  setSelectedPanelIds: (panelIds: string[]) => void;
  clearSelection: () => void;
  setPanelGenerationProgress: (panelId: string, isGenerating: boolean, progress?: string, partialImageUrl?: string) => void;
  clearPanelGenerationProgress: (panelId: string) => void;
  setPanelCloudinaryUpload: (panelId: string, isUploading: boolean) => void;
  addRecentGeneration: (generation: { url: string; prompt: string; timestamp: Date; model: string; type: string; metadata?: Record<string, any> }) => void;
  clearRecentGenerations: () => void;
  loadRecentGenerationsFromStorage: () => void;
  // Vision overlay actions
  setVisionOverlay: (panelId: string, overlay: Partial<State['visionOverlays'][string]>) => void;
  clearVisionOverlay: (panelId: string) => void;
  // User authentication actions
  setUser: (user: { id: string; email?: string } | null) => void;
  setWalletAddress: (address: string | null) => void;
  // World mode actions
  setWorldMode: (enabled: boolean) => void;
  setWorldSettings: (settings: Partial<State['worldSettings']>) => void;
  setWorldModePreference: (mode: 'immersive' | 'map') => void;
  setPreferredGameModel: (model: 'gemini' | 'claude') => void;
  addWorldScene: (scene: State['worldScenes'][number]) => void;
  updateWorldScene: (sceneId: string, patch: Partial<State['worldScenes'][number]>) => void;
  removeWorldScene: (sceneId: string) => void;
  // World 3D model actions
  addWorld3DModel: (model: State['world3DModels'][number]) => void;
  updateWorld3DModel: (modelId: string, patch: Partial<State['world3DModels'][number]>) => void;
  removeWorld3DModel: (modelId: string) => void;
  clearWorld3DModels: () => void;
  setShowObjectTags: (show: boolean) => void;
  setShowSAM3Masks: (show: boolean) => void;
  setHighlightedObjects: (panelId: string, objects: string[]) => void;
  clearHighlightedObjects: (panelId?: string) => void; // Clear all if no panelId
  setPanelMaskData: (panelId: string, objectName: string, data: { box?: number[]; score?: number | null; mask_url?: string | null }) => void;
  clearPanelMaskData: (panelId?: string, objectName?: string) => void;
}

// Combined Type for the Store
type FullComicStore = State & ComicStoreActions;

const persistMedia = async (url: string): Promise<string> => {
  if (!url) return '';
  
  try {
    // Already a Cloudinary URL
    if (url.includes('cloudinary')) {
      return url;
    }

    // If URL is a blob, try to re-upload
    if (url.startsWith('blob:')) {
      try {
        // Check if the blob URL is still valid
        const response = await fetch(url);
        if (!response.ok) {
          console.warn('Blob URL no longer valid:', url);
          return ''; // Return empty string for invalid blobs
        }

        const blob = await response.blob();
        const file = new File([blob], 'panel-content', { type: blob.type });
        const cloudinaryUrl = await mediaService.upload(file);
        
        if (!cloudinaryUrl) {
          console.warn('Failed to upload media to Cloudinary');
          return '';
        }
        
        return cloudinaryUrl;
      } catch (error) {
        console.warn('Failed to persist blob:', error);
        return ''; // Return empty string for failed blobs
      }
    }

    // For all other URLs, return as-is
    return url;
  } catch (error) {
    console.warn('Error in persistMedia:', error);
    return '';
  }
};

// Just comment out unused declaration instead of removing
// const persistComicMedia = async (comic: Comic): Promise<Comic> => {...};

// Explicitly typed state creator function
const comicStoreCreator: StateCreator<FullComicStore, [["zustand/persist", unknown]]> = (set, get) => ({
  // Initial state implementation (matches State interface)
  publishedComics: [],
  draftComics: [],
  currentComic: null,
  currentPageIndex: 0,
  isCreatorMode: false,
  mediaLoadingStates: {},
  showMyComics: false,
  selectedPanelId: null,
  selectedPanelIds: [],
  currentUserAction: null,
  panelGenerationProgress: {},
  panelCloudinaryUpload: {},
  visionOverlays: {},
  recentGenerations: [],
  user: null,
  walletAddress: null,
  isWorldMode: false,
  worldSettings: {
    splatUrl: null,
    sourceImageUrl: null,
    scale: 1,
    selectedSceneId: null,
    mapQuery: '',
    mapTarget: null,
    mapStatus: 'idle',
    mapError: null,
    mapView: null,
  },
  worldModePreference: 'immersive',
  preferredGameModel: 'gemini',
  worldScenes: [],
  world3DModels: [],
  showObjectTags: true, // Default to showing tags
  showSAM3Masks: false, // Default to hiding masks (can be visually busy)
  highlightedObjects: {}, // No objects highlighted by default
  panelMaskData: {},

  // Actions implementation (matches ComicStoreActions interface)
  saveDraft: async (comic: Comic): Promise<Comic> => {
    try {
      const savedComic = await comicService.saveComic(comic);
      set((state) => ({
        draftComics: [
          ...state.draftComics.filter(d => d.id !== comic.id),
          savedComic
        ]
      }));
      return savedComic;
    } catch (error) {
      console.error('Failed to save draft:', error);
      throw error;
    }
  },

  publishComic: async (comic: Comic): Promise<Comic> => {
    try {
      // Ensure cover is persisted to Cloudinary (avoid blob: covers)
      const persistedCover = await persistMedia(comic.coverImage || '');
      
      // Persist all panel media to Cloudinary (fal.ai URLs might expire)
      const persistedPages = await Promise.all(
        comic.pages.map(async (page) => {
          return Promise.all(
            page.map(async (panel) => {
              // Only persist image/video/gif URLs that aren't already on Cloudinary
              if (panel.url && 
                  (panel.type === 'image' || panel.type === 'video' || panel.type === 'gif') &&
                  !panel.url.includes('cloudinary')) {
                try {
                  // Fetch the media and upload to Cloudinary
                  const response = await fetch(panel.url);
                  if (response.ok) {
                    const blob = await response.blob();
                    const ext = panel.type === 'video' ? 'mp4' : panel.type === 'gif' ? 'gif' : 'png';
                    const file = new File([blob], `panel.${ext}`, { type: blob.type || `image/${ext}` });
                    const cloudinaryUrl = await mediaService.upload(file);
                    if (cloudinaryUrl) {
                      console.log(`✅ Persisted panel ${panel.id} to Cloudinary`);
                      return { ...panel, url: cloudinaryUrl };
                    }
                  }
                } catch (e) {
                  console.warn(`Failed to persist panel ${panel.id}:`, e);
                }
              }
              return panel;
            })
          );
        })
      );
      
      const comicToPublish = ensureRequiredFields({
        ...comic,
        pages: persistedPages,
        coverImage: persistedCover || comic.coverImage || '',
        id: comic.id.startsWith('draft-') ? nanoid() : comic.id 
      });
      const publishedComic = await comicService.saveComic(comicToPublish);
      // If we still ended up with a blob URL cover, attempt a best-effort persist once more
      if (publishedComic.coverImage && publishedComic.coverImage.startsWith('blob:')) {
        try {
          const response = await fetch(publishedComic.coverImage);
          if (response.ok) {
            const blob = await response.blob();
            const file = new File([blob], 'cover', { type: blob.type || 'image/jpeg' });
            const url = await mediaService.upload(file);
            if (url && url.startsWith('http')) {
              const updated = { ...publishedComic, coverImage: url };
              await comicService.saveComic(updated);
            }
          }
        } catch (e) {
          console.warn('Post-publish cover persist failed:', e);
        }
      }
      set((state) => ({
        publishedComics: [...state.publishedComics, publishedComic],
        draftComics: state.draftComics.filter(d => d.id !== comic.id),
        // Don't set currentComic to null here - let the caller handle state reset after navigation
        // This prevents React error #300 (hooks called in different order) when Creator re-renders
      }));
      return publishedComic;
    } catch (error) {
      console.error('Failed to publish comic:', error);
      throw error;
    }
  },

  init: () => {
    set(() => {
      const storedState = localStorage.getItem('comicState');
      if (!storedState) return {};
      try {
        const parsedState = JSON.parse(storedState);
        return {
          ...parsedState,
          currentComic: parsedState.currentComic ? ensureRequiredFields(parsedState.currentComic) : null
        };
      } catch (e) {
        console.error('Failed to parse stored state:', e);
        return {};
      }
    });
    
    // Load recent generations from localStorage and filter out placeholders
    const stored = localStorage.getItem('recent-generations');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          // Filter out placeholder/invalid URLs during load
          const validGenerations = parsed.filter(gen => {
            const url = gen?.url || '';
            return url && !url.startsWith('data:') && !url.startsWith('blob:') && !url.includes('placeholder') && url.length >= 10;
          });
          
          set((state) => ({
            recentGenerations: validGenerations.map(gen => ({
              ...gen,
              timestamp: new Date(gen.timestamp)
            }))
          }));
          
          // Update localStorage with cleaned data
          if (validGenerations.length !== parsed.length) {
            localStorage.setItem('recent-generations', JSON.stringify(validGenerations));
            console.log(`Cleaned up ${parsed.length - validGenerations.length} placeholder images from recent generations`);
          }
        }
      } catch (error) {
        console.warn('Failed to load recent generations from storage:', error);
      }
    }
  },

  setSelectedPanelId: (panelId: string | null) => set({ selectedPanelId: panelId }),
  setSelectedPanelIds: (panelIds: string[]) => set({ selectedPanelIds: [...panelIds], selectedPanelId: panelIds?.[0] || null }),
  clearSelection: () => set({ selectedPanelId: null, selectedPanelIds: [] }),

  setPanelGenerationProgress: (panelId: string, isGenerating: boolean, progress: string = '', partialImageUrl?: string) => 
    set((state) => ({
      panelGenerationProgress: {
        ...state.panelGenerationProgress,
        [panelId]: { isGenerating, progress, partialImageUrl }
      }
    })),

  clearPanelGenerationProgress: (panelId: string) =>
    set((state) => {
      const { [panelId]: removed, ...rest } = state.panelGenerationProgress;
      return { panelGenerationProgress: rest };
    }),

  setPanelCloudinaryUpload: (panelId: string, isUploading: boolean) =>
    set((state) => {
      if (isUploading) {
        return {
          panelCloudinaryUpload: {
            ...state.panelCloudinaryUpload,
            [panelId]: true
          }
        };
      } else {
        const { [panelId]: removed, ...rest } = state.panelCloudinaryUpload;
        return { panelCloudinaryUpload: rest };
      }
    }),

  setCurrentComic: (comic: Comic | null) => set({ currentComic: comic }),

  initializeComic: (comic: Comic) => set({
    currentComic: ensureRequiredFields({
      ...comic,
      pages: comic.pages || [[]],
      pageTemplates: comic.pageTemplates || [],
    }),
    currentPageIndex: 0,
    isCreatorMode: true,
  }),

  toggleCreatorMode: () => set((state) => ({ isCreatorMode: !state.isCreatorMode, currentPageIndex: 0 })),

  editComic: (comic: Comic) => set({
    currentComic: ensureRequiredFields({
      ...comic,
      pages: comic.pages || [[]],
      pageTemplates: comic.pageTemplates || [],
    }),
    currentPageIndex: 0,
    isCreatorMode: true,
  }),

  updateComicTitle: (title: string) => set((state) => ({
    currentComic: state.currentComic ? ensureRequiredFields({
      ...state.currentComic,
      title,
    }) : null,
  })),

  updateComicCover: (cover: { url: string; type: 'image' | 'video' | 'gif' }) => set((state) => ({
    currentComic: state.currentComic ? ensureRequiredFields({
      ...state.currentComic,
      coverImage: cover.url,
      coverType: cover.type,
    }) : null,
  })),

  addPanel: (panel: Panel, pageIndex: number) => set((state) => {
    if (!state.currentComic) return {};
    const newPages = [...state.currentComic.pages];
    if (!newPages[pageIndex]) newPages[pageIndex] = [];
    newPages[pageIndex] = [...newPages[pageIndex], panel];
    return {
      currentComic: ensureRequiredFields({
        ...state.currentComic,
        pages: newPages,
        lastModified: new Date()
      })
    };
  }),

  updatePanel: async (panel: Panel, pageIndex: number) => {
    console.log('[Store] Updating panel:', {
      id: panel.id,
      url: panel.url?.slice(0, 60),
      type: panel.type,
      pageIndex
    });

    let finalPanel = { ...panel };
    if (panel.url && panel.url.startsWith('blob:')) {
      try {
        const response = await fetch(panel.url);
        const blob = await response.blob();
        const file = new File([blob], 'panel-content', { type: blob.type });
        const cloudinaryUrl = await mediaService.upload(file);
        finalPanel.url = cloudinaryUrl || "";
      } catch (error) {
        console.warn('Failed to upload blob:', error);
        finalPanel.url = "";
      }
    }

    set((state) => {
      if (!state.currentComic) return {};
      const newPages = [...state.currentComic.pages];
      if (!newPages[pageIndex]) newPages[pageIndex] = [];
      const existingPanelIndex = newPages[pageIndex].findIndex(p => p.id === finalPanel.id);
      const existingPanel = existingPanelIndex !== -1 ? newPages[pageIndex][existingPanelIndex] : null;
      
      // CRITICAL: Clear aiCaption if URL changed - ensures Hon gets fresh context
      const urlChanged = existingPanel && existingPanel.url !== finalPanel.url;
      
      const panelData = {
        ...finalPanel,
        position: {
          ...finalPanel.position,
          rowSpan: finalPanel.position.rowSpan || 1,
          colSpan: finalPanel.position.colSpan || 1
        },
        // Reset caption state when URL changes so new caption is fetched
        ...(urlChanged ? { aiCaption: undefined, captionAttempted: false } : {})
      };
      
      if (existingPanelIndex !== -1) {
        console.log('[Store] Replacing existing panel at index', existingPanelIndex, 'with new URL:', panelData.url?.slice(0, 60), urlChanged ? '(caption reset)' : '');
        newPages[pageIndex][existingPanelIndex] = panelData;
      } else {
        console.log('[Store] Adding new panel to page', pageIndex);
        newPages[pageIndex].push(panelData);
      }
      return { currentComic: { ...state.currentComic, pages: newPages, lastModified: new Date() } };
    });
    
    // If this is a remote non-Cloudinary URL (image, video, or 3D model), re-upload to Cloudinary in background
    try {
      if (
        (finalPanel.type === 'image' || finalPanel.type === 'video' || finalPanel.type === '3d' || finalPanel.type === 'gif') &&
        typeof finalPanel.url === 'string' &&
        finalPanel.url.startsWith('http') &&
        !finalPanel.url.includes('cloudinary')
      ) {
        const resourceType = finalPanel.type === 'video' ? 'video' : finalPanel.type === 'image' || finalPanel.type === 'gif' ? 'image' : 'raw';
        console.log(`[updatePanel] Re-uploading ${finalPanel.type} to Cloudinary for persistence:`, finalPanel.url.substring(0, 60) + '...');

        // Set blur state to show smooth transition during upload
        set((state) => ({
          panelCloudinaryUpload: { ...state.panelCloudinaryUpload, [finalPanel.id]: true }
        }));

        const resp = await fetch('/api/cloudinary-upload-remote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: finalPanel.url, resourceType, folder: 'hon-comics' })
        });
        if (resp.ok) {
          const data = await resp.json();
          const cloudUrl = data?.url;
          if (cloudUrl && typeof cloudUrl === 'string') {
            console.log(`[updatePanel] ✅ Successfully uploaded ${finalPanel.type} to Cloudinary:`, cloudUrl.substring(0, 60) + '...');
            const updatedPanel: Panel = { ...finalPanel, url: cloudUrl };
            set((state) => {
              if (!state.currentComic) return {};
              const newPages = [...state.currentComic.pages];
              if (!newPages[pageIndex]) newPages[pageIndex] = [];
              const idx = newPages[pageIndex].findIndex(p => p.id === updatedPanel.id);
              if (idx !== -1) {
                newPages[pageIndex][idx] = {
                  ...updatedPanel,
                  position: {
                    ...updatedPanel.position,
                    rowSpan: updatedPanel.position.rowSpan || 1,
                    colSpan: updatedPanel.position.colSpan || 1
                  }
                };
              }
              // Clear blur state and update panel atomically
              const { [finalPanel.id]: removed, ...restUpload } = state.panelCloudinaryUpload;
              return {
                currentComic: { ...state.currentComic, pages: newPages, lastModified: new Date() },
                panelCloudinaryUpload: restUpload
              };
            });
          } else {
            // Clear blur state on failed URL extraction
            set((state) => {
              const { [finalPanel.id]: removed, ...rest } = state.panelCloudinaryUpload;
              return { panelCloudinaryUpload: rest };
            });
          }
        } else {
          console.warn(`[updatePanel] ⚠️ Cloudinary upload failed with status ${resp.status}`);
          // Clear blur state on HTTP error
          set((state) => {
            const { [finalPanel.id]: removed, ...rest } = state.panelCloudinaryUpload;
            return { panelCloudinaryUpload: rest };
          });
        }
      }
    } catch (error) {
      console.warn(`[updatePanel] Cloudinary remote ${finalPanel.type} upload failed; keeping original URL:`, error);
      // Clear blur state on exception
      set((state) => {
        const { [finalPanel.id]: removed, ...rest } = state.panelCloudinaryUpload;
        return { panelCloudinaryUpload: rest };
      });
    }

    // Automatically generate SAM3 embedding for image panels (background, non-blocking)
    // Only generate if panel URL has changed AND doesn't already have an embedding
    // Embeddings are stored in Supabase, not in panel object (prevents localStorage bloat)
    const currentState = get();
    const previousPanel = currentState.currentComic?.pages?.[pageIndex]?.find(p => p.id === finalPanel.id);
    const urlChanged = !previousPanel || previousPanel.url !== finalPanel.url;
    
    if (
      finalPanel.type === 'image' &&
      finalPanel.url &&
      urlChanged &&
      (finalPanel.url.startsWith('http') || finalPanel.url.startsWith('blob:'))
    ) {
      const currentComic = currentState.currentComic;
      
      if (!currentComic) return;
      
      // Check if embedding already exists in Supabase (non-blocking check)
      Promise.all([
        import('../services/panelEmbeddingService'),
        import('../services/sam3EmbeddingService')
      ]).then(([{ getEmbedding, saveEmbedding }, { generateEmbedding }]) => {
        // First check Supabase for existing embedding
        getEmbedding(finalPanel.id, finalPanel.url).then(existingEmbedding => {
          if (existingEmbedding) {
            // Embedding already exists in Supabase, skip generation
            console.log('[SAM3] Embedding already exists in Supabase for panel:', finalPanel.id);
            return;
          }
          
          // Generate new embedding (expensive operation)
          // Pass panelId and comicId so embedding is automatically saved to Supabase
          generateEmbedding(finalPanel.url, finalPanel.id, currentComic.id).then(embedding => {
            if (embedding) {
              console.log('[SAM3] Generated embedding for panel:', finalPanel.id);
              // Embedding is automatically saved to Supabase by generateEmbedding
            }
          }).catch(err => {
            console.warn('[SAM3] Failed to generate embedding:', err);
          });
        }).catch(err => {
          console.warn('[SAM3] Failed to check existing embedding:', err);
        });
      }).catch(err => {
        console.warn('[SAM3] Failed to load embedding services:', err);
      });
    }

    // Automatically trigger caption fetching for image panels that have a URL
    // Do this after state update to ensure panel is in the store
    // CRITICAL: Also trigger when URL changed (urlChanged from earlier check)
    // SKIP during moodboard generation (or cooldown) to prevent floods of API calls
    if (moodboardState.shouldSuppressAutoAnalysis) {
      console.log(`[Moondream] ⏭️ Skipping auto-caption during moodboard generation/cooldown`);
      return;
    }
    
    const currentPanel = currentState.currentComic?.pages?.[pageIndex]?.find(p => p.id === finalPanel.id);
    const shouldFetchCaption = (finalPanel.type === 'image' || finalPanel.type === 'game') && 
        finalPanel.url && 
        (finalPanel.url.startsWith('http') || finalPanel.url.startsWith('blob:')) && 
        (!currentPanel?.aiCaption || urlChanged);
    
    if (shouldFetchCaption) {
      console.log(`[Moondream] 🔄 Auto-triggering caption fetch for panel ${finalPanel.id}${urlChanged ? ' (URL changed)' : ' (new panel)'}`);
      setTimeout(() => {
        // Using setTimeout to ensure state update is completed first
        get().fetchAndSetPanelAICaption(finalPanel.id, pageIndex);
      }, 100);
    }
  },

  removePanel: (panelId: string, pageIndex: number) => set((state) => {
    if (!state.currentComic) return {};
    const newPages = [...state.currentComic.pages];
    if (!newPages[pageIndex]) return {};
    newPages[pageIndex] = newPages[pageIndex].filter(p => p.id !== panelId);
    return {
      currentComic: ensureRequiredFields({ ...state.currentComic, pages: newPages, lastModified: new Date() })
    };
  }),

  reorderPanels: (startIndex: number, endIndex: number, pageIndex: number) => set((state) => {
    if (!state.currentComic) return {};
    const newPages = [...state.currentComic.pages];
    const [removed] = newPages[pageIndex].splice(startIndex, 1);
    newPages[pageIndex].splice(endIndex, 0, removed);
    return { currentComic: { ...state.currentComic, pages: newPages, lastModified: new Date() } };
  }),

  addPage: () => set((state) => {
    if (!state.currentComic) return {};
    const newPages = [...state.currentComic.pages, []];
    return { currentComic: { ...state.currentComic, pages: newPages, lastModified: new Date() } };
  }),

  removePage: (pageIndex: number) => set((state) => {
    if (!state.currentComic) return {};
    const newPages = [...state.currentComic.pages];
    const newTemplates = [...state.currentComic.pageTemplates];
    newPages.splice(pageIndex, 1);
    newTemplates.splice(pageIndex, 1);
    return {
      currentComic: { ...state.currentComic, pages: newPages, pageTemplates: newTemplates, lastModified: new Date() },
      currentPageIndex: Math.max(0, pageIndex - 1)
    };
  }),

  setCurrentPageIndex: (index: number) => set({ currentPageIndex: index }),

  unpublishComic: (comicId: string) => set((state) => ({ publishedComics: state.publishedComics.filter(c => c.id !== comicId) })),

  deleteDraft: (comicId: string) => set((state) => ({ draftComics: state.draftComics.filter(d => d.id !== comicId) })),

  loadDraft: (comicId: string) => set((state) => {
    const draft = state.draftComics.find(d => d.id === comicId);
    if (!draft) return {};
    return { currentComic: draft, currentPageIndex: 0, isCreatorMode: true };
  }),

  setMediaLoaded: (panelId: string, loaded: boolean) => set((state) => ({
    mediaLoadingStates: { ...state.mediaLoadingStates, [panelId]: loaded }
  })),

  updatePanelNarration: (panelId: string, pageIndex: number, narration: NarrationSettings) => set((state) => {
    if (!state.currentComic) return {};
    const newPages = [...state.currentComic.pages];
    const page = newPages[pageIndex];
    if (!page) return {};
    const panelIndex = page.findIndex(p => p.id === panelId);
    if (panelIndex === -1) return {};
    page[panelIndex] = { ...page[panelIndex], narration };
    return { currentComic: { ...state.currentComic, pages: newPages, lastModified: new Date() } };
  }),

  updatePageNarration: (pageIndex: number, narration: PageNarration) => set((state) => {
    if (!state.currentComic) return {};
    const existingNarration = state.currentComic.narrations[pageIndex] || {};
    
    // Create the updated narration object, merging new data
    const updatedNarration: PageNarration = {
      ...existingNarration, // Keep existing fields like audioUrl if present
      text: narration.text, // Always update text
      engine: narration.engine || 'eleven', // Default to eleven if not provided
      voiceId: narration.engine !== 'hume' ? narration.voiceId : undefined, // Store voiceId only if engine is not Hume
      humeVoiceId: narration.engine === 'hume' ? narration.humeVoiceId : undefined,
      humeVoicePrompt: narration.engine === 'hume' ? narration.humeVoicePrompt : undefined,
      humeActingInstruction: narration.engine === 'hume' ? narration.humeActingInstruction : undefined,
    };

    // Clean up potentially conflicting fields based on engine
    if (updatedNarration.engine === 'hume') {
      delete updatedNarration.voiceId; // Remove standard voiceId if Hume
      // Optional: Clear prompt if library ID is set, and vice-versa?
      // if (updatedNarration.humeVoiceId) delete updatedNarration.humeVoicePrompt;
      // if (updatedNarration.humeVoicePrompt) delete updatedNarration.humeVoiceId;
    } else { // Engine is eleven or undefined (defaulted to eleven)
      delete updatedNarration.humeVoiceId;
      delete updatedNarration.humeVoicePrompt;
      delete updatedNarration.humeActingInstruction;
    }

    const updatedNarrations = {
      ...state.currentComic.narrations,
      [pageIndex]: updatedNarration,
    };

    return {
      currentComic: ensureRequiredFields({ ...state.currentComic, narrations: updatedNarrations, lastModified: new Date() }),
    };
  }),

  getPageNarration: (pageIndex: number): PageNarration | undefined => {
    const state = get(); 
    return state.currentComic?.narrations?.[pageIndex];
  },

  setPageTemplate: (template: Template, pageIndex: number) => set((state) => {
    if (!state.currentComic) return {};
    const newTemplates = [...state.currentComic.pageTemplates];
    newTemplates[pageIndex] = template;
    return { currentComic: { ...state.currentComic, pageTemplates: newTemplates, lastModified: new Date() } };
  }),

  addNewPage: () => set((state) => {
    if (!state.currentComic) return {};
    const updatedComic: Comic = {
      ...state.currentComic,
      pages: [...state.currentComic.pages, []],
      pageTemplates: [...(state.currentComic.pageTemplates || []), null],
      narrations: {
        ...(state.currentComic.narrations || {})
      },
      lastModified: new Date()
    };
    const newPageIndex = updatedComic.pages.length - 1;
    return { currentComic: updatedComic, currentPageIndex: newPageIndex };
  }),

  setPageNarration: ({ text, voiceId, pageIndex }: { text: string; voiceId: string; pageIndex: number; }) => set((state) => {
    if (!state.currentComic) return {};
    const updatedComic = {
      ...state.currentComic,
      narrations: {
        ...(state.currentComic.narrations || {}),
        [pageIndex]: {
          text,
          voiceId,
          pageIndex
        }
      }
    };
    const updatedDrafts = state.draftComics.map(draft => 
      draft.id === updatedComic.id ? updatedComic : draft
    );
    if (!state.draftComics.find(d => d.id === updatedComic.id)) updatedDrafts.push(updatedComic);
    return { currentComic: updatedComic, draftComics: updatedDrafts };
  }),

  setShowMyComics: (show: boolean) => set({ showMyComics: show }),

  savePage: (pageIndex: number, panels: Panel[], template: Template | null) => set((state) => {
    if (!state.currentComic) return {};
    const newPages = [...state.currentComic.pages];
    const newTemplates = [...state.currentComic.pageTemplates];
    newPages[pageIndex] = panels;
    newTemplates[pageIndex] = template;
    return { currentComic: { ...state.currentComic, pages: newPages, pageTemplates: newTemplates, lastModified: new Date() } };
  }),
  
  fetchAndSetPanelAICaption: async (panelId: string, pageIndex: number) => {
    const state = get();
    const panel = state.currentComic?.pages?.[pageIndex]?.find(p => p.id === panelId);
    if (!panel) return;
    const imageUrl = panel.url;
    if (!imageUrl || (!imageUrl.startsWith('http') && !imageUrl.startsWith('blob:'))) return;
    if (panel.aiCaption !== undefined) return;
    
    let fetchedCaption: string | null = null;
    const maxRetries = 3;
    let attempt = 0;
    
    // Retry logic with exponential backoff - Moondream must never fail silently
    while (attempt < maxRetries && !fetchedCaption) {
      try {
        attempt++;
        console.log(`[Moondream] 👁️ Fetching caption for panel ${panelId} (attempt ${attempt}/${maxRetries})...`);
        
        const response = await fetch('/api/fal/moondream', { 
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ imageUrl }),
          signal: AbortSignal.timeout(30000) // 30s timeout
        });
        
        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error');
          console.error(`[Moondream] ❌ Attempt ${attempt} failed with status ${response.status}:`, errorText.substring(0, 200));
          
          if (attempt < maxRetries) {
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff, max 5s
            console.log(`[Moondream] ⏳ Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          fetchedCaption = null;
        } else { 
          const data = await response.json();
          if (data.success === false) {
            console.error(`[Moondream] ❌ Attempt ${attempt} API error:`, data.error);
            if (attempt < maxRetries) {
              const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
              console.log(`[Moondream] ⏳ Retrying in ${delay}ms...`);
              await new Promise(resolve => setTimeout(resolve, delay));
              continue;
            }
            fetchedCaption = null;
          } else {
            fetchedCaption = data.caption || null;
            if (fetchedCaption) {
              console.log(`[Moondream] ✅ Caption generated for panel ${panelId}: "${fetchedCaption}"`);
              console.log(`[Moondream] 📤 Sending caption to Hon for panel ${panelId}: "${fetchedCaption}"`);
            } else {
              console.warn(`[Moondream] ⚠️ Empty caption returned for panel ${panelId}`);
            }
          }
        }
      } catch (error: any) {
        console.error(`[Moondream] ❌ Attempt ${attempt} error:`, error?.message || error);
        if (attempt < maxRetries && !error?.name?.includes('AbortError')) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          console.log(`[Moondream] ⏳ Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          fetchedCaption = null;
        }
      }
    }
    
    // If all retries failed, log but don't break - set a fallback caption
    if (!fetchedCaption && attempt >= maxRetries) {
      console.error(`[Moondream] ❌ All ${maxRetries} attempts failed for panel ${panelId}. Hon will work without caption.`);
      fetchedCaption = null; // Don't set a fake caption, but don't break the system
    }
    
    // Update the panel with the fetched caption
    set((currentState) => {
      if (!currentState.currentComic) return {};
      const newPages = [...currentState.currentComic.pages];
      if (!newPages[pageIndex]) return {};
      const panelIndex = newPages[pageIndex].findIndex(p => p.id === panelId);
      if (panelIndex === -1) return {};
      
      // Keep track of caption attempts to avoid endless retries
      const captionAttempted = true;
      newPages[pageIndex][panelIndex] = { 
        ...newPages[pageIndex][panelIndex], 
        aiCaption: fetchedCaption,
        captionAttempted 
      };
      
      return { 
        currentComic: { 
          ...currentState.currentComic, 
          pages: newPages 
        } 
      };
    });
  },

  captionAllCurrentPagePanels: async () => {
    const state = get();
    const { currentComic, currentPageIndex } = state;
    if (!currentComic || !currentComic.pages[currentPageIndex]) return;
    
    const panels = currentComic.pages[currentPageIndex];
    console.log(`Captioning all ${panels.length} panels on page ${currentPageIndex}`);
    
    // Process each image panel that doesn't already have a caption
    const imagePanels = panels.filter(panel => 
      panel.type === 'image' && 
      panel.url && 
      (panel.url.startsWith('http') || panel.url.startsWith('blob:')) && 
      panel.aiCaption === undefined
    );
    
    if (imagePanels.length === 0) {
      console.log('No panels need captioning on this page');
      return;
    }
    
    console.log(`Found ${imagePanels.length} panels that need captioning`);
    
    // Process panels in sequence to avoid overwhelming the API
    for (const panel of imagePanels) {
      console.log(`Captioning panel ${panel.id}`);
      await state.fetchAndSetPanelAICaption(panel.id, currentPageIndex);
      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  },

  addRecentGeneration: (generation: { url: string; prompt: string; timestamp: Date; model: string; type: string; metadata?: Record<string, any> }) => 
    set((state) => {
      console.log('Store: addRecentGeneration called with:', generation);
      console.log('Store: Current recentGenerations length:', state.recentGenerations.length);
      
      // Filter out placeholder images, data URLs, and invalid URLs
      const url = generation.url || '';
      if (!url || url.startsWith('data:') || url.startsWith('blob:') || url.includes('placeholder') || url.length < 10) {
        console.warn('Store: Rejected invalid/placeholder URL:', url.substring(0, 50));
        return state; // Don't add this generation
      }
      
      // Limit to last 50 generations to prevent localStorage quota issues
      const MAX_RECENT_GENERATIONS = 50;
      const newRecentGenerations = [...state.recentGenerations, generation]
        .slice(-MAX_RECENT_GENERATIONS); // Keep only last 50
      console.log('Store: New recentGenerations length:', newRecentGenerations.length);
      
      // Save to localStorage for persistence
      try {
        localStorage.setItem('recent-generations', JSON.stringify(newRecentGenerations));
        console.log('Store: Saved to localStorage successfully');
      } catch (error) {
        console.warn('Failed to save recent generations to storage:', error);
        // If storage fails, try clearing old items and retry with just the new one
        try {
          localStorage.removeItem('recent-generations');
          localStorage.setItem('recent-generations', JSON.stringify([generation]));
          return { recentGenerations: [generation] };
        } catch (retryError) {
          console.error('Failed to save even after clearing:', retryError);
        }
      }
      
      return {
        recentGenerations: newRecentGenerations
      };
    }),

  clearRecentGenerations: () => 
    set((state) => {
      // Clear from localStorage
      try {
        localStorage.removeItem('recent-generations');
      } catch (error) {
        console.warn('Failed to clear recent generations from storage:', error);
      }
      
      return {
        recentGenerations: []
      };
    }),

  loadRecentGenerationsFromStorage: () => {
    try {
      const stored = localStorage.getItem('recent-generations');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          set((state) => ({
            recentGenerations: parsed.map(gen => ({
              ...gen,
              timestamp: new Date(gen.timestamp)
            }))
          }));
        }
      }
    } catch (error) {
      console.warn('Failed to load recent generations from storage:', error);
    }
  },

  // Vision overlay actions
  setVisionOverlay: (panelId, overlay) => set((state) => {
    const prev = state.visionOverlays[panelId] || { responseStyle: 'text', updatedAt: 0 } as any;
    return {
      visionOverlays: {
        ...state.visionOverlays,
        [panelId]: {
          ...prev,
          ...overlay,
          updatedAt: Date.now(),
        }
      }
    };
  }),
  clearVisionOverlay: (panelId) => set((state) => {
    const next = { ...state.visionOverlays };
    delete next[panelId];
    return { visionOverlays: next };
  }),

  // User authentication actions
  setUser: (user) => set({ user }),
  setWalletAddress: (walletAddress) => set({ walletAddress }),
  
  // World mode actions
  setWorldMode: (enabled) => set({ isWorldMode: enabled }),
  setWorldSettings: (settings) => set((state) => ({ 
    worldSettings: { ...state.worldSettings, ...settings } 
  })),
  setWorldModePreference: (mode) => set({ worldModePreference: mode }),
  setPreferredGameModel: (model) => set({ preferredGameModel: model }),
  addWorldScene: (scene) => set((state) => {
    const nextScenes = [...state.worldScenes, scene];
    let worldSettings = state.worldSettings;
    if (!worldSettings.selectedSceneId) {
      worldSettings = { ...worldSettings, selectedSceneId: scene.id };
    }
    return { worldScenes: nextScenes, worldSettings };
  }),
  updateWorldScene: (sceneId, patch) => set((state) => {
    let updatedId = patch.id || sceneId;
    const nextScenes = state.worldScenes.map(scene =>
      scene.id === sceneId ? { ...scene, ...patch } : scene
    );
    let worldSettings = state.worldSettings;
    if (patch.id && state.worldSettings.selectedSceneId === sceneId) {
      worldSettings = { ...worldSettings, selectedSceneId: patch.id };
    }
    if (
      patch.status === 'ready' &&
      patch.fileUrl &&
      worldSettings.selectedSceneId === updatedId
    ) {
      worldSettings = { ...worldSettings, splatUrl: patch.fileUrl };
    }
    return { worldScenes: nextScenes, worldSettings };
  }),
  removeWorldScene: (sceneId) => set((state) => {
    const nextScenes = state.worldScenes.filter(scene => scene.id !== sceneId);
    let worldSettings = state.worldSettings;
    if (worldSettings.selectedSceneId === sceneId) {
      const fallback = nextScenes[nextScenes.length - 1];
      worldSettings = {
        ...worldSettings,
        selectedSceneId: fallback ? fallback.id : null,
        splatUrl: fallback?.fileUrl || null
      };
    }
    return { worldScenes: nextScenes, worldSettings };
  }),
  // World 3D model actions
  addWorld3DModel: (model) => set((state) => ({
    world3DModels: [...state.world3DModels, model]
  })),
  updateWorld3DModel: (modelId, patch) => set((state) => ({
    world3DModels: state.world3DModels.map(m => m.id === modelId ? { ...m, ...patch } : m)
  })),
  removeWorld3DModel: (modelId) => set((state) => ({
    world3DModels: state.world3DModels.filter(m => m.id !== modelId)
  })),
  clearWorld3DModels: () => set({ world3DModels: [] }),
  setShowObjectTags: (show) => set({ showObjectTags: show }),
  setShowSAM3Masks: (show) => set({ showSAM3Masks: show }),
  setHighlightedObjects: (panelId, objects) => set((state) => ({
    highlightedObjects: { ...state.highlightedObjects, [panelId]: objects }
  })),
  clearHighlightedObjects: (panelId) => set((state) => {
    if (panelId) {
      const nextHighlighted = { ...state.highlightedObjects };
      delete nextHighlighted[panelId];
      const nextMaskData = { ...state.panelMaskData };
      delete nextMaskData[panelId];
      return { highlightedObjects: nextHighlighted, panelMaskData: nextMaskData };
    }
    return { highlightedObjects: {}, panelMaskData: {} };
  }),
  setPanelMaskData: (panelId, objectName, data) => set((state) => {
    const panelEntry = state.panelMaskData[panelId] || {};
    return {
      panelMaskData: {
        ...state.panelMaskData,
        [panelId]: {
          ...panelEntry,
          [objectName]: {
            ...panelEntry[objectName],
            ...data,
            updatedAt: Date.now(),
          }
        }
      }
    };
  }),
  clearPanelMaskData: (panelId, objectName) => set((state) => {
    if (!panelId) {
      return { panelMaskData: {} };
    }
    const panelEntry = state.panelMaskData[panelId];
    if (!panelEntry) return {};
    if (!objectName) {
      const nextMaskData = { ...state.panelMaskData };
      delete nextMaskData[panelId];
      return { panelMaskData: nextMaskData };
    }
    const { [objectName]: removed, ...restObjects } = panelEntry;
    const nextMaskData = { ...state.panelMaskData, [panelId]: restObjects };
    if (Object.keys(restObjects).length === 0) {
      delete nextMaskData[panelId];
    }
    return { panelMaskData: nextMaskData };
  }),
});

// Helper to strip large data from comics before persistence
const stripLargeData = (comic: Comic | null): Comic | null => {
  if (!comic) return null;
  return {
    ...comic,
    pages: comic.pages.map(page => 
      page.map(panel => {
        // Remove embeddings (7MB+ each) - they can be regenerated
        const { embedding, ...panelWithoutEmbedding } = panel;
        return panelWithoutEmbedding;
      })
    )
  };
};

// Apply middleware and create store
export const useComicStore = create<FullComicStore>()(
  persist(
    comicStoreCreator,
    {
      name: 'comic-store',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => {
        // Strip embeddings from comics before persisting (they're too large for localStorage)
        const publishedComicsWithoutEmbeddings = state.publishedComics.map(comic => stripLargeData(comic)!);
        const draftComicsWithoutEmbeddings = state.draftComics.map(comic => stripLargeData(comic)!);
        const currentComicWithoutEmbeddings = stripLargeData(state.currentComic);
        
        return {
          publishedComics: publishedComicsWithoutEmbeddings,
          draftComics: draftComicsWithoutEmbeddings,
          // Don't persist currentComic - it's a working draft that should be saved explicitly
          // This prevents localStorage quota issues with large working canvases
          showMyComics: state.showMyComics,
          selectedPanelId: state.selectedPanelId,
          currentUserAction: state.currentUserAction,
          panelGenerationProgress: state.panelGenerationProgress,
          recentGenerations: state.recentGenerations.slice(-50), // Limit to last 50
          // Persist world settings but NOT active mode (always start in normal mode)
          worldSettings: state.worldSettings,
          worldModePreference: state.worldModePreference,
          worldScenes: state.worldScenes,
          // Persist UI preferences
          showObjectTags: state.showObjectTags,
          showSAM3Masks: state.showSAM3Masks,
        };
      },
      onRehydrateStorage: () => (state, error) => {
        // Wrap everything in try-catch to handle corrupted data gracefully
        try {
          if (state) {
            // Strip embeddings from persisted comics (they're too large for localStorage)
            if (Array.isArray(state.publishedComics)) {
              state.publishedComics = state.publishedComics.map(comic => {
                try {
                  const cleaned = stripLargeData(comic);
                  return cleaned ? ensureRequiredFields(cleaned) : ensureRequiredFields(comic);
                } catch {
                  return ensureRequiredFields(comic);
                }
              });
            }
            if (Array.isArray(state.draftComics)) {
              state.draftComics = state.draftComics.map(comic => {
                try {
                  const cleaned = stripLargeData(comic);
                  return cleaned ? ensureRequiredFields(cleaned) : ensureRequiredFields(comic);
                } catch {
                  return ensureRequiredFields(comic);
                }
              });
            }
            
            // Limit recentGenerations to prevent quota issues
            if (state.recentGenerations && state.recentGenerations.length > 50) {
              state.recentGenerations = state.recentGenerations.slice(-50);
            }
            
            state.mediaLoadingStates = {}; 
            state.panelGenerationProgress = {};
          }
        } catch (rehydrateError) {
          // Silently handle rehydration errors - clear corrupted data
          try {
            localStorage.removeItem('comic-store');
          } catch {}
        }
        
        if (error) {
          // Clear corrupted localStorage data on any rehydration error
          try {
            localStorage.removeItem('comic-store');
          } catch {}
        }
      }
    }
  )
);