import { supabase } from '../utils/supabaseClient';

export type MemoryScope = 'user' | 'project';

export interface PutMemoryInput {
  key: string;
  value: Record<string, any>;
  tags?: string[];
  importance?: number; // 0-10
  scope?: MemoryScope; // default: 'user'
  projectId?: string | null;
}

export interface MemoryRecord {
  id: string;
  user_id: string | null;
  wallet_address: string | null;
  key: string;
  value_json: Record<string, any>;
  tags: string[] | null;
  importance: number | null;
  scope: MemoryScope;
  project_id: string | null;
  updated_at: string;
}

class MemoryService {
  private async getUserAndWallet(): Promise<{ userId: string | null; walletAddress: string | null }> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      // Wallet address, if your app stores it in local storage or profile, can be wired here later
      // For now, we try to infer from profile if available
      const walletAddress = null;
      return { userId: user?.id ?? null, walletAddress };
    } catch {
      return { userId: null, walletAddress: null };
    }
  }

  async put(input: PutMemoryInput): Promise<MemoryRecord | null> {
    const { userId, walletAddress } = await this.getUserAndWallet();
    if (!userId && !walletAddress) return null;

    const row = {
      user_id: userId,
      wallet_address: walletAddress,
      key: input.key,
      value_json: input.value,
      tags: input.tags ?? null,
      importance: input.importance ?? null,
      scope: input.scope ?? 'user',
      project_id: input.projectId ?? null,
    } as any;

    // Upsert by unique composite (user_id/wallet_address, key)
    const { data, error } = await supabase
      .from('hon_memories')
      .upsert(row, { onConflict: 'user_id,wallet_address,key' })
      .select()
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn('hon_memories upsert failed:', error.message);
      return null;
    }
    return data as MemoryRecord;
  }

  async get(key: string): Promise<MemoryRecord | null> {
    const { userId, walletAddress } = await this.getUserAndWallet();
    if (!userId && !walletAddress) return null;

    let query = supabase.from('hon_memories').select('*').eq('key', key).limit(1);
    if (userId) query = query.eq('user_id', userId);
    else query = query.eq('wallet_address', walletAddress);

    const { data, error } = await query.maybeSingle();
    if (error) {
      return null;
    }
    return data as MemoryRecord;
  }

  async search(params: { tag?: string; limit?: number }): Promise<MemoryRecord[]> {
    const { userId, walletAddress } = await this.getUserAndWallet();
    if (!userId && !walletAddress) return [];

    const limit = params.limit ?? 50;
    let query = supabase.from('hon_memories').select('*').order('updated_at', { ascending: false }).limit(limit);
    if (userId) query = query.eq('user_id', userId);
    else query = query.eq('wallet_address', walletAddress);
    if (params.tag) query = query.contains('tags', [params.tag]);

    const { data, error } = await query;
    if (error) return [];
    return (data ?? []) as MemoryRecord[];
  }

  async delete(key: string): Promise<boolean> {
    const { userId, walletAddress } = await this.getUserAndWallet();
    if (!userId && !walletAddress) return false;
    let query = supabase.from('hon_memories').delete().eq('key', key);
    if (userId) query = query.eq('user_id', userId);
    else query = query.eq('wallet_address', walletAddress);
    const { error } = await query;
    return !error;
  }

  // Session snapshot helpers (optional for reconnection continuity)
  async upsertSessionSnapshot(snapshot: Record<string, any>): Promise<void> {
    const { userId, walletAddress } = await this.getUserAndWallet();
    if (!userId && !walletAddress) return;
    const row = {
      user_id: userId,
      wallet_address: walletAddress,
      snapshot_json: snapshot,
    } as any;
    await supabase.from('hon_sessions').upsert(row, { onConflict: 'user_id,wallet_address' });
  }

  async getSessionSnapshot(): Promise<Record<string, any> | null> {
    const { userId, walletAddress } = await this.getUserAndWallet();
    if (!userId && !walletAddress) return null;
    let query = supabase.from('hon_sessions').select('snapshot_json').limit(1);
    if (userId) query = query.eq('user_id', userId);
    else query = query.eq('wallet_address', walletAddress);
    const { data, error } = await query.maybeSingle();
    if (error || !data) return null;
    return (data as any).snapshot_json ?? null;
  }
}

export const memoryService = new MemoryService();


