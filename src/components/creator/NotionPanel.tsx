import { beginOAuthPopup } from '../../services/apiAccess';
import { isOAuthPopupMessage } from '../../utils/apiRequest';
import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { useComicStore } from '../../store/useComicStore';
import { useTheme } from '../../contexts/ThemeContext';
import { Mic, X, ExternalLink } from 'lucide-react';

// Helper to lazy load Hume service
let _humeService: any = null;
const getHumeService = async () => {
  if (_humeService) return _humeService;
  try {
    const mod = await import('../../services/humeEviService');
    _humeService = mod.humeEviService;
    return _humeService;
  } catch (e) {
    console.warn('Failed to load Hume service:', e);
    return null;
  }
};

interface NotionPanelProps { 
  panelId: string; 
  pageId?: string; 
  interactive?: boolean;
  onRemove?: () => void;
}

interface BlockWithAnimation {
  id: string;
  type: 'paragraph' | 'heading' | 'todo';
  text: string;
  checked?: boolean;
  isNew?: boolean;
}

export const NotionPanel: React.FC<NotionPanelProps> = ({ panelId, pageId, interactive = true, onRemove }) => {
  const [blocks, setBlocks] = useState<Array<BlockWithAnimation>>([]);
  const [notionConnected, setNotionConnected] = useState<boolean>(false);
  const [mcpConnected, setMcpConnected] = useState<boolean>(false);
  const [isMcpActive, setIsMcpActive] = useState<boolean>(false);
  const [isListening, setIsListening] = useState<boolean>(false);
  const [isEmpty, setIsEmpty] = useState(true);
  const [pendingPartial, setPendingPartial] = useState<string>('');
  const pendingRef = useRef<string>('');
  const [bulletMode] = useState<boolean>(false);
  const [editorContent, setEditorContent] = useState<string>('');
  const rootRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<Window | null>(null);
  const recRef = useRef<any>(null);
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const sttStreamRef = useRef<MediaStream | null>(null);
  const isCleaningUpRef = useRef<boolean>(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastBlockIdsRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);
  const connectionCheckRef = useRef<NodeJS.Timeout | null>(null);

  // Get dark mode from theme context
  const { isDarkMode } = useTheme();

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  const stopListening = async () => {
    if (!isListening || isCleaningUpRef.current || !mountedRef.current) return;
    isCleaningUpRef.current = true;
    
    const pendingText = pendingRef.current.trim();
    if (pendingText && mountedRef.current) {
      appendText(pendingText);
    }
    
    try { 
      if (recRef.current) {
        recRef.current.stop();
        recRef.current = null;
      }
    } catch (e) { console.warn('[NotionPanel] Error stopping SpeechRecognition:', e); }
    
    try {
      if (mediaRecRef.current) {
        mediaRecRef.current.onstop = null;
        if (mediaRecRef.current.state !== 'inactive') {
          mediaRecRef.current.stop();
        }
        mediaRecRef.current = null;
      }
    } catch (e) { console.warn('[NotionPanel] Error stopping MediaRecorder:', e); }
    
    try { 
      if (sttStreamRef.current) {
        sttStreamRef.current.getTracks().forEach(t => {
          try {
            if (t.readyState === 'live') t.stop();
          } catch {}
        });
        sttStreamRef.current = null;
      }
    } catch (e) { console.warn('[NotionPanel] Error stopping stream tracks:', e); }
    
    if (mountedRef.current) {
      setIsListening(false);
      setPendingPartial('');
    }
    pendingRef.current = '';
    isCleaningUpRef.current = false;
    
    setTimeout(async () => {
      if (!mountedRef.current) return;
      try { 
        const hume = await getHumeService();
        if (hume && typeof hume.isSessionActive === 'function' && hume.isSessionActive()) {
          if (typeof hume.toggleMute === 'function') {
            await hume.toggleMute();
          }
        }
      } catch (e) { 
        console.warn('[NotionPanel] Error toggling mute:', e);
      }
    }, 150);
  };

  useEffect(() => {
    const onStopNotes = () => { stopListening(); };
    window.addEventListener('stop-notes', onStopNotes as any);
    return () => { 
      window.removeEventListener('stop-notes', onStopNotes as any);
      if (recRef.current) {
        try { recRef.current.stop(); recRef.current = null; } catch {}
      }
      if (mediaRecRef.current) {
        try {
          mediaRecRef.current.onstop = null;
          if (mediaRecRef.current.state !== 'inactive') mediaRecRef.current.stop();
          mediaRecRef.current = null;
        } catch {}
      }
      if (sttStreamRef.current) {
        try {
          sttStreamRef.current.getTracks().forEach(t => { try { if (t.readyState === 'live') t.stop(); } catch {} });
          sttStreamRef.current = null;
        } catch {}
      }
    };
  }, []);

  // MCP Integration: Real-time polling and animation
  const animateNewBlocks = (newBlocks: BlockWithAnimation[]) => {
    if (!mountedRef.current) return;
    const currentIds = lastBlockIdsRef.current;
    const added = newBlocks.filter(b => !currentIds.has(b.id));
    const updated = newBlocks.filter(b => currentIds.has(b.id));
    
    if (added.length > 0 || updated.length > 0) {
      console.log('[NotionPanel MCP] Blocks changed:', { added: added.length, updated: updated.length });
      
      setBlocks(prev => {
        // Create a map of existing blocks
        const existingMap = new Map(prev.map(b => [b.id, b]));
        
        // Add new blocks with animation
        const newOnes = added.filter(b => !existingMap.has(b.id)).map(b => ({ ...b, isNew: true }));
        
        // Update existing blocks
        for (const upd of updated) {
          if (existingMap.has(upd.id)) {
            const existing = existingMap.get(upd.id)!;
            // Only update if content changed
            if (existing.text !== upd.text || existing.checked !== upd.checked) {
              existingMap.set(upd.id, { ...upd, isNew: true });
            }
          }
        }
        
        return [...Array.from(existingMap.values()), ...newOnes];
      });
      
      newBlocks.forEach(b => lastBlockIdsRef.current.add(b.id));
      
      setTimeout(() => {
        if (!mountedRef.current) return;
        setBlocks(prev => prev.map(b => ({ ...b, isNew: false })));
      }, 600);
      setIsEmpty(false);

      // Dispatch event to notify that blocks are now rendered
      try {
        document.dispatchEvent(new CustomEvent('notion-blocks-rendered', {
          detail: { blockCount: newBlocks.length }
        }));
      } catch {}
    }
  };
  
  const refreshBlocks = async () => {
    if (!pageId || !mountedRef.current) return;
    try {
      const resp = await fetch(`/api/notion/blocks?pageId=${encodeURIComponent(pageId)}`, {
        credentials: 'include',
        signal: AbortSignal.timeout(10000)
      });
      if (!resp.ok) {
        console.warn('[NotionPanel MCP] Blocks fetch failed:', resp.status);
        return;
      }
      const data = await resp.json();
      const mapped: BlockWithAnimation[] = (data?.results || []).map((r: any) => {
        if (r.type === 'heading_2') return { id: r.id, type: 'heading' as const, text: r.heading_2?.rich_text?.[0]?.plain_text || '' };
        if (r.type === 'heading_1') return { id: r.id, type: 'heading' as const, text: r.heading_1?.rich_text?.[0]?.plain_text || '' };
        if (r.type === 'to_do') return { id: r.id, type: 'todo' as const, text: r.to_do?.rich_text?.[0]?.plain_text || '', checked: !!r.to_do?.checked };
        if (r.type === 'bulleted_list_item') return { id: r.id, type: 'paragraph' as const, text: '• ' + (r.bulleted_list_item?.rich_text?.[0]?.plain_text || '') };
        if (r.type === 'numbered_list_item') return { id: r.id, type: 'paragraph' as const, text: (r.numbered_list_item?.rich_text?.[0]?.plain_text || '') };
        return { id: r.id, type: 'paragraph' as const, text: r.paragraph?.rich_text?.[0]?.plain_text || '' };
      }).filter((b: BlockWithAnimation) => b.text.trim()); // Filter out empty blocks
      
      if (mapped.length && mountedRef.current) {
        animateNewBlocks(mapped);
      }
    } catch (e) {
      console.warn('[NotionPanel MCP] Failed to refresh blocks:', e);
    }
  };
  
  useEffect(() => {
    const onMcpStart = () => {
      console.log('[NotionPanel MCP] Action started - beginning rapid polling');
      if (!mountedRef.current) return;
      setIsMcpActive(true);
      lastBlockIdsRef.current = new Set(blocks.map(b => b.id));
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      
      // Poll every 300ms during active MCP operations for real-time feel
      // If no pageId yet, the polling will just skip (the pageId might come from complete event)
      pollIntervalRef.current = setInterval(() => {
        if (!mountedRef.current) return;
        // Try to get current pageId from store if prop is stale
        try {
          const { currentComic, currentPageIndex } = useComicStore.getState();
          const currentPanel = (currentComic?.pages[currentPageIndex] || []).find((p: any) => p.id === panelId);
          const currentPageId = currentPanel?.url || pageId;
          if (currentPageId) {
            refreshBlocks();
          }
        } catch {
          if (pageId) refreshBlocks();
        }
      }, 300);
    };
    
    const onMcpComplete = (e: CustomEvent) => {
      console.log('[NotionPanel MCP] Action complete', e.detail);
      if (!mountedRef.current) return;
      
      const detail = e.detail || {};
      const newPageId = detail.pageId;
      const isError = detail.error;
      
      // If we got a new pageId, update the panel immediately
      if (newPageId && newPageId !== pageId) {
        console.log('[NotionPanel MCP] Updating pageId to:', newPageId);
        try {
          const { currentComic, currentPageIndex, updatePanel } = useComicStore.getState();
          const existing = (currentComic?.pages[currentPageIndex] || []).find((p: any) => p.id === panelId);
          if (existing) {
            updatePanel({ ...existing, url: newPageId }, currentPageIndex);
          }
        } catch (err) {
          console.warn('[NotionPanel] Failed to update panel with new pageId:', err);
        }
        
        // Start polling with the new pageId immediately
        if (!isError) {
          setTimeout(async () => {
            if (!mountedRef.current) return;
            try {
              const resp = await fetch(`/api/notion/blocks?pageId=${encodeURIComponent(newPageId)}`, {
                credentials: 'include',
                signal: AbortSignal.timeout(10000)
              });
              if (resp.ok) {
                const data = await resp.json();
                const mapped: BlockWithAnimation[] = (data?.results || []).map((r: any) => {
                  if (r.type === 'heading_2') return { id: r.id, type: 'heading' as const, text: r.heading_2?.rich_text?.[0]?.plain_text || '' };
                  if (r.type === 'heading_1') return { id: r.id, type: 'heading' as const, text: r.heading_1?.rich_text?.[0]?.plain_text || '' };
                  if (r.type === 'to_do') return { id: r.id, type: 'todo' as const, text: r.to_do?.rich_text?.[0]?.plain_text || '', checked: !!r.to_do?.checked };
                  if (r.type === 'bulleted_list_item') return { id: r.id, type: 'paragraph' as const, text: '• ' + (r.bulleted_list_item?.rich_text?.[0]?.plain_text || '') };
                  if (r.type === 'numbered_list_item') return { id: r.id, type: 'paragraph' as const, text: (r.numbered_list_item?.rich_text?.[0]?.plain_text || '') };
                  return { id: r.id, type: 'paragraph' as const, text: r.paragraph?.rich_text?.[0]?.plain_text || '' };
                }).filter((b: BlockWithAnimation) => b.text.trim());
                
                if (mapped.length && mountedRef.current) {
                  setBlocks(mapped.map(b => ({ ...b, isNew: true })));
                  setIsEmpty(false);
                  // Remove animation after delay
                  setTimeout(() => {
                    if (!mountedRef.current) return;
                    setBlocks(prev => prev.map(b => ({ ...b, isNew: false })));
                  }, 600);
                }
              }
            } catch {}
          }, 100);
        }
      }
      
      // Clear rapid polling
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
      
      // If there's an error, just stop
      if (isError) {
        setIsMcpActive(false);
        pollIntervalRef.current = null;
        return;
      }
      
      // Do a few more refreshes to catch any final updates
      let finalRefreshes = 5; // More refreshes for better real-time feel
      const finalPoll = () => {
        if (!mountedRef.current) return;
        refreshBlocks();
        finalRefreshes--;
        if (finalRefreshes > 0) {
          setTimeout(finalPoll, 400);
        } else {
          setIsMcpActive(false);
          pollIntervalRef.current = null;
        }
      };
      setTimeout(finalPoll, 200);
    };
    
    const onMcpConnected = (e: MessageEvent | CustomEvent) => {
      if (e.type === 'message' && !isOAuthPopupMessage(e as MessageEvent, popupRef.current, window.location.origin)) return;
      const detail = (e as CustomEvent).detail || (e as MessageEvent).data;
      if (detail?.kind === 'notion-mcp-connected') {
        console.log('[NotionPanel MCP] Connected to workspace:', detail.workspace);
        if (mountedRef.current) {
          setMcpConnected(true);
          setNotionConnected(true);
          toast.success(`Connected to ${detail.workspace || 'Notion'} via MCP`);
        }
      }
    };
    
    // Handle streamed notes from Hon (add_notion_note tool)
    const onStreamNote = (e: CustomEvent) => {
      if (!mountedRef.current) return;
      const { note, type } = e.detail || {};
      if (!note) return;

      console.log('[NotionPanel] Received streamed note:', { note: note.substring(0, 50), type });

      // Create a new block with animation
      const newBlock: BlockWithAnimation = {
        id: `streamed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: type === 'heading' ? 'heading' : type === 'task' ? 'todo' : 'paragraph',
        text: type === 'heading' ? note : `• ${note}`,
        checked: false,
        isNew: true
      };

      setBlocks(prev => [...prev, newBlock]);
      setIsEmpty(false);

      // Remove animation after delay
      setTimeout(() => {
        if (!mountedRef.current) return;
        setBlocks(prev => prev.map(b =>
          b.id === newBlock.id ? { ...b, isNew: false } : b
        ));
      }, 600);
    };

    document.addEventListener('notion-mcp-action-start', onMcpStart as any);
    document.addEventListener('notion-mcp-action-complete', onMcpComplete as any);
    document.addEventListener('notion-mcp-connected', onMcpConnected as any);
    document.addEventListener('notion-stream-note', onStreamNote as any);
    window.addEventListener('message', onMcpConnected as any);

    return () => {
      document.removeEventListener('notion-mcp-action-start', onMcpStart as any);
      document.removeEventListener('notion-mcp-action-complete', onMcpComplete as any);
      document.removeEventListener('notion-mcp-connected', onMcpConnected as any);
      document.removeEventListener('notion-stream-note', onStreamNote as any);
      window.removeEventListener('message', onMcpConnected as any);
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [pageId, panelId, blocks]);
  
  // Check for connection on mount - auto-trigger OAuth if not connected
  useEffect(() => {
    // Clear any existing check
    if (connectionCheckRef.current) {
      clearTimeout(connectionCheckRef.current);
    }
    
    let hasTriggeredAuth = false;
    
    const checkConnection = async () => {
      if (!mountedRef.current) return;
      try {
        const resp = await fetch('/api/notion/session', {
          credentials: 'include', signal: AbortSignal.timeout(5000)
        });
        if (resp.ok) {
          const status = await resp.json();
          if (status.ok) {
            setNotionConnected(true);
            setMcpConnected(status.mcp === true);
            return;
          }
        }

        // Not connected - auto-trigger OAuth if interactive and not already triggered
        if (interactive && !hasTriggeredAuth && mountedRef.current) {
          hasTriggeredAuth = true;
          console.log('[NotionPanel] Not connected - auto-triggering OAuth...');
          // Small delay to let panel render first
          connectionCheckRef.current = setTimeout(() => {
            if (mountedRef.current && !notionConnected) {
              handleConnect();
            }
          }, 500);
        }
      } catch (err) {
        console.warn('[NotionPanel] Connection check error:', err);
      }
    };
    
    // Check once on mount
    checkConnection();
    
    return () => {
      if (connectionCheckRef.current) {
        clearTimeout(connectionCheckRef.current);
      }
    };
  }, [interactive]);

  useEffect(() => {
    try {
      const t = (editorRef.current?.textContent || '').trim();
      setIsEmpty(!t && (!blocks || blocks.length === 0));
    } catch {}
  }, [blocks]);

  const handleInput = (e: React.FormEvent<HTMLDivElement>) => {
    try {
      const t = (e.currentTarget.textContent || '').trim();
      if (t) {
        setIsEmpty(false);
        setEditorContent(t);
      }
    } catch {}
  };

  // Sync editorContent state to DOM for transcriptions (one-way sync)
  useEffect(() => {
    if (!editorRef.current || !mountedRef.current) return;
    const el = editorRef.current;
    const currentText = el.textContent || '';
    // Only update if the state has content and differs from current DOM
    if (editorContent && editorContent !== currentText && el.isConnected) {
      try {
        el.textContent = editorContent;
      } catch (e) {
        console.warn('[NotionPanel] Error syncing editor content:', e);
      }
    }
  }, [editorContent]);

  useEffect(() => {
    if (!interactive) return;
    setTimeout(() => { try { editorRef.current?.focus(); } catch {} }, 0);
  }, [interactive]);

  const appendText = (t: string) => {
    if (!t || !mountedRef.current) return;
    const cleaned = t.replace(/\b(uh|um|er|ah)\b/gi, '').replace(/\b(\w+)\s+\1\b/gi, '$1').replace(/\s+/g, ' ').trim();
    if (!cleaned) return;
    
    // Use React state instead of direct DOM manipulation to avoid crashes
    setEditorContent(prevContent => {
      const base = prevContent || '';
      const baseLower = base.trim().toLowerCase();
      const cleanLower = cleaned.toLowerCase();
      if (baseLower.endsWith(cleanLower)) return prevContent;
      if (baseLower.length > 0 && cleanLower.length > 10 && baseLower.includes(cleanLower)) return prevContent;
      let k = Math.min(cleanLower.length, 40);
      let overlap = 0;
      while (k > 0) {
        if (baseLower.endsWith(cleanLower.slice(0, k))) { overlap = k; break; }
        k--;
      }
      const delta = cleaned.slice(overlap).trim();
      if (!delta) return prevContent;
      const withSpace = base.replace(/\s*$/, '') + (base ? ' ' : '');
      const prefix = bulletMode ? (base ? (withSpace.endsWith('\n ') || withSpace.endsWith('\n') ? '' : '\n• ') : '• ') : '';
      const commit = (prefix + delta).trimStart();
      const newText = (withSpace + commit).trim();
      return newText;
    });
    setIsEmpty(false);
  };

  const containsStopPhrase = (s: string): boolean => {
    const text = (s || '').toLowerCase();
    return ['stop notes', 'stop note taking', 'stop taking notes', 'hon stop notes', 'end notes'].some(p => text.includes(p));
  };

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        if (!pageId) return;
        const resp = await fetch(`/api/notion/blocks?pageId=${encodeURIComponent(pageId)}`, {
          credentials: 'include'
        });
        if (!resp.ok) return;
        const data = await resp.json();
        if (!mounted) return;
        const mapped = (data?.results || []).map((r: any) => {
          if (r.type === 'heading_2') return { id: r.id, type: 'heading', text: r.heading_2?.rich_text?.[0]?.plain_text || '' };
          if (r.type === 'to_do') return { id: r.id, type: 'todo', text: r.to_do?.rich_text?.[0]?.plain_text || '', checked: !!r.to_do?.checked };
          return { id: r.id, type: 'paragraph', text: r.paragraph?.rich_text?.[0]?.plain_text || '' };
        });
        if (mapped.length) setBlocks(mapped);
      } catch {}
    };
    load();
    return () => { mounted = false; };
  }, [pageId]);

  useEffect(() => {
    if (!pageId) return;
    const handle = setTimeout(async () => {
      try {
        const prevIds = blocks.map(b => b.id).filter(Boolean);
        const payload = blocks.map(b => ({ type: b.type, text: b.text, checked: b.checked }));
        await fetch('/api/notion/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ pageId, blocks: payload, previousIds: prevIds }) });
      } catch {}
    }, 1000);
    return () => clearTimeout(handle);
  }, [blocks, pageId]);

  const handleConnect = async () => {
    console.log('[NotionPanel] Starting OAuth flow...');
    try {
      const w = 520, h = 640;
      const left = window.screenX + (window.outerWidth - w) / 2;
      const top = window.screenY + (window.outerHeight - h) / 2;
      // Use the MCP auth endpoint
      popupRef.current = window.open('about:blank', 'notion-mcp-oauth', `width=${w},height=${h},left=${left},top=${top}`);
      if (!popupRef.current) {
        toast.error('Please allow popups to connect Notion');
        return;
      }
      
      let stopped = false;
      let successHandled = false;
      
      const cleanup = () => { 
        stopped = true; 
        window.removeEventListener('message', onMsg as any); 
      };
      
      const handleSuccess = async (isMcp: boolean, workspace?: string) => {
        if (successHandled) return;
        successHandled = true;
        cleanup();
        try { popupRef.current?.close(); } catch {}
        if (mountedRef.current) {
          setNotionConnected(true);
          setMcpConnected(isMcp);
        }
        toast.success(`Connected to ${workspace || 'Notion'}`);
        await afterConnected();
      };
      
      const onMsg = async (e: MessageEvent) => {
        if (!isOAuthPopupMessage(e, popupRef.current, window.location.origin) || !e.data) return;
        const kind = e.data.kind;
        if (kind === 'notion-mcp-connected' || kind === 'notion-connected') {
          await handleSuccess(kind === 'notion-mcp-connected', e.data.workspace);
        }
      };
      window.addEventListener('message', onMsg);
      void beginOAuthPopup(popupRef.current, '/api/notion/mcp-auth').catch(() => { cleanup(); toast.error('Notion connection could not be started'); });
      
      // Poll for connection with faster initial checks
      const start = Date.now();
      let pollCount = 0;
      const poll = async () => {
        if (stopped || successHandled) return;
        pollCount++;
        
        // Check if popup was closed without connecting
        try {
          if (popupRef.current?.closed && pollCount > 3) {
            console.log('[NotionPanel] Popup closed - checking if connected...');
            // Give a moment for cookies to be set
            await new Promise(r => setTimeout(r, 500));
          }
        } catch {}
        
        try {
          const r = await fetch('/api/notion/session', {
            credentials: 'include',
            signal: AbortSignal.timeout(5000)
          });
          if (r.ok) {
            const status = await r.json();
            if (!status.ok) return;
            await handleSuccess(status.mcp === true, status.workspace);
            return;
          }
        } catch {}
        
        // Continue polling for 90 seconds
        if (Date.now() - start < 90_000) {
          // Poll faster initially, then slow down
          const delay = pollCount < 5 ? 800 : 1500;
          setTimeout(poll, delay);
        } else {
          cleanup();
          if (!successHandled) {
            toast.error('Connection timed out. Please try again.');
          }
        }
      };
      setTimeout(poll, 800);
    } catch (e) {
      console.error('[NotionPanel] OAuth error:', e);
      toast.error('Failed to start Notion connection');
    }
  };

  const afterConnected = async () => {
    try {
      if (!pageId) {
        const cr = await fetch('/api/notion/create', { method: 'POST', credentials: 'include' });
        if (cr.ok) {
          const cj = await cr.json();
          const newId = cj?.pageId;
          if (newId) {
            const { currentComic, currentPageIndex, updatePanel } = useComicStore.getState();
            const existing = (currentComic?.pages[currentPageIndex] || []).find(p => p.id === panelId);
            if (existing) {
              await updatePanel({ ...existing, url: newId }, currentPageIndex);
              toast.success('Notion page linked');
            }
          }
        }
      }
    } catch {}
  };

  // Transcribe audio blob using Whisper API
  const transcribeWithWhisper = async (audioBlob: Blob): Promise<string> => {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.webm');

    try {
      const resp = await fetch('/api/whisper-transcribe', {
        method: 'POST',
        body: formData,
      });

      if (!resp.ok) {
        console.warn('[NotionPanel] Whisper transcription failed:', resp.status);
        return '';
      }

      const data = await resp.json();
      return data.text || '';
    } catch (e) {
      console.warn('[NotionPanel] Whisper error:', e);
      return '';
    }
  };

  const handleMicClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    try {
      const hume = await getHumeService();
      if (!isListening && hume && hume.isSessionActive()) await hume.toggleMute();

      if (!isListening) {
        // Use Whisper API for reliable transcription
        // Record audio in chunks and send to Whisper periodically
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          sttStreamRef.current = stream;

          const mediaRecorder = new MediaRecorder(stream, {
            mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
          });
          mediaRecRef.current = mediaRecorder;

          let audioChunks: Blob[] = [];
          let chunkStartTime = Date.now();
          const CHUNK_INTERVAL = 4000; // Send to Whisper every 4 seconds

          mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
              audioChunks.push(event.data);
            }
          };

          // Periodically send accumulated audio to Whisper
          const processChunks = async () => {
            if (!mountedRef.current || audioChunks.length === 0) return;

            const audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
            // Keep last chunk for continuity overlap
            audioChunks = audioChunks.slice(-1);
            chunkStartTime = Date.now();

            if (audioBlob.size < 1000) return; // Skip tiny chunks

            if (mountedRef.current) setPendingPartial('Transcribing...');

            const text = await transcribeWithWhisper(audioBlob);
            if (text && mountedRef.current) {
              if (containsStopPhrase(text)) {
                stopListening();
                return;
              }
              setPendingPartial('');
              appendText(text);
            } else if (mountedRef.current) {
              setPendingPartial('');
            }
          };

          // Process chunks at regular intervals
          const chunkInterval = setInterval(() => {
            if (mountedRef.current && mediaRecRef.current?.state === 'recording') {
              processChunks();
            }
          }, CHUNK_INTERVAL);

          mediaRecorder.onstop = async () => {
            clearInterval(chunkInterval);
            // Process any remaining audio
            if (audioChunks.length > 0 && mountedRef.current) {
              const finalBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
              if (finalBlob.size > 1000) {
                setPendingPartial('Transcribing...');
                const text = await transcribeWithWhisper(finalBlob);
                if (text && mountedRef.current) {
                  appendText(text);
                }
              }
            }
            if (mountedRef.current) {
              setPendingPartial('');
              setIsListening(false);
            }
          };

          // Request data frequently for smoother chunks
          mediaRecorder.start(1000); // Get data every 1 second

          if (mountedRef.current) {
            setIsListening(true);
            toast.info('Listening with Whisper...');
          }

        } catch (micError) {
          console.error('[NotionPanel] Microphone access error:', micError);
          toast.error('Could not access microphone');
        }
      } else {
        stopListening();
      }
    } catch (e) {
      console.error('[NotionPanel] Mic error:', e);
    }
  };

  const handleClose = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try { 
      const { currentPageIndex, removePanel } = useComicStore.getState() as any; 
      if (typeof currentPageIndex === 'number' && removePanel) { 
        removePanel(panelId, currentPageIndex); 
      } 
    } catch {} 
  };

  // Theme colors
  const theme = isDarkMode ? {
    bg: 'bg-gray-900',
    bgGradient: 'from-gray-900 to-gray-800',
    header: 'bg-gray-800/90',
    border: 'border-gray-700',
    text: 'text-gray-100',
    textMuted: 'text-gray-400',
    textSubtle: 'text-gray-500',
    buttonBg: 'bg-gray-700 hover:bg-gray-600',
    buttonText: 'text-gray-200',
    inputBg: 'bg-gray-800',
  } : {
    bg: 'bg-white',
    bgGradient: 'from-white to-gray-50',
    header: 'bg-white/95',
    border: 'border-gray-200',
    text: 'text-gray-900',
    textMuted: 'text-gray-500',
    textSubtle: 'text-gray-400',
    buttonBg: 'bg-gray-100 hover:bg-gray-200',
    buttonText: 'text-gray-700',
    inputBg: 'bg-gray-50',
  };

  return (
    <div
      ref={rootRef}
      className={`w-full h-full rounded-xl overflow-hidden flex flex-col ${theme.bg} bg-gradient-to-br ${theme.bgGradient} border ${theme.border} shadow-xl`}
      style={{ minWidth: 280, minHeight: 200 }}
    >
      {/* Header */}
      <div className={`flex items-center justify-between px-4 py-3 border-b ${theme.border} ${theme.header} backdrop-blur-sm`}>
        {/* Left: Logo + Status */}
        <div className="flex items-center gap-3">
          {/* Notion logo */}
          <div className="w-8 h-8 rounded-lg bg-black flex items-center justify-center shadow-sm">
            <span className="text-white text-sm font-bold">N</span>
          </div>
          
          {/* MCP Activity */}
          {isMcpActive && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-purple-500/20 border border-purple-500/30">
              <div className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
              <span className="text-xs font-medium text-purple-400">Hon working...</span>
            </div>
          )}
          
          {/* Connection badge */}
          {notionConnected && !isMcpActive && (
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
              mcpConnected 
                ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' 
                : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
            }`}>
              {mcpConnected ? '✓ MCP' : '✓ Connected'}
            </span>
          )}
        </div>
        
        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          {/* Mic button */}
          <button 
            onClick={handleMicClick}
            className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all ${
              isListening 
                ? 'bg-red-500 text-white shadow-lg shadow-red-500/40 animate-pulse' 
                : `${theme.buttonBg} ${theme.buttonText}`
            }`}
            title={isListening ? 'Stop listening' : 'Start dictation'}
          >
            <Mic className="w-4 h-4" />
          </button>
          
          {/* Open in Notion */}
          {notionConnected && pageId && (
            <a
              href={`https://www.notion.so/${pageId.replace(/-/g, '')}`}
              target="_blank" 
              rel="noreferrer"
              className={`w-9 h-9 rounded-lg flex items-center justify-center ${theme.buttonBg} ${theme.buttonText} transition-colors`}
              title="Open in Notion"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
          
          {/* Connect/Change button */}
          <button
            onClick={handleConnect}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              notionConnected
                ? `${theme.buttonBg} ${theme.textMuted}`
                : 'bg-black text-white hover:bg-gray-800 shadow-md'
            }`}
          >
            {notionConnected ? 'Change' : 'Connect'}
          </button>
          
          {/* Close button */}
          <button
            onClick={handleClose}
            className={`w-9 h-9 rounded-lg flex items-center justify-center ${theme.buttonBg} hover:bg-red-500/20 hover:text-red-400 ${theme.textMuted} transition-colors`}
            title="Close panel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      
      {/* Content area */}
      <div
        ref={editorRef}
        className={`flex-1 overflow-auto outline-none p-4 ${theme.text}`}
        style={{ fontSize: 14, lineHeight: 1.7 }}
        contentEditable={interactive}
        suppressContentEditableWarning
        onInput={handleInput}
      >
        {/* Empty state */}
        {isEmpty && (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className={`w-16 h-16 rounded-2xl ${isDarkMode ? 'bg-gray-800' : 'bg-gray-100'} flex items-center justify-center mb-4`}>
              <span className="text-3xl">📝</span>
            </div>
            <div className={`text-base font-semibold ${theme.textMuted} mb-2`}>Hon Notes</div>
            <div className={`text-sm ${theme.textSubtle} max-w-[200px]`}>
              {notionConnected 
                ? 'Start typing or ask Hon to take notes...' 
                : 'Connect Notion to sync your notes'}
            </div>
            {!notionConnected && (
              <button
                onClick={handleConnect}
                className="mt-4 px-5 py-2.5 rounded-lg bg-black text-white text-sm font-medium hover:bg-gray-800 transition-colors shadow-md"
              >
                Connect Notion
              </button>
            )}
          </div>
        )}
        
        {/* Blocks */}
        {blocks.map(b => (
          <div 
            key={b.id} 
            className={`mb-2 transition-all duration-300 ${
              b.isNew 
                ? `${isDarkMode ? 'bg-purple-500/20' : 'bg-purple-50'} rounded-lg px-3 py-2 -mx-3 border-l-2 border-purple-500` 
                : ''
            }`}
          >
            {b.type === 'heading' ? (
              <div className={`text-lg font-bold ${theme.text}`}>{b.text}</div>
            ) : b.type === 'todo' ? (
              <label className="flex items-start gap-3 cursor-pointer group">
                <input 
                  type="checkbox" 
                  defaultChecked={b.checked} 
                  className="mt-1 w-4 h-4 rounded border-gray-300 text-purple-500 focus:ring-purple-400"
                />
                <span className={b.checked ? `line-through ${theme.textMuted}` : theme.text}>{b.text}</span>
              </label>
            ) : (
              <div className={theme.text}>{b.text}</div>
            )}
          </div>
        ))}
        
        {/* Pending transcript */}
        {!!pendingPartial && (
          <div className={`${theme.textMuted} italic border-l-2 border-blue-400 pl-3 mt-2`}>
            {pendingPartial}
          </div>
        )}
      </div>
      
      {/* Resize handle */}
      {interactive && (
        <div
          className={`absolute bottom-1 right-1 w-6 h-6 rounded-md ${theme.buttonBg} flex items-center justify-center cursor-nwse-resize opacity-60 hover:opacity-100 transition-opacity`}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            // Dispatch resize event to parent
            document.dispatchEvent(new CustomEvent('panel-resize-start', { detail: { panelId } }));
          }}
        >
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
            <path d="M22 22H20V20H22V22ZM22 18H20V16H22V18ZM18 22H16V20H18V22ZM22 14H20V12H22V14ZM18 18H16V16H18V18ZM14 22H12V20H14V22Z" />
          </svg>
        </div>
      )}
    </div>
  );
};
