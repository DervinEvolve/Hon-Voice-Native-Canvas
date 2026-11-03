import { useEffect, useState } from 'react';
import { humeEviService } from '../services/humeEviService';
import type { HonPresence } from '../types';

export function useHonPresence() {
  const [presence, setPresence] = useState<HonPresence>({
    isActive: false,
    processingState: 'idle',
    progressPercent: undefined,
    progressLabel: undefined,
    etaSeconds: null,
    focusPanelId: null,
    offscreen: false,
  });

  useEffect(() => {
    const off = humeEviService.onPresenceChange(setPresence);
    return off;
  }, []);

  return presence;
}


