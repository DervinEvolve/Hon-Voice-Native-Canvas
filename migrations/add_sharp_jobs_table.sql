-- Migration: Add sharp_jobs table for tracking image-to-splat conversions
-- Run this in your Supabase SQL editor

CREATE TABLE IF NOT EXISTS sharp_jobs (
  id TEXT PRIMARY KEY,
  image_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  ply_data TEXT, -- Base64 encoded PLY file (temporary storage before upload)
  ply_url TEXT,  -- Final URL after upload to storage
  filename TEXT,
  size_bytes INTEGER,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Index for faster status lookups
CREATE INDEX IF NOT EXISTS idx_sharp_jobs_status ON sharp_jobs(status);
CREATE INDEX IF NOT EXISTS idx_sharp_jobs_created_at ON sharp_jobs(created_at);

-- Auto-cleanup old jobs (optional - keeps last 7 days)
-- You can set up a cron job or Supabase Edge Function to run this periodically
-- DELETE FROM sharp_jobs WHERE created_at < NOW() - INTERVAL '7 days';

-- RLS policies (adjust based on your auth setup)
ALTER TABLE sharp_jobs ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role has full access to sharp_jobs"
  ON sharp_jobs
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE sharp_jobs IS 'Tracks Apple Sharp image-to-Gaussian-splat conversion jobs';
COMMENT ON COLUMN sharp_jobs.ply_data IS 'Temporary base64 storage, cleared after upload to hon-assets bucket';

