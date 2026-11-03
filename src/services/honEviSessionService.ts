/**
 * Hon EVI Session Service
 * 
 * Manages Hume EVI chat sessions and chat groups for conversation continuity.
 * Enables Hon to remember context across disconnects and resume conversations seamlessly.
 */

// Share the app auth client so session refresh and persistence use one instance.
import { supabase } from '../utils/supabaseClient';

export interface HonEviSession {
  id: string;
  user_id: string | null;
  wallet_address: string | null;
  chat_group_id: string;
  current_chat_id: string | null;
  is_active: boolean;
  last_active: string;
  started_at: string;
  ended_at: string | null;
  total_duration_seconds: number;
  message_count: number;
  tool_calls_count: number;
  last_context: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface SessionContext {
  current_task?: string;
  panels_created?: number;
  active_models?: string[];
  user_preferences?: Record<string, any>;
  [key: string]: any;
}

class HonEviSessionService {
  /**
   * Initialize or resume a session for the current user
   * Returns the chat_group_id to use for the WebSocket connection, or null for a fresh start
   */
  async initializeSession(userId?: string, walletAddress?: string): Promise<string | null> {
    if (!supabase) {
      console.warn('[HonEviSession] Supabase not configured, using in-memory session');
      return null;
    }

    if (!userId && !walletAddress) {
      console.warn('[HonEviSession] No user identification provided');
      return null;
    }

    try {
      // Check for existing active session
      const existingSession = await this.getActiveSession(userId, walletAddress);
      
      if (existingSession) {
        // Check if session is recent (within last 24 hours)
        const lastActive = new Date(existingSession.last_active);
        const hoursSinceActive = (Date.now() - lastActive.getTime()) / (1000 * 60 * 60);
        
        if (hoursSinceActive < 24) {
          console.log('[HonEviSession] Resuming existing session:', {
            chat_group_id: existingSession.chat_group_id,
            hours_since_active: hoursSinceActive.toFixed(2)
          });
          
          // Update last_active timestamp
          await this.updateSessionActivity(existingSession.id);
          
          return existingSession.chat_group_id;
        } else {
          // Session too old, deactivate it and start fresh
          console.log('[HonEviSession] Session expired, starting fresh');
          await this.deactivateSession(existingSession.id);
          return null;
        }
      }
      
      // No active session found
      console.log('[HonEviSession] No active session found, will start fresh');
      return null;
      
    } catch (error) {
      console.error('[HonEviSession] Error initializing session:', error);
      return null;
    }
  }

  /**
   * Get the active session for a user
   */
  async getActiveSession(userId?: string, walletAddress?: string): Promise<HonEviSession | null> {
    if (!supabase) return null;

    try {
      let query = supabase
        .from('hon_evi_sessions')
        .select('*')
        .eq('is_active', true)
        .single();

      // Filter by user_id or wallet_address
      if (userId) {
        query = query.eq('user_id', userId);
      } else if (walletAddress) {
        query = query.eq('wallet_address', walletAddress);
      } else {
        return null;
      }

      const { data, error } = await query;

      if (error) {
        if (error.code === 'PGRST116') {
          // No rows returned - this is expected, not an error
          return null;
        }
        throw error;
      }

      return data;
    } catch (error) {
      console.error('[HonEviSession] Error getting active session:', error);
      return null;
    }
  }

  /**
   * Store a new chat session (called when receiving chat_metadata from Hume)
   * Returns the session ID
   */
  async storeChatMetadata(
    chatGroupId: string,
    chatId: string,
    userId?: string,
    walletAddress?: string,
    context?: SessionContext
  ): Promise<string | null> {
    if (!supabase) {
      console.warn('[HonEviSession] Supabase not configured, cannot store session');
      return null;
    }

    if (!userId && !walletAddress) {
      console.warn('[HonEviSession] No user identification provided');
      return null;
    }

    try {
      // Deactivate any existing active sessions for this user
      const existingSession = await this.getActiveSession(userId, walletAddress);
      if (existingSession) {
        await this.deactivateSession(existingSession.id);
      }

      // Create new session
      const sessionData: any = {
        user_id: userId || null,
        wallet_address: walletAddress || null,
        chat_group_id: chatGroupId,
        current_chat_id: chatId,
        is_active: true,
        last_active: new Date().toISOString(),
        started_at: new Date().toISOString(),
        last_context: context || {},
      };

      const { data, error } = await supabase
        .from('hon_evi_sessions')
        .insert(sessionData)
        .select()
        .single();

      if (error) throw error;

      console.log('[HonEviSession] Session stored:', {
        session_id: data.id,
        chat_group_id: chatGroupId,
        user_id: userId,
        wallet_address: walletAddress
      });

      return data.id;

    } catch (error) {
      console.error('[HonEviSession] Error storing session:', error);
      return null;
    }
  }

  /**
   * Update session activity timestamp (keepalive)
   */
  async updateSessionActivity(sessionId: string): Promise<void> {
    if (!supabase) return;

    try {
      const { error } = await supabase
        .from('hon_evi_sessions')
        .update({ 
          last_active: new Date().toISOString() 
        })
        .eq('id', sessionId);

      if (error) throw error;
    } catch (error) {
      console.error('[HonEviSession] Error updating session activity:', error);
    }
  }

  /**
   * Update session context (for session_upsert tool)
   */
  async updateSessionContext(
    chatGroupId: string,
    context: SessionContext
  ): Promise<void> {
    if (!supabase) return;

    try {
      const { error } = await supabase
        .from('hon_evi_sessions')
        .update({ 
          last_context: context,
          last_active: new Date().toISOString() 
        })
        .eq('chat_group_id', chatGroupId)
        .eq('is_active', true);

      if (error) throw error;

      console.log('[HonEviSession] Context updated for chat group:', chatGroupId);
    } catch (error) {
      console.error('[HonEviSession] Error updating session context:', error);
    }
  }

  /**
   * Increment message counter
   */
  async incrementMessageCount(sessionId: string): Promise<void> {
    if (!supabase) return;

    try {
      const { error } = await supabase.rpc('increment_message_count', {
        session_id: sessionId
      });

      if (error) {
        // Fallback: manual increment
        const session = await this.getSessionById(sessionId);
        if (session) {
          await supabase
            .from('hon_evi_sessions')
            .update({ 
              message_count: (session.message_count || 0) + 1,
              last_active: new Date().toISOString()
            })
            .eq('id', sessionId);
        }
      }
    } catch (error) {
      console.error('[HonEviSession] Error incrementing message count:', error);
    }
  }

  /**
   * Increment tool calls counter
   */
  async incrementToolCallsCount(sessionId: string): Promise<void> {
    if (!supabase) return;

    try {
      const session = await this.getSessionById(sessionId);
      if (session) {
        await supabase
          .from('hon_evi_sessions')
          .update({ 
            tool_calls_count: (session.tool_calls_count || 0) + 1,
            last_active: new Date().toISOString()
          })
          .eq('id', sessionId);
      }
    } catch (error) {
      console.error('[HonEviSession] Error incrementing tool calls count:', error);
    }
  }

  /**
   * Get session by ID
   */
  private async getSessionById(sessionId: string): Promise<HonEviSession | null> {
    if (!supabase) return null;

    try {
      const { data, error } = await supabase
        .from('hon_evi_sessions')
        .select('*')
        .eq('id', sessionId)
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('[HonEviSession] Error getting session by ID:', error);
      return null;
    }
  }

  /**
   * Deactivate a session (called when user explicitly ends conversation)
   */
  async deactivateSession(sessionId: string): Promise<void> {
    if (!supabase) return;

    try {
      // Get session to calculate duration
      const session = await this.getSessionById(sessionId);
      if (!session) return;

      const startTime = new Date(session.started_at).getTime();
      const endTime = Date.now();
      const durationSeconds = Math.floor((endTime - startTime) / 1000);

      const { error } = await supabase
        .from('hon_evi_sessions')
        .update({ 
          is_active: false,
          ended_at: new Date().toISOString(),
          total_duration_seconds: durationSeconds
        })
        .eq('id', sessionId);

      if (error) throw error;

      console.log('[HonEviSession] Session deactivated:', {
        session_id: sessionId,
        duration_seconds: durationSeconds
      });
    } catch (error) {
      console.error('[HonEviSession] Error deactivating session:', error);
    }
  }

  /**
   * Deactivate session by chat group ID
   */
  async deactivateSessionByChatGroupId(chatGroupId: string): Promise<void> {
    if (!supabase) return;

    try {
      const { data, error } = await supabase
        .from('hon_evi_sessions')
        .select('id')
        .eq('chat_group_id', chatGroupId)
        .eq('is_active', true)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // No active session found
          return;
        }
        throw error;
      }

      if (data) {
        await this.deactivateSession(data.id);
      }
    } catch (error) {
      console.error('[HonEviSession] Error deactivating session by chat group ID:', error);
    }
  }

  /**
   * Get all sessions for a user (for analytics/history)
   */
  async getUserSessions(
    userId?: string,
    walletAddress?: string,
    limit: number = 10
  ): Promise<HonEviSession[]> {
    if (!supabase) return [];

    try {
      let query = supabase
        .from('hon_evi_sessions')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(limit);

      if (userId) {
        query = query.eq('user_id', userId);
      } else if (walletAddress) {
        query = query.eq('wallet_address', walletAddress);
      } else {
        return [];
      }

      const { data, error } = await query;

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('[HonEviSession] Error getting user sessions:', error);
      return [];
    }
  }

  /**
   * Clean up old inactive sessions (maintenance function)
   */
  async cleanupOldSessions(daysOld: number = 30): Promise<number> {
    if (!supabase) return 0;

    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      const { data, error } = await supabase
        .from('hon_evi_sessions')
        .delete()
        .eq('is_active', false)
        .lt('ended_at', cutoffDate.toISOString())
        .select('id');

      if (error) throw error;

      const deletedCount = data?.length || 0;
      console.log(`[HonEviSession] Cleaned up ${deletedCount} old sessions`);
      
      return deletedCount;
    } catch (error) {
      console.error('[HonEviSession] Error cleaning up old sessions:', error);
      return 0;
    }
  }
}

// Export singleton instance
export const honEviSessionService = new HonEviSessionService();

