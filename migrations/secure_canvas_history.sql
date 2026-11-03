-- Apply LAST, after legacy canvas migrations, in a test database first.
-- History is private to the database-authenticated user. A wallet string or
-- frontend user ID is metadata, not identity. Draft project IDs are namespaced
-- by that owner; no cross-user history or wallet-only collaboration is granted.
BEGIN;
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


ALTER TABLE public.canvas_history_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canvas_history_snapshots ENABLE ROW LEVEL SECURITY;
-- Replace legacy permissive OR policies, including their wallet-string shortcut.
DO $policies$
DECLARE p record;
BEGIN
  FOR p IN SELECT schemaname, tablename, policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('canvas_history_events', 'canvas_history_snapshots')
  LOOP EXECUTE format('DROP POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename); END LOOP;
END $policies$;
CREATE POLICY canvas_events_owner ON public.canvas_history_events FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY canvas_snapshots_owner ON public.canvas_history_snapshots FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
REVOKE ALL ON public.canvas_history_events, public.canvas_history_snapshots FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.canvas_history_events, public.canvas_history_snapshots TO authenticated;
CREATE OR REPLACE FUNCTION public.save_canvas_event(
  p_project_id TEXT,
  p_event_type TEXT,
  p_user_id UUID DEFAULT NULL,
  p_wallet_address TEXT DEFAULT NULL,
  p_event_description TEXT DEFAULT NULL,
  p_voice_event_id TEXT DEFAULT NULL,
  p_conversation_id TEXT DEFAULT NULL,
  p_voice_transcript TEXT DEFAULT NULL,
  p_event_data JSONB DEFAULT '{}'::jsonb,
  p_snapshot_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_event_id UUID;
  v_valid_user_id UUID;
BEGIN
  v_valid_user_id := auth.uid();
  IF v_valid_user_id IS NULL OR (p_user_id IS NOT NULL AND p_user_id <> v_valid_user_id) THEN
    RAISE EXCEPTION 'Verified canvas owner required' USING ERRCODE = '42501';
  END IF;
  IF p_project_id IS NULL OR length(p_project_id) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Invalid project ID' USING ERRCODE = '22023';
  END IF;

  IF p_snapshot_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.canvas_history_snapshots s
    WHERE s.id = p_snapshot_id AND s.project_id = p_project_id AND s.user_id = v_valid_user_id
  ) THEN
    RAISE EXCEPTION 'Snapshot is not owned by this project user' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.canvas_history_events (
    project_id,
    user_id,
    wallet_address,
    event_type,
    event_description,
    voice_event_id,
    conversation_id,
    voice_transcript,
    event_data,
    snapshot_id
  ) VALUES (
    p_project_id,
    v_valid_user_id,
    p_wallet_address,
    p_event_type,
    p_event_description,
    p_voice_event_id,
    p_conversation_id,
    p_voice_transcript,
    p_event_data,
    p_snapshot_id
  )
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_canvas_snapshot(
  p_project_id TEXT,
  p_snapshot_type TEXT,
  p_canvas_state JSONB,
  p_user_id UUID DEFAULT NULL,
  p_wallet_address TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_voice_event_id TEXT DEFAULT NULL,
  p_conversation_id TEXT DEFAULT NULL,
  p_voice_context TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_snapshot_id UUID;
  v_valid_user_id UUID;
BEGIN
  v_valid_user_id := auth.uid();
  IF v_valid_user_id IS NULL OR (p_user_id IS NOT NULL AND p_user_id <> v_valid_user_id) THEN
    RAISE EXCEPTION 'Verified canvas owner required' USING ERRCODE = '42501';
  END IF;
  IF p_project_id IS NULL OR length(p_project_id) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Invalid project ID' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.canvas_history_snapshots (
    project_id,
    user_id,
    wallet_address,
    snapshot_type,
    description,
    canvas_state,
    voice_event_id,
    conversation_id,
    voice_context
  ) VALUES (
    p_project_id,
    v_valid_user_id,
    p_wallet_address,
    p_snapshot_type,
    p_description,
    p_canvas_state,
    p_voice_event_id,
    p_conversation_id,
    p_voice_context
  )
  RETURNING id INTO v_snapshot_id;

  RETURN v_snapshot_id;
END;
$$;

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
SECURITY INVOKER
SET search_path = ''
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
  LIMIT greatest(1, least(coalesce(p_limit, 100), 200));
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
SECURITY INVOKER
SET search_path = ''
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
SECURITY INVOKER
SET search_path = ''
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
      AND created_at < NOW() - (greatest(1, least(coalesce(p_older_than_days, 90), 3650)) * interval '1 day')
      AND snapshot_type != 'restore_point'
  )
  DELETE FROM public.canvas_history_snapshots
  WHERE id IN (
    SELECT id FROM ranked_snapshots WHERE rn > greatest(1, least(coalesce(p_keep_count, 50), 1000))
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
SECURITY INVOKER
SET search_path = ''
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
-- RPC function to update thumbnail in canvas_state using PostgreSQL JSONB merge
-- This ensures atomic updates and proper JSONB handling

CREATE OR REPLACE FUNCTION public.update_canvas_snapshot_thumbnail(
  p_snapshot_id UUID,
  p_thumbnail_url TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  -- Use PostgreSQL's JSONB merge operator (||) to update only the thumbnail field
  UPDATE public.canvas_history_snapshots
  SET canvas_state = canvas_state || jsonb_build_object('thumbnail', p_thumbnail_url)
  WHERE id = p_snapshot_id;
  
  -- Return true if update succeeded
  RETURN FOUND;
END;
$$;


CREATE OR REPLACE FUNCTION public.calculate_snapshot_size() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN NEW.snapshot_size_bytes := pg_column_size(NEW.canvas_state) + 200; RETURN NEW; END; $$;
-- Retire every old overload as well; only the current interfaces below reopen.
DO $functions$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('save_canvas_event','create_canvas_snapshot',
      'get_canvas_timeline','get_canvas_snapshot','update_canvas_snapshot_thumbnail',
      'cleanup_old_snapshots','cleanup_old_events','get_project_storage_stats','calculate_snapshot_size')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SECURITY INVOKER', f.signature);
    EXECUTE format('ALTER FUNCTION %s SET search_path = %L', f.signature, '');
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.signature);
  END LOOP;
END $functions$;
GRANT EXECUTE ON FUNCTION public.save_canvas_event(text,text,uuid,text,text,text,text,text,jsonb,uuid),
  public.create_canvas_snapshot(text,text,jsonb,uuid,text,text,text,text,text),
  public.get_canvas_timeline(text,integer), public.get_canvas_snapshot(uuid),
  public.update_canvas_snapshot_thumbnail(uuid,text), public.cleanup_old_snapshots(text,integer,integer),
  public.get_project_storage_stats(text) TO authenticated;
-- Old global cleanup_old_events and obsolete UUID overloads stay inaccessible.
COMMIT;
