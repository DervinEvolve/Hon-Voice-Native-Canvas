-- Disposable copy of the 33 SECURITY DEFINER routines and the two
-- SECURITY INVOKER trigger helpers found on the live project, the tables
-- they use, the four live policies on profiles_new and comics_new, and the
-- five live trigger attachments. Never run against a real project.
-- Run after tests/sql/database-bootstrap.sql, tests/sql/live-policy-fixture.sql
-- and migrations/harden_live_policies.sql, and before
-- migrations/secure_canvas_history.sql.
-- Every routine is created from the exact text the owner exported
-- (pg_get_functiondef), by a role named postgres, so that definition hashes
-- and ACL strings match the live ones.
-- Column types of comic_comments, comic_drafts, comic_stats, comics,
-- comment_votes, creator_subscriptions, subscriptions, comics_new and
-- profiles_new are the live ones from the owner's exports.
-- public.bookmarks and public.likes do not exist live and are not created here.
-- hon_evi_sessions has only the columns its trigger needs (assumption).
-- Verified live by the owner (SELECT-only metadata, PostgreSQL 15.14) and
-- matched here: profiles.created_at and hon_evi_sessions.updated_at are
-- timestamptz, auth.users.email is varchar, auth.role() is the stable SQL
-- function below owned by supabase_auth_admin, and anon, authenticated and
-- service_role each hold all seven table privileges on profiles_new.
-- User A, user B and their fake profiles come from the files above.
\set ON_ERROR_STOP on

-- Stand-in for the Supabase postgres role that owns the live routines. It is
-- a superuser here so that the definer routines can reach every table.
DO $role$
BEGIN
  CREATE ROLE postgres SUPERUSER NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$role$;
-- Supabase default privileges: routines created by postgres in public get
-- EXECUTE for the client roles, in addition to the default for PUBLIC.
-- Together they give the live ACL.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

-- Columns that the exported trigger bodies write, with the live types.
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email varchar;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.comment_votes ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- auth.role() as verified live: stable SQL, the role claim or the role in
-- the claims JSON, owned by supabase_auth_admin (a stand-in role here).
DO $role$
BEGIN
  CREATE ROLE supabase_auth_admin NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$role$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('request.jwt.claim.role', true),
                  (current_setting('request.jwt.claims', true)::jsonb ->> 'role'))::text;
$$;
ALTER FUNCTION auth.role() OWNER TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;

-- Stand-in for the role that inserts auth.users rows (Supabase: supabase_auth_admin).
-- It has no EXECUTE on handle_new_user, so the test shows a trigger needs none.
DO $role$
BEGIN
  CREATE ROLE hon_auth_admin NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$role$;
GRANT USAGE ON SCHEMA auth TO hon_auth_admin;
GRANT INSERT ON auth.users TO hon_auth_admin;

-- Live column types (owner's exports).
CREATE TABLE IF NOT EXISTS public.comic_comments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  comic_id uuid,
  user_id uuid,
  wallet_address text,
  content text NOT NULL,
  parent_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS public.comic_drafts (
  id text PRIMARY KEY,
  title text,
  description text,
  creator_id uuid,
  creator_wallet text,
  published boolean,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  cover_image text,
  tags text[]
);
CREATE TABLE IF NOT EXISTS public.comic_stats (
  comic_id text PRIMARY KEY,
  view_count bigint,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.comics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  title text,
  creator_id uuid,
  creator_wallet text,
  cover_image text,
  cover_type text,
  content jsonb,
  is_published boolean,
  last_modified timestamptz DEFAULT now(),
  published_at timestamp,
  publication_id text,
  draft_id text,
  published_id uuid,
  story_type text,
  is_ai_generated boolean,
  like_count bigint,
  comment_count bigint,
  bookmark_count bigint
);
CREATE TABLE IF NOT EXISTS public.creator_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id uuid,
  creator_id uuid,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.comics_new (
  id text NOT NULL,
  title text NOT NULL,
  creator_id text NOT NULL,
  creator_wallet text,
  cover_image text,
  cover_type text DEFAULT 'image'::text,
  pages jsonb NOT NULL DEFAULT '[]'::jsonb,
  page_templates jsonb DEFAULT '[]'::jsonb,
  narrations jsonb DEFAULT '{}'::jsonb,
  is_published boolean DEFAULT false,
  is_draft boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS public.profiles_new (
  id text NOT NULL,
  username text,
  display_name text,
  first_name text,
  last_name text,
  avatar_url text,
  bio text,
  email text,
  wallet_address text,
  solana_wallet text,
  social_links jsonb DEFAULT '{}'::jsonb,
  preferences jsonb DEFAULT '{}'::jsonb,
  subscription_tier text DEFAULT 'free'::text,
  subscription_status text DEFAULT 'inactive'::text,
  subscription_expiry timestamp with time zone,
  is_verified boolean DEFAULT false,
  is_creator boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS public.hon_evi_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  updated_at timestamptz DEFAULT now()
);

-- Live table grants on profiles_new: anon, authenticated and service_role
-- each hold SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER.
REVOKE ALL ON public.profiles_new FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.profiles_new
  TO anon, authenticated, service_role;

-- Stop here if an earlier fixture left a different type on a verified column.
DO $types$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(format('%s.%s.%s expected %s, found %s', e.sch, e.tbl, e.col, e.typ, coalesce(c.data_type, 'no column')),
                    '; ') INTO bad
  FROM (VALUES ('public', 'profiles', 'created_at', 'timestamp with time zone'),
               ('public', 'hon_evi_sessions', 'updated_at', 'timestamp with time zone'),
               ('auth', 'users', 'email', 'character varying')) AS e(sch, tbl, col, typ)
  LEFT JOIN information_schema.columns c
    ON c.table_schema = e.sch AND c.table_name = e.tbl AND c.column_name = e.col
  WHERE c.data_type IS DISTINCT FROM e.typ;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Fixture column types differ from the verified live types: %', bad;
  END IF;
END
$types$;
-- Canvas history columns that the live routines and secure_canvas_history.sql use.
ALTER TABLE public.canvas_history_events
  ADD COLUMN IF NOT EXISTS event_description text,
  ADD COLUMN IF NOT EXISTS voice_event_id text,
  ADD COLUMN IF NOT EXISTS conversation_id text,
  ADD COLUMN IF NOT EXISTS voice_transcript text,
  ADD COLUMN IF NOT EXISTS event_data jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS snapshot_id uuid;
ALTER TABLE public.canvas_history_snapshots
  ADD COLUMN IF NOT EXISTS snapshot_type text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS voice_event_id text,
  ADD COLUMN IF NOT EXISTS conversation_id text,
  ADD COLUMN IF NOT EXISTS voice_context text,
  ADD COLUMN IF NOT EXISTS snapshot_size_bytes integer;

-- Row-level security on, no client policy: clients reach these tables only
-- through the routines. (Their live policies are not part of this review.)
ALTER TABLE public.comic_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comic_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comic_stats ENABLE ROW LEVEL SECURITY;

-- The four live policies on profiles_new and comics_new (exact export).
ALTER TABLE public.profiles_new ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comics_new ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view published comics" ON public.comics_new;
CREATE POLICY "Anyone can view published comics" ON public.comics_new AS PERMISSIVE
  FOR SELECT TO PUBLIC USING ((is_published = true));
DROP POLICY IF EXISTS "Users can manage their own comics" ON public.comics_new;
CREATE POLICY "Users can manage their own comics" ON public.comics_new AS PERMISSIVE
  FOR ALL TO PUBLIC USING ((creator_id = current_setting('app.current_user_id'::text, true)));
DROP POLICY IF EXISTS "Users can manage their own profile" ON public.profiles_new;
CREATE POLICY "Users can manage their own profile" ON public.profiles_new AS PERMISSIVE
  FOR ALL TO PUBLIC USING ((id = current_setting('app.current_user_id'::text, true)));
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles_new;
CREATE POLICY "Users can view all profiles" ON public.profiles_new AS PERMISSIVE
  FOR SELECT TO PUBLIC USING (true);

-- Fake rows only. User B owns one of each; user A owns a subscription to B.
INSERT INTO public.comic_drafts (id, title, creator_id, creator_wallet, updated_at) VALUES
  ('draft-1', 'Fixture draft one', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'WalletBBB', '2000-01-01'),
  ('draft-2', 'Fixture draft two', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'WalletAAA', '2000-01-01')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.comics (id, title, creator_id, draft_id) VALUES
  ('c0c0c0c0-0000-4000-8000-000000000001', 'Fixture comic one', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'draft-1'),
  ('c0c0c0c0-0000-4000-8000-000000000002', 'Fixture comic two', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'draft-2')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.comic_comments (id, comic_id, user_id, content) VALUES
  ('c0c0c0c0-0000-4000-8000-0000000000c1', 'c0c0c0c0-0000-4000-8000-000000000001',
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'comment by b')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.comment_votes (comment_id, user_id, vote_type) VALUES
  ('c0c0c0c0-0000-4000-8000-0000000000c1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', -1)
ON CONFLICT DO NOTHING;
INSERT INTO public.creator_subscriptions (subscriber_id, creator_id) VALUES
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
INSERT INTO public.subscriptions (subscriber_id, creator_id) VALUES
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
ON CONFLICT DO NOTHING;
INSERT INTO public.canvas_history_snapshots (id, project_id, user_id, snapshot_type, canvas_state) VALUES
  ('c0c0c0c0-0000-4000-8000-0000000000e1', 'canvas-b', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'manual', '{"marker": "canvas-b"}')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.canvas_history_events (project_id, user_id, event_type) VALUES
  ('canvas-b', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'panel_create');
INSERT INTO public.profiles_new (id, username, display_name, email, wallet_address, solana_wallet, preferences,
                                 subscription_tier, subscription_status, subscription_expiry) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'new_a', 'A on profiles_new', 'a-new@example.test', 'WalletAAA', 'WalletAAA',
   '{"marker": "prefs-new-a"}', 'tier-fake-a', 'status-fake-a', '2031-01-01'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'new_b', 'B on profiles_new', 'b-new@example.test', 'WalletBBB', 'WalletBBB',
   '{"marker": "prefs-new-b"}', 'tier-fake-b', 'status-fake-b', '2032-02-02')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.comics_new (id, title, creator_id, is_published) VALUES
  ('comic-new-b-published', 'B published', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true),
  ('comic-new-b-draft', 'B draft', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', false),
  ('comic-new-a-draft', 'A draft', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.hon_evi_sessions (id, updated_at) VALUES
  ('c0c0c0c0-0000-4000-8000-0000000000f1', '2000-01-01')
ON CONFLICT (id) DO NOTHING;

-- Routines, created by postgres from the exact exported text.
SET ROLE postgres;
-- Live definition of public.add_comment(text,text,text,uuid).
CREATE OR REPLACE FUNCTION public.add_comment(p_comic_id text, p_user_id text, p_content text, p_parent_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  comment_id uuid;
BEGIN
  INSERT INTO public.comic_comments (comic_id, user_id, content, parent_id)
  VALUES (p_comic_id, p_user_id, p_content, p_parent_id)
  RETURNING id INTO comment_id;
  
  RETURN comment_id;
END;
$function$
;
-- Live definition of public.cleanup_old_events(integer).
CREATE OR REPLACE FUNCTION public.cleanup_old_events(p_older_than_days integer DEFAULT 180)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
$function$
;
-- Live definition of public.cleanup_old_snapshots(text,integer,integer).
CREATE OR REPLACE FUNCTION public.cleanup_old_snapshots(p_project_id text DEFAULT NULL::text, p_keep_count integer DEFAULT 50, p_older_than_days integer DEFAULT 90)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
$function$
;
-- Live definition of public.create_canvas_snapshot(text,text,jsonb,uuid,text,text,text,text,text).
CREATE OR REPLACE FUNCTION public.create_canvas_snapshot(p_project_id text, p_snapshot_type text, p_canvas_state jsonb, p_user_id uuid DEFAULT NULL::uuid, p_wallet_address text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_voice_event_id text DEFAULT NULL::text, p_conversation_id text DEFAULT NULL::text, p_voice_context text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
$function$
;
-- Live definition of public.get_canvas_snapshot(uuid).
CREATE OR REPLACE FUNCTION public.get_canvas_snapshot(p_snapshot_id uuid)
 RETURNS TABLE(id uuid, project_id text, snapshot_type text, description text, canvas_state jsonb, voice_event_id text, conversation_id text, voice_context text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
$function$
;
-- Live definition of public.get_canvas_timeline(text,integer).
CREATE OR REPLACE FUNCTION public.get_canvas_timeline(p_project_id text, p_limit integer DEFAULT 100)
 RETURNS TABLE(id uuid, type text, event_type text, description text, voice_event_id text, conversation_id text, voice_transcript text, snapshot_id uuid, created_at timestamp with time zone, has_snapshot boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
$function$
;
-- Live definition of public.get_comic_id_from_draft_id(text).
CREATE OR REPLACE FUNCTION public.get_comic_id_from_draft_id(p_draft_id text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  comic_id uuid;
BEGIN
  SELECT id INTO comic_id
  FROM public.comics
  WHERE draft_id = p_draft_id;
  
  RETURN comic_id;
END;
$function$
;
-- Live definition of public.get_comment_votes(uuid).
CREATE OR REPLACE FUNCTION public.get_comment_votes(p_comment_id uuid)
 RETURNS TABLE(vote_type integer, vote_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  RETURN QUERY
  SELECT cv.vote_type, COUNT(*)::bigint as vote_count
  FROM public.comment_votes cv
  WHERE cv.comment_id = p_comment_id
  GROUP BY cv.vote_type;
END;
$function$
;
-- Live definition of public.get_comment_votes(uuid,text).
CREATE OR REPLACE FUNCTION public.get_comment_votes(p_comment_id uuid, p_user_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_upvotes INTEGER;
    v_downvotes INTEGER;
    v_user_vote INTEGER;
BEGIN
    -- Get vote counts
    SELECT 
        COUNT(*) FILTER (WHERE vote_type = 1),
        COUNT(*) FILTER (WHERE vote_type = -1)
    INTO v_upvotes, v_downvotes
    FROM public.comment_votes
    WHERE comment_id = p_comment_id;
    
    -- Get user's vote if user_id is provided
    IF p_user_id IS NOT NULL THEN
        SELECT vote_type INTO v_user_vote
        FROM public.comment_votes
        WHERE comment_id = p_comment_id AND user_id = p_user_id;
    END IF;
    
    -- Return vote counts and user's vote
    RETURN jsonb_build_object(
        'upvotes', v_upvotes,
        'downvotes', v_downvotes,
        'user_vote', v_user_vote
    );
END;
$function$
;
-- Live definition of public.get_comments_for_comic(text).
CREATE OR REPLACE FUNCTION public.get_comments_for_comic(p_comic_id text)
 RETURNS TABLE(id uuid, content text, user_id text, parent_id uuid, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  RETURN QUERY
  SELECT c.id, c.content, c.user_id, c.parent_id, c.created_at, c.updated_at
  FROM public.comic_comments c
  WHERE c.comic_id = p_comic_id
  ORDER BY c.created_at ASC;
END;
$function$
;
-- Live definition of public.get_pg_version().
CREATE OR REPLACE FUNCTION public.get_pg_version()
 RETURNS text
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT version();
$function$
;
-- Live definition of public.get_project_storage_stats(text).
CREATE OR REPLACE FUNCTION public.get_project_storage_stats(p_project_id text)
 RETURNS TABLE(total_events bigint, total_snapshots bigint, total_snapshot_size_bytes bigint, oldest_event timestamp with time zone, newest_event timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    (SELECT COUNT(*) FROM public.canvas_history_events WHERE project_id = p_project_id)::BIGINT as total_events,
    (SELECT COUNT(*) FROM public.canvas_history_snapshots WHERE project_id = p_project_id)::BIGINT as total_snapshots,
    (SELECT COALESCE(SUM(snapshot_size_bytes), 0) FROM public.canvas_history_snapshots WHERE project_id = p_project_id)::BIGINT as total_snapshot_size_bytes,
    (SELECT MIN(created_at) FROM public.canvas_history_events WHERE project_id = p_project_id) as oldest_event,
    (SELECT MAX(created_at) FROM public.canvas_history_events WHERE project_id = p_project_id) as newest_event;
END;
$function$
;
-- Live definition of public.get_user_bookmarks(uuid).
CREATE OR REPLACE FUNCTION public.get_user_bookmarks(p_user_identifier uuid)
 RETURNS TABLE(id uuid, comic_id text, title text, description text, creator_id uuid, creator_wallet text, cover_image text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    -- Check if the user exists
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_identifier) THEN
        RAISE EXCEPTION 'User not found with identifier: %', p_user_identifier;
    END IF;
    
    RETURN QUERY
    SELECT 
        b.id,
        cd.id AS comic_id,
        cd.title,
        cd.description,
        cd.creator_id,
        cd.creator_wallet,
        cd.cover_image,
        b.created_at
    FROM public.bookmarks b
    JOIN public.comic_drafts cd ON b.comic_id = cd.id
    WHERE b.user_id = p_user_identifier
    ORDER BY b.created_at DESC;
END;
$function$
;
-- Live definition of public.get_user_id_from_identifier(text).
CREATE OR REPLACE FUNCTION public.get_user_id_from_identifier(p_identifier text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  user_id uuid;
BEGIN
  -- Try to find user by ID first (if it's a valid UUID)
  IF p_identifier ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT id INTO user_id FROM public.profiles WHERE id::text = p_identifier;
    IF FOUND THEN RETURN user_id; END IF;
  END IF;
  
  -- Try to find by username
  SELECT id INTO user_id FROM public.profiles WHERE username = p_identifier;
  IF FOUND THEN RETURN user_id; END IF;
  
  -- Try to find by email
  SELECT id INTO user_id FROM public.profiles WHERE email = p_identifier;
  RETURN user_id;
END;
$function$
;
-- Live definition of public.get_user_likes(uuid).
CREATE OR REPLACE FUNCTION public.get_user_likes(p_user_identifier uuid)
 RETURNS TABLE(comic_id text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    RETURN QUERY
    SELECT l.comic_id, l.created_at
    FROM public.likes l
    WHERE l.user_id = p_user_identifier;
END;
$function$
;
-- Live definition of public.get_user_subscriptions(uuid).
CREATE OR REPLACE FUNCTION public.get_user_subscriptions(p_subscriber_wallet uuid)
 RETURNS TABLE(id uuid, creator_id uuid, username text, avatar_url text, wallet_address text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    -- Check if the subscriber exists
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_subscriber_wallet) THEN
        RAISE EXCEPTION 'Subscriber not found with identifier: %', p_subscriber_wallet;
    END IF;
    
    RETURN QUERY
    SELECT 
        s.id,
        p.id AS creator_id,
        p.username,
        p.avatar_url,
        p.wallet_address,
        s.created_at
    FROM public.subscriptions s
    JOIN public.profiles p ON s.creator_id = p.id
    WHERE s.subscriber_id = p_subscriber_wallet
    ORDER BY s.created_at DESC;
END;
$function$
;
-- Live definition of public.get_user_subscriptions(text).
CREATE OR REPLACE FUNCTION public.get_user_subscriptions(p_user_id text)
 RETURNS SETOF creator_subscriptions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  RETURN QUERY
  SELECT * FROM public.creator_subscriptions
  WHERE subscriber_id = p_user_id;
END;
$function$
;
-- Live definition of public.increment_comic_views(text).
CREATE OR REPLACE FUNCTION public.increment_comic_views(input_comic_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  INSERT INTO public.comic_stats (comic_id, view_count)
  VALUES (input_comic_id, 1)
  ON CONFLICT (comic_id) 
  DO UPDATE SET 
    view_count = comic_stats.view_count + 1,
    updated_at = timezone('utc'::text, now());
END;
$function$
;
-- Live definition of public.is_comic_bookmarked(uuid,text).
CREATE OR REPLACE FUNCTION public.is_comic_bookmarked(p_user_identifier uuid, p_comic_identifier text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_is_bookmarked BOOLEAN;
BEGIN
    -- Check if the user exists
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_identifier) THEN
        RAISE EXCEPTION 'User not found with identifier: %', p_user_identifier;
    END IF;
    
    SELECT EXISTS (
        SELECT 1
        FROM public.bookmarks
        WHERE user_id = p_user_identifier
        AND comic_id = p_comic_identifier
    ) INTO v_is_bookmarked;
    
    RETURN json_build_object('is_bookmarked', v_is_bookmarked);
END;
$function$
;
-- Live definition of public.is_comic_liked(uuid,text).
CREATE OR REPLACE FUNCTION public.is_comic_liked(p_user_identifier uuid, p_comic_identifier text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_is_liked BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM public.likes
        WHERE user_id = p_user_identifier
        AND comic_id = p_comic_identifier
    ) INTO v_is_liked;
    
    RETURN json_build_object('is_liked', v_is_liked);
END;
$function$
;
-- Live definition of public.is_subscribed(text,text).
CREATE OR REPLACE FUNCTION public.is_subscribed(p_subscriber_id text, p_creator_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  RETURN EXISTS(
    SELECT 1 FROM public.creator_subscriptions
    WHERE subscriber_id = p_subscriber_id AND creator_id = p_creator_id
  );
END;
$function$
;
-- Live definition of public.is_subscribed(uuid,uuid).
CREATE OR REPLACE FUNCTION public.is_subscribed(p_subscriber_wallet uuid, p_creator_wallet uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_is_subscribed BOOLEAN;
BEGIN
    -- Check if the subscriber exists
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_subscriber_wallet) THEN
        RAISE EXCEPTION 'Subscriber not found with identifier: %', p_subscriber_wallet;
    END IF;
    
    -- Check if the creator exists
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_creator_wallet) THEN
        RAISE EXCEPTION 'Creator not found with identifier: %', p_creator_wallet;
    END IF;
    
    SELECT EXISTS (
        SELECT 1
        FROM public.subscriptions
        WHERE subscriber_id = p_subscriber_wallet
        AND creator_id = p_creator_wallet
    ) INTO v_is_subscribed;
    
    RETURN v_is_subscribed;
END;
$function$
;
-- Live definition of public.save_canvas_event(text,text,uuid,text,text,text,text,text,jsonb,uuid).
CREATE OR REPLACE FUNCTION public.save_canvas_event(p_project_id text, p_event_type text, p_user_id uuid DEFAULT NULL::uuid, p_wallet_address text DEFAULT NULL::text, p_event_description text DEFAULT NULL::text, p_voice_event_id text DEFAULT NULL::text, p_conversation_id text DEFAULT NULL::text, p_voice_transcript text DEFAULT NULL::text, p_event_data jsonb DEFAULT '{}'::jsonb, p_snapshot_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
$function$
;
-- Live definition of public.set_current_user_id(text).
CREATE OR REPLACE FUNCTION public.set_current_user_id(user_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    PERFORM set_config('app.current_user_id', user_id, true);
END;
$function$
;
-- Live definition of public.setup_collaboration_tables().
CREATE OR REPLACE FUNCTION public.setup_collaboration_tables()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  -- This function sets up collaboration-related triggers and policies
  -- Only allow service role to execute
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Access denied: service role required';
  END IF;
  
  -- Setup is already done via migrations
  RAISE NOTICE 'Collaboration tables already configured via migrations';
END;
$function$
;
-- Live definition of public.update_canvas_snapshot_thumbnail(uuid,text).
CREATE OR REPLACE FUNCTION public.update_canvas_snapshot_thumbnail(p_snapshot_id uuid, p_thumbnail_url text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  UPDATE public.canvas_history_snapshots
  SET canvas_state = canvas_state || jsonb_build_object('thumbnail', p_thumbnail_url)
  WHERE id = p_snapshot_id;
  
  RETURN FOUND;
END;
$function$
;
-- Live definition of public.handle_new_user().
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, created_at, updated_at, wallet_id)
  VALUES (
    NEW.id,
    NEW.email,
    now(),
    now(),
    gen_random_uuid()
  );
  RETURN NEW;
END;
$function$
;
-- Live definition of public.handle_updated_at().
CREATE OR REPLACE FUNCTION public.handle_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;
-- Live definition of public.notify_waitlist_signup().
CREATE OR REPLACE FUNCTION public.notify_waitlist_signup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  -- Send notification about new waitlist signup
  PERFORM pg_notify('waitlist_signup', 
    json_build_object(
      'email', NEW.email,
      'source', NEW.source,
      'created_at', NEW.created_at
    )::text
  );
  
  RETURN NEW;
END;
$function$
;
-- Live definition of public.set_bookmark_user_id().
CREATE OR REPLACE FUNCTION public.set_bookmark_user_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  -- Ensure user_id is set from auth context if not provided
  IF NEW.user_id IS NULL THEN
    NEW.user_id = auth.uid()::text;
  END IF;
  
  RETURN NEW;
END;
$function$
;
-- Live definition of public.trigger_collaboration_event().
CREATE OR REPLACE FUNCTION public.trigger_collaboration_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  -- Notify realtime about collaboration changes
  PERFORM pg_notify('collaboration_change', 
    json_build_object(
      'comic_id', COALESCE(NEW.comic_id, OLD.comic_id),
      'event_type', TG_OP,
      'table_name', TG_TABLE_NAME
    )::text
  );
  
  RETURN COALESCE(NEW, OLD);
END;
$function$
;
-- Live definition of public.update_modified_column().
CREATE OR REPLACE FUNCTION public.update_modified_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.last_modified = now();
  RETURN NEW;
END;
$function$
;
-- Live definition of public.update_updated_at_column().
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;
-- Live definition of public.calculate_snapshot_size().
CREATE OR REPLACE FUNCTION public.calculate_snapshot_size()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.snapshot_size_bytes := pg_column_size(NEW.canvas_state) + 200;
  RETURN NEW;
END;
$function$
;
-- Live definition of public.update_hon_evi_sessions_updated_at().
CREATE OR REPLACE FUNCTION public.update_hon_evi_sessions_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;
RESET ROLE;

-- The five live trigger attachments (exact export).
DROP TRIGGER IF EXISTS calculate_snapshot_size_trigger ON public.canvas_history_snapshots;
CREATE TRIGGER calculate_snapshot_size_trigger BEFORE INSERT OR UPDATE ON public.canvas_history_snapshots FOR EACH ROW EXECUTE FUNCTION calculate_snapshot_size();
DROP TRIGGER IF EXISTS update_hon_evi_sessions_updated_at ON public.hon_evi_sessions;
CREATE TRIGGER update_hon_evi_sessions_updated_at BEFORE UPDATE ON public.hon_evi_sessions FOR EACH ROW EXECUTE FUNCTION update_hon_evi_sessions_updated_at();
DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
DROP TRIGGER IF EXISTS waitlist_signup_notification ON public.waitlist;
CREATE TRIGGER waitlist_signup_notification AFTER INSERT ON public.waitlist FOR EACH ROW EXECUTE FUNCTION notify_waitlist_signup();
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();
