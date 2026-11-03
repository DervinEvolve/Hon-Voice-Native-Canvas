import { supabase } from '../utils/supabaseClient';

export type RecentGenerationType = 'image' | 'video' | 'gif';

export interface RecentGenerationRecord {
  id: string;
  user_id: string | null;
  wallet_address?: string | null;
  type: RecentGenerationType;
  url: string;
  prompt: string;
  model: string;
  created_at: string; // ISO string from DB
  metadata?: Record<string, any> | null;
}

export interface CreateRecentGenerationInput {
  type: RecentGenerationType;
  url: string;
  prompt: string;
  model: string;
  metadata?: Record<string, any>;
}

class RecentGenerationsService {
  async saveForCurrentUser(input: CreateRecentGenerationInput): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return; // skip if not logged in

    const payload = {
      user_id: user.id,
      type: input.type,
      url: input.url,
      prompt: input.prompt,
      model: input.model,
      metadata: input.metadata ?? null,
    };

    const { error } = await supabase.from('recent_generations').insert(payload);
    if (error) {
      // Non-fatal: log and continue UX with local state
      console.warn('recent_generations insert failed:', error.message);
    }
  }

  async saveForWalletAddress(walletAddress: string, input: CreateRecentGenerationInput): Promise<void> {
    if (!walletAddress) return;
    const payload = {
      user_id: null,
      wallet_address: walletAddress,
      type: input.type,
      url: input.url,
      prompt: input.prompt,
      model: input.model,
      metadata: input.metadata ?? null,
    } as any;
    const { error } = await supabase.from('recent_generations').insert(payload);
    if (error) {
      console.warn('recent_generations insert (wallet) failed:', error.message);
    }
  }

  async listForCurrentUser(limit: number = 100): Promise<Array<{ url: string; prompt: string; timestamp: Date; model: string; type: RecentGenerationType; metadata?: Record<string, any>; creatorName: string; creatorAvatar: string | null }>> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    // Get user profile information - use maybeSingle to avoid 406 errors
    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('username, avatar_url')
      .eq('id', user.id)
      .maybeSingle();

    // Try to get wallet address from the user's profile
    let walletAddress = null;
    if (profileData) {
      const { data: walletData } = await supabase
        .from('profiles')
        .select('wallet_address')
        .eq('id', user.id)
        .maybeSingle(); // Use maybeSingle to avoid 406 errors
      walletAddress = walletData?.wallet_address;
      console.log('Found wallet address for user:', walletAddress);
    }

    // Query for generations by user_id first
    let { data, error } = await supabase
      .from('recent_generations')
      .select('url,prompt,model,type,created_at,metadata')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit);

    console.log('Generations by user_id:', { count: data?.length || 0, data: data?.slice(0, 2) });

    // If no results by user_id and we have a wallet address, try by wallet_address
    if ((!data || data.length === 0) && walletAddress) {
      console.log('No generations found by user_id, trying wallet_address:', walletAddress);
      const { data: walletData, error: walletError } = await supabase
        .from('recent_generations')
        .select('url,prompt,model,type,created_at,metadata')
        .eq('wallet_address', walletAddress)
        .order('created_at', { ascending: false })
        .limit(limit);
      
      console.log('Generations by wallet_address:', { count: walletData?.length || 0, data: walletData?.slice(0, 2) });
      
      if (walletError) {
        console.warn('recent_generations fetch by wallet failed:', walletError.message);
      } else {
        data = walletData;
        error = walletError;
      }
    }

    if (error) {
      console.warn('recent_generations fetch failed:', error.message);
      return [];
    }

    return (data || []).map((row: any) => ({
      url: row.url,
      prompt: row.prompt,
      model: row.model,
      type: row.type as RecentGenerationType,
      timestamp: new Date(row.created_at),
      metadata: row.metadata || undefined,
      creatorName: profileData?.username || 'Unknown',
      creatorAvatar: profileData?.avatar_url || null,
    }));
  }

  async listForWalletAddress(walletAddress: string, limit: number = 100): Promise<Array<{ url: string; prompt: string; timestamp: Date; model: string; type: RecentGenerationType; metadata?: Record<string, any>; creatorName: string; creatorAvatar: string | null }>> {
    if (!walletAddress) return [];

    // Get user profile information by wallet address - use maybeSingle to avoid 406 errors
    const { data: profileData, error: profileError } = await supabase
      .from('profiles_public')
      .select('username, avatar_url')
      .eq('wallet_address', walletAddress)
      .maybeSingle();

    const { data, error } = await supabase
      .from('recent_generations')
      .select('url,prompt,model,type,created_at,metadata')
      .eq('wallet_address', walletAddress)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.warn('recent_generations fetch by wallet failed:', error.message);
      return [];
    }

    return (data || []).map((row: any) => ({
      url: row.url,
      prompt: row.prompt,
      model: row.model,
      type: row.type as RecentGenerationType,
      timestamp: new Date(row.created_at),
      metadata: row.metadata || undefined,
      creatorName: profileData?.username || 'Unknown',
      creatorAvatar: profileData?.avatar_url || null,
    }));
  }

  // Get recent generations by username (for public profile viewing)
  async listForUsername(username: string, limit: number = 100): Promise<Array<{ url: string; prompt: string; timestamp: Date; model: string; type: RecentGenerationType; metadata?: Record<string, any>; creatorName: string; creatorAvatar: string | null }>> {
    try {
      // First get the user ID from the username via profiles table - use maybeSingle to avoid 406 errors
      const { data: profileData, error: profileError } = await supabase
        .from('profiles_public')
        .select('id, username, avatar_url')
        .eq('username', username)
        .maybeSingle();

      if (profileError || !profileData) {
        console.warn('Profile not found for username:', username);
        return [];
      }

      const userId = profileData.id;

      // Get recent generations by user_id
      const { data, error } = await supabase
        .from('recent_generations')
        .select('url,prompt,model,type,created_at,metadata')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.warn('recent_generations fetch by username failed:', error.message);
        return [];
      }

      return (data || []).map((row: any) => ({
        url: row.url,
        prompt: row.prompt,
        model: row.model,
        type: row.type as RecentGenerationType,
        timestamp: new Date(row.created_at),
        metadata: row.metadata || undefined,
        creatorName: profileData.username || 'Unknown',
        creatorAvatar: profileData.avatar_url,
      }));
    } catch (error) {
      console.error('Error fetching recent generations by username:', error);
      return [];
    }
  }
}

export const recentGenerationsService = new RecentGenerationsService();

