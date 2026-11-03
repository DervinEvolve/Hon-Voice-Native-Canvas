import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useComicStore } from '../store/useComicStore';
import { useAuth } from '../contexts/AuthContext';
import { collaboratorService, Collaborator } from '../services/collaboratorService';
import { supabase } from '../utils/supabaseClient';
import { initialsAvatar } from '../utils/initialsAvatar';
import { Panel, Comic } from '../types';
import { formatDistanceToNow } from "date-fns";

// Types for collaboration state
export interface CollaboratorPresence {
  userId: string;
  username: string;
  avatarUrl: string;
  cursorPosition: { x: number; y: number } | null;
  currentPageIndex: number;
  selectedPanelId: string | null;
  lastActive: Date;
  status: 'online' | 'idle' | 'offline';
}

export interface CollaborationChange {
  id: string;
  userId: string;
  username: string;
  pageIndex: number;
  panelId: string | null;
  timestamp: Date;
  changeType: 'add' | 'update' | 'delete' | 'move';
  description: string;
}

interface CollaborationContextType {
  // Collaborators
  collaborators: Collaborator[];
  activeCollaborators: CollaboratorPresence[];
  isLoadingCollaborators: boolean;
  
  // Panel editing states
  panelLocks: Record<string, string>; // panelId -> userId who's editing it
  isPanelLocked: (panelId: string) => boolean;
  lockPanel: (panelId: string) => Promise<boolean>;
  unlockPanel: (panelId: string) => void;
  
  // Presence
  updatePresence: (data: Partial<Omit<CollaboratorPresence, 'userId' | 'username' | 'avatarUrl'>>) => void;
  
  // Changes
  recentChanges: CollaborationChange[];
  
  // Invites
  inviteCollaborator: (email: string) => Promise<boolean>;
  removeCollaborator: (userId: string) => Promise<boolean>;
  isInvitingCollaborator: boolean;
  
  // New additions
  isConnected: boolean;
  getLockedBy: (panelId: string) => { userId: string; username: string } | null;
  formatTimeAgo: (timestamp: number) => string;
}

const CollaborationContext = createContext<CollaborationContextType | undefined>(undefined);

interface CollaborationProviderProps {
  children: ReactNode;
}

export const CollaborationProvider: React.FC<CollaborationProviderProps> = ({ children }) => {
  const { currentComic } = useComicStore();
  const { user, profile } = useAuth();
  
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [activeCollaborators, setActiveCollaborators] = useState<CollaboratorPresence[]>([]);
  const [isLoadingCollaborators, setIsLoadingCollaborators] = useState(false);
  const [panelLocks, setPanelLocks] = useState<Record<string, string>>({});
  const [recentChanges, setRecentChanges] = useState<CollaborationChange[]>([]);
  const [isInvitingCollaborator, setIsInvitingCollaborator] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [hasSupabaseSession, setHasSupabaseSession] = useState(false);

  // Track Supabase session so we avoid unauthenticated calls (smoother UX with Privy)
  useEffect(() => {
    let unsub: { unsubscribe: () => void } | null = null;
    const init = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        setHasSupabaseSession(!!data?.session);
      } catch {}
      const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
        setHasSupabaseSession(!!session);
      });
      unsub = listener.subscription;
    };
    init();
    return () => {
      if (unsub) unsub.unsubscribe();
    };
  }, []);
  
  // Fetch collaborators when the comic changes
  useEffect(() => {
    // Require both a logged-in app user and a Supabase session before collaborating
    if (!currentComic?.id || !user || !hasSupabaseSession) {
      setCollaborators([]); // Clear collaborators when not logged in
      setActiveCollaborators([]); // Clear active collaborators
      setIsConnected(false); // Mark as disconnected
      return;
    }
    
    const fetchCollaborators = async () => {
      setIsLoadingCollaborators(true);
      try {
        const data = await collaboratorService.getCollaborators(currentComic.id);
        setCollaborators(data);
      } catch (error) {
        console.error('Failed to fetch collaborators:', error);
        setCollaborators([]); // Set empty array on error
      } finally {
        setIsLoadingCollaborators(false);
      }
    };
    
    fetchCollaborators();
    
    // Setup realtime subscription for collaborator presence only when authenticated
    if (supabase && user && hasSupabaseSession) {
      // Check if we have any collaborators before setting up presence tracking
      const channel = supabase.channel(`comic:${currentComic.id}`);
      
      // Subscribe to presence updates
      channel
        .on('presence', { event: 'sync' }, () => {
          // Get all online users
          const state = channel.presenceState();
          
          // Convert presence state to our format
          const presenceList: CollaboratorPresence[] = Object.entries(state).map(([userId, presences]) => {
            const presenceData = presences[0] as any;
            return {
              userId,
              username: presenceData.username || `User ${userId.slice(0, 5)}`,
              avatarUrl: presenceData.avatarUrl || initialsAvatar(presenceData.username || 'User', userId),
              cursorPosition: presenceData.cursorPosition || null,
              currentPageIndex: presenceData.currentPageIndex || 0,
              selectedPanelId: presenceData.selectedPanelId || null,
              lastActive: new Date(presenceData.lastActive || Date.now()),
              status: presenceData.status || 'online'
            };
          });
          
          setActiveCollaborators(presenceList);
          setIsConnected(true);
        })
        .on('presence', { event: 'join' }, ({ key, newPresences }) => {
          // Handle user join
          console.log('User joined:', key, newPresences);
        })
        .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
          // Handle user leave
          console.log('User left:', key, leftPresences);
        });
      
      // Subscribe to panel lock events
      channel
        .on('broadcast', { event: 'panel_lock' }, (payload) => {
          setPanelLocks(prevLocks => ({
            ...prevLocks,
            [payload.panelId]: payload.userId
          }));
        })
        .on('broadcast', { event: 'panel_unlock' }, (payload) => {
          setPanelLocks(prevLocks => {
            const newLocks = { ...prevLocks };
            if (newLocks[payload.panelId] === payload.userId) {
              delete newLocks[payload.panelId];
            }
            return newLocks;
          });
        });
      
      // Subscribe to change events
      channel
        .on('broadcast', { event: 'panel_change' }, (payload) => {
          const change: CollaborationChange = payload.change;
          setRecentChanges(prev => [change, ...prev].slice(0, 20)); // Keep last 20 changes
        });
      
      // Track user's presence automatically
      if (user && profile) {
        const presenceData = {
          username: profile.username || user.email,
          avatarUrl: profile.avatarUrl,
          cursorPosition: null,
          currentPageIndex: 0,
          selectedPanelId: null,
          lastActive: new Date().toISOString(),
          status: 'online'
        };
        
        channel
          .subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
              await channel.track(presenceData);
            }
          });
      }
      
      // Cleanup on unmount
      return () => {
        channel.unsubscribe();
      };
    }
  }, [currentComic?.id, user, hasSupabaseSession]);
  
  // Function to check if a panel is locked
  const isPanelLocked = (panelId: string): boolean => {
    return !!panelLocks[panelId] && panelLocks[panelId] !== user?.id;
  };
  
  // Function to lock a panel for editing
  const lockPanel = async (panelId: string): Promise<boolean> => {
    if (!user || !currentComic?.id) return false;
    
    // Check if panel is already locked by someone else
    if (isPanelLocked(panelId)) return false;
    
    // Set locally first for immediate feedback
    setPanelLocks(prev => ({ ...prev, [panelId]: user.id }));
    
    // Broadcast to others
    if (supabase) {
      try {
        const channel = supabase.channel(`comic:${currentComic.id}`);
        await channel.send({
          type: 'broadcast',
          event: 'panel_lock',
          payload: { panelId, userId: user.id }
        });
        return true;
      } catch (error) {
        console.error('Failed to lock panel:', error);
        // Rollback local state
        setPanelLocks(prev => {
          const newLocks = { ...prev };
          delete newLocks[panelId];
          return newLocks;
        });
        return false;
      }
    }
    
    return true;
  };
  
  // Function to unlock a panel
  const unlockPanel = (panelId: string): void => {
    if (!user || !currentComic?.id) return;
    
    // Only the user who locked it can unlock it
    if (panelLocks[panelId] !== user.id) return;
    
    // Update local state
    setPanelLocks(prev => {
      const newLocks = { ...prev };
      delete newLocks[panelId];
      return newLocks;
    });
    
    // Broadcast to others
    if (supabase) {
      const channel = supabase.channel(`comic:${currentComic.id}`);
      channel.send({
        type: 'broadcast',
        event: 'panel_unlock',
        payload: { panelId, userId: user.id }
      }).catch(error => {
        console.error('Failed to unlock panel:', error);
      });
    }
  };
  
  // Function to update user presence
  const updatePresence = (data: Partial<Omit<CollaboratorPresence, 'userId' | 'username' | 'avatarUrl'>>): void => {
    if (!user || !currentComic?.id) return;
    
    if (supabase) {
      // Get the channel and ensure we subscribe before tracking
      const channel = supabase.channel(`comic:${currentComic.id}`);
      
      const presenceData = {
        username: profile?.username || user.email,
        avatarUrl: profile?.avatarUrl,
        lastActive: new Date().toISOString(),
        status: 'online',
        ...data
      };
      
      // Make sure we're subscribed before tracking
      if (!isConnected) {
        // Only subscribe if not already connected
        channel.subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            try {
              await channel.track(presenceData);
            } catch (error) {
              console.error('Failed to update presence after subscription:', error);
            }
          }
        });
      } else {
        // Already subscribed, just track
        channel.track(presenceData).catch(error => {
          console.error('Failed to update presence:', error);
        });
      }
    }
  };
  
  // Function to invite a collaborator
  const inviteCollaborator = async (email: string): Promise<boolean> => {
    if (!currentComic?.id) return false;
    
    setIsInvitingCollaborator(true);
    
    try {
      await collaboratorService.inviteCollaborator(currentComic.id, email);
      
      // Refresh collaborator list
      const updatedCollaborators = await collaboratorService.getCollaborators(currentComic.id);
      setCollaborators(updatedCollaborators);
      
      return true;
    } catch (error) {
      console.error('Failed to invite collaborator:', error);
      return false;
    } finally {
      setIsInvitingCollaborator(false);
    }
  };
  
  // Function to remove a collaborator
  const removeCollaborator = async (userId: string): Promise<boolean> => {
    if (!currentComic?.id) return false;
    
    try {
      await collaboratorService.removeCollaborator(currentComic.id, userId);
      
      // Refresh collaborator list
      const updatedCollaborators = await collaboratorService.getCollaborators(currentComic.id);
      setCollaborators(updatedCollaborators);
      
      return true;
    } catch (error) {
      console.error('Failed to remove collaborator:', error);
      return false;
    }
  };
  
  // Get user who locked a panel
  const getLockedBy = (panelId: string): { userId: string; username: string } | null => {
    const lock = panelLocks[panelId];
    if (!lock) return null;
    return {
      userId: lock,
      username: user?.user_metadata?.username || user?.email || `User ${lock.slice(0, 5)}`
    };
  };
  
  // Format time for display
  const formatTimeAgo = (timestamp: number): string => {
    return formatDistanceToNow(timestamp, { addSuffix: true });
  };
  
  return (
    <CollaborationContext.Provider
      value={{
        collaborators,
        activeCollaborators,
        isLoadingCollaborators,
        panelLocks,
        isPanelLocked,
        lockPanel,
        unlockPanel,
        updatePresence,
        recentChanges,
        inviteCollaborator,
        removeCollaborator,
        isInvitingCollaborator,
        isConnected,
        getLockedBy,
        formatTimeAgo
      }}
    >
      {children}
    </CollaborationContext.Provider>
  );
};

// Hook for using the collaboration context
export const useCollaboration = () => {
  const context = useContext(CollaborationContext);
  if (context === undefined) {
    throw new Error('useCollaboration must be used within a CollaborationProvider');
  }
  return context;
}; 