import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Search, Users, Bot, Clock, UserCheck, Edit, Trash, Lock, Unlock, User, Activity, Mic, MicOff } from 'lucide-react';
import { collaboratorService, Collaborator } from '../../services/collaboratorService';
import { useCollaboration } from '../../contexts/CollaborationContext';
import { humeEviService, HonSessionStatus, HonProcessingState } from '../../services/humeEviService';

interface CollaborationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInvite: (email: string) => void;
  isInviting?: boolean;
}

export const CollaborationModal: React.FC<CollaborationModalProps> = ({
  isOpen,
  onClose,
  onInvite,
  isInviting = false,
}) => {
  const [email, setEmail] = useState('');
  const [searchResults, setSearchResults] = useState<Collaborator[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [activeTab, setActiveTab] = useState<'invite' | 'activity' | 'ai'>('invite');
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  
  // Hume EVI State
  const [honStatus, setHonStatus] = useState<HonSessionStatus>('idle');
  const [isHonMuted, setIsHonMuted] = useState(false);
  const [honActive, setHonActive] = useState(false);
  const [honProcessing, setHonProcessing] = useState<HonProcessingState>('idle');

  // Get collaboration context data
  const { 
    collaborators, 
    recentChanges, 
    formatTimeAgo,
    isConnected 
  } = useCollaboration();

  // Subscribe to Hume EVI status updates
  useEffect(() => {
    const unsubscribe = humeEviService.onStatusChange((status) => {
      setHonStatus(status);
      if (status === 'idle' || status === 'error') {
        setIsHonMuted(false); 
      }
    });
    return unsubscribe;
  }, []);

  // Subscribe to visual indicator stream (active + processing state)
  useEffect(() => {
    const un = humeEviService.onVisualIndicatorChange((active, processing) => {
      setHonActive(active);
      setHonProcessing(processing);
    });
    return un;
  }, []);

  // Focus the search input when the modal opens
  useEffect(() => {
    if (isOpen && searchInputRef.current && activeTab === 'invite') {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
    }
  }, [isOpen, activeTab]);

  // Handle focus trapping
  useEffect(() => {
    if (!isOpen) return;

    const handleTabKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !modalRef.current) return;

      const focusableElements = modalRef.current.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      
      const firstElement = focusableElements[0] as HTMLElement;
      const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          lastElement.focus();
          e.preventDefault();
        }
      } else {
        if (document.activeElement === lastElement) {
          firstElement.focus();
          e.preventDefault();
        }
      }
    };

    document.addEventListener('keydown', handleTabKey);
    return () => {
      document.removeEventListener('keydown', handleTabKey);
    };
  }, [isOpen]);

  const handleBackdropClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
      onClose();
    }
  }, [onClose]);

  const handleSearch = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setEmail(value);
    
    if (value.length > 2) {
      setIsSearching(true);
      try {
        const results = await collaboratorService.searchUsers(value);
        setSearchResults(results);
      } catch (error) {
        console.error('Error searching users:', error);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    } else {
      setSearchResults([]);
    }
  };

  const handleInvite = () => {
    onInvite(email);
    setEmail('');
  };

  useEffect(() => {
    const handleEscapeKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscapeKey);
    return () => {
      document.removeEventListener('keydown', handleEscapeKey);
    };
  }, [isOpen, onClose]);
  
  const getChangeIcon = (changeType: string) => {
    switch (changeType) {
      case 'edit':
        return <Edit size={16} className="text-blue-500" />;
      case 'add':
        return <UserCheck size={16} className="text-green-500" />;
      case 'delete':
        return <Trash size={16} className="text-red-500" />;
      case 'lock':
        return <Lock size={16} className="text-amber-500" />;
      case 'unlock':
        return <Unlock size={16} className="text-purple-500" />;
      default:
        return <Activity size={16} className="text-gray-500" />;
    }
  };

  const handleInviteHon = async () => {
    await humeEviService.startSession();
  };

  const handleEndCall = async () => {
    await humeEviService.endSession();
  };

  const handleToggleMute = async () => {
    await humeEviService.toggleMute();
    setIsHonMuted(prevState => !prevState); 
  };

  if (!isOpen) return null;

  const modalContent = (
    <div 
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[10000] modal-fade-in"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div 
        ref={modalRef}
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md modal-content"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 id="modal-title" className="text-xl font-semibold text-gray-900 dark:text-white">
            Invite & Collab
          </h2>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="flex border-b border-gray-200 dark:border-gray-700 mb-4">
          <button
            className={`py-2 px-4 text-sm font-medium flex-1 ${
              activeTab === 'invite' 
                ? 'text-blue-500 border-b-2 border-blue-500' 
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
            onClick={() => setActiveTab('invite')}
          >
            <div className="flex items-center justify-center space-x-1">
              <Users size={16} />
              <span>Invite</span>
            </div>
          </button>
          
          <button
            className={`py-2 px-4 text-sm font-medium flex-1 ${
              activeTab === 'activity' 
                ? 'text-blue-500 border-b-2 border-blue-500' 
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
            onClick={() => setActiveTab('activity')}
          >
            <div className="flex items-center justify-center space-x-1">
              <Clock size={16} />
              <span>Activity</span>
            </div>
          </button>
          
          <button
            className={`py-2 px-4 text-sm font-medium flex-1 ${
              activeTab === 'ai' 
                ? 'text-blue-500 border-b-2 border-blue-500' 
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
            onClick={() => setActiveTab('ai')}
          >
            <div className="flex items-center justify-center space-x-1">
              <Bot size={16} />
              <span>AI</span>
            </div>
          </button>
        </div>

        {activeTab === 'invite' && (
          <>
            <div className="mb-4">
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Search className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  ref={searchInputRef}
                  type="text"
                  value={email}
                  onChange={handleSearch}
                  placeholder="Search by username or email"
                  className="pl-10 w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
            </div>

            {isSearching && (
              <div className="flex justify-center items-center py-4">
                <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-blue-500"></div>
              </div>
            )}

            {searchResults.length > 0 && (
              <div className="mb-4 max-h-60 overflow-y-auto">
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Search Results</h3>
                <div className="space-y-2">
                  {searchResults.map((user) => (
                    <div
                      key={user.id}
                      className="flex items-center justify-between p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md cursor-pointer"
                      onClick={() => setEmail(user.username)}
                    >
                      <div className="flex items-center space-x-3">
                        {user.avatar_url ? (
                          <img
                            src={user.avatar_url}
                            alt={user.username}
                            className="h-8 w-8 rounded-full object-cover"
                          />
                        ) : (
                          <div className="h-8 w-8 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center">
                            <span className="text-xs font-medium text-gray-800 dark:text-gray-200">
                              {user.username.charAt(0).toUpperCase()}
                            </span>
                          </div>
                        )}
                        <span className="text-sm font-medium text-gray-900 dark:text-white">{user.username}</span>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onInvite(user.username);
                        }}
                        className="px-3 py-1 bg-blue-500 text-white text-xs rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={isInviting}
                      >
                        {isInviting ? 'Inviting...' : 'Invite'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Or invite by email</h3>
              <div className="flex space-x-2">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter email address"
                  className="flex-1 px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
                <button
                  onClick={handleInvite}
                  disabled={!email || isInviting}
                  className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isInviting ? 'Inviting...' : 'Invite'}
                </button>
              </div>
            </div>
          </>
        )}
        
        {activeTab === 'activity' && (
          <div className="max-h-96 overflow-y-auto">
            <div className="flex items-center space-x-2 mb-3">
              <div className="flex items-center space-x-1">
                <span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></span>
                <span className="text-sm text-gray-600 dark:text-gray-300">
                  {isConnected ? 'Connected' : 'Disconnected'}
                </span>
              </div>
            </div>
            
            <div className="mb-4">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Active Collaborators
                {collaborators?.length > 0 && <span className="ml-2 text-xs">({collaborators.length})</span>}
              </h3>
              <div className="space-y-2">
                {!collaborators || collaborators.length === 0 ? (
                  <p className="text-sm text-center text-gray-500 dark:text-gray-400 py-2">
                    No active collaborators
                  </p>
                ) : (
                  collaborators.map((collaborator, index) => {
                    const colors = ['bg-blue-500', 'bg-emerald-500', 'bg-purple-500', 'bg-amber-500', 'bg-pink-500'];
                    const colorIndex = index % colors.length;
                    const avatarColor = colors[colorIndex];
                    
                    return (
                      <div key={collaborator.userId || collaborator.id || Math.random().toString()} 
                           className="flex items-center space-x-2 p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                        {collaborator.avatar ? (
                          <img 
                            src={collaborator.avatar} 
                            alt={collaborator.username} 
                            className="h-8 w-8 rounded-full"
                          />
                        ) : (
                          <div className={`h-8 w-8 rounded-full ${avatarColor} flex items-center justify-center`}>
                            <span className="text-xs font-medium text-white">
                              {collaborator.username ? collaborator.username.charAt(0).toUpperCase() : '?'}
                            </span>
                          </div>
                        )}
                        <div className="flex-1">
                          <p className="text-sm font-medium truncate">{collaborator.username}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {formatTimeAgo && collaborator.lastActive ? 
                              (() => {
                                try {
                                  return formatTimeAgo(collaborator.lastActive);
                                } catch (error) {
                                  return 'Recently';
                                }
                              })() : 
                              'Just now'}
                          </p>
                        </div>
                        <span className={`h-2 w-2 rounded-full ${
                          collaborator.status === 'online' ? 'bg-green-500' :
                          collaborator.status === 'away' ? 'bg-yellow-500' : 'bg-gray-500'
                        }`}></span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
            
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Recent Activity</h3>
              <div className="space-y-2">
                {!recentChanges || recentChanges.length === 0 ? (
                  <p className="text-sm text-center text-gray-500 dark:text-gray-400 py-2">
                    No recent activity
                  </p>
                ) : (
                  recentChanges.map((change, index) => {
                    const colors = ['bg-blue-500', 'bg-emerald-500', 'bg-purple-500', 'bg-amber-500', 'bg-pink-500'];
                    const username = change.username || '';
                    const colorIndex = index % colors.length;
                    const avatarColor = colors[colorIndex];
                    
                    return (
                      <div key={change.id || Math.random().toString()} className="flex items-start space-x-2 p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                        <div className={`mt-1 h-6 w-6 rounded-full ${avatarColor} flex items-center justify-center`}>
                          {getChangeIcon(change.changeType)}
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-medium">
                            <span className="font-semibold">{change.username}</span>
                            {' '}
                            <span className="text-gray-600 dark:text-gray-300">
                              {change.details || `${change.changeType} ${change.resourceType}`}
                            </span>
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {formatTimeAgo && change.timestamp ? 
                              (() => {
                                try {
                                  return formatTimeAgo(change.timestamp);
                                } catch (error) {
                                  return 'Recently';
                                }
                              })() : 
                              'Just now'}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}
        
        {activeTab === 'ai' && (
          <div className="space-y-4">
            {/* AI Collab card – matched to Figma */}
            <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-50/5 shadow-sm">
              {/* Header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Bot size={18} className="text-gray-700 dark:text-gray-200" />
                  <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                    {honStatus === 'active' ? "You're on with Hon" : 'Collaborate with Hon'}
                  </span>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                  honStatus === 'active' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' :
                  honStatus === 'connecting' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' :
                  honStatus === 'error' ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' :
                  'bg-gray-200 text-gray-800 dark:bg-gray-600 dark:text-gray-200'
                }`}>
                  {honStatus === 'active' ? 'Active' : honStatus === 'connecting' ? 'Connecting' : honStatus === 'error' ? 'Error' : 'Ready to collaborate'}
                </span>
              </div>

              {/* Status dots – fixed colors from Figma with active glow */}
              <div className="grid grid-cols-4 gap-2 text-center mb-4">
                {[
                  { label: 'Speaking/\nLooking', color: 'bg-purple-500', active: honActive && (honProcessing === 'inspiring' || honProcessing === 'reasoning') },
                  { label: 'Editing on\nCanvas', color: 'bg-emerald-500', active: honActive && honProcessing === 'editing' },
                  { label: 'Generating\nvideo', color: 'bg-pink-500', active: honActive && honProcessing === 'dreaming' },
                  { label: 'Active\nListening', color: 'bg-blue-500', active: honStatus === 'active' && !isHonMuted },
                ].map((item, idx) => (
                  <div key={idx} className="flex flex-col items-center gap-1">
                    <span className={`h-2.5 w-2.5 rounded-full ${item.color} ${item.active ? 'shadow-[0_0_0_3px_rgba(0,0,0,0.05)] drop-shadow-md' : 'opacity-60'}`}></span>
                    <span className="text-[10px] text-gray-600 dark:text-gray-300 leading-tight whitespace-pre-line">{item.label}</span>
                  </div>
                ))}
              </div>

              {/* Controls – mic moved to Page Manager; keep end-call only */}
              {honStatus === 'active' ? (
                <div className="flex items-end justify-end mt-2">
                  <button onClick={handleEndCall} className="text-sm font-medium text-red-500 hover:text-red-600">End call</button>
                </div>
              ) : (
                <div className="flex items-center justify-center">
                  <button
                    onClick={handleInviteHon}
                    disabled={honStatus === 'connecting'}
                    className="px-6 py-2.5 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                  >
                    {honStatus === 'connecting' ? 'Connecting...' : 'Invite Hon'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}; 