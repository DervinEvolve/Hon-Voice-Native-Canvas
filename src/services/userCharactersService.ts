import { supabase } from '../utils/supabaseClient';

export interface UserCharacter {
  id: string;
  user_id: string | null;
  wallet_address?: string | null;
  name?: string | null;
  soul_id?: string | null;
  image_url?: string | null;
  created_at?: string;
  metadata?: Record<string, any> | null;
}

export const userCharactersService = {
  async saveForCurrentUser(input: { name?: string; soul_id?: string; image_url?: string; metadata?: Record<string, any> }) {
    const { data: { user } } = await supabase.auth.getUser();
    const payload: any = {
      user_id: user?.id || null,
      wallet_address: null,
      name: input.name || null,
      soul_id: input.soul_id || null,
      image_url: input.image_url || null,
      metadata: input.metadata || null,
    };
    const { error } = await supabase.from('user_characters').insert(payload);
    if (error) console.warn('user_characters insert failed:', error.message);
  },

  async upsertForCurrentUser(input: { name?: string; soul_id?: string; image_url?: string; metadata?: Record<string, any> }) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: existing } = await supabase
      .from('user_characters')
      .select('id')
      .eq('user_id', user.id)
      .eq('soul_id', input.soul_id || null)
      .limit(1);
    if (existing && existing.length) {
      const id = (existing as any)[0].id as string;
      await supabase.from('user_characters').update({
        name: input.name || null,
        image_url: input.image_url || null,
        metadata: input.metadata || null,
      }).eq('id', id);
    } else {
      await this.saveForCurrentUser(input);
    }
  },

  async listForCurrentUser(limit = 50): Promise<UserCharacter[]> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    const { data, error } = await supabase
      .from('user_characters')
      .select('id,name,soul_id,image_url,created_at,metadata')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      console.warn('user_characters list failed:', error.message);
      return [];
    }
    return (data || []) as any;
  }
};


