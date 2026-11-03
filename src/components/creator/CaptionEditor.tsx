import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';

// Define proper types for caption position
type VerticalPosition = 'top' | 'middle' | 'bottom';
type HorizontalPosition = 'left' | 'center' | 'right';

interface CaptionPosition {
  vertical: VerticalPosition;
  horizontal: HorizontalPosition;
}

interface CaptionStyle {
  fontFamily: string;
  fontSize: number;
  backgroundColor: string;
  opacity: number;
  textAlign: HorizontalPosition;
  position: CaptionPosition;
}

interface CaptionEditorProps {
  initialCaption?: string;
  onSave: (caption: string, style: CaptionStyle) => void;
  onCancel: () => void;
}

const fontFamilies = ['Arial', 'Times New Roman', 'Comic Sans MS', 'Impact'];

export const CaptionEditor: React.FC<CaptionEditorProps> = ({
  initialCaption = '',
  onSave,
  onCancel
}) => {
  const [caption, setCaption] = useState(initialCaption);
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>({
    fontFamily: 'Arial',
    fontSize: 16,
    backgroundColor: 'black',
    opacity: 0.75,
    textAlign: 'center',
    position: {
      vertical: 'bottom',
      horizontal: 'center'
    }
  });

  const handleFontSizeChange = (increment: number) => {
    setCaptionStyle(prev => ({
      ...prev,
      fontSize: Math.max(10, Math.min(36, prev.fontSize + increment))
    }));
  };

  const handleSave = () => {
    onSave(caption, captionStyle);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-lg p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-gray-800">Edit Caption</h2>
          <button onClick={onCancel} className="text-gray-500 hover:text-gray-700">
            <X size={20} />
          </button>
        </div>

        <div className="mb-4">
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={3}
            placeholder="Add caption..."
            style={{ color: 'black' }}
          />
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Font Style</label>
            <select
              value={captionStyle.fontFamily}
              onChange={(e) => setCaptionStyle(prev => ({ ...prev, fontFamily: e.target.value }))}
              className="w-full px-3 py-2 border rounded-md"
              style={{ color: 'black' }}
            >
              {fontFamilies.map(font => (
                <option key={font} value={font} style={{ color: 'black' }}>
                  {font}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Background</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setCaptionStyle(prev => ({ ...prev, backgroundColor: 'black' }))}
                className={`px-3 py-2 rounded-md ${captionStyle.backgroundColor === 'black' ? 'ring-2 ring-blue-500' : ''}`}
                style={{ backgroundColor: 'black', color: 'white' }}
              >
                Black
              </button>
              <button
                onClick={() => setCaptionStyle(prev => ({ ...prev, backgroundColor: 'white' }))}
                className={`px-3 py-2 rounded-md ${captionStyle.backgroundColor === 'white' ? 'ring-2 ring-blue-500' : ''}`}
                style={{ backgroundColor: 'white', color: 'black' }}
              >
                White
              </button>
            </div>
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Font Size</label>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => handleFontSizeChange(-2)}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-200 hover:bg-gray-300"
              style={{ color: 'black' }}
            >
              -
            </button>
            <span style={{ color: 'black' }}>{captionStyle.fontSize}px</span>
            <button
              onClick={() => handleFontSizeChange(2)}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-200 hover:bg-gray-300"
              style={{ color: 'black' }}
            >
              +
            </button>
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Background Opacity: {Math.round(captionStyle.opacity * 100)}%
          </label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={captionStyle.opacity}
            onChange={(e) => setCaptionStyle(prev => ({ ...prev, opacity: parseFloat(e.target.value) }))}
            className="w-full"
          />
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Text Alignment</label>
          <div className="flex space-x-2">
            <button
              onClick={() => setCaptionStyle(prev => ({ ...prev, textAlign: 'left' }))}
              className={`flex-1 px-3 py-2 rounded-md ${captionStyle.textAlign === 'left' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-800'}`}
            >
              Left
            </button>
            <button
              onClick={() => setCaptionStyle(prev => ({ ...prev, textAlign: 'center' }))}
              className={`flex-1 px-3 py-2 rounded-md ${captionStyle.textAlign === 'center' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-800'}`}
            >
              Center
            </button>
            <button
              onClick={() => setCaptionStyle(prev => ({ ...prev, textAlign: 'right' }))}
              className={`flex-1 px-3 py-2 rounded-md ${captionStyle.textAlign === 'right' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-800'}`}
            >
              Right
            </button>
          </div>
        </div>

        <div className="p-4 bg-gray-100 rounded-md mb-4">
          <div 
            className="p-2 rounded"
            style={{
              backgroundColor: captionStyle.backgroundColor,
              opacity: captionStyle.opacity,
              color: captionStyle.backgroundColor === 'white' ? 'black' : 'white',
              fontFamily: captionStyle.fontFamily,
              fontSize: `${captionStyle.fontSize}px`,
              textAlign: captionStyle.textAlign,
            }}
          >
            {caption || "Hey how are you"}
          </div>
        </div>

        <div className="flex justify-end space-x-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
          >
            Save Caption
          </button>
        </div>
      </div>
    </div>
  );
};