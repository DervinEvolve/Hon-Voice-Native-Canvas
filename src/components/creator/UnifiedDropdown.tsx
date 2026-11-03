import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Send, Save, LogOut } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

interface UnifiedDropdownProps {
  onSaveDraft: () => void;
  onPublish: () => void;
  onSavePage: () => void;
  isSaving: boolean;
  isPublishing: boolean;
  isSavingPage: boolean;
}

export const UnifiedDropdown: React.FC<UnifiedDropdownProps> = ({
  onSaveDraft,
  onPublish,
  onSavePage,
  isSaving,
  isPublishing,
  isSavingPage
}) => {
  const [isFileOpen, setIsFileOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { user, logout } = useAuth();

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsFileOpen(false);
        setIsProfileOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleFileItemClick = (action: () => void) => {
    action();
    setIsFileOpen(false);
  };

  const handleProfileItemClick = (action: () => void) => {
    action();
    setIsProfileOpen(false);
  };

  const handleLogout = () => {
    logout();
  };

  const avatarUrl = (user as any)?.avatar_url || (user as any)?.avatarUrl || (user as any)?.picture || null;

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Main unified dropdown button */}
      <div className="bg-white dark:bg-gray-800 box-border flex flex-row items-center justify-between px-5 py-2.5 rounded-[10px] border-[#bfc3ca] dark:border-gray-700 border border-solid shadow-sm">
        {/* File section */}
        <button
          onClick={() => {
            setIsFileOpen(!isFileOpen);
            setIsProfileOpen(false);
          }}
          className="flex items-center space-x-3 hover:opacity-80 transition-opacity"
        >
          <span className="font-['Inter'] font-bold text-[14px] text-gray-500 dark:text-gray-300 not-italic leading-[0] text-center whitespace-nowrap">
            File
          </span>
          <ChevronDown className={`w-3 h-3 text-purple-500 transition-transform ${isFileOpen ? 'rotate-180' : ''}`} />
        </button>

        {/* Invisible spacer for layout - no visible divider */}
        <div className="mx-8" />

        {/* Profile section */}
        <button
          onClick={() => {
            setIsProfileOpen(!isProfileOpen);
            setIsFileOpen(false);
          }}
          className="flex items-center space-x-3 hover:opacity-80 transition-opacity"
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt="avatar" className="w-8 h-8 rounded-full object-cover" />
          ) : (
            <div className="w-8 h-8 bg-gray-300 dark:bg-gray-600 rounded-full flex items-center justify-center">
              <span className="text-gray-600 dark:text-gray-300 text-sm font-medium">U</span>
            </div>
          )}
          <ChevronDown className={`w-3 h-3 text-purple-500 transition-transform ${isProfileOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* File dropdown menu */}
      {isFileOpen && (
        <div className="absolute top-full left-0 mt-2 w-56 bg-white dark:bg-gray-800 border border-[#bfc3ca] dark:border-gray-700 rounded-[10px] shadow-lg z-50">
          <div className="py-2">
            <button
              onClick={() => handleFileItemClick(onPublish)}
              disabled={isPublishing}
              className="group flex items-center justify-between w-full px-5 py-3 text-left text-gray-700 dark:text-gray-300 hover:bg-[#E8F5E8] dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-['Inter'] text-[14px] font-medium"
            >
              <span>{isPublishing ? 'Publishing...' : 'Publish'}</span>
              <Send className="w-5 h-5 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
            
            <button
              onClick={() => handleFileItemClick(onSaveDraft)}
              disabled={isSaving}
              className="group flex items-center justify-between w-full px-5 py-3 text-left text-gray-700 dark:text-gray-300 hover:bg-[#E8F5E8] dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-['Inter'] text-[14px] font-medium"
            >
              <span>{isSaving ? 'Saving...' : 'Save Draft'}</span>
              <Save className="w-5 h-5 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
            
            <button
              onClick={() => handleFileItemClick(onSavePage)}
              disabled={isSavingPage}
              className="group flex items-center justify-between w-full px-5 py-3 text-left text-gray-700 dark:text-gray-300 hover:bg-[#E8F5E8] dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-['Inter'] text-[14px] font-medium"
            >
              <span>{isSavingPage ? 'Saving...' : 'Save Page'}</span>
              <Save className="w-5 h-5 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          </div>
        </div>
      )}

      {/* Profile dropdown menu */}
      {isProfileOpen && (
        <div className="absolute top-full right-0 mt-2 w-48 bg-white dark:bg-gray-800 border border-[#bfc3ca] dark:border-gray-700 rounded-[10px] shadow-lg z-50">
          <div className="py-2">
            <button
              onClick={() => handleProfileItemClick(handleLogout)}
              className="group flex items-center justify-between w-full px-5 py-3 text-left text-gray-700 dark:text-gray-300 hover:bg-[#E8F5E8] dark:hover:bg-gray-700 transition-colors font-['Inter'] text-[14px] font-medium"
            >
              <span>Logout</span>
              <LogOut className="w-5 h-5 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}; 