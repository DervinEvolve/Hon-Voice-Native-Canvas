import { Panel } from '../types';
import { Template } from '../types';
import { PageNarration } from '../types';

export interface UserProfile {
  id: string;
  created_at: string;
  updated_at: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  
  // Auth state
  auth_method: 'discord' | 'twitter' | 'google' | null;
  solana_wallet: string | null;
  wallet_connected: boolean;
  
  // Auth IDs for social logins
  discord_id: string | null;
  twitter_id: string | null;
  google_id: string | null;
  
  // Social profile links
  twitter_url: string | null;
  instagram_url: string | null;
  website_url: string | null;
  
  // Creator status
  is_creator: boolean;
  
  // Support notifications
  notification_preferences: {
    support_received: boolean;
    new_stories: boolean;
  };
}

export interface ComicContent {
  pages: Panel[][];
  pageTemplates: (Template | null)[];
  narrations: Record<number, PageNarration>;
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: UserProfile;
        Insert: Omit<UserProfile, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<UserProfile, 'id'>>;
      };
      comics: {
        Row: {
          id: string;
          title: string;
          creator_id: string;
          creator_wallet: string;
          cover_image: string;
          cover_type: 'image' | 'video' | 'gif';
          content: ComicContent;
          is_published: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['comics']['Row'], 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['comics']['Row']>;
      };
      bookmarks: {
        Row: {
          id: string;
          user_id: string;
          comic_id: string;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['bookmarks']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['bookmarks']['Row']>;
      };
      creator_subscriptions: {
        Row: {
          id: string;
          subscriber_id: string;
          creator_id: string;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['creator_subscriptions']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['creator_subscriptions']['Row']>;
      };
      support_transactions: {
        Row: {
          id: string;
          created_at: string;
          sender_id: string;
          recipient_id: string;
          comic_id: string;
          amount: number;
          currency: string;
          transaction_hash: string | null;
          status: 'pending' | 'completed' | 'failed';
          is_ai_generated: boolean;
          story_type: 'ai_enhanced' | 'traditional';
        };
        Insert: Omit<Database['public']['Tables']['support_transactions']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['support_transactions']['Row']>;
      };
    };
  };
} 