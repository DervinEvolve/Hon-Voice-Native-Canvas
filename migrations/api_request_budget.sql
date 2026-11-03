-- Apply before enabling the shared API. Counters are service-only and atomic
-- across instances. This is a request cap, not a dollar-spend guarantee.
BEGIN;
CREATE TABLE IF NOT EXISTS public.hon_api_request_windows (
  actor_id text NOT NULL,
  window_start timestamptz NOT NULL,
  requests integer NOT NULL CHECK (requests > 0),
  PRIMARY KEY (actor_id, window_start)
);
ALTER TABLE public.hon_api_request_windows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hon_api_request_windows FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hon_api_request_windows TO service_role;
CREATE OR REPLACE FUNCTION public.claim_hon_api_request(p_actor_id text, p_limit integer)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE claimed boolean;
BEGIN
  IF p_actor_id IS NULL OR length(p_actor_id) NOT BETWEEN 1 AND 512 OR p_limit NOT BETWEEN 1 AND 10000 OR p_limit IS NULL THEN
    RAISE EXCEPTION 'Invalid API budget request' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.hon_api_request_windows AS w (actor_id, window_start, requests)
  VALUES (p_actor_id, date_trunc('hour', now()), 1)
  ON CONFLICT (actor_id, window_start) DO UPDATE SET requests = w.requests + 1 WHERE w.requests < p_limit
  RETURNING true INTO claimed;
  RETURN coalesce(claimed, false);
END; $$;
REVOKE ALL ON FUNCTION public.claim_hon_api_request(text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_hon_api_request(text,integer) TO service_role;
COMMIT;
