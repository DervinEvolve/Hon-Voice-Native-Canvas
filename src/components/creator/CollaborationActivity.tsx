import React, { useState, useEffect } from 'react';
import { X, Users, Clock, UserCheck, Edit, Trash, Lock, Unlock, User, Activity } from 'lucide-react';
import { useCollaboration } from '../../contexts/CollaborationContext';

interface CollaborationActivityProps {
  isVisible: boolean;
  onClose: () => void;
}

const CollaborationActivity: React.FC<CollaborationActivityProps> = ({ isVisible, onClose }) => {
  const { 
    collaborators, 
    recentChanges, 
    formatTimeAgo,
    isConnected
  } = useCollaboration();
  
  const [isExpanded, setIsExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState<'collaborators' | 'activity'>('collaborators');
  const [inactivityTimer, setInactivityTimer] = useState<NodeJS.Timeout | null>(null);
  
  // Auto-collapse after inactivity
  useEffect(() => {
    if (isVisible && isExpanded) {
      // Reset any existing timer
      if (inactivityTimer) {
        clearTimeout(inactivityTimer);
      }
      
      // Set new timer to collapse after 30 seconds of inactivity
      const timer = setTimeout(() => {
        setIsExpanded(false);
      }, 30000);
      
      setInactivityTimer(timer);
    }
    
    return () => {
      if (inactivityTimer) {
        clearTimeout(inactivityTimer);
      }
    };
  }, [isVisible, isExpanded, collaborators, recentChanges]);
  
  // Auto-expand on new activity
  useEffect(() => {
    if (isVisible && !isExpanded && (collaborators.length > 0 || recentChanges.length > 0)) {
      setIsExpanded(true);
    }
  }, [collaborators, recentChanges, isVisible, isExpanded]);
  
  if (!isVisible) {
    return null;
  }
  
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
  
  return (
    <div className="fixed right-4 top-20 bg-white dark:bg-gray-800 shadow-lg rounded-lg border border-gray-200 dark:border-gray-700 w-64 z-50 transition-all duration-300 ease-in-out"
         style={{ opacity: isExpanded ? 1 : 0.7, transform: isExpanded ? 'translateY(0)' : 'translateY(-50px)' }}
         onMouseEnter={() => {
           setIsExpanded(true);
           if (inactivityTimer) {
             clearTimeout(inactivityTimer);
           }
         }}>
      <div className="flex items-center justify-between p-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center space-x-2">
          <Users size={18} className="text-blue-500" />
          <h3 className="text-sm font-medium">Collaboration</h3>
          {isConnected ? (
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
            </span>
          ) : (
            <span className="h-2 w-2 rounded-full bg-red-500"></span>
          )}
        </div>
        <button 
          onClick={onClose}
          className="text-gray-400 hover:text-gray-500 dark:hover:text-gray-300"
        >
          <X size={16} />
        </button>
      </div>
      
      <div className="border-b border-gray-200 dark:border-gray-700">
        <div className="flex">
          <button 
            className={`py-2 px-4 text-xs font-medium flex-1 ${activeTab === 'collaborators' 
              ? 'text-blue-500 border-b-2 border-blue-500' 
              : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
            onClick={() => setActiveTab('collaborators')}
          >
            <div className="flex items-center justify-center space-x-1">
              <Users size={14} />
              <span>Collaborators ({collaborators.length})</span>
            </div>
          </button>
          
          <button 
            className={`py-2 px-4 text-xs font-medium flex-1 ${activeTab === 'activity' 
              ? 'text-blue-500 border-b-2 border-blue-500' 
              : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
            onClick={() => setActiveTab('activity')}
          >
            <div className="flex items-center justify-center space-x-1">
              <Clock size={14} />
              <span>Activity</span>
            </div>
          </button>
        </div>
      </div>
      
      <div className="max-h-80 overflow-y-auto p-2">
        {activeTab === 'collaborators' ? (
          <div className="space-y-2">
            {collaborators.length === 0 ? (
              <p className="text-xs text-center text-gray-500 dark:text-gray-400 py-4">
                No active collaborators
              </p>
            ) : (
              collaborators.map((collaborator) => (
                <div key={collaborator.userId} className="flex items-center space-x-2 p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                  {collaborator.avatar ? (
                    <img 
                      src={collaborator.avatar} 
                      alt={collaborator.username} 
                      className="h-6 w-6 rounded-full"
                    />
                  ) : (
                    <div className="h-6 w-6 rounded-full bg-blue-100 dark:bg-blue-800 flex items-center justify-center">
                      <User size={12} className="text-blue-500 dark:text-blue-200" />
                    </div>
                  )}
                  <div className="flex-1">
                    <p className="text-xs font-medium truncate">{collaborator.username}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {formatTimeAgo(collaborator.lastActive)}
                    </p>
                  </div>
                  <span className={`h-2 w-2 rounded-full ${
                    collaborator.status === 'online' ? 'bg-green-500' :
                    collaborator.status === 'away' ? 'bg-yellow-500' : 'bg-gray-500'
                  }`}></span>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {recentChanges.length === 0 ? (
              <p className="text-xs text-center text-gray-500 dark:text-gray-400 py-4">
                No recent activity
              </p>
            ) : (
              recentChanges.map((change) => (
                <div key={change.id} className="flex items-start space-x-2 p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                  <div className="mt-1">{getChangeIcon(change.changeType)}</div>
                  <div className="flex-1">
                    <p className="text-xs font-medium">
                      <span className="font-semibold">{change.username}</span>
                      {' '}
                      <span className="text-gray-600 dark:text-gray-300">
                        {change.details || `${change.changeType} ${change.resourceType}`}
                      </span>
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {formatTimeAgo(change.timestamp)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default CollaborationActivity; 