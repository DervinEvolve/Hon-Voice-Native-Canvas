-- Hardens the 33 SECURITY DEFINER routines that the owner exported from the
-- live project (PostgreSQL 15), two SECURITY INVOKER trigger helpers, and the
-- policies of profiles_new and comics_new. Run the whole file as one transaction.
-- See docs/RPC_HARDENING.md.
--
-- A SECURITY DEFINER function runs with its owner's rights and skips
-- row-level security. On the live project all 33 are executable by PUBLIC,
-- anon and authenticated. This file:
--   * rewrites the routines that take a caller-supplied user ID so they act
--     only for auth.uid() and raise 42501 for a different ID;
--   * rewrites get_user_id_from_identifier so it never matches on email;
--   * adds an auth.uid() filter to three canvas history routines;
--   * recreates the seven trigger functions from their exported bodies with
--     search_path = '';
--   * pins search_path = '' on every other definer routine;
--   * makes admin and cleanup helpers, and the four routines whose tables
--     do not exist, service_role only;
--   * replaces the two policies that trust app.current_user_id with
--     auth.uid() owner policies, makes profiles_new owner-only and adds the
--     view profiles_new_public for its public columns;
--   * revokes EXECUTE from PUBLIC, anon and authenticated everywhere and
--     grants it back only where a client needs it.
-- It creates, empties and drops no table, deletes no row and creates, drops
-- or alters no trigger.
-- Before any change it compares every routine it touches (definition hash
-- and ACL), the policies of profiles_new and comics_new, and the seven table
-- privileges of anon and authenticated on profiles_new with the reviewed
-- state, and aborts on any difference.
-- Each step runs only when the routine exists with the exact live signature.
-- A missing routine is skipped with a NOTICE.
-- The self-check at the end aborts the transaction if any routine in public
-- breaks the rules in docs/RPC_HARDENING.md, including routines not listed here.
-- Prerequisites: migrations/harden_live_policies.sql (public.profiles_public)
-- and migrations/secure_canvas_history.sql (canvas history routines).
-- Reapplying the file gives the same result.
-- Rollback: migrations/rollback_harden_rpc_exposure.sql.
BEGIN;

-- 0. Preconditions. Each raises before anything changes.
DO $preconditions$
DECLARE
  bad text;
BEGIN
  IF to_regclass('public.profiles_public') IS NULL THEN
    RAISE EXCEPTION 'public.profiles_public is missing; apply migrations/harden_live_policies.sql first';
  END IF;

  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO bad
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosecdef
    AND p.proname IN ('save_canvas_event', 'create_canvas_snapshot', 'get_canvas_timeline',
                      'get_canvas_snapshot', 'update_canvas_snapshot_thumbnail',
                      'cleanup_old_snapshots', 'cleanup_old_events',
                      'get_project_storage_stats', 'calculate_snapshot_size');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Canvas history functions still run as SECURITY DEFINER: %; apply migrations/secure_canvas_history.sql first', bad;
  END IF;

  -- The rewritten routines compare these columns with auth.uid(). A
  -- different type, or a missing column, stops the migration here.
  SELECT string_agg(format('%s.%s expected %s, found %s', e.tbl, e.col, e.typ, coalesce(c.data_type, 'no column')),
                    '; ' ORDER BY e.tbl, e.col) INTO bad
  FROM (VALUES ('comic_comments', 'comic_id', 'uuid'),
               ('comic_comments', 'user_id', 'uuid'),
               ('comment_votes', 'user_id', 'text'),
               ('subscriptions', 'subscriber_id', 'text'),
               ('subscriptions', 'creator_id', 'text'),
               ('creator_subscriptions', 'subscriber_id', 'uuid'),
               ('creator_subscriptions', 'creator_id', 'uuid')) AS e(tbl, col, typ)
  LEFT JOIN information_schema.columns c
    ON c.table_schema = 'public' AND c.table_name = e.tbl AND c.column_name = e.col
  WHERE c.data_type IS DISTINCT FROM e.typ;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Column types differ from the reviewed schema: %', bad;
  END IF;
  -- No drift: each routine this file changes must have a reviewed definition
  -- (md5 of pg_get_functiondef) and ACL (same entries, any order), either
  -- the state before this file or the state after it. The values are
  -- generated from the owner's exports.
  WITH expected (sig, md5, acl) AS (VALUES
    ('add_comment(text,text,text,uuid)', '923b74d87dd1919c53b161b7ae78226d', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('add_comment(text,text,text,uuid)', 'f0d321818b17b48201b792001b89ddf0', '{service_role=X/postgres,postgres=X/postgres,authenticated=X/postgres}'),
    ('calculate_snapshot_size()', 'c27858415dfee56c378c11adefa1f8bc', '{service_role=X/postgres,postgres=X/postgres}'),
    ('calculate_snapshot_size()', 'c27858415dfee56c378c11adefa1f8bc', '{service_role=X/postgres,postgres=X/postgres}'),
    ('cleanup_old_events(integer)', '591dc75181972ac8965d96ec990ba57c', '{service_role=X/postgres,postgres=X/postgres}'),
    ('cleanup_old_events(integer)', '591dc75181972ac8965d96ec990ba57c', '{service_role=X/postgres,postgres=X/postgres}'),
    ('cleanup_old_snapshots(text,integer,integer)', '721b249c09e4f1f09a9ff34ef2514076', '{service_role=X/postgres,postgres=X/postgres,authenticated=X/postgres}'),
    ('cleanup_old_snapshots(text,integer,integer)', '721b249c09e4f1f09a9ff34ef2514076', '{service_role=X/postgres,postgres=X/postgres}'),
    ('get_canvas_snapshot(uuid)', 'a1fcac8d69cead8b9791daa16ab3bb46', '{service_role=X/postgres,postgres=X/postgres,authenticated=X/postgres}'),
    ('get_canvas_snapshot(uuid)', 'de862a255997c2e1bf31e8a95cd4b347', '{service_role=X/postgres,postgres=X/postgres,authenticated=X/postgres}'),
    ('get_canvas_timeline(text,integer)', '617220ea8f4fea52adb8174e8b874ef8', '{service_role=X/postgres,postgres=X/postgres,authenticated=X/postgres}'),
    ('get_canvas_timeline(text,integer)', '0dd24a8ada8192a08af776e804c126e1', '{service_role=X/postgres,postgres=X/postgres,authenticated=X/postgres}'),
    ('get_comic_id_from_draft_id(text)', '9ad9af9ef0a9974215b231ad5d134a93', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('get_comic_id_from_draft_id(text)', 'd6af65a7f139a83f7b0483f22eb08ce2', '{service_role=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}'),
    ('get_comment_votes(uuid)', '0b547e793100a6898dd14601b234f2e6', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('get_comment_votes(uuid)', '701462d5338de696c503915db42294ea', '{service_role=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}'),
    ('get_comment_votes(uuid,text)', '3c1cc722e7d960e7da85283071bac6c4', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('get_comment_votes(uuid,text)', '6ce2b38c4ac4392ec7208d18ce82bbb1', '{service_role=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}'),
    ('get_comments_for_comic(text)', '1970731fc4f0b587694f670b46223750', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('get_comments_for_comic(text)', '6010e8ef332dd30a0beda28e64cada66', '{service_role=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}'),
    ('get_pg_version()', '2a3050097c7d148d9686cb75e3d51d62', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('get_pg_version()', 'f73370401fb69381aea25ec1005ee5da', '{service_role=X/postgres,postgres=X/postgres}'),
    ('get_project_storage_stats(text)', '682e046da5125a091d030ef207d6e29f', '{service_role=X/postgres,postgres=X/postgres,authenticated=X/postgres}'),
    ('get_project_storage_stats(text)', '682e046da5125a091d030ef207d6e29f', '{service_role=X/postgres,postgres=X/postgres}'),
    ('get_user_bookmarks(uuid)', 'e58c48404185ec6ec93b0f6130b64368', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('get_user_bookmarks(uuid)', '589721cb77cf6d74bfbbe0315f91639d', '{service_role=X/postgres,postgres=X/postgres}'),
    ('get_user_id_from_identifier(text)', '60a295e2421f92a18bba8dc2fdc52c9c', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('get_user_id_from_identifier(text)', '3a604b0302feea54c908cc27e653227f', '{service_role=X/postgres,postgres=X/postgres}'),
    ('get_user_likes(uuid)', '1d12797985221776f3c2be39b91b7fe0', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('get_user_likes(uuid)', 'fe2c612f408616faf31a09f95f6d3612', '{service_role=X/postgres,postgres=X/postgres}'),
    ('get_user_subscriptions(text)', 'fd20f8409ce7669d8f8fbfa3a2656b6e', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('get_user_subscriptions(text)', '65f750eeddc50839a4e5d598371576e9', '{service_role=X/postgres,postgres=X/postgres,authenticated=X/postgres}'),
    ('get_user_subscriptions(uuid)', '1d667e0fef516fd0fcfeaf75690765a2', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('get_user_subscriptions(uuid)', 'd24bf540d95795792ab42a6c65053a15', '{service_role=X/postgres,postgres=X/postgres,authenticated=X/postgres}'),
    ('handle_new_user()', '51489d63fc1f5f7a386f26cea47a87f1', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('handle_new_user()', 'a2494c63cb9acfbed0d03754972dfaa0', '{service_role=X/postgres,postgres=X/postgres}'),
    ('handle_updated_at()', 'a4d81ad1e8210e2cf54ce1bb0b703b88', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('handle_updated_at()', '74f8cd1bec6f02721dae98c7d4ae8793', '{service_role=X/postgres,postgres=X/postgres}'),
    ('increment_comic_views(text)', 'd140d5999f74d927ce5ece0818c6e9af', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('increment_comic_views(text)', 'f832cf0b31a86b95c7dcd1301b3040a7', '{service_role=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}'),
    ('is_comic_bookmarked(uuid,text)', 'dc2cc478549c3afe3e4fa76fe58af69c', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('is_comic_bookmarked(uuid,text)', 'eca84290742cf93968fa9b5415d5d482', '{service_role=X/postgres,postgres=X/postgres}'),
    ('is_comic_liked(uuid,text)', '37c3fedf3a444fdc7ede387fd39e616b', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('is_comic_liked(uuid,text)', '65e317bf5e436682e6847578be3ff190', '{service_role=X/postgres,postgres=X/postgres}'),
    ('is_subscribed(text,text)', 'a4256ccddd30ac83c088cc53ef8d268b', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('is_subscribed(text,text)', '0758f8426ea4b4542d47299a9c40a5f3', '{service_role=X/postgres,postgres=X/postgres,authenticated=X/postgres}'),
    ('is_subscribed(uuid,uuid)', '53053cbd48174798a24e55b01ae8ff00', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('is_subscribed(uuid,uuid)', '82ba67dba6d17e81fd78b2769f6d8823', '{service_role=X/postgres,postgres=X/postgres,authenticated=X/postgres}'),
    ('notify_waitlist_signup()', 'bb0ff65a0205445007a951c62bc3ed29', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('notify_waitlist_signup()', '5dc297ffecbec5fb35979749825af39d', '{service_role=X/postgres,postgres=X/postgres}'),
    ('set_bookmark_user_id()', 'c5aea35331df2cf6a633999a031352b1', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('set_bookmark_user_id()', '3324430cf9903183ef10a6058d96f5e4', '{service_role=X/postgres,postgres=X/postgres}'),
    ('set_current_user_id(text)', 'a3c5f5122f62805621b270601e0aa95f', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('set_current_user_id(text)', '54c113decc94b4773b41a4b80328f93d', '{service_role=X/postgres,postgres=X/postgres}'),
    ('setup_collaboration_tables()', 'c67e30a4e65a79d48be8d948f4e94246', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('setup_collaboration_tables()', '222d9a8ddfd78a5ac9b981e422c4a9ed', '{service_role=X/postgres,postgres=X/postgres}'),
    ('trigger_collaboration_event()', 'b19f3142a3e2f12ce4356a9a002b3ec6', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('trigger_collaboration_event()', '1e1ade9a5758720966a718fe001549c8', '{service_role=X/postgres,postgres=X/postgres}'),
    ('update_canvas_snapshot_thumbnail(uuid,text)', '8ee81e1d6364dfacd2dacb11e39bab7e', '{service_role=X/postgres,postgres=X/postgres,authenticated=X/postgres}'),
    ('update_canvas_snapshot_thumbnail(uuid,text)', 'bec3fac821fd0d8076f18bd751ddd48d', '{service_role=X/postgres,postgres=X/postgres,authenticated=X/postgres}'),
    ('update_hon_evi_sessions_updated_at()', '9950e385615970b6fe3eed0789786ef9', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('update_hon_evi_sessions_updated_at()', 'a7bd1141d48e6bce598d3feb235cfe5a', '{service_role=X/postgres,postgres=X/postgres}'),
    ('update_modified_column()', 'c0b3b6828e73d77bd8e2092f791a68e0', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('update_modified_column()', '56dad5c205aa44383d01eef7c98aff14', '{service_role=X/postgres,postgres=X/postgres}'),
    ('update_updated_at_column()', '7be3d094bf7781418fbcac3630a25c24', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('update_updated_at_column()', 'a323c77a0c0a0c8cd18dc8e8d3ca3d0f', '{service_role=X/postgres,postgres=X/postgres}')
  )
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO bad
  FROM (SELECT DISTINCT e.sig FROM expected e) s
  JOIN pg_proc p ON p.oid = to_regprocedure('public.' || s.sig)
  WHERE NOT EXISTS (
    SELECT 1 FROM expected e
    WHERE e.sig = s.sig
      AND e.md5 = md5(pg_get_functiondef(p.oid))
      AND (SELECT array_agg(a ORDER BY a) FROM unnest(e.acl::text[]) a)
          = (SELECT array_agg(a::text ORDER BY a::text) FROM unnest(p.proacl) a));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Routine differs from the reviewed definition or ACL: %', bad;
  END IF;

  -- No drift: the policies of profiles_new and comics_new are the four
  -- exported ones, or the set this file leaves.
  SELECT coalesce(string_agg(format('%s|%s|%s|%s|%s|%s', tablename, policyname, cmd, roles::text,
                                    coalesce(qual, '-'), coalesce(with_check, '-')),
                             ' ;; ' ORDER BY tablename, policyname), '') INTO bad
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename IN ('profiles_new', 'comics_new');
  IF bad NOT IN ($pol$comics_new|Anyone can view published comics|SELECT|{public}|(is_published = true)|- ;; comics_new|Users can manage their own comics|ALL|{public}|(creator_id = current_setting('app.current_user_id'::text, true))|- ;; profiles_new|Users can manage their own profile|ALL|{public}|(id = current_setting('app.current_user_id'::text, true))|- ;; profiles_new|Users can view all profiles|SELECT|{public}|true|-$pol$, $pol$comics_new|Anyone can view published comics|SELECT|{public}|(is_published = true)|- ;; comics_new|comics_new_owner|ALL|{authenticated}|(creator_id = (( SELECT auth.uid() AS uid))::text)|(creator_id = (( SELECT auth.uid() AS uid))::text) ;; profiles_new|profiles_new_owner|ALL|{authenticated}|(id = (( SELECT auth.uid() AS uid))::text)|(id = (( SELECT auth.uid() AS uid))::text)$pol$) THEN
    RAISE EXCEPTION 'Policies on profiles_new or comics_new differ from the reviewed set: %', bad;
  END IF;

  -- profiles_new table grants. All seven table privileges are compared for
  -- anon and authenticated. Accepted: the live state before this file (both
  -- hold SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER),
  -- or the state this file leaves (anon holds none of them, also not on a
  -- column; authenticated holds exactly SELECT, INSERT, UPDATE and DELETE).
  -- Anything else aborts and names each role and privilege that differs from
  -- the nearer of the two states. service_role is reported, not required.
  WITH held AS (
    SELECT r, v, o,
           has_table_privilege(r, 'public.profiles_new', v) AS on_table,
           CASE WHEN v IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
                THEN has_any_column_privilege(r, 'public.profiles_new', v)
                ELSE has_table_privilege(r, 'public.profiles_new', v) END AS on_any
    FROM unnest(ARRAY['anon', 'authenticated']) AS r,
         unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'])
           WITH ORDINALITY AS u(v, o)
  ), diff AS (
    SELECT
      array_agg(format('%s lacks %s', r, v) ORDER BY r, o) FILTER (WHERE NOT on_table) AS to_live,
      array_agg(CASE WHEN r = 'authenticated' AND v IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
                     THEN format('%s lacks %s', r, v) ELSE format('%s holds %s', r, v) END ORDER BY r, o)
        FILTER (WHERE CASE WHEN r = 'authenticated' AND v IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
                           THEN NOT on_table ELSE on_any END) AS to_hardened
    FROM held
  )
  SELECT CASE
           WHEN to_live IS NULL OR to_hardened IS NULL THEN NULL
           WHEN cardinality(to_live) < cardinality(to_hardened)
             THEN 'nearest is the live state (anon and authenticated hold all seven): ' || array_to_string(to_live, ', ')
           WHEN cardinality(to_hardened) < cardinality(to_live)
             THEN 'nearest is the hardened state (anon none, authenticated exactly SELECT, INSERT, UPDATE, DELETE): '
                  || array_to_string(to_hardened, ', ')
           ELSE 'against the live state: ' || array_to_string(to_live, ', ')
                || '; against the hardened state: ' || array_to_string(to_hardened, ', ')
         END INTO bad
  FROM diff;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Grants on public.profiles_new differ from the reviewed state; %', bad;
  END IF;
  RAISE NOTICE 'service_role holds on public.profiles_new (not checked, not changed): %',
    (SELECT coalesce(string_agg(v, ', ' ORDER BY o), 'none')
     FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'])
          WITH ORDINALITY AS u(v, o)
     WHERE has_table_privilege('service_role', 'public.profiles_new', v));
END
$preconditions$;

-- 1. Routines rewritten in place. Name, argument names and result type are
-- the live ones. CREATE OR REPLACE keeps the old grants; each block resets them.
-- add_comment: authenticated as auth.uid() only; service_role for a named user. comic_comments.comic_id and user_id are uuid.
DO $add_comment$
BEGIN
  IF to_regprocedure('public.add_comment(text,text,text,uuid)') IS NULL THEN
    RAISE NOTICE 'Skipped: public.add_comment(text,text,text,uuid) does not exist';
    RETURN;
  END IF;
  EXECUTE $create$
    CREATE OR REPLACE FUNCTION public.add_comment(p_comic_id text, p_user_id text, p_content text, p_parent_id uuid DEFAULT NULL::uuid)
    RETURNS uuid
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
    AS $body$
    DECLARE
      v_user uuid := auth.uid();
      v_comic uuid;
      v_comment_id uuid;
    BEGIN
      IF v_user IS NULL AND auth.role() = 'service_role' AND p_user_id IS NOT NULL THEN
        BEGIN
          v_user := p_user_id::uuid;
        EXCEPTION WHEN invalid_text_representation THEN
          RAISE EXCEPTION 'p_user_id is not a uuid: %', p_user_id USING ERRCODE = '22P02';
        END;
      END IF;
      IF v_user IS NULL THEN
        RAISE EXCEPTION 'Signed-in user required' USING ERRCODE = '42501';
      END IF;
      IF p_user_id IS NOT NULL AND lower(p_user_id) <> v_user::text THEN
        RAISE EXCEPTION 'Identity does not match the signed-in user' USING ERRCODE = '42501';
      END IF;
      BEGIN
        v_comic := p_comic_id::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'p_comic_id is not a uuid: %', p_comic_id USING ERRCODE = '22P02';
      END;
      INSERT INTO public.comic_comments AS c (comic_id, user_id, content, parent_id)
      VALUES (v_comic, v_user, p_content, p_parent_id)
      RETURNING c.id INTO v_comment_id;
      RETURN v_comment_id;
    END;
    $body$
  $create$;
  REVOKE ALL ON FUNCTION public.add_comment(text,text,text,uuid) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.add_comment(text,text,text,uuid) TO authenticated, service_role;
END
$add_comment$;

-- get_comment_votes(uuid, text): anon, authenticated, service_role. Public counts; the caller's own vote from auth.uid()::text (comment_votes.user_id is text).
DO $get_comment_votes_user$
BEGIN
  IF to_regprocedure('public.get_comment_votes(uuid,text)') IS NULL THEN
    RAISE NOTICE 'Skipped: public.get_comment_votes(uuid,text) does not exist';
    RETURN;
  END IF;
  EXECUTE $create$
    CREATE OR REPLACE FUNCTION public.get_comment_votes(p_comment_id uuid, p_user_id text DEFAULT NULL::text)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
    AS $body$
    DECLARE
      v_user text := auth.uid()::text;
      v_upvotes integer;
      v_downvotes integer;
      v_user_vote integer;
    BEGIN
      IF v_user IS NOT NULL THEN
        IF p_user_id IS NOT NULL AND lower(p_user_id) <> v_user THEN
          RAISE EXCEPTION 'Identity does not match the signed-in user' USING ERRCODE = '42501';
        END IF;
      ELSIF auth.role() = 'service_role' THEN
        v_user := p_user_id;
      END IF;
      -- Visitors get the counts only; a supplied p_user_id is ignored.

      SELECT count(*) FILTER (WHERE cv.vote_type = 1),
             count(*) FILTER (WHERE cv.vote_type = -1)
      INTO v_upvotes, v_downvotes
      FROM public.comment_votes cv
      WHERE cv.comment_id = p_comment_id;

      IF v_user IS NOT NULL THEN
        SELECT cv.vote_type INTO v_user_vote
        FROM public.comment_votes cv
        WHERE cv.comment_id = p_comment_id AND cv.user_id = v_user;
      END IF;

      RETURN jsonb_build_object('upvotes', v_upvotes, 'downvotes', v_downvotes, 'user_vote', v_user_vote);
    END;
    $body$
  $create$;
  REVOKE ALL ON FUNCTION public.get_comment_votes(uuid,text) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.get_comment_votes(uuid,text) TO anon, authenticated, service_role;
END
$get_comment_votes_user$;

-- get_user_subscriptions(uuid): authenticated (own subscriptions only), service_role (named user). subscriptions IDs are text; creator fields from profiles_public.
DO $get_user_subscriptions_uuid$
BEGIN
  IF to_regprocedure('public.get_user_subscriptions(uuid)') IS NULL THEN
    RAISE NOTICE 'Skipped: public.get_user_subscriptions(uuid) does not exist';
    RETURN;
  END IF;
  EXECUTE $create$
    CREATE OR REPLACE FUNCTION public.get_user_subscriptions(p_subscriber_wallet uuid)
    RETURNS TABLE(id uuid, creator_id uuid, username text, avatar_url text, wallet_address text, created_at timestamp with time zone)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
    AS $body$
    DECLARE
      v_user uuid := auth.uid();
    BEGIN
      IF v_user IS NULL AND auth.role() = 'service_role' THEN
        v_user := p_subscriber_wallet;
      END IF;
      IF v_user IS NULL THEN
        RAISE EXCEPTION 'Signed-in user required' USING ERRCODE = '42501';
      END IF;
      IF p_subscriber_wallet IS NOT NULL AND p_subscriber_wallet <> v_user THEN
        RAISE EXCEPTION 'Identity does not match the signed-in user' USING ERRCODE = '42501';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_user) THEN
        RAISE EXCEPTION 'Subscriber not found with identifier: %', v_user;
      END IF;

      RETURN QUERY
      SELECT s.id, pp.id AS creator_id, pp.username, pp.avatar_url, pp.wallet_address, s.created_at
      FROM public.subscriptions s
      JOIN public.profiles_public pp ON s.creator_id = pp.id::text
      WHERE s.subscriber_id = v_user::text
      ORDER BY s.created_at DESC;
    END;
    $body$
  $create$;
  REVOKE ALL ON FUNCTION public.get_user_subscriptions(uuid) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.get_user_subscriptions(uuid) TO authenticated, service_role;
END
$get_user_subscriptions_uuid$;

-- get_user_subscriptions(text): authenticated (own rows only), service_role (named user). creator_subscriptions IDs are uuid.
DO $get_user_subscriptions_text$
BEGIN
  IF to_regprocedure('public.get_user_subscriptions(text)') IS NULL THEN
    RAISE NOTICE 'Skipped: public.get_user_subscriptions(text) does not exist';
    RETURN;
  END IF;
  EXECUTE $create$
    CREATE OR REPLACE FUNCTION public.get_user_subscriptions(p_user_id text)
    RETURNS SETOF public.creator_subscriptions
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
    AS $body$
    DECLARE
      v_user uuid := auth.uid();
    BEGIN
      IF v_user IS NULL AND auth.role() = 'service_role' AND p_user_id IS NOT NULL THEN
        BEGIN
          v_user := p_user_id::uuid;
        EXCEPTION WHEN invalid_text_representation THEN
          RAISE EXCEPTION 'p_user_id is not a uuid: %', p_user_id USING ERRCODE = '22P02';
        END;
      END IF;
      IF v_user IS NULL THEN
        RAISE EXCEPTION 'Signed-in user required' USING ERRCODE = '42501';
      END IF;
      IF p_user_id IS NOT NULL AND lower(p_user_id) <> v_user::text THEN
        RAISE EXCEPTION 'Identity does not match the signed-in user' USING ERRCODE = '42501';
      END IF;
      RETURN QUERY
      SELECT cs.* FROM public.creator_subscriptions cs
      WHERE cs.subscriber_id = v_user;
    END;
    $body$
  $create$;
  REVOKE ALL ON FUNCTION public.get_user_subscriptions(text) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.get_user_subscriptions(text) TO authenticated, service_role;
END
$get_user_subscriptions_text$;

-- is_subscribed(text, text): authenticated (own subscriptions only), service_role (named user). creator_subscriptions IDs are uuid.
DO $is_subscribed_text$
BEGIN
  IF to_regprocedure('public.is_subscribed(text,text)') IS NULL THEN
    RAISE NOTICE 'Skipped: public.is_subscribed(text,text) does not exist';
    RETURN;
  END IF;
  EXECUTE $create$
    CREATE OR REPLACE FUNCTION public.is_subscribed(p_subscriber_id text, p_creator_id text)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
    AS $body$
    DECLARE
      v_user uuid := auth.uid();
      v_creator uuid;
    BEGIN
      IF v_user IS NULL AND auth.role() = 'service_role' AND p_subscriber_id IS NOT NULL THEN
        BEGIN
          v_user := p_subscriber_id::uuid;
        EXCEPTION WHEN invalid_text_representation THEN
          RAISE EXCEPTION 'p_subscriber_id is not a uuid: %', p_subscriber_id USING ERRCODE = '22P02';
        END;
      END IF;
      IF v_user IS NULL THEN
        RAISE EXCEPTION 'Signed-in user required' USING ERRCODE = '42501';
      END IF;
      IF p_subscriber_id IS NOT NULL AND lower(p_subscriber_id) <> v_user::text THEN
        RAISE EXCEPTION 'Identity does not match the signed-in user' USING ERRCODE = '42501';
      END IF;
      BEGIN
        v_creator := p_creator_id::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'p_creator_id is not a uuid: %', p_creator_id USING ERRCODE = '22P02';
      END;
      RETURN EXISTS (
        SELECT 1 FROM public.creator_subscriptions cs
        WHERE cs.subscriber_id = v_user AND cs.creator_id = v_creator);
    END;
    $body$
  $create$;
  REVOKE ALL ON FUNCTION public.is_subscribed(text,text) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.is_subscribed(text,text) TO authenticated, service_role;
END
$is_subscribed_text$;

-- is_subscribed(uuid, uuid): authenticated (own subscriptions only), service_role (named user). subscriptions IDs are text.
DO $is_subscribed_uuid$
BEGIN
  IF to_regprocedure('public.is_subscribed(uuid,uuid)') IS NULL THEN
    RAISE NOTICE 'Skipped: public.is_subscribed(uuid,uuid) does not exist';
    RETURN;
  END IF;
  EXECUTE $create$
    CREATE OR REPLACE FUNCTION public.is_subscribed(p_subscriber_wallet uuid, p_creator_wallet uuid)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
    AS $body$
    DECLARE
      v_user uuid := auth.uid();
    BEGIN
      IF v_user IS NULL AND auth.role() = 'service_role' THEN
        v_user := p_subscriber_wallet;
      END IF;
      IF v_user IS NULL THEN
        RAISE EXCEPTION 'Signed-in user required' USING ERRCODE = '42501';
      END IF;
      IF p_subscriber_wallet IS NOT NULL AND p_subscriber_wallet <> v_user THEN
        RAISE EXCEPTION 'Identity does not match the signed-in user' USING ERRCODE = '42501';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_user) THEN
        RAISE EXCEPTION 'Subscriber not found with identifier: %', v_user;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_creator_wallet) THEN
        RAISE EXCEPTION 'Creator not found with identifier: %', p_creator_wallet;
      END IF;

      RETURN EXISTS (
        SELECT 1 FROM public.subscriptions s
        WHERE s.subscriber_id = v_user::text
          AND s.creator_id = p_creator_wallet::text);
    END;
    $body$
  $create$;
  REVOKE ALL ON FUNCTION public.is_subscribed(uuid,uuid) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.is_subscribed(uuid,uuid) TO authenticated, service_role;
END
$is_subscribed_uuid$;

-- get_user_id_from_identifier: service_role only. Matches a user id or a username; never any other column.
DO $get_user_id_from_identifier$
BEGIN
  IF to_regprocedure('public.get_user_id_from_identifier(text)') IS NULL THEN
    RAISE NOTICE 'Skipped: public.get_user_id_from_identifier(text) does not exist';
    RETURN;
  END IF;
  EXECUTE $create$
    CREATE OR REPLACE FUNCTION public.get_user_id_from_identifier(p_identifier text)
    RETURNS uuid
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
    AS $body$
    DECLARE
      v_id uuid;
    BEGIN
      IF p_identifier ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        SELECT pp.id INTO v_id FROM public.profiles_public pp WHERE pp.id::text = p_identifier;
        IF FOUND THEN
          RETURN v_id;
        END IF;
      END IF;

      SELECT pp.id INTO v_id FROM public.profiles_public pp WHERE pp.username = p_identifier;
      RETURN v_id;
    END;
    $body$
  $create$;
  REVOKE ALL ON FUNCTION public.get_user_id_from_identifier(text) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.get_user_id_from_identifier(text) TO service_role;
END
$get_user_id_from_identifier$;

-- get_canvas_snapshot: authenticated, own snapshots only. SECURITY INVOKER, as in secure_canvas_history.sql, plus an auth.uid() filter.
DO $get_canvas_snapshot$
BEGIN
  IF to_regprocedure('public.get_canvas_snapshot(uuid)') IS NULL THEN
    RAISE NOTICE 'Skipped: public.get_canvas_snapshot(uuid) does not exist';
    RETURN;
  END IF;
  EXECUTE $create$
    CREATE OR REPLACE FUNCTION public.get_canvas_snapshot(p_snapshot_id uuid)
    RETURNS TABLE(id uuid, project_id text, snapshot_type text, description text, canvas_state jsonb, voice_event_id text, conversation_id text, voice_context text, created_at timestamp with time zone)
    LANGUAGE plpgsql
    SECURITY INVOKER
    SET search_path = ''
    AS $body$
    BEGIN
      RETURN QUERY
      SELECT s.id, s.project_id, s.snapshot_type, s.description, s.canvas_state,
             s.voice_event_id, s.conversation_id, s.voice_context, s.created_at
      FROM public.canvas_history_snapshots s
      WHERE s.id = p_snapshot_id
        AND s.user_id = (SELECT auth.uid());
    END;
    $body$
  $create$;
  REVOKE ALL ON FUNCTION public.get_canvas_snapshot(uuid) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.get_canvas_snapshot(uuid) TO authenticated;
END
$get_canvas_snapshot$;

-- get_canvas_timeline: authenticated, own events only. SECURITY INVOKER, as in secure_canvas_history.sql, plus an auth.uid() filter.
DO $get_canvas_timeline$
BEGIN
  IF to_regprocedure('public.get_canvas_timeline(text,integer)') IS NULL THEN
    RAISE NOTICE 'Skipped: public.get_canvas_timeline(text,integer) does not exist';
    RETURN;
  END IF;
  EXECUTE $create$
    CREATE OR REPLACE FUNCTION public.get_canvas_timeline(p_project_id text, p_limit integer DEFAULT 100)
    RETURNS TABLE(id uuid, type text, event_type text, description text, voice_event_id text, conversation_id text, voice_transcript text, snapshot_id uuid, created_at timestamp with time zone, has_snapshot boolean)
    LANGUAGE plpgsql
    SECURITY INVOKER
    SET search_path = ''
    AS $body$
    BEGIN
      RETURN QUERY
      SELECT e.id, 'event'::text AS type, e.event_type, e.event_description AS description,
             e.voice_event_id, e.conversation_id, e.voice_transcript, e.snapshot_id,
             e.created_at, (e.snapshot_id IS NOT NULL) AS has_snapshot
      FROM public.canvas_history_events e
      WHERE e.project_id = p_project_id
        AND e.user_id = (SELECT auth.uid())
      ORDER BY e.created_at DESC
      LIMIT greatest(1, least(coalesce(p_limit, 100), 200));
    END;
    $body$
  $create$;
  REVOKE ALL ON FUNCTION public.get_canvas_timeline(text,integer) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.get_canvas_timeline(text,integer) TO authenticated;
END
$get_canvas_timeline$;

-- update_canvas_snapshot_thumbnail: authenticated, own snapshots only. SECURITY INVOKER, as in secure_canvas_history.sql, plus an auth.uid() filter.
DO $update_canvas_snapshot_thumbnail$
BEGIN
  IF to_regprocedure('public.update_canvas_snapshot_thumbnail(uuid,text)') IS NULL THEN
    RAISE NOTICE 'Skipped: public.update_canvas_snapshot_thumbnail(uuid,text) does not exist';
    RETURN;
  END IF;
  EXECUTE $create$
    CREATE OR REPLACE FUNCTION public.update_canvas_snapshot_thumbnail(p_snapshot_id uuid, p_thumbnail_url text)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY INVOKER
    SET search_path = ''
    AS $body$
    BEGIN
      UPDATE public.canvas_history_snapshots s
      SET canvas_state = s.canvas_state || jsonb_build_object('thumbnail', p_thumbnail_url)
      WHERE s.id = p_snapshot_id
        AND s.user_id = (SELECT auth.uid());
      RETURN FOUND;
    END;
    $body$
  $create$;
  REVOKE ALL ON FUNCTION public.update_canvas_snapshot_thumbnail(uuid,text) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.update_canvas_snapshot_thumbnail(uuid,text) TO authenticated;
END
$update_canvas_snapshot_thumbnail$;

-- handle_new_user: no caller. Trigger that creates the profiles row for a new auth.users row. Body as exported; search_path pinned.
DO $handle_new_user$
BEGIN
  IF to_regprocedure('public.handle_new_user()') IS NULL THEN
    RAISE NOTICE 'Skipped: public.handle_new_user() does not exist';
    RETURN;
  END IF;
  EXECUTE $create$
    CREATE OR REPLACE FUNCTION public.handle_new_user()
     RETURNS trigger
     LANGUAGE plpgsql
     SECURITY DEFINER
     SET search_path = ''
    AS $body$
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
    $body$
  $create$;
  REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
END
$handle_new_user$;

-- handle_updated_at: no caller. Trigger that sets updated_at. Body as exported; search_path pinned.
DO $handle_updated_at$
BEGIN
  IF to_regprocedure('public.handle_updated_at()') IS NULL THEN
    RAISE NOTICE 'Skipped: public.handle_updated_at() does not exist';
    RETURN;
  END IF;
  EXECUTE $create$
    CREATE OR REPLACE FUNCTION public.handle_updated_at()
     RETURNS trigger
     LANGUAGE plpgsql
     SECURITY DEFINER
     SET search_path = ''
    AS $body$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $body$
  $create$;
  REVOKE ALL ON FUNCTION public.handle_updated_at() FROM PUBLIC, anon, authenticated;
END
$handle_updated_at$;

-- notify_waitlist_signup: no caller. Trigger that sends a waitlist notification. Body as exported; search_path pinned.
DO $notify_waitlist_signup$
BEGIN
  IF to_regprocedure('public.notify_waitlist_signup()') IS NULL THEN
    RAISE NOTICE 'Skipped: public.notify_waitlist_signup() does not exist';
    RETURN;
  END IF;
  EXECUTE $create$
    CREATE OR REPLACE FUNCTION public.notify_waitlist_signup()
     RETURNS trigger
     LANGUAGE plpgsql
     SECURITY DEFINER
     SET search_path = ''
    AS $body$
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
    $body$
  $create$;
  REVOKE ALL ON FUNCTION public.notify_waitlist_signup() FROM PUBLIC, anon, authenticated;
END
$notify_waitlist_signup$;

-- set_bookmark_user_id: no caller. Trigger that fills user_id from auth.uid(). Body as exported; search_path pinned.
DO $set_bookmark_user_id$
BEGIN
  IF to_regprocedure('public.set_bookmark_user_id()') IS NULL THEN
    RAISE NOTICE 'Skipped: public.set_bookmark_user_id() does not exist';
    RETURN;
  END IF;
  EXECUTE $create$
    CREATE OR REPLACE FUNCTION public.set_bookmark_user_id()
     RETURNS trigger
     LANGUAGE plpgsql
     SECURITY DEFINER
     SET search_path = ''
    AS $body$
    BEGIN
      -- Ensure user_id is set from auth context if not provided
      IF NEW.user_id IS NULL THEN
        NEW.user_id = auth.uid()::text;
      END IF;
      
      RETURN NEW;
    END;
    $body$
  $create$;
  REVOKE ALL ON FUNCTION public.set_bookmark_user_id() FROM PUBLIC, anon, authenticated;
END
$set_bookmark_user_id$;

-- trigger_collaboration_event: no caller. Trigger that sends a collaboration notification. Body as exported; search_path pinned.
DO $trigger_collaboration_event$
BEGIN
  IF to_regprocedure('public.trigger_collaboration_event()') IS NULL THEN
    RAISE NOTICE 'Skipped: public.trigger_collaboration_event() does not exist';
    RETURN;
  END IF;
  EXECUTE $create$
    CREATE OR REPLACE FUNCTION public.trigger_collaboration_event()
     RETURNS trigger
     LANGUAGE plpgsql
     SECURITY DEFINER
     SET search_path = ''
    AS $body$
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
    $body$
  $create$;
  REVOKE ALL ON FUNCTION public.trigger_collaboration_event() FROM PUBLIC, anon, authenticated;
END
$trigger_collaboration_event$;

-- update_modified_column: no caller. Trigger that sets last_modified. Body as exported; search_path pinned.
DO $update_modified_column$
BEGIN
  IF to_regprocedure('public.update_modified_column()') IS NULL THEN
    RAISE NOTICE 'Skipped: public.update_modified_column() does not exist';
    RETURN;
  END IF;
  EXECUTE $create$
    CREATE OR REPLACE FUNCTION public.update_modified_column()
     RETURNS trigger
     LANGUAGE plpgsql
     SECURITY DEFINER
     SET search_path = ''
    AS $body$
    BEGIN
      NEW.last_modified = now();
      RETURN NEW;
    END;
    $body$
  $create$;
  REVOKE ALL ON FUNCTION public.update_modified_column() FROM PUBLIC, anon, authenticated;
END
$update_modified_column$;

-- update_updated_at_column: no caller. Trigger that sets updated_at. Body as exported; search_path pinned.
DO $update_updated_at_column$
BEGIN
  IF to_regprocedure('public.update_updated_at_column()') IS NULL THEN
    RAISE NOTICE 'Skipped: public.update_updated_at_column() does not exist';
    RETURN;
  END IF;
  EXECUTE $create$
    CREATE OR REPLACE FUNCTION public.update_updated_at_column()
     RETURNS trigger
     LANGUAGE plpgsql
     SECURITY DEFINER
     SET search_path = ''
    AS $body$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $body$
  $create$;
  REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
END
$update_updated_at_column$;

-- 2. Public reads. Bodies are not changed; they already use schema-qualified
-- names. search_path is pinned and EXECUTE goes to the client roles directly.
DO $public_reads$
DECLARE
  sig text;
  fn regprocedure;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    -- anon, authenticated, service_role. Comments of one comic, no profile data.
    'public.get_comments_for_comic(text)',
    -- anon, authenticated, service_role. Vote counts of one comment.
    'public.get_comment_votes(uuid)',
    -- anon, authenticated, service_role. Comic id for a draft id.
    'public.get_comic_id_from_draft_id(text)',
    -- anon, authenticated, service_role. View counter; see the abuse note in the doc.
    'public.increment_comic_views(text)'
  ]
  LOOP
    fn := to_regprocedure(sig);
    IF fn IS NULL THEN
      RAISE NOTICE 'Skipped: % does not exist', sig;
      CONTINUE;
    END IF;
    EXECUTE format('ALTER FUNCTION %s SET search_path = %L', fn, '');
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated, service_role', fn);
  END LOOP;
END
$public_reads$;

-- 3. Admin and cleanup helpers, and routines whose tables do not exist.
-- Bodies are not changed. service_role only.
DO $service_only$
DECLARE
  sig text;
  fn regprocedure;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    -- service_role only. Deletes canvas events with caller-chosen retention.
    'public.cleanup_old_events(integer)',
    -- service_role only. Deletes canvas snapshots with caller-chosen retention.
    'public.cleanup_old_snapshots(text,integer,integer)',
    -- service_role only. Storage counts for any project.
    'public.get_project_storage_stats(text)',
    -- service_role only. Server version string.
    'public.get_pg_version()',
    -- service_role only. Sets app.current_user_id, which two live policies trust.
    'public.set_current_user_id(text)',
    -- service_role only. Checks auth.role() itself; the grant is a second layer.
    'public.setup_collaboration_tables()',
    -- service_role only. Reads public.bookmarks, which does not exist live.
    'public.get_user_bookmarks(uuid)',
    -- service_role only. Reads public.likes, which does not exist live.
    'public.get_user_likes(uuid)',
    -- service_role only. Reads public.bookmarks, which does not exist live.
    'public.is_comic_bookmarked(uuid,text)',
    -- service_role only. Reads public.likes, which does not exist live.
    'public.is_comic_liked(uuid,text)'
  ]
  LOOP
    fn := to_regprocedure(sig);
    IF fn IS NULL THEN
      RAISE NOTICE 'Skipped: % does not exist', sig;
      CONTINUE;
    END IF;
    EXECUTE format('ALTER FUNCTION %s SET search_path = %L', fn, '');
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END
$service_only$;

-- 4. SECURITY INVOKER trigger helpers that clients could call directly.
-- Bodies are not changed; they use only pg_column_size and now(). A trigger
-- runs without an EXECUTE check, so they keep working as triggers.
DO $invoker$
DECLARE
  sig text;
  fn regprocedure;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    -- No client caller. Trigger helper for canvas_history_snapshots.
    'public.calculate_snapshot_size()',
    -- No client caller. Trigger for hon_evi_sessions.
    'public.update_hon_evi_sessions_updated_at()'
  ]
  LOOP
    fn := to_regprocedure(sig);
    IF fn IS NULL THEN
      RAISE NOTICE 'Skipped: % does not exist', sig;
      CONTINUE;
    END IF;
    EXECUTE format('ALTER FUNCTION %s SET search_path = %L', fn, '');
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
  END LOOP;
END
$invoker$;

-- 5. profiles_new and comics_new. The two policies that trusted the
-- caller-chosen app.current_user_id become owner policies on auth.uid().
-- profiles_new holds email, preferences and subscription data, so clients
-- read other users' public columns through profiles_new_public.
-- The published-comics policy on comics_new is kept as it is.
DROP POLICY IF EXISTS "Users can manage their own profile" ON public.profiles_new;
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles_new;
DROP POLICY IF EXISTS "Users can manage their own comics" ON public.comics_new;

-- For a signed-in user reading and writing their own profiles_new row.
DROP POLICY IF EXISTS profiles_new_owner ON public.profiles_new;
CREATE POLICY profiles_new_owner ON public.profiles_new
  FOR ALL TO authenticated
  USING (id = (SELECT auth.uid())::text)
  WITH CHECK (id = (SELECT auth.uid())::text);

-- For a signed-in user managing their own comics_new rows.
DROP POLICY IF EXISTS comics_new_owner ON public.comics_new;
CREATE POLICY comics_new_owner ON public.comics_new
  FOR ALL TO authenticated
  USING (creator_id = (SELECT auth.uid())::text)
  WITH CHECK (creator_id = (SELECT auth.uid())::text);

-- profiles_new: none of the seven table privileges for anon (a table-level
-- REVOKE also removes column grants); exactly SELECT, INSERT, UPDATE and
-- DELETE for authenticated, limited to its own row by profiles_new_owner.
-- service_role keeps its grants (all seven live); they are not changed.
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.profiles_new FROM PUBLIC, anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.profiles_new FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles_new TO authenticated;

-- Public profiles_new columns for visitors and signed-in users. Owner rights
-- on purpose, as for profiles_public: the table policies are owner-only.
-- Never add email, preferences, subscription_tier, subscription_status or
-- subscription_expiry. Clients get SELECT only.
CREATE OR REPLACE VIEW public.profiles_new_public
  WITH (security_invoker = false, security_barrier = true)
AS
SELECT
  p.id,
  p.username,
  p.display_name,
  p.first_name,
  p.last_name,
  p.avatar_url,
  p.bio,
  p.wallet_address,
  p.solana_wallet,
  p.social_links,
  p.is_verified,
  p.is_creator,
  p.created_at
FROM public.profiles_new AS p;
REVOKE ALL ON public.profiles_new_public FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.profiles_new_public TO anon, authenticated, service_role;
COMMENT ON VIEW public.profiles_new_public IS
  'Public profiles_new columns. Owner rights on purpose; see docs/RPC_HARDENING.md.';

-- save_canvas_event and create_canvas_snapshot are left as
-- secure_canvas_history.sql defines them (auth.uid() check, authenticated only).

-- 6. Self-check. Any failure aborts the transaction and nothing above is kept.
-- It covers every routine in public, not only those above. Routines that
-- belong to an extension are not checked.
-- self-check:start
DO $self_check$
DECLARE
  routines oid[];
  callable oid[];
  public_reads oid[];
  bad text;
BEGIN
  routines := ARRAY(
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind IN ('f', 'p')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d
                      WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'));
  -- Trigger functions cannot be called as RPCs.
  callable := ARRAY(
    SELECT p.oid FROM pg_proc p
    WHERE p.oid = ANY (routines)
      AND p.prorettype NOT IN ('trigger'::regtype, 'event_trigger'::regtype));
  -- Public reads that need no caller identity.
  public_reads := ARRAY(
    SELECT r::oid
    FROM unnest(ARRAY[to_regprocedure('public.get_comments_for_comic(text)'),
                      to_regprocedure('public.get_comment_votes(uuid)'),
                      to_regprocedure('public.get_comic_id_from_draft_id(text)'),
                      to_regprocedure('public.increment_comic_views(text)'),
                      to_regprocedure('public.subscriber_count(text)')]) AS r
    WHERE r IS NOT NULL);

  -- Every SECURITY DEFINER routine, triggers included, has search_path = ''.
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO bad
  FROM pg_proc p
  WHERE p.oid = ANY (routines)
    AND p.prosecdef
    AND NOT coalesce('search_path=""' = ANY (p.proconfig), false);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'SECURITY DEFINER function without search_path = '''': %', bad;
  END IF;

  -- No SECURITY DEFINER routine is executable by PUBLIC. A NULL ACL is the
  -- default, which grants EXECUTE to PUBLIC.
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO bad
  FROM pg_proc p
  WHERE p.oid = ANY (routines)
    AND p.prosecdef
    AND EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'SECURITY DEFINER function executable by PUBLIC: %', bad;
  END IF;

  -- No callable SECURITY DEFINER routine names a private profile column, in
  -- its body or in its result.
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO bad
  FROM pg_proc p
  WHERE p.oid = ANY (callable)
    AND p.prosecdef
    AND pg_get_functiondef(p.oid)
        ~* '\m(email|discord_id|twitter_id|google_id|notification_preferences|privy_user_id|wallet_id|preferences|subscription_tier|subscription_status|subscription_expiry)\M';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'SECURITY DEFINER function references a private profile column: %', bad;
  END IF;

  -- No callable SECURITY DEFINER routine reads the profiles or profiles_new
  -- table. A row or JSON built from a table carries the private columns
  -- without naming them. profiles_public and profiles_new_public do not match.
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO bad
  FROM pg_proc p
  WHERE p.oid = ANY (callable)
    AND p.prosecdef
    AND pg_get_functiondef(p.oid) ~* '\m(profiles|profiles_new)\M';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'SECURITY DEFINER function reads public.profiles directly: %', bad;
  END IF;

  -- Every routine that anon or authenticated can execute refers to
  -- auth.uid(), except the public reads. This covers the canvas history
  -- routines and trigger functions as well.
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO bad
  FROM pg_proc p
  WHERE p.oid = ANY (routines)
    AND (has_function_privilege('anon', p.oid, 'EXECUTE')
         OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
    AND pg_get_functiondef(p.oid) !~ 'auth\.uid\(\)'
    AND NOT p.oid = ANY (public_reads);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Client-executable function without an auth.uid() reference: %', bad;
  END IF;

  -- anon may execute a SECURITY DEFINER routine only when it is a public read
  -- or get_comment_votes(uuid, text), which returns counts to visitors.
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO bad
  FROM pg_proc p
  WHERE p.oid = ANY (routines)
    AND p.prosecdef
    AND has_function_privilege('anon', p.oid, 'EXECUTE')
    AND NOT p.oid = ANY (public_reads)
    AND p.oid IS DISTINCT FROM to_regprocedure('public.get_comment_votes(uuid,text)')::oid;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'anon can execute a SECURITY DEFINER function that is not a public read: %', bad;
  END IF;
  -- profiles_new: anon holds none of the seven privileges (on the table or a
  -- column); authenticated holds no TRUNCATE, REFERENCES or TRIGGER; every
  -- policy is for authenticated and names auth.uid() in USING and in WITH
  -- CHECK; no policy on profiles_new or comics_new trusts app.current_user_id.
  SELECT string_agg(v.priv, ', ') INTO bad
  FROM (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) AS v(priv)
  WHERE has_any_column_privilege('anon', 'public.profiles_new', v.priv);
  SELECT concat_ws(', ', bad, string_agg(v.priv, ', ')) INTO bad
  FROM (VALUES ('DELETE'), ('TRUNCATE'), ('TRIGGER')) AS v(priv)
  WHERE has_table_privilege('anon', 'public.profiles_new', v.priv);
  IF bad <> '' THEN
    RAISE EXCEPTION 'anon holds privileges on public.profiles_new: %', bad;
  END IF;
  SELECT string_agg(v.priv, ', ') INTO bad
  FROM (VALUES ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS v(priv)
  WHERE CASE WHEN v.priv = 'REFERENCES'
             THEN has_any_column_privilege('authenticated', 'public.profiles_new', v.priv)
             ELSE has_table_privilege('authenticated', 'public.profiles_new', v.priv) END;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'authenticated holds a privilege beyond SELECT, INSERT, UPDATE, DELETE on public.profiles_new: %', bad;
  END IF;
  SELECT string_agg(format('%s "%s"', tablename, policyname), ', ') INTO bad
  FROM pg_policies
  WHERE schemaname = 'public'
    AND ((tablename = 'profiles_new'
          AND (roles <> ARRAY['authenticated']::name[]
               OR (cmd <> 'INSERT' AND coalesce(qual, '') NOT LIKE '%auth.uid()%')
               OR (cmd IN ('INSERT', 'UPDATE', 'ALL')
                   AND coalesce(with_check, qual, '') NOT LIKE '%auth.uid()%')))
         OR (tablename IN ('profiles_new', 'comics_new')
             AND concat_ws(' ', qual, with_check) ~ 'app\.current_user_id'));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Open or setting-based policy on profiles_new or comics_new: %', bad;
  END IF;

  -- profiles_new_public lists no private column, runs with owner rights
  -- whose owner reads every row, and is read-only for clients.
  SELECT string_agg(column_name::text, ', ') INTO bad
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'profiles_new_public'
    AND column_name IN ('email', 'preferences', 'subscription_tier', 'subscription_status',
                        'subscription_expiry');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'profiles_new_public exposes a private column: %', bad;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class v
    JOIN pg_class t ON t.oid = 'public.profiles_new'::regclass
    JOIN pg_roles r ON r.oid = v.relowner
    WHERE v.oid = to_regclass('public.profiles_new_public')
      AND v.relkind = 'v'
      AND NOT coalesce('security_invoker=true' = ANY (v.reloptions), false)
      AND NOT coalesce('security_invoker=on' = ANY (v.reloptions), false)
      AND NOT t.relforcerowsecurity
      AND (v.relowner = t.relowner OR r.rolbypassrls OR r.rolsuper)
  ) THEN
    RAISE EXCEPTION 'profiles_new_public must be a view with owner rights whose owner can read every profiles_new row';
  END IF;
  SELECT string_agg(v.who || ' ' || v.priv, ', ') INTO bad
  FROM (VALUES ('anon', 'INSERT'), ('anon', 'UPDATE'), ('anon', 'DELETE'),
               ('authenticated', 'INSERT'), ('authenticated', 'UPDATE'), ('authenticated', 'DELETE')) AS v(who, priv)
  WHERE has_table_privilege(v.who, 'public.profiles_new_public', v.priv);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Client role can write through profiles_new_public: %', bad;
  END IF;
END
$self_check$;
-- self-check:end

COMMIT;

