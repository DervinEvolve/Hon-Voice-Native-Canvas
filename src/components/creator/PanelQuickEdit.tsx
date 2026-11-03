/**
 * PanelQuickEdit - Quick edit menu component for panels
 * 
 * Extracted from Creator.tsx for better code organization.
 * Handles game panel editing and image/video panel editing.
 */

import React from 'react';
import { Panel } from '../../types';

export interface GameTemplate {
  id: string;
  name: string;
  code: string;
  createdAt: string;
}

export type ActionModel = 'nano-banana' | 'recraft' | 'seedream' | 'flux-kontext' | 'qwen-edit' | 'ideogram';
export type GameEditModel = 'gemini-3' | 'claude';

export interface PanelQuickEditProps {
  /** The panel being edited */
  panel: Panel;
  /** Page index of the panel */
  pageIndex: number;
  /** Whether the edit is loading */
  isLoading: boolean;
  /** Current action prompt */
  actionPrompt: string;
  /** Set action prompt */
  setActionPrompt: (prompt: string) => void;
  /** Current action model (for image/video) */
  actionModel: ActionModel;
  /** Set action model */
  setActionModel: (model: ActionModel) => void;
  /** Current target object (for mask-based editing) */
  actionTargetObject: string;
  /** Set target object */
  setActionTargetObject: (object: string) => void;
  /** Current game edit model */
  gameEditModel: GameEditModel;
  /** Set game edit model */
  setGameEditModel: (model: GameEditModel) => void;
  /** Saved game templates */
  savedGameTemplates: GameTemplate[];
  /** Selected game template ID */
  selectedGameTemplate: string;
  /** Set selected game template */
  setSelectedGameTemplate: (id: string) => void;
  /** Whether save template input is shown */
  showSaveTemplateInput: boolean;
  /** Set show save template input */
  setShowSaveTemplateInput: (show: boolean) => void;
  /** New template name */
  newTemplateName: string;
  /** Set new template name */
  setNewTemplateName: (name: string) => void;
  /** Handler for quick edit (image/video) */
  onQuickEdit: (panel: Panel) => void;
  /** Handler for game edit */
  onGameEdit: (panel: Panel) => void;
  /** Handler for loading game template */
  onLoadGameTemplate: (panel: Panel, templateId: string) => void;
  /** Handler for saving game template */
  onSaveGameTemplate: (panel: Panel) => void;
  /** Handler for deleting game template */
  onDeleteGameTemplate: (templateId: string) => void;
  /** Handler for closing the menu */
  onClose: () => void;
}

export const PanelQuickEdit: React.FC<PanelQuickEditProps> = ({
  panel,
  pageIndex,
  isLoading,
  actionPrompt,
  setActionPrompt,
  actionModel,
  setActionModel,
  actionTargetObject,
  setActionTargetObject,
  gameEditModel,
  setGameEditModel,
  savedGameTemplates,
  selectedGameTemplate,
  setSelectedGameTemplate,
  showSaveTemplateInput,
  setShowSaveTemplateInput,
  newTemplateName,
  setNewTemplateName,
  onQuickEdit,
  onGameEdit,
  onLoadGameTemplate,
  onSaveGameTemplate,
  onDeleteGameTemplate,
  onClose,
}) => {
  const isGame = panel.type === 'game';

  const handleClose = () => {
    setActionPrompt('');
    if (isGame) {
      setShowSaveTemplateInput(false);
      setNewTemplateName('');
      setSelectedGameTemplate('');
    } else {
      setActionTargetObject('');
    }
    onClose();
  };

  const handleSubmit = () => {
    if (isGame) {
      onGameEdit(panel);
    } else {
      onQuickEdit(panel);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && actionPrompt.trim() && !isLoading) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div
      className="fixed z-50 rounded-xl p-3 bg-white/95 dark:bg-gray-900/95 border border-gray-200 dark:border-gray-700 shadow-2xl backdrop-blur-sm"
      style={{ 
        width: isGame ? '320px' : '280px',
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        maxHeight: '80vh',
        overflowY: 'auto'
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {isGame ? (
        // Game Panel Edit UI
        <>
          <div className="text-xs font-medium text-gray-800 dark:text-gray-200 mb-2">Edit Game with</div>
          <select
            value={gameEditModel}
            onChange={(e) => setGameEditModel(e.target.value as GameEditModel)}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            disabled={isLoading}
            className="w-full text-sm bg-transparent border border-gray-300 dark:border-gray-700 rounded px-2 py-1 mb-2 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="gemini-3">Gemini 3 Pro</option>
            <option value="claude">Claude Opus 4.5</option>
          </select>

          {/* Saved Templates Dropdown */}
          {savedGameTemplates.length > 0 && (
            <>
              <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Load from Template</label>
              <div className="flex gap-1 mb-2">
                <select
                  value={selectedGameTemplate}
                  onChange={(e) => setSelectedGameTemplate(e.target.value)}
                  onMouseDown={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  disabled={isLoading}
                  className="flex-1 text-sm bg-transparent border border-gray-300 dark:border-gray-700 rounded px-2 py-1 focus:outline-none disabled:opacity-50"
                >
                  <option value="">Select a template...</option>
                  {savedGameTemplates.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                {selectedGameTemplate && (
                  <>
                    <button
                      onClick={() => onLoadGameTemplate(panel, selectedGameTemplate)}
                      disabled={isLoading}
                      className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
                      title="Load template"
                    >
                      Load
                    </button>
                    <button
                      onClick={() => {
                        if (confirm('Delete this template?')) {
                          onDeleteGameTemplate(selectedGameTemplate);
                          setSelectedGameTemplate('');
                        }
                      }}
                      disabled={isLoading}
                      className="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50"
                      title="Delete template"
                    >
                      ×
                    </button>
                  </>
                )}
              </div>
            </>
          )}

          <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Edit Instructions</label>
          <textarea
            value={actionPrompt}
            onChange={(e) => { 
              setActionPrompt(e.target.value); 
              e.currentTarget.style.height = 'auto'; 
              e.currentTarget.style.height = Math.min(200, e.currentTarget.scrollHeight) + 'px'; 
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={handleKeyDown}
            placeholder="e.g., Add a scoring system, Make the player faster, Add enemy AI..."
            rows={3}
            disabled={isLoading}
            className="w-full text-sm bg-transparent border border-gray-300 dark:border-gray-700 rounded px-2 py-1 mb-2 resize-none focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
          />

          {/* Save as Template */}
          {!showSaveTemplateInput ? (
            <button
              onClick={() => setShowSaveTemplateInput(true)}
              disabled={isLoading || !(panel as any).gameCode}
              className="w-full text-xs text-gray-600 dark:text-gray-400 hover:text-purple-500 dark:hover:text-purple-400 mb-2 py-1 border border-dashed border-gray-300 dark:border-gray-600 rounded disabled:opacity-50"
            >
              Save as Template
            </button>
          ) : (
            <div className="flex gap-1 mb-2">
              <input
                type="text"
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                placeholder="Template name..."
                className="flex-1 text-sm bg-transparent border border-gray-300 dark:border-gray-700 rounded px-2 py-1 focus:outline-none"
              />
              <button
                onClick={() => onSaveGameTemplate(panel)}
                disabled={!newTemplateName.trim()}
                className="px-2 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50"
              >
                Save
              </button>
              <button
                onClick={() => { setShowSaveTemplateInput(false); setNewTemplateName(''); }}
                className="px-2 py-1 text-xs bg-gray-300 dark:bg-gray-600 rounded"
              >
                ×
              </button>
            </div>
          )}

          <div className="flex gap-2 justify-end pt-1 border-t border-gray-200 dark:border-gray-700 mt-2">
            <button 
              className="px-2 py-1 text-xs rounded bg-gray-200 dark:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed" 
              onClick={handleClose}
              disabled={isLoading}
            >
              Cancel
            </button>
            <button
              className={`px-2 py-1 text-xs rounded flex items-center gap-1.5 ${actionPrompt.trim() && !isLoading ? 'bg-purple-600 text-white hover:bg-purple-700' : 'bg-gray-300 text-gray-600 cursor-not-allowed'}`}
              disabled={!actionPrompt.trim() || isLoading}
              onClick={handleSubmit}
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span>Editing...</span>
                </>
              ) : (
                'Apply Edit'
              )}
            </button>
          </div>
          
          {/* Show code checkbox */}
          <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
            <label className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={false}
                onChange={() => {
                  document.dispatchEvent(new CustomEvent('panel-game-show-code', { detail: { panelId: panel.id } }));
                }}
                className="rounded"
              />
              Show generated code (preview)
            </label>
          </div>
        </>
      ) : (
        // Image/Video Panel Edit UI
        <>
          <div className="text-xs font-medium text-gray-800 dark:text-gray-200 mb-2">Edit with</div>
          <select
            value={actionModel}
            onChange={(e) => setActionModel(e.target.value as ActionModel)}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            disabled={isLoading}
            className="w-full text-sm bg-transparent border border-gray-300 dark:border-gray-700 rounded px-2 py-1 mb-2 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="nano-banana">Nano Banana Pro</option>
            <option value="recraft">Recraft</option>
            <option value="seedream">Seedream 4.5</option>
            <option value="flux-kontext">Flux Kontext</option>
            <option value="qwen-edit">Qwen Edit</option>
            <option value="ideogram">Ideogram</option>
          </select>

          {/* Object selection dropdown - only show if objects detected and Seedream selected */}
          {actionModel === 'seedream' && panel.detectedObjects && panel.detectedObjects.length > 0 && (
            <>
              <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Target Object (optional)</label>
              <select
                value={actionTargetObject}
                onChange={(e) => setActionTargetObject(e.target.value)}
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                disabled={isLoading}
                className="w-full text-sm bg-transparent border border-gray-300 dark:border-gray-700 rounded px-2 py-1 mb-2 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="">Edit entire image</option>
                {panel.detectedObjects.map((obj, idx) => (
                  <option key={idx} value={obj}>
                    Edit: {obj}
                  </option>
                ))}
              </select>
            </>
          )}

          <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Prompt</label>
          <textarea
            value={actionPrompt}
            onChange={(e) => { 
              setActionPrompt(e.target.value); 
              e.currentTarget.style.height = 'auto'; 
              e.currentTarget.style.height = Math.min(200, e.currentTarget.scrollHeight) + 'px'; 
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={handleKeyDown}
            placeholder="Describe the edit..."
            rows={2}
            disabled={isLoading}
            className="w-full text-sm bg-transparent border border-gray-300 dark:border-gray-700 rounded px-2 py-1 mb-2 resize-none focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
          />

          <div className="flex gap-2 justify-end pt-1">
            <button 
              className="px-2 py-1 text-xs rounded bg-gray-200 dark:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed" 
              onClick={handleClose}
              disabled={isLoading}
            >
              Cancel
            </button>
            <button
              className={`px-2 py-1 text-xs rounded flex items-center gap-1.5 ${actionPrompt.trim() && !isLoading ? 'bg-purple-600 text-white hover:bg-purple-700' : 'bg-gray-300 text-gray-600 cursor-not-allowed'}`}
              disabled={!actionPrompt.trim() || isLoading}
              onClick={handleSubmit}
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span>Generating...</span>
                </>
              ) : (
                'Apply'
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default PanelQuickEdit;

