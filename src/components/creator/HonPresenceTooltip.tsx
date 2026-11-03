import React from 'react';
import type { HonPresence } from '../../types';

interface Props {
  presence: HonPresence;
  alignTo?: 'right' | 'left';
  onCancel?: () => void;
  onJump?: () => void;
  style?: React.CSSProperties;
  className?: string;
}

export const HonPresenceTooltip: React.FC<Props> = ({ presence, alignTo = 'right', onCancel, onJump, style, className }) => {
  if (!presence.isActive || presence.processingState === 'idle') return null;

  const labelMap: Record<HonPresence['processingState'], string> = {
    idle: 'Idle',
    processing: 'Processing',
    generating: 'Generating',
    editing: 'Editing',
    dreaming: 'Generating',
    inspiring: 'Finishing',
    reasoning: 'Thinking'
  };

  const label = labelMap[presence.processingState] || 'Working';
  const percent = typeof presence.progressPercent === 'number' ? Math.max(0, Math.min(100, presence.progressPercent)) : undefined;
  const eta = presence.etaSeconds && presence.etaSeconds > 0 ? `${Math.ceil(presence.etaSeconds / 60)}m` : undefined;

  // Match Hon Indicator colors
  const colorForState = (state: HonPresence['processingState']) => {
    switch (state) {
      case 'generating':
        return 'rgba(139, 92, 246, 1.0)'; // purple
      case 'editing':
        return 'rgba(34, 197, 94, 1.0)'; // green
      case 'dreaming':
        return 'rgba(236, 72, 153, 1.0)'; // pink
      case 'inspiring':
        return 'rgba(59, 130, 246, 1.0)'; // blue
      case 'reasoning':
      case 'processing':
        return 'rgba(139, 92, 246, 1.0)'; // purple
      default:
        return 'rgba(59, 130, 246, 1.0)'; // blue
    }
  };
  const accent = colorForState(presence.processingState);
  const softGlow = accent.replace('1.0', '0.35');

  return (
    <div className={`pointer-events-auto absolute z-40 ${className || ''}`} style={style} aria-live="polite">
      <div
        className="relative w-64 bg-gray-900 text-gray-100 rounded-lg shadow-xl p-3 space-y-2"
        style={{
          border: `1px solid ${accent}`,
          boxShadow: `0 0 16px 2px ${softGlow}`
        }}
      >
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium flex items-center gap-2">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: accent }}
            />
            <span>Hon • {label}</span>
          </div>
          {eta && <div className="text-xs text-gray-400">ETA {eta}</div>}
        </div>
        {presence.progressLabel && (
          <div className="text-xs text-gray-300">{presence.progressLabel}</div>
        )}
        {typeof percent === 'number' && (
          <div className="w-full h-2 bg-gray-700 rounded">
            <div className="h-2 rounded transition-all" style={{ width: `${percent}%`, backgroundColor: accent }} />
          </div>
        )}
        <div className="flex items-center justify-end gap-2 pt-1">
          {presence.offscreen && (
            <button onClick={onJump} className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded border border-gray-600">Jump</button>
          )}
          {onCancel && (
            <button onClick={onCancel} className="text-xs px-2 py-1 bg-red-600 hover:bg-red-700 rounded">Cancel</button>
          )}
        </div>
        {/* Arrow */}
        <div
          className={`absolute top-1/2 -translate-y-1/2 ${alignTo === 'right' ? '-left-2' : '-right-2'} w-0 h-0 border-8 border-transparent`}
          style={{
            borderRightColor: alignTo === 'right' ? 'rgba(17,24,39,1)' : 'transparent',
            borderLeftColor: alignTo === 'left' ? 'rgba(17,24,39,1)' : 'transparent',
          }}
        />
      </div>
    </div>
  );
};


