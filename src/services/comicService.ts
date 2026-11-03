import { supabase } from '../utils/supabaseClient';
import type { Comic, Panel, NarrationSettings, PageNarration, Template } from '../types';
import { nanoid } from 'nanoid';

export class ComicService {
  private static instance: ComicService;
  // Deprecated: legacy local server URL (do not use in production)
  private baseUrl: string = '';
  
  // Singleton pattern to ensure we only have one instance
  static getInstance(): ComicService {
    if (!ComicService.instance) {
      ComicService.instance = new ComicService();
    }
    return ComicService.instance;
  }

  // Save comic to both storages
  async saveComic(comic: Comic): Promise<Comic> {
    // Ensure a cover image exists – fallback to first image panel on canvas
    try {
      if (!comic.coverImage || comic.coverImage.trim().length === 0) {
        const firstImage = (comic.pages || [])
          .flat()
          .find((p: any) => p && p.type === 'image' && typeof p.url === 'string' && p.url.startsWith('http'));
        if (firstImage && firstImage.url) {
          comic = { ...comic, coverImage: firstImage.url, coverType: 'image' } as Comic;
        }
      }
    } catch {}

    // Always save to localStorage first for offline capability
    await this.saveToLocalStorage(comic);
    
    // Try to save to Supabase if authenticated
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      try {
        const { data, error } = await supabase
          .from('comics')
          .upsert({
            id: comic.id,
            title: comic.title,
            creator_id: user.id,
            creator_wallet: comic.creatorWallet,
            cover_image: comic.coverImage,
            cover_type: comic.coverType,
            content: {
              pages: comic.pages,
              pageTemplates: comic.pageTemplates,
              narrations: comic.narrations,
            },
            is_published: !comic.id.startsWith('draft'),
            story_type: comic.story_type,
            is_ai_generated: comic.is_ai_generated,
            last_modified: new Date().toISOString()
          })
          .select()
          .single();

        if (error) {
          console.warn('Supabase save failed, using localStorage version:', error);
          return comic; // Return localStorage version if Supabase fails
        }
        
        console.log('Comic saved to both storages:', data);
        return this.mapSupabaseToComic(data);
      } catch (error) {
        console.warn('Failed to save to Supabase, using localStorage version:', error);
        return comic; // Return localStorage version if Supabase fails
      }
    }
    
    return comic; // Return localStorage version if not authenticated
  }

  // Get comics with improved fallback
  async getComics(): Promise<{ published: Comic[], drafts: Comic[] }> {
    try {
      // Try Supabase first if authenticated
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: supabaseComics, error } = await supabase
          .from('comics')
          .select('*')
          .eq('creator_id', user.id);

        if (!error && supabaseComics) {
          const comics = supabaseComics.map(this.mapSupabaseToComic);
          return {
            published: comics.filter(c => !c.id.startsWith('draft')),
            drafts: comics.filter(c => c.id.startsWith('draft'))
          };
        }
      }
    } catch (error) {
      console.warn('Supabase fetch failed, falling back to localStorage:', error);
    }
    
    // Fallback to localStorage
    return this.getFromLocalStorage();
  }

  private async saveToLocalStorage(comic: Comic): Promise<void> {
    const stored = localStorage.getItem('comic-store');
    const data = stored ? JSON.parse(stored) : { publishedComics: [], draftComics: [] };
    
    // Ensure arrays exist
    data.publishedComics = data.publishedComics || [];
    data.draftComics = data.draftComics || [];
    
    if (comic.id.startsWith('draft')) {
      data.draftComics = [...data.draftComics.filter((d: Comic) => d.id !== comic.id), comic];
    } else {
      data.publishedComics = [...data.publishedComics.filter((p: Comic) => p.id !== comic.id), comic];
    }
    
    localStorage.setItem('comic-store', JSON.stringify(data));
  }

  private getFromLocalStorage(): { published: Comic[], drafts: Comic[] } {
    const stored = localStorage.getItem('comic-store');
    if (!stored) return { published: [], drafts: [] };
    
    const { publishedComics, draftComics } = JSON.parse(stored);
    return {
      published: publishedComics || [],
      drafts: draftComics || []
    };
  }

  private mapSupabaseToComic(data: any): Comic {
    return {
      id: data.id,
      title: data.title,
      creator: data.creator_id,
      creatorWallet: data.creator_wallet,
      coverImage: data.cover_image,
      coverType: data.cover_type,
      pages: data.content.pages,
      pageTemplates: data.content.pageTemplates,
      narrations: data.content.narrations,
      story_type: data.story_type || 'traditional',
      is_ai_generated: data.is_ai_generated || false,
      createdAt: new Date(data.created_at),
      lastModified: new Date(data.last_modified)
    };
  }

  async createComic(comic: Partial<Comic>, isAiEnhanced: boolean = false) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    // Generate proper ID based on publication status
    const comicId = comic.id || `draft-${nanoid()}`; // Default to draft ID

    const { data, error } = await supabase
      .from('comics')
      .insert({
        ...comic,
        id: comicId,
        creator_id: user.id,
        is_ai_generated: isAiEnhanced,
        story_type: isAiEnhanced ? 'ai_enhanced' : 'traditional'
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async getComicsByType(type: 'ai_enhanced' | 'traditional') {
    const { data, error } = await supabase
      .from('comics')
      .select('*')
      .eq('story_type', type)
      .eq('is_published', true)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
  }

  async getCreatorStats(creatorId: string) {
    const { data, error } = await supabase
      .from('comics')
      .select(`
        id,
        title,
        story_type,
        is_ai_generated,
        like_count,
        comment_count,
        bookmark_count,
        created_at,
        comic_stats!inner (
          view_count
        ),
        support_transactions (
          amount,
          currency,
          created_at
        )
      `)
      .eq('creator_id', creatorId);

    if (error) {
      console.error('Error fetching published comics:', error);
      throw error;
    }
    
    // Filter out draft comics using the same logic as getComicsByUsername
    const publishedComics = (data || []).filter(comic => !comic.id.startsWith('draft'));
    
    // Transform the data to include view_count from comic_stats
    const transformedComics = publishedComics.map(comic => ({
      ...comic,
      view_count: comic.comic_stats?.[0]?.view_count || 0
    }));
    
    return transformedComics;
  }

  // Get engagement data for analytics
  async getEngagementStats(creatorId: string) {
    const { data, error } = await supabase
      .from('comic_engagement')
      .select(`
        engagement_type,
        comic_id,
        comics!inner (
          creator_id
        )
      `)
      .eq('comics.creator_id', creatorId);

    if (error) {
      console.error('Error fetching engagement stats:', error);
      throw error;
    }

    return data || [];
  }

  // Get comment stats for analytics
  async getCommentStats(creatorId: string) {
    const { data, error } = await supabase
      .from('comic_comments')
      .select(`
        id,
        comic_id,
        comics!inner (
          creator_id
        )
      `)
      .eq('comics.creator_id', creatorId);

    if (error) {
      console.error('Error fetching comment stats:', error);
      throw error;
    }

    return data || [];
  }

  // Get comics by username (for public profile viewing)
  async getComicsByUsername(username: string): Promise<{ published: Comic[], drafts: Comic[] }> {
    try {
      // First get the user ID from the username via profiles table
      const { data: profileData, error: profileError } = await supabase
        .from('profiles_public')
        .select('id')
        .eq('username', username)
        .single();

      if (profileError || !profileData) {
        console.warn('Profile not found for username:', username);
        return { published: [], drafts: [] };
      }

      const userId = profileData.id;

      // Get comics by creator_id
      const { data: comics, error } = await supabase
        .from('comics')
        .select('*')
        .eq('creator_id', userId);

      if (error) {
        console.warn('Failed to fetch comics for username:', username, error);
        return { published: [], drafts: [] };
      }

      const mappedComics = (comics || []).map(this.mapSupabaseToComic);
      
      // Only expose drafts to the owner (no drafts on public profile views)
      const { data: { user } } = await supabase.auth.getUser();
      const isOwner = user && user.id === userId;
      return {
        published: mappedComics.filter(c => !c.id.startsWith('draft')),
        drafts: isOwner ? mappedComics.filter(c => c.id.startsWith('draft')) : []
      };
    } catch (error) {
      console.error('Error fetching comics by username:', error);
      return { published: [], drafts: [] };
    }
  }

  async getComicStats(comicId: string): Promise<number> {
    try {
      // Prefer Supabase stats in production
      const { data, error } = await supabase
        .from('comic_stats')
        .select('view_count')
        .eq('comic_id', comicId)
        .maybeSingle();

      if (error) {
        console.warn('Supabase getComicStats failed:', error.message);
        return 0;
      }

      return data?.view_count ?? 0;
    } catch (error) {
      console.error(`Error fetching stats for comic ${comicId}:`, error);
      return 0;
    }
  }

  async incrementComicViews(comicId: string): Promise<void> {
    console.log('Attempting to increment views for comic:', comicId);
    try {
      const response = await supabase.rpc('increment_comic_views', {
        input_comic_id: comicId
      });
      
      console.log('RPC Response:', response);
      
      if (response.error) {
        console.error('Error incrementing views:', response.error);
        throw response.error;
      }
      
      const currentStats = await this.getComicStats(comicId);
      console.log('Current view count after increment:', currentStats);
      
    } catch (err) {
      console.error('Failed to increment views:', err);
      throw err;
    }
  }

  // Add this method to the comicService class to check API health
  async checkApiHealth(): Promise<boolean> {
    try {
      // Try to ping the API server
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
      });
      
      if (response.ok) {
        console.log('API server is healthy');
        return true;
      } else {
        console.warn('API server returned non-OK status:', response.status);
        return false;
      }
    } catch (error) {
      console.error('API server appears to be offline:', error);
      return false;
    }
  }
}

export const comicService = ComicService.getInstance(); 