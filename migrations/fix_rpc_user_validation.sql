-- Update RPC functions to validate user_id existence before insert
-- This prevents "Key (user_id)=... is not present in table" errors

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
SECURITY DEFINER
AS $$
DECLARE
  v_event_id UUID;
  v_valid_user_id UUID;
BEGIN
  -- Validate user_id exists in auth.users to prevent FK violations
  IF p_user_id IS NOT NULL THEN
    SELECT id INTO v_valid_user_id FROM auth.users WHERE id = p_user_id;
  ELSE
    v_valid_user_id := NULL;
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
    v_valid_user_id, -- Use validated ID (NULL if not found or passed as NULL)
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
SECURITY DEFINER
AS $$
DECLARE
  v_snapshot_id UUID;
  v_valid_user_id UUID;
BEGIN
  -- Validate user_id exists in auth.users to prevent FK violations
  IF p_user_id IS NOT NULL THEN
    SELECT id INTO v_valid_user_id FROM auth.users WHERE id = p_user_id;
  ELSE
    v_valid_user_id := NULL;
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
    v_valid_user_id, -- Use validated ID (NULL if not found or passed as NULL)
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

