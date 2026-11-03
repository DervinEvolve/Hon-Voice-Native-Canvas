CREATE TABLE IF NOT EXISTS public.canvas_history_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_address TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'panel_create', 'panel_update', 'panel_delete', 'panel_move', 'panel_resize',
    'panel_group', 'panel_ungroup', 'panel_link',
    'canvas_pan', 'canvas_zoom', 'canvas_layout',
    'voice_task_start', 'voice_task_complete', 'voice_task_failed',
    'conversation_start', 'conversation_message', 'conversation_end',
    'snapshot_created', 'restore_point'
  )),
  event_description TEXT,
  voice_event_id TEXT,
  conversation_id TEXT,
  voice_transcript TEXT,
  event_data JSONB DEFAULT '{}',
  snapshot_id UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT valid_user_or_wallet CHECK (user_id IS NOT NULL OR wallet_address IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.canvas_history_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_address TEXT,
  snapshot_type TEXT NOT NULL CHECK (snapshot_type IN ('manual', 'auto', 'restore_point', 'voice_task_complete')),
  description TEXT,
  canvas_state JSONB NOT NULL DEFAULT '{}',
  is_compressed BOOLEAN DEFAULT false,
  compression_method TEXT,
  voice_event_id TEXT,
  conversation_id TEXT,
  voice_context TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  snapshot_size_bytes INTEGER,
  CONSTRAINT valid_user_or_wallet CHECK (user_id IS NOT NULL OR wallet_address IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_canvas_events_project_created ON public.canvas_history_events (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_canvas_events_user ON public.canvas_history_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_canvas_events_voice ON public.canvas_history_events (voice_event_id) WHERE voice_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_canvas_events_conversation ON public.canvas_history_events (conversation_id) WHERE conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_canvas_events_type ON public.canvas_history_events (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_canvas_snapshots_project_created ON public.canvas_history_snapshots (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_canvas_snapshots_user ON public.canvas_history_snapshots (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_canvas_snapshots_voice ON public.canvas_history_snapshots (voice_event_id) WHERE voice_event_id IS NOT NULL;

ALTER TABLE public.canvas_history_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canvas_history_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own canvas events"
  ON public.canvas_history_events
  FOR SELECT
  USING (
    (auth.uid() = user_id) OR 
    (wallet_address IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.comics 
      WHERE id = project_id 
      AND (creator_id = auth.uid() OR creator_wallet = wallet_address)
    ))
  );

CREATE POLICY "Users can insert their own canvas events"
  ON public.canvas_history_events
  FOR INSERT
  WITH CHECK (
    (auth.uid() = user_id) OR 
    (wallet_address IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.comics 
      WHERE id = project_id 
      AND (creator_id = auth.uid() OR creator_wallet = wallet_address)
    ))
  );

CREATE POLICY "Users can view their own canvas snapshots"
  ON public.canvas_history_snapshots
  FOR SELECT
  USING (
    (auth.uid() = user_id) OR 
    (wallet_address IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.comics 
      WHERE id = project_id 
      AND (creator_id = auth.uid() OR creator_wallet = wallet_address)
    ))
  );

CREATE POLICY "Users can insert their own canvas snapshots"
  ON public.canvas_history_snapshots
  FOR INSERT
  WITH CHECK (
    (auth.uid() = user_id) OR 
    (wallet_address IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.comics 
      WHERE id = project_id 
      AND (creator_id = auth.uid() OR creator_wallet = wallet_address)
    ))
  );

CREATE OR REPLACE FUNCTION public.get_canvas_timeline(
  p_project_id TEXT,
  p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
  id UUID,
  type TEXT,
  event_type TEXT,
  description TEXT,
  voice_event_id TEXT,
  conversation_id TEXT,
  voice_transcript TEXT,
  snapshot_id UUID,
  created_at TIMESTAMP WITH TIME ZONE,
  has_snapshot BOOLEAN
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    e.id,
    'event'::TEXT as type,
    e.event_type,
    e.event_description as description,
    e.voice_event_id,
    e.conversation_id,
    e.voice_transcript,
    e.snapshot_id,
    e.created_at,
    (e.snapshot_id IS NOT NULL) as has_snapshot
  FROM public.canvas_history_events e
  WHERE e.project_id = p_project_id
  ORDER BY e.created_at DESC
  LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_canvas_snapshot(p_snapshot_id UUID)
RETURNS TABLE (
  id UUID,
  project_id TEXT,
  snapshot_type TEXT,
  description TEXT,
  canvas_state JSONB,
  voice_event_id TEXT,
  conversation_id TEXT,
  voice_context TEXT,
  created_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.id,
    s.project_id,
    s.snapshot_type,
    s.description,
    s.canvas_state,
    s.voice_event_id,
    s.conversation_id,
    s.voice_context,
    s.created_at
  FROM public.canvas_history_snapshots s
  WHERE s.id = p_snapshot_id;
END;
$$;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.calculate_snapshot_size()
RETURNS TRIGGER AS $$
BEGIN
  NEW.snapshot_size_bytes := pg_column_size(NEW.canvas_state) + 200;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER calculate_snapshot_size_trigger
  BEFORE INSERT OR UPDATE ON public.canvas_history_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION public.calculate_snapshot_size();

CREATE OR REPLACE FUNCTION public.cleanup_old_snapshots(
  p_project_id TEXT DEFAULT NULL,
  p_keep_count INTEGER DEFAULT 50,
  p_older_than_days INTEGER DEFAULT 90
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  WITH ranked_snapshots AS (
    SELECT 
      id,
      ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at DESC) as rn
    FROM public.canvas_history_snapshots
    WHERE 
      (p_project_id IS NULL OR project_id = p_project_id)
      AND created_at < NOW() - (p_older_than_days || ' days')::INTERVAL
      AND snapshot_type != 'restore_point'
  )
  DELETE FROM public.canvas_history_snapshots
  WHERE id IN (
    SELECT id FROM ranked_snapshots WHERE rn > p_keep_count
  );
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_old_events(
  p_older_than_days INTEGER DEFAULT 180
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.canvas_history_events
  WHERE 
    created_at < NOW() - (p_older_than_days || ' days')::INTERVAL
    AND snapshot_id IS NULL;
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_project_storage_stats(p_project_id TEXT)
RETURNS TABLE (
  total_events BIGINT,
  total_snapshots BIGINT,
  total_snapshot_size_bytes BIGINT,
  oldest_event TIMESTAMP WITH TIME ZONE,
  newest_event TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    (SELECT COUNT(*) FROM public.canvas_history_events WHERE project_id = p_project_id)::BIGINT as total_events,
    (SELECT COUNT(*) FROM public.canvas_history_snapshots WHERE project_id = p_project_id)::BIGINT as total_snapshots,
    (SELECT COALESCE(SUM(snapshot_size_bytes), 0) FROM public.canvas_history_snapshots WHERE project_id = p_project_id)::BIGINT as total_snapshot_size_bytes,
    (SELECT MIN(created_at) FROM public.canvas_history_events WHERE project_id = p_project_id) as oldest_event,
    (SELECT MAX(created_at) FROM public.canvas_history_events WHERE project_id = p_project_id) as newest_event;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_canvas_snapshots_state_gin ON public.canvas_history_snapshots USING GIN (canvas_state jsonb_path_ops);

CREATE INDEX IF NOT EXISTS idx_canvas_snapshots_size ON public.canvas_history_snapshots (project_id, snapshot_size_bytes) WHERE snapshot_size_bytes IS NOT NULL;

ALTER TABLE public.canvas_history_events
ADD CONSTRAINT canvas_history_events_project_id_fkey
FOREIGN KEY (project_id) REFERENCES public.comics(id) ON DELETE CASCADE;

ALTER TABLE public.canvas_history_events
ADD CONSTRAINT canvas_history_events_snapshot_id_fkey
FOREIGN KEY (snapshot_id) REFERENCES public.canvas_history_snapshots(id) ON DELETE SET NULL;

ALTER TABLE public.canvas_history_snapshots
ADD CONSTRAINT canvas_history_snapshots_project_id_fkey
FOREIGN KEY (project_id) REFERENCES public.comics(id) ON DELETE CASCADE;
