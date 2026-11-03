-- Legacy layout probe: adds public.canvas_history, which the live project
-- does not have, with the wallet-string policy of the old canvas migrations.
-- Run after tests/sql/live-policy-fixture.sql. Never run against a real project.
\set ON_ERROR_STOP on
CREATE TABLE IF NOT EXISTS public.canvas_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id text NOT NULL,
  user_id uuid,
  wallet_address text,
  canvas_state jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.canvas_history ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.canvas_history TO anon, authenticated, service_role;
DROP POLICY IF EXISTS "canvas_history_wallet_access" ON public.canvas_history;
CREATE POLICY "canvas_history_wallet_access" ON public.canvas_history
  FOR ALL TO PUBLIC
  USING (user_id = auth.uid()
    OR wallet_address = current_setting('request.headers', true)::json ->> 'x-wallet-address')
  WITH CHECK (user_id = auth.uid()
    OR wallet_address = current_setting('request.headers', true)::json ->> 'x-wallet-address');
