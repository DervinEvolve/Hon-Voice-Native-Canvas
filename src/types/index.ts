export interface Voice {
  id: string;
  name: string;
  category: 'male' | 'female';
  description: string;
}

export interface CaptionStyle {
  color: string;
  backgroundColor: string;
  opacity: number;
}

export interface PanelPosition {
  row: number;
  col: number;
  rowSpan?: number;
  colSpan?: number;
  // For custom template absolute positioning
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface NarrationSettings {
  text: string;
  voiceId: string;
}

export interface Panel {
  id: string;
  url: string;
  type: 'image' | 'video' | 'gif' | '3d' | 'game';
  caption?: string;
  captionLink?: string;
  captionPosition?: {
    x: number;
    y: number;
    vertical: 'top' | 'bottom';
    align?: 'left' | 'center' | 'right';
  };
  captionStyle?: {
    fontSize: number;
    fontFamily: string;
    backgroundColor: string;
    opacity: number;
  };
  position: PanelPosition;
  narration?: NarrationSettings;
  gameCode?: string;
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
      size: 'small' | 'medium' | 'large';
      position: { row: number; col: number };
    }[];
  };
}

export interface Collaborator {
  id: string;
  username: string;
  avatar_url: string;
  status: 'active' | 'idle' | 'offline';
  lastActive?: Date;
}

export interface Comic {
  id: string;
  title: string;
  cover_image: string;
  cover_type: string;
  coverImage: string;
  coverType: string;
  creator_id: string;
  creator?: string;
  is_ai_generated: boolean;
  story_type: 'ai_enhanced' | 'traditional';
  pages: Panel[][];
  pageTemplates?: Template[];
  lastModified?: Date;
  collaborators?: Collaborator[];
}

export interface HonPresence {
  isActive: boolean;
  processingState: 'idle' | 'processing' | 'generating' | 'editing' | 'dreaming' | 'inspiring' | 'reasoning';
  progressPercent?: number;
  progressLabel?: string;
  etaSeconds: number | null;
  focusPanelId: string | null;
  offscreen: boolean;
}