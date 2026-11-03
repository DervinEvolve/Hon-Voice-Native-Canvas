DROP POLICY IF EXISTS "Users can view their own canvas events" ON public.canvas_history_events;
DROP POLICY IF EXISTS "Users can insert their own canvas events" ON public.canvas_history_events;
DROP POLICY IF EXISTS "Users can view their own canvas snapshots" ON public.canvas_history_snapshots;
DROP POLICY IF EXISTS "Users can insert their own canvas snapshots" ON public.canvas_history_snapshots;

ALTER TABLE IF EXISTS public.canvas_history_events
DROP CONSTRAINT IF EXISTS canvas_history_events_project_id_fkey;

ALTER TABLE IF EXISTS public.canvas_history_snapshots
DROP CONSTRAINT IF EXISTS canvas_history_snapshots_project_id_fkey;

DROP FUNCTION IF EXISTS public.get_canvas_timeline(UUID, INTEGER);
DROP FUNCTION IF EXISTS public.get_canvas_snapshot(UUID);
DROP FUNCTION IF EXISTS public.cleanup_old_snapshots(UUID, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.get_project_storage_stats(UUID);

ALTER TABLE IF EXISTS public.canvas_history_events
ALTER COLUMN project_id TYPE TEXT USING project_id::TEXT;

ALTER TABLE IF EXISTS public.canvas_history_snapshots
ALTER COLUMN project_id TYPE TEXT USING project_id::TEXT;

CREATE POLICY "Users can view their own canvas events"
  ON public.canvas_history_events
  FOR SELECT
  USING (
    (auth.uid() = user_id) OR 
    (wallet_address IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.comics 
      WHERE id::TEXT = project_id 
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
      WHERE id::TEXT = project_id 
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
      WHERE id::TEXT = project_id 
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
      WHERE id::TEXT = project_id 
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
