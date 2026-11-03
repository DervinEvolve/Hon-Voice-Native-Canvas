-- RPC function to update thumbnail in canvas_state using PostgreSQL JSONB merge
-- This ensures atomic updates and proper JSONB handling

CREATE OR REPLACE FUNCTION public.update_canvas_snapshot_thumbnail(
  p_snapshot_id UUID,
  p_thumbnail_url TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
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

