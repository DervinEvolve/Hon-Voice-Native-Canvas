import React, { useState, useEffect } from 'react';
import { Edit3, Save } from 'lucide-react';
import { useComicStore } from '../../store/useComicStore';

export const TitleEditor: React.FC = () => {
  const { currentComic, updateComicTitle } = useComicStore();
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(() => {
    // Handle both "Untitled Comic" and empty/null titles
    if (!currentComic?.title || currentComic.title === 'Untitled Comic') {
      return 'Untitled';
    }
    return currentComic.title;
  });

  // Update title when currentComic changes
  useEffect(() => {
    if (!currentComic?.title || currentComic.title === 'Untitled Comic') {
      setTitle('Untitled');
    } else {
      setTitle(currentComic.title);
    }
  }, [currentComic?.title]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateComicTitle(title);
    setIsEditing(false);
  };

  return (
    <div className="flex items-center w-full">
      {isEditing ? (
        <form onSubmit={handleSubmit} className="flex items-center gap-2 w-full">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-4 py-2 text-white text-lg font-semibold border-b-2 border-purple-500 focus:outline-none bg-transparent placeholder-gray-300"
            placeholder="Untitled"
            autoFocus
          />
          <button
            type="submit"
            className="p-2 text-purple-500 hover:text-purple-600"
          >
            <Save size={20} />
          </button>
        </form>
      ) : (
        <div className="flex items-center justify-between w-full">
          <h1 className="text-lg font-semibold text-white">{title}</h1>
          <button
            onClick={() => setIsEditing(true)}
            className="p-2 text-gray-400 hover:text-gray-300"
          >
            <Edit3 size={20} />
          </button>
        </div>
      )}
    </div>
  );
};