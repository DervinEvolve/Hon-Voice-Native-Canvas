-- Apply before the protected SHARP API. Existing unowned jobs remain inaccessible.
BEGIN;
-- Text supports both Supabase IDs and server-derived Privy identity hashes.
ALTER TABLE public.sharp_jobs ADD COLUMN IF NOT EXISTS owner_id TEXT;
ALTER TABLE public.sharp_jobs ADD COLUMN IF NOT EXISTS storage_path TEXT;
CREATE INDEX IF NOT EXISTS sharp_jobs_owner_id_idx ON public.sharp_jobs(owner_id);
ALTER TABLE public.sharp_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to sharp_jobs" ON public.sharp_jobs;
CREATE POLICY "Service role has full access to sharp_jobs"
  ON public.sharp_jobs FOR ALL TO service_role USING (true) WITH CHECK (true);
-- Access goes through the backend's verified owner predicates, never the browser key.
REVOKE ALL ON public.sharp_jobs FROM PUBLIC, anon, authenticated;
INSERT INTO storage.buckets (id, name, public)
VALUES ('hon-private-splats', 'hon-private-splats', false)
ON CONFLICT (id) DO UPDATE SET public = false;
COMMIT;
-- Review any pre-existing storage.objects policies separately. Do not create a
-- broad authenticated/anon policy for this bucket. Old public files are not moved
-- or deleted here; review and migrate them before publication.
