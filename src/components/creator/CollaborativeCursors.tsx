import React, { useState, useEffect } from 'react';
import { useCollaboration } from '../../contexts/CollaborationContext';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../utils/supabaseClient';
import { useComicStore } from '../../store/useComicStore';

interface CursorPosition {
  userId: string;
  username: string;
  avatarUrl?: string;
  x: number;
  y: number;
  lastUpdated: number;
}

interface CollaborativeCursorsProps {
  containerRef: React.RefObject<HTMLDivElement>;
}

const CollaborativeCursors: React.FC<CollaborativeCursorsProps> = ({ containerRef }) => {
  const { currentComic } = useComicStore();
  const { user } = useAuth();
  const [cursors, setCursors] = useState<Record<string, CursorPosition>>({});
  const [localCursor, setLocalCursor] = useState({ x: 0, y: 0 });
  const [throttle, setThrottle] = useState(false);
  const { isConnected } = useCollaboration();

  // Generate a consistent color based on userId
  const getUserColor = (userId: string) => {
    // Simple hash function to generate a color
    const hash = userId.split('').reduce((acc, char) => {
      return char.charCodeAt(0) + ((acc << 5) - acc);
    }, 0);
    
    // Convert to HSL color (using hue with good saturation and lightness)
    return `hsl(${Math.abs(hash % 360)}, 65%, 55%)`;
  };

  // Set up cursor tracking
  useEffect(() => {
    if (!containerRef.current || !user || !currentComic || !isConnected) return;
    
    const container = containerRef.current;

    // Track mouse movement within the container
    const handleMouseMove = (e: MouseEvent) => {
      if (!container) return;
      
      // Get relative position to the container
      const rect = container.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100; // as percentage
      const y = ((e.clientY - rect.top) / rect.height) * 100; // as percentage
      
      setLocalCursor({ x, y });
      
      // Throttle broadcasting to reduce websocket traffic
      if (!throttle) {
        setThrottle(true);
        
        // Broadcast cursor position
        const channel = supabase.channel(`comic:${currentComic.id}`);
        channel.send({
          type: 'broadcast',
          event: 'cursor_move',
          payload: {
            userId: user.id,
            username: user.user_metadata?.username || user.email,
            avatarUrl: user.user_metadata?.avatar_url,
            x,
            y,
            lastUpdated: Date.now()
          }
        });
        
        // Reset throttle after a short delay
        setTimeout(() => setThrottle(false), 50);
      }
    };
    
    // Add event listener
    container.addEventListener('mousemove', handleMouseMove);
    
    // Clean up
    return () => {
      container.removeEventListener('mousemove', handleMouseMove);
    };
  }, [containerRef, user, currentComic, throttle, isConnected]);

  // Subscribe to cursor broadcasts
  useEffect(() => {
    if (!currentComic || !user || !isConnected) return;
    
    // Set up channel to listen for cursor movements
    const channel = supabase
      .channel(`comic:${currentComic.id}`)
      .on('broadcast', { event: 'cursor_move' }, (payload) => {
        if (!payload.payload) return;
        
        const { userId, username, avatarUrl, x, y, lastUpdated } = payload.payload;
        
        // Don't track own cursor
        if (userId === user.id) return;
        
        // Update cursors
        setCursors(prev => ({
          ...prev,
          [userId]: { userId, username, avatarUrl, x, y, lastUpdated }
        }));
      });
    
    channel.subscribe();
    
    // Clean up
    return () => {
      channel.unsubscribe();
    };
  }, [currentComic, user, isConnected]);
  
  // Remove stale cursors
  useEffect(() => {
    if (Object.keys(cursors).length === 0) return;
    
    const interval = setInterval(() => {
      const now = Date.now();
      setCursors(prev => {
        const updated = { ...prev };
        Object.entries(updated).forEach(([userId, cursor]) => {
          // Remove cursors that haven't been updated in 5 seconds
          if (now - cursor.lastUpdated > 5000) {
            delete updated[userId];
          }
        });
        return updated;
      });
    }, 2000);
    
    return () => clearInterval(interval);
  }, [cursors]);

  return (
    <>
      {Object.values(cursors).map((cursor) => (
        <div
          key={cursor.userId}
          className="absolute pointer-events-none z-50 flex flex-col items-start"
          style={{
            left: `${cursor.x}%`,
            top: `${cursor.y}%`,
            transform: 'translate(-50%, -50%)'
          }}
        >
          {/* Cursor pointer */}
          <svg 
            width="24" 
            height="24" 
            viewBox="0 0 24 24" 
            fill="none" 
            style={{ 
              filter: 'drop-shadow(0px 0px 2px rgba(0,0,0,0.5))',
              color: getUserColor(cursor.userId)
            }}
          >
            <path 
              d="M5 3L19 12L12 13L9 20L5 3Z" 
              fill="currentColor" 
              stroke="white" 
              strokeWidth="1"
            />
          </svg>
          
          {/* User label */}
          <div 
            className="mt-1 px-2 py-1 rounded text-xs text-white whitespace-nowrap"
            style={{ 
              backgroundColor: getUserColor(cursor.userId),
              boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
              transform: 'translateX(8px)'
            }}
          >
            {cursor.username || `User ${cursor.userId.slice(0,5)}`}
          </div>
        </div>
      ))}
    </>
  );
};

export default CollaborativeCursors; 