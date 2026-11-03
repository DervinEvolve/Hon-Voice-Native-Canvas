export interface CaptionPosition {
  x: number;
  y: number;
  align: 'left' | 'center' | 'right';
  vertical: 'top' | 'middle' | 'bottom';
}

export interface CaptionStyle {
  fontSize: number;
  fontFamily: string;
  backgroundColor: 'black' | 'white';
  opacity: number;
}

export interface CoverPosition {
  x: number;
  y: number;
  scale: number;
}

export interface Panel {
  id: string;
  type: 'image' | 'video' | 'text' | 'dialogue' | 'narration' | 'gif' | '3d' | 'palette' | 'notion' | 'game';
  url: string;
  caption: string;
  aiCaption?: string | null;
  captionAttempted?: boolean;
  size: 'small' | 'medium' | 'large';
  aspectRatio: number;
  position: {
    row: number;
    col: number;
    rowSpan?: number;
    colSpan?: number;
  };
  captionPosition?: {
    x: number;
    y: number;
    vertical: 'top' | 'bottom';
    align: 'left' | 'center' | 'right';
  };
  captionStyle?: {
    fontSize: number;
    fontFamily: string;
    backgroundColor: 'black' | 'white';
    opacity: number;
  };
  narration?: NarrationSettings;
  imagePosition?: {
    x: number;
    y: number;
    scale: number;
  };
  // For game panels
  gameCode?: string;
  // SAM3 detected objects for canvas awareness
  detectedObjects?: string[];
  // SAM3 image embedding for similarity search (base64 encoded)
  embedding?: string;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  icon: string;
  layout: {
    rows: number;
    cols: number;
    areas: {
      size: "small" | "medium" | "large";
      position: { 
        row: number; 
        col: number;
        rowSpan?: number;
        colSpan?: number;
      };
    }[];
  };
}

export interface Voice {
  id: string;
  name: string;
  category: string;
  description: string;
}

export interface PageNarration {
  text: string;
  voiceId: string;
  audioUrl?: string;
  engine?: 'eleven' | 'hume';
  humeVoiceId?: string;
  humeVoicePrompt?: string;
  humeActingInstruction?: string;
}

export interface Comic {
  id: string;
  title: string;
  creator: string;
  creatorWallet: string;
  coverImage: string;
  coverType: 'image' | 'video' | 'gif' | '3d';
  pages: Panel[][];
  pageTemplates: (Template | null)[];
  narrations: Record<number, PageNarration>;
  createdAt: Date;
  lastModified: Date;
  coverPosition?: {
    x: number;
    y: number;
    scale: number;
  };
  collaborators?: Collaborator[];
}

export interface NarrationSettings {
  voiceId: string;
  enabled: boolean;
  autoPlay?: boolean;
}

export interface ComicStore {
  currentComic: Comic | null;
  currentPageIndex: number;
  showMyComics: boolean;
  isCreatorMode: boolean;
  setCurrentComic: (comic: Comic | null) => void;
  setCurrentPageIndex: (index: number) => void;
  setShowMyComics: (show: boolean) => void;
  toggleCreatorMode: () => void;
  updatePanel: (pageIndex: number, panelIndex: number, panel: Panel) => void;
  removePanel: (pageIndex: number, panelIndex: number) => void;
  reorderPanels: (pageIndex: number, panels: Panel[]) => void;
  // ... other methods
}

export interface Collaborator {
  id: string;
  username: string;
  avatar_url: string;
  status: 'online' | 'offline' | 'away' | 'invited' | 'active' | 'idle';
}