import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, BookOpen, Send, Save, Eye } from 'lucide-react';

interface FileDropdownProps {
  onViewStories: () => void;
  onSaveDraft: () => void;
  onPublish: () => void;
  onSavePage: () => void;
  isSaving: boolean;
  isPublishing: boolean;
  isSavingPage: boolean;
}

export const FileDropdown: React.FC<FileDropdownProps> = ({
  onViewStories,
  onSaveDraft,
  onPublish,
  onSavePage,
  isSaving,
  isPublishing,
  isSavingPage
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleItemClick = (action: () => void) => {
    action();
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="bg-white box-border flex flex-col gap-2.5 items-start justify-start px-5 py-2.5 rounded-bl-[10px] rounded-tl-[10px] border-[#bfc3ca] border-[1px_0px_1px_1px] border-solid"
      >
        <div className="box-border flex flex-row gap-12 h-8 items-center justify-start w-full">
          <div className="box-border flex flex-row h-full items-center justify-between">
            <span className="font-['Inter'] font-bold text-[14px] text-gray-500 not-italic leading-[0] text-center whitespace-nowrap mr-12">
              File
            </span>
            <ChevronDown className={`w-2 h-2 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </div>
        </div>
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-48 bg-white border border-gray-200 rounded-md shadow-lg z-50">
          <div className="py-1">
            <button
              onClick={() => handleItemClick(onViewStories)}
              className="flex items-center space-x-3 w-full px-4 py-2 text-left text-gray-700 hover:bg-gray-100 transition-colors font-['Inter'] text-[14px]"
            >
              <Eye className="w-4 h-4" />
              <span>View Stories</span>
            </button>
            
            <button
              onClick={() => handleItemClick(onPublish)}
              disabled={isPublishing}
              className="flex items-center space-x-3 w-full px-4 py-2 text-left text-gray-700 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-['Inter'] text-[14px]"
            >
              <Send className="w-4 h-4" />
              <span>{isPublishing ? 'Publishing...' : 'Publish'}</span>
            </button>
            
            <button
              onClick={() => handleItemClick(onSaveDraft)}
              disabled={isSaving}
              className="flex items-center space-x-3 w-full px-4 py-2 text-left text-gray-700 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-['Inter'] text-[14px]"
            >
              <Save className="w-4 h-4" />
              <span>{isSaving ? 'Saving...' : 'Save Draft'}</span>
            </button>
            
            <button
              onClick={() => handleItemClick(onSavePage)}
              disabled={isSavingPage}
              className="flex items-center space-x-3 w-full px-4 py-2 text-left text-gray-700 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-['Inter'] text-[14px]"
            >
              <Save className="w-4 h-4" />
              <span>{isSavingPage ? 'Saving...' : 'Save Page'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}; 