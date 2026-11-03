-- EMERGENCY USE ONLY. Undoes migrations/harden_rpc_exposure.sql.
-- See docs/RPC_HARDENING.md before running it.
--
-- It puts back the live state that the owner exported:
--   * the 26 non-trigger routines, the 7 trigger functions and the 2
--     SECURITY INVOKER trigger helpers, recreated verbatim from their live
--     definitions (pg_get_functiondef), including SECURITY DEFINER and the
--     live SET search_path, with EXECUTE for PUBLIC, anon, authenticated and
--     service_role (live ACL {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres});
--   * the three live policies on profiles_new and comics_new that the
--     migration replaced, by exact name and definition; the two owner
--     policies and the view profiles_new_public are dropped;
--   * SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER on
--     profiles_new for anon and authenticated, granted by name: the seven
--     privileges each role holds live (verified metadata). service_role is
--     not touched.
-- This includes the canvas history routines, so it also undoes the routine
-- part of migrations/secure_canvas_history.sql (not its table policies).
-- After this file, the routines again let any caller act as any user,
-- delete canvas history, set app.current_user_id or look up a user by email,
-- and anyone can read every profiles_new row with its email.
-- It creates, empties and drops no table and changes no trigger. Two
-- restored bodies (cleanup_old_events, cleanup_old_snapshots) contain DELETE
-- statements, as live.
-- Each routine step runs only when the routine exists with the exact live
-- signature. Before any change the file checks that each routine, the
-- policies and the profiles_new table grants are in the state the migration
-- leaves (or already rolled back), and aborts on any difference.
BEGIN;

-- 0. No drift. Raises before anything changes.
DO $preconditions$
DECLARE
  bad text;
BEGIN
  -- Each routine has the definition (md5 of pg_get_functiondef) and ACL
  -- (same entries, any order) that the migration leaves, or the exported
  -- live one. The values are generated from the owner's exports.
  WITH expected (sig, md5, acl) AS (VALUES
    ('add_comment(text,text,text,uuid)', 'f0d321818b17b48201b792001b89ddf0', '{service_role=X/postgres,postgres=X/postgres,authenticated=X/postgres}'),
    ('add_comment(text,text,text,uuid)', '923b74d87dd1919c53b161b7ae78226d', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('calculate_snapshot_size()', 'c27858415dfee56c378c11adefa1f8bc', '{service_role=X/postgres,postgres=X/postgres}'),
    ('calculate_snapshot_size()', 'ccc874f094a4cf446d66b8669c6f4dc7', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('cleanup_old_events(integer)', '591dc75181972ac8965d96ec990ba57c', '{service_role=X/postgres,postgres=X/postgres}'),
    ('cleanup_old_events(integer)', '4259eef44d87181b8cf26c949f227f6e', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('cleanup_old_snapshots(text,integer,integer)', '721b249c09e4f1f09a9ff34ef2514076', '{service_role=X/postgres,postgres=X/postgres}'),
    ('cleanup_old_snapshots(text,integer,integer)', 'e490d7d72e2d80daaf4c0e01469b15c3', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('create_canvas_snapshot(text,text,jsonb,uuid,text,text,text,text,text)', '9e1463c81b7ae1b311d95dbbbf807cfe', '{service_role=X/postgres,postgres=X/postgres,authenticated=X/postgres}'),
    ('create_canvas_snapshot(text,text,jsonb,uuid,text,text,text,text,text)', 'a6bcadbce428d1d8be00c7672a603ba4', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('get_canvas_snapshot(uuid)', 'de862a255997c2e1bf31e8a95cd4b347', '{service_role=X/postgres,postgres=X/postgres,authenticated=X/postgres}'),
    ('get_canvas_snapshot(uuid)', '252b70f0b5099e392663f8426694755a', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('get_canvas_timeline(text,integer)', '0dd24a8ada8192a08af776e804c126e1', '{service_role=X/postgres,postgres=X/postgres,authenticated=X/postgres}'),
    ('get_canvas_timeline(text,integer)', '5aa636bb857d468d6c9fbb04534bcbdc', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('get_comic_id_from_draft_id(text)', 'd6af65a7f139a83f7b0483f22eb08ce2', '{service_role=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}'),
    ('get_comic_id_from_draft_id(text)', '9ad9af9ef0a9974215b231ad5d134a93', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('get_comment_votes(uuid)', '701462d5338de696c503915db42294ea', '{service_role=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}'),
    ('get_comment_votes(uuid)', '0b547e793100a6898dd14601b234f2e6', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('get_comment_votes(uuid,text)', '6ce2b38c4ac4392ec7208d18ce82bbb1', '{service_role=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}'),
    ('get_comment_votes(uuid,text)', '3c1cc722e7d960e7da85283071bac6c4', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('get_comments_for_comic(text)', '6010e8ef332dd30a0beda28e64cada66', '{service_role=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}'),
    ('get_comments_for_comic(text)', '1970731fc4f0b587694f670b46223750', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('get_pg_version()', 'f73370401fb69381aea25ec1005ee5da', '{service_role=X/postgres,postgres=X/postgres}'),
    ('get_pg_version()', '2a3050097c7d148d9686cb75e3d51d62', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('get_project_storage_stats(text)', '682e046da5125a091d030ef207d6e29f', '{service_role=X/postgres,postgres=X/postgres}'),
    ('get_project_storage_stats(text)', 'e1e3fd00af2dc8343a3335867cf5a0b3', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('get_user_bookmarks(uuid)', '589721cb77cf6d74bfbbe0315f91639d', '{service_role=X/postgres,postgres=X/postgres}'),
    ('get_user_bookmarks(uuid)', 'e58c48404185ec6ec93b0f6130b64368', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('get_user_id_from_identifier(text)', '3a604b0302feea54c908cc27e653227f', '{service_role=X/postgres,postgres=X/postgres}'),
    ('get_user_id_from_identifier(text)', '60a295e2421f92a18bba8dc2fdc52c9c', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('get_user_likes(uuid)', 'fe2c612f408616faf31a09f95f6d3612', '{service_role=X/postgres,postgres=X/postgres}'),
    ('get_user_likes(uuid)', '1d12797985221776f3c2be39b91b7fe0', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('get_user_subscriptions(text)', '65f750eeddc50839a4e5d598371576e9', '{service_role=X/postgres,postgres=X/postgres,authenticated=X/postgres}'),
    ('get_user_subscriptions(text)', 'fd20f8409ce7669d8f8fbfa3a2656b6e', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('get_user_subscriptions(uuid)', 'd24bf540d95795792ab42a6c65053a15', '{service_role=X/postgres,postgres=X/postgres,authenticated=X/postgres}'),
    ('get_user_subscriptions(uuid)', '1d667e0fef516fd0fcfeaf75690765a2', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('handle_new_user()', 'a2494c63cb9acfbed0d03754972dfaa0', '{service_role=X/postgres,postgres=X/postgres}'),
    ('handle_new_user()', '51489d63fc1f5f7a386f26cea47a87f1', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('handle_updated_at()', '74f8cd1bec6f02721dae98c7d4ae8793', '{service_role=X/postgres,postgres=X/postgres}'),
    ('handle_updated_at()', 'a4d81ad1e8210e2cf54ce1bb0b703b88', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('increment_comic_views(text)', 'f832cf0b31a86b95c7dcd1301b3040a7', '{service_role=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}'),
    ('increment_comic_views(text)', 'd140d5999f74d927ce5ece0818c6e9af', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('is_comic_bookmarked(uuid,text)', 'eca84290742cf93968fa9b5415d5d482', '{service_role=X/postgres,postgres=X/postgres}'),
    ('is_comic_bookmarked(uuid,text)', 'dc2cc478549c3afe3e4fa76fe58af69c', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('is_comic_liked(uuid,text)', '65e317bf5e436682e6847578be3ff190', '{service_role=X/postgres,postgres=X/postgres}'),
    ('is_comic_liked(uuid,text)', '37c3fedf3a444fdc7ede387fd39e616b', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('is_subscribed(text,text)', '0758f8426ea4b4542d47299a9c40a5f3', '{service_role=X/postgres,postgres=X/postgres,authenticated=X/postgres}'),
    ('is_subscribed(text,text)', 'a4256ccddd30ac83c088cc53ef8d268b', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('is_subscribed(uuid,uuid)', '82ba67dba6d17e81fd78b2769f6d8823', '{service_role=X/postgres,postgres=X/postgres,authenticated=X/postgres}'),
    ('is_subscribed(uuid,uuid)', '53053cbd48174798a24e55b01ae8ff00', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('notify_waitlist_signup()', '5dc297ffecbec5fb35979749825af39d', '{service_role=X/postgres,postgres=X/postgres}'),
    ('notify_waitlist_signup()', 'bb0ff65a0205445007a951c62bc3ed29', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('save_canvas_event(text,text,uuid,text,text,text,text,text,jsonb,uuid)', 'babef22092cdf3ff25a6e4484bff0952', '{service_role=X/postgres,postgres=X/postgres,authenticated=X/postgres}'),
    ('save_canvas_event(text,text,uuid,text,text,text,text,text,jsonb,uuid)', 'df9d9ed43bbf9eb7591081f17c147187', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('set_bookmark_user_id()', '3324430cf9903183ef10a6058d96f5e4', '{service_role=X/postgres,postgres=X/postgres}'),
    ('set_bookmark_user_id()', 'c5aea35331df2cf6a633999a031352b1', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('set_current_user_id(text)', '54c113decc94b4773b41a4b80328f93d', '{service_role=X/postgres,postgres=X/postgres}'),
    ('set_current_user_id(text)', 'a3c5f5122f62805621b270601e0aa95f', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('setup_collaboration_tables()', '222d9a8ddfd78a5ac9b981e422c4a9ed', '{service_role=X/postgres,postgres=X/postgres}'),
    ('setup_collaboration_tables()', 'c67e30a4e65a79d48be8d948f4e94246', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('trigger_collaboration_event()', '1e1ade9a5758720966a718fe001549c8', '{service_role=X/postgres,postgres=X/postgres}'),
    ('trigger_collaboration_event()', 'b19f3142a3e2f12ce4356a9a002b3ec6', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('update_canvas_snapshot_thumbnail(uuid,text)', 'bec3fac821fd0d8076f18bd751ddd48d', '{service_role=X/postgres,postgres=X/postgres,authenticated=X/postgres}'),
    ('update_canvas_snapshot_thumbnail(uuid,text)', '9e45b67d1308a17a16ebc08f7c07e59b', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('update_hon_evi_sessions_updated_at()', 'a7bd1141d48e6bce598d3feb235cfe5a', '{service_role=X/postgres,postgres=X/postgres}'),
    ('update_hon_evi_sessions_updated_at()', '9950e385615970b6fe3eed0789786ef9', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('update_modified_column()', '56dad5c205aa44383d01eef7c98aff14', '{service_role=X/postgres,postgres=X/postgres}'),
    ('update_modified_column()', 'c0b3b6828e73d77bd8e2092f791a68e0', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('update_updated_at_column()', 'a323c77a0c0a0c8cd18dc8e8d3ca3d0f', '{service_role=X/postgres,postgres=X/postgres}'),
    ('update_updated_at_column()', '7be3d094bf7781418fbcac3630a25c24', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}')
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
    RAISE EXCEPTION 'Routine differs from the state the migration leaves: %', bad;
  END IF;

  -- The policies of profiles_new and comics_new are the set the migration
  -- leaves, or the exported live set.
  SELECT coalesce(string_agg(format('%s|%s|%s|%s|%s|%s', tablename, policyname, cmd, roles::text,
                                    coalesce(qual, '-'), coalesce(with_check, '-')),
                             ' ;; ' ORDER BY tablename, policyname), '') INTO bad
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename IN ('profiles_new', 'comics_new');
  IF bad NOT IN ($pol$comics_new|Anyone can view published comics|SELECT|{public}|(is_published = true)|- ;; comics_new|Users can manage their own comics|ALL|{public}|(creator_id = current_setting('app.current_user_id'::text, true))|- ;; profiles_new|Users can manage their own profile|ALL|{public}|(id = current_setting('app.current_user_id'::text, true))|- ;; profiles_new|Users can view all profiles|SELECT|{public}|true|-$pol$, $pol$comics_new|Anyone can view published comics|SELECT|{public}|(is_published = true)|- ;; comics_new|comics_new_owner|ALL|{authenticated}|(creator_id = (( SELECT auth.uid() AS uid))::text)|(creator_id = (( SELECT auth.uid() AS uid))::text) ;; profiles_new|profiles_new_owner|ALL|{authenticated}|(id = (( SELECT auth.uid() AS uid))::text)|(id = (( SELECT auth.uid() AS uid))::text)$pol$) THEN
    RAISE EXCEPTION 'Policies on profiles_new or comics_new differ from the state the migration leaves: %', bad;
  END IF;

  -- profiles_new table grants. All seven table privileges are compared for
  -- anon and authenticated. Accepted: the state the migration leaves (anon
  -- holds none of them, also not on a column; authenticated holds exactly
  -- SELECT, INSERT, UPDATE and DELETE), or the live state for a database that
  -- is already rolled back (both hold all seven). Anything else aborts and
  -- names each role and privilege that differs from the nearer of the two.
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
      array_agg(CASE WHEN r = 'authenticated' AND v IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
                     THEN format('%s lacks %s', r, v) ELSE format('%s holds %s', r, v) END ORDER BY r, o)
        FILTER (WHERE CASE WHEN r = 'authenticated' AND v IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
                           THEN NOT on_table ELSE on_any END) AS to_hardened,
      array_agg(format('%s lacks %s', r, v) ORDER BY r, o) FILTER (WHERE NOT on_table) AS to_live
    FROM held
  )
  SELECT CASE
           WHEN to_hardened IS NULL OR to_live IS NULL THEN NULL
           WHEN cardinality(to_hardened) < cardinality(to_live)
             THEN 'nearest is the hardened state (anon none, authenticated exactly SELECT, INSERT, UPDATE, DELETE): '
                  || array_to_string(to_hardened, ', ')
           WHEN cardinality(to_live) < cardinality(to_hardened)
             THEN 'nearest is the live state (anon and authenticated hold all seven): ' || array_to_string(to_live, ', ')
           ELSE 'against the hardened state: ' || array_to_string(to_hardened, ', ')
                || '; against the live state: ' || array_to_string(to_live, ', ')
         END INTO bad
  FROM diff;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Grants on public.profiles_new differ from the state the migration leaves; %', bad;
  END IF;
END
$preconditions$;

-- add_comment(text,text,text,uuid): live definition, verbatim. Callers after rollback: everyone (PUBLIC).
DO $add_comment_text_text_text_uuid$
BEGIN
  IF to_regprocedure('public.add_comment(text,text,text,uuid)') IS NULL THEN
    RAISE NOTICE 'Skipped: public.add_comment(text,text,text,uuid) does not exist';
    RETURN;
  END IF;
  EXECUTE $live$
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
  $live$;
  REVOKE ALL ON FUNCTION public.add_comment(text,text,text,uuid) FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.add_comment(text,text,text,uuid) TO PUBLIC, anon, authenticated, service_role;
END
$add_comment_text_text_text_uuid$;

-- cleanup_old_events(integer): live definition, verbatim. Callers after rollback: everyone (PUBLIC).
DO $cleanup_old_events_integer$
BEGIN
  IF to_regprocedure('public.cleanup_old_events(integer)') IS NULL THEN
    RAISE NOTICE 'Skipped: public.cleanup_old_events(integer) does not exist';
    RETURN;
  END IF;
  EXECUTE $live$
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
  $live$;
  REVOKE ALL ON FUNCTION public.cleanup_old_events(integer) FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.cleanup_old_events(integer) TO PUBLIC, anon, authenticated, service_role;
END
$cleanup_old_events_integer$;

-- cleanup_old_snapshots(text,integer,integer): live definition, verbatim. Callers after rollback: everyone (PUBLIC).
DO $cleanup_old_snapshots_text_integer_integer$
BEGIN
  IF to_regprocedure('public.cleanup_old_snapshots(text,integer,integer)') IS NULL THEN
    RAISE NOTICE 'Skipped: public.cleanup_old_snapshots(text,integer,integer) does not exist';
    RETURN;
  END IF;
  EXECUTE $live$
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
  $live$;
  REVOKE ALL ON FUNCTION public.cleanup_old_snapshots(text,integer,integer) FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.cleanup_old_snapshots(text,integer,integer) TO PUBLIC, anon, authenticated, service_role;
END
$cleanup_old_snapshots_text_integer_integer$;

-- create_canvas_snapshot(text,text,jsonb,uuid,text,text,text,text,text): live definition, verbatim. Callers after rollback: everyone (PUBLIC).
DO $create_canvas_snapshot_text_text_jsonb_uuid_text_text_text_text_text$
BEGIN
  IF to_regprocedure('public.create_canvas_snapshot(text,text,jsonb,uuid,text,text,text,text,text)') IS NULL THEN
    RAISE NOTICE 'Skipped: public.create_canvas_snapshot(text,text,jsonb,uuid,text,text,text,text,text) does not exist';
    RETURN;
  END IF;
  EXECUTE $live$
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
  $live$;
  REVOKE ALL ON FUNCTION public.create_canvas_snapshot(text,text,jsonb,uuid,text,text,text,text,text) FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.create_canvas_snapshot(text,text,jsonb,uuid,text,text,text,text,text) TO PUBLIC, anon, authenticated, service_role;
END
$create_canvas_snapshot_text_text_jsonb_uuid_text_text_text_text_text$;

-- get_canvas_snapshot(uuid): live definition, verbatim. Callers after rollback: everyone (PUBLIC).
DO $get_canvas_snapshot_uuid$
BEGIN
  IF to_regprocedure('public.get_canvas_snapshot(uuid)') IS NULL THEN
    RAISE NOTICE 'Skipped: public.get_canvas_snapshot(uuid) does not exist';
    RETURN;
  END IF;
  EXECUTE $live$
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
  $live$;
  REVOKE ALL ON FUNCTION public.get_canvas_snapshot(uuid) FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.get_canvas_snapshot(uuid) TO PUBLIC, anon, authenticated, service_role;
END
$get_canvas_snapshot_uuid$;

-- get_canvas_timeline(text,integer): live definition, verbatim. Callers after rollback: everyone (PUBLIC).
DO $get_canvas_timeline_text_integer$
BEGIN
  IF to_regprocedure('public.get_canvas_timeline(text,integer)') IS NULL THEN
    RAISE NOTICE 'Skipped: public.get_canvas_timeline(text,integer) does not exist';
    RETURN;
  END IF;
  EXECUTE $live$
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
  $live$;
  REVOKE ALL ON FUNCTION public.get_canvas_timeline(text,integer) FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.get_canvas_timeline(text,integer) TO PUBLIC, anon, authenticated, service_role;
END
$get_canvas_timeline_text_integer$;

-- get_comic_id_from_draft_id(text): live definition, verbatim. Callers after rollback: everyone (PUBLIC).
DO $get_comic_id_from_draft_id_text$
BEGIN
  IF to_regprocedure('public.get_comic_id_from_draft_id(text)') IS NULL THEN
    RAISE NOTICE 'Skipped: public.get_comic_id_from_draft_id(text) does not exist';
    RETURN;
  END IF;
  EXECUTE $live$
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
  $live$;
  REVOKE ALL ON FUNCTION public.get_comic_id_from_draft_id(text) FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.get_comic_id_from_draft_id(text) TO PUBLIC, anon, authenticated, service_role;
END
$get_comic_id_from_draft_id_text$;

-- get_comment_votes(uuid): live definition, verbatim. Callers after rollback: everyone (PUBLIC).
DO $get_comment_votes_uuid$
BEGIN
  IF to_regprocedure('public.get_comment_votes(uuid)') IS NULL THEN
    RAISE NOTICE 'Skipped: public.get_comment_votes(uuid) does not exist';
    RETURN;
  END IF;
  EXECUTE $live$
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
  $live$;
  REVOKE ALL ON FUNCTION public.get_comment_votes(uuid) FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.get_comment_votes(uuid) TO PUBLIC, anon, authenticated, service_role;
END
$get_comment_votes_uuid$;

-- get_comment_votes(uuid,text): live definition, verbatim. Callers after rollback: everyone (PUBLIC).
DO $get_comment_votes_uuid_text$
BEGIN
  IF to_regprocedure('public.get_comment_votes(uuid,text)') IS NULL THEN
    RAISE NOTICE 'Skipped: public.get_comment_votes(uuid,text) does not exist';
    RETURN;
  END IF;
  EXECUTE $live$
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
  $live$;
  REVOKE ALL ON FUNCTION public.get_comment_votes(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.get_comment_votes(uuid,text) TO PUBLIC, anon, authenticated, service_role;
END
$get_comment_votes_uuid_text$;

-- get_comments_for_comic(text): live definition, verbatim. Callers after rollback: everyone (PUBLIC).
DO $get_comments_for_comic_text$
BEGIN
  IF to_regprocedure('public.get_comments_for_comic(text)') IS NULL THEN
    RAISE NOTICE 'Skipped: public.get_comments_for_comic(text) does not exist';
    RETURN;
  END IF;
  EXECUTE $live$
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
  $live$;
  REVOKE ALL ON FUNCTION public.get_comments_for_comic(text) FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.get_comments_for_comic(text) TO PUBLIC, anon, authenticated, service_role;
END
$get_comments_for_comic_text$;

-- get_pg_version(): live definition, verbatim. Callers after rollback: everyone (PUBLIC).
DO $get_pg_version$
BEGIN
  IF to_regprocedure('public.get_pg_version()') IS NULL THEN
    RAISE NOTICE 'Skipped: public.get_pg_version() does not exist';
    RETURN;
  END IF;
  EXECUTE $live$
CREATE OR REPLACE FUNCTION public.get_pg_version()
 RETURNS text
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT version();
$function$
  $live$;
  REVOKE ALL ON FUNCTION public.get_pg_version() FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.get_pg_version() TO PUBLIC, anon, authenticated, service_role;
END
$get_pg_version$;

-- get_project_storage_stats(text): live definition, verbatim. Callers after rollback: everyone (PUBLIC).
DO $get_project_storage_stats_text$
BEGIN
  IF to_regprocedure('public.get_project_storage_stats(text)') IS NULL THEN
    RAISE NOTICE 'Skipped: public.get_project_storage_stats(text) does not exist';
    RETURN;
  END IF;
  EXECUTE $live$
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
  $live$;
  REVOKE ALL ON FUNCTION public.get_project_storage_stats(text) FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.get_project_storage_stats(text) TO PUBLIC, anon, authenticated, service_role;
END
$get_project_storage_stats_text$;

-- get_user_bookmarks(uuid): live definition, verbatim. Callers after rollback: everyone (PUBLIC).
DO $get_user_bookmarks_uuid$
BEGIN
  IF to_regprocedure('public.get_user_bookmarks(uuid)') IS NULL THEN
    RAISE NOTICE 'Skipped: public.get_user_bookmarks(uuid) does not exist';
    RETURN;
  END IF;
  EXECUTE $live$
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
  $live$;
  REVOKE ALL ON FUNCTION public.get_user_bookmarks(uuid) FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.get_user_bookmarks(uuid) TO PUBLIC, anon, authenticated, service_role;
END
$get_user_bookmarks_uuid$;

-- get_user_id_from_identifier(text): live definition, verbatim. Callers after rollback: everyone (PUBLIC).
DO $get_user_id_from_identifier_text$
BEGIN
  IF to_regprocedure('public.get_user_id_from_identifier(text)') IS NULL THEN
    RAISE NOTICE 'Skipped: public.get_user_id_from_identifier(text) does not exist';
    RETURN;
  END IF;
  EXECUTE $live$
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
  $live$;
  REVOKE ALL ON FUNCTION public.get_user_id_from_identifier(text) FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.get_user_id_from_identifier(text) TO PUBLIC, anon, authenticated, service_role;
END
$get_user_id_from_identifier_text$;

-- get_user_likes(uuid): live definition, verbatim. Callers after rollback: everyone (PUBLIC).
DO $get_user_likes_uuid$
BEGIN
  IF to_regprocedure('public.get_user_likes(uuid)') IS NULL THEN
    RAISE NOTICE 'Skipped: public.get_user_likes(uuid) does not exist';
    RETURN;
  END IF;
  EXECUTE $live$
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
  $live$;
  REVOKE ALL ON FUNCTION public.get_user_likes(uuid) FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.get_user_likes(uuid) TO PUBLIC, anon, authenticated, service_role;
END
$get_user_likes_uuid$;

-- get_user_subscriptions(uuid): live definition, verbatim. Callers after rollback: everyone (PUBLIC).
DO $get_user_subscriptions_uuid$
BEGIN
  IF to_regprocedure('public.get_user_subscriptions(uuid)') IS NULL THEN
    RAISE NOTICE 'Skipped: public.get_user_subscriptions(uuid) does not exist';
    RETURN;
  END IF;
  EXECUTE $live$
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
  $live$;
  REVOKE ALL ON FUNCTION public.get_user_subscriptions(uuid) FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.get_user_subscriptions(uuid) TO PUBLIC, anon, authenticated, service_role;
END
$get_user_subscriptions_uuid$;

-- get_user_subscriptions(text): live definition, verbatim. Callers after rollback: everyone (PUBLIC).
DO $get_user_subscriptions_text$
BEGIN
  IF to_regprocedure('public.get_user_subscriptions(text)') IS NULL THEN
    RAISE NOTICE 'Skipped: public.get_user_subscriptions(text) does not exist';
    RETURN;
  END IF;
  EXECUTE $live$
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
  $live$;
  REVOKE ALL ON FUNCTION public.get_user_subscriptions(text) FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.get_user_subscriptions(text) TO PUBLIC, anon, authenticated, service_role;
END
$get_user_subscriptions_text$;

-- increment_comic_views(text): live definition, verbatim. Callers after rollback: everyone (PUBLIC).
DO $increment_comic_views_text$
BEGIN
  IF to_regprocedure('public.increment_comic_views(text)') IS NULL THEN
    RAISE NOTICE 'Skipped: public.increment_comic_views(text) does not exist';
    RETURN;
  END IF;
  EXECUTE $live$
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
  $live$;
  REVOKE ALL ON FUNCTION public.increment_comic_views(text) FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.increment_comic_views(text) TO PUBLIC, anon, authenticated, service_role;
END
$increment_comic_views_text$;

-- is_comic_bookmarked(uuid,text): live definition, verbatim. Callers after rollback: everyone (PUBLIC).
DO $is_comic_bookmarked_uuid_text$
BEGIN
  IF to_regprocedure('public.is_comic_bookmarked(uuid,text)') IS NULL THEN
    RAISE NOTICE 'Skipped: public.is_comic_bookmarked(uuid,text) does not exist';
    RETURN;
  END IF;
  EXECUTE $live$
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
  $live$;
  REVOKE ALL ON FUNCTION public.is_comic_bookmarked(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.is_comic_bookmarked(uuid,text) TO PUBLIC, anon, authenticated, service_role;
END
$is_comic_bookmarked_uuid_text$;

-- is_comic_liked(uuid,text): live definition, verbatim. Callers after rollback: everyone (PUBLIC).
DO $is_comic_liked_uuid_text$
BEGIN
  IF to_regprocedure('public.is_comic_liked(uuid,text)') IS NULL THEN
    RAISE NOTICE 'Skipped: public.is_comic_liked(uuid,text) does not exist';
    RETURN;
  END IF;
  EXECUTE $live$
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
  $live$;
  REVOKE ALL ON FUNCTION public.is_comic_liked(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.is_comic_liked(uuid,text) TO PUBLIC, anon, authenticated, service_role;
END
$is_comic_liked_uuid_text$;

-- is_subscribed(text,text): live definition, verbatim. Callers after rollback: everyone (PUBLIC).
DO $is_subscribed_text_text$
BEGIN
  IF to_regprocedure('public.is_subscribed(text,text)') IS NULL THEN
    RAISE NOTICE 'Skipped: public.is_subscribed(text,text) does not exist';
    RETURN;
  END IF;
  EXECUTE $live$
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
  $live$;
  REVOKE ALL ON FUNCTION public.is_subscribed(text,text) FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.is_subscribed(text,text) TO PUBLIC, anon, authenticated, service_role;
END
$is_subscribed_text_text$;

-- is_subscribed(uuid,uuid): live definition, verbatim. Callers after rollback: everyone (PUBLIC).
DO $is_subscribed_uuid_uuid$
BEGIN
  IF to_regprocedure('public.is_subscribed(uuid,uuid)') IS NULL THEN
    RAISE NOTICE 'Skipped: public.is_subscribed(uuid,uuid) does not exist';
    RETURN;
  END IF;
  EXECUTE $live$
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
  $live$;
  REVOKE ALL ON FUNCTION public.is_subscribed(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.is_subscribed(uuid,uuid) TO PUBLIC, anon, authenticated, service_role;
END
$is_subscribed_uuid_uuid$;

-- save_canvas_event(text,text,uuid,text,text,text,text,text,jsonb,uuid): live definition, verbatim. Callers after rollback: everyone (PUBLIC).
DO $save_canvas_event_text_text_uuid_text_text_text_text_text_jsonb_uuid$
BEGIN
  IF to_regprocedure('public.save_canvas_event(text,text,uuid,text,text,text,text,text,jsonb,uuid)') IS NULL THEN
    RAISE NOTICE 'Skipped: public.save_canvas_event(text,text,uuid,text,text,text,text,text,jsonb,uuid) does not exist';
    RETURN;
  END IF;
  EXECUTE $live$
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
  $live$;
  REVOKE ALL ON FUNCTION public.save_canvas_event(text,text,uuid,text,text,text,text,text,jsonb,uuid) FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.save_canvas_event(text,text,uuid,text,text,text,text,text,jsonb,uuid) TO PUBLIC, anon, authenticated, service_role;
END
$save_canvas_event_text_text_uuid_text_text_text_text_text_jsonb_uuid$;

-- set_current_user_id(text): live definition, verbatim. Callers after rollback: everyone (PUBLIC).
DO $set_current_user_id_text$
BEGIN
  IF to_regprocedure('public.set_current_user_id(text)') IS NULL THEN
    RAISE NOTICE 'Skipped: public.set_current_user_id(text) does not exist';
    RETURN;
  END IF;
  EXECUTE $live$
CREATE OR REPLACE FUNCTION public.set_current_user_id(user_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    PERFORM set_config('app.current_user_id', user_id, true);
END;
$function$
  $live$;
  REVOKE ALL ON FUNCTION public.set_current_user_id(text) FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.set_current_user_id(text) TO PUBLIC, anon, authenticated, service_role;
END
$set_current_user_id_text$;

-- setup_collaboration_tables(): live definition, verbatim. Callers after rollback: everyone (PUBLIC).
DO $setup_collaboration_tables$
BEGIN
  IF to_regprocedure('public.setup_collaboration_tables()') IS NULL THEN
    RAISE NOTICE 'Skipped: public.setup_collaboration_tables() does not exist';
    RETURN;
  END IF;
  EXECUTE $live$
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
  $live$;
  REVOKE ALL ON FUNCTION public.setup_collaboration_tables() FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.setup_collaboration_tables() TO PUBLIC, anon, authenticated, service_role;
END
$setup_collaboration_tables$;

-- update_canvas_snapshot_thumbnail(uuid,text): live definition, verbatim. Callers after rollback: everyone (PUBLIC).
DO $update_canvas_snapshot_thumbnail_uuid_text$
BEGIN
  IF to_regprocedure('public.update_canvas_snapshot_thumbnail(uuid,text)') IS NULL THEN
    RAISE NOTICE 'Skipped: public.update_canvas_snapshot_thumbnail(uuid,text) does not exist';
    RETURN;
  END IF;
  EXECUTE $live$
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
  $live$;
  REVOKE ALL ON FUNCTION public.update_canvas_snapshot_thumbnail(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.update_canvas_snapshot_thumbnail(uuid,text) TO PUBLIC, anon, authenticated, service_role;
END
$update_canvas_snapshot_thumbnail_uuid_text$;

-- handle_new_user(): live definition, verbatim. Callers after rollback: everyone (PUBLIC).
DO $handle_new_user$
BEGIN
  IF to_regprocedure('public.handle_new_user()') IS NULL THEN
    RAISE NOTICE 'Skipped: public.handle_new_user() does not exist';
    RETURN;
  END IF;
  EXECUTE $live$
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
  $live$;
  REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.handle_new_user() TO PUBLIC, anon, authenticated, service_role;
END
$handle_new_user$;

-- handle_updated_at(): live definition, verbatim. Callers after rollback: everyone (PUBLIC).
DO $handle_updated_at$
BEGIN
  IF to_regprocedure('public.handle_updated_at()') IS NULL THEN
    RAISE NOTICE 'Skipped: public.handle_updated_at() does not exist';
    RETURN;
  END IF;
  EXECUTE $live$
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
  $live$;
  REVOKE ALL ON FUNCTION public.handle_updated_at() FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.handle_updated_at() TO PUBLIC, anon, authenticated, service_role;
END
$handle_updated_at$;

-- notify_waitlist_signup(): live definition, verbatim. Callers after rollback: everyone (PUBLIC).
DO $notify_waitlist_signup$
BEGIN
  IF to_regprocedure('public.notify_waitlist_signup()') IS NULL THEN
    RAISE NOTICE 'Skipped: public.notify_waitlist_signup() does not exist';
    RETURN;
  END IF;
  EXECUTE $live$
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
  $live$;
  REVOKE ALL ON FUNCTION public.notify_waitlist_signup() FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.notify_waitlist_signup() TO PUBLIC, anon, authenticated, service_role;
END
$notify_waitlist_signup$;

-- set_bookmark_user_id(): live definition, verbatim. Callers after rollback: everyone (PUBLIC).
DO $set_bookmark_user_id$
BEGIN
  IF to_regprocedure('public.set_bookmark_user_id()') IS NULL THEN
    RAISE NOTICE 'Skipped: public.set_bookmark_user_id() does not exist';
    RETURN;
  END IF;
  EXECUTE $live$
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
  $live$;
  REVOKE ALL ON FUNCTION public.set_bookmark_user_id() FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.set_bookmark_user_id() TO PUBLIC, anon, authenticated, service_role;
END
$set_bookmark_user_id$;

-- trigger_collaboration_event(): live definition, verbatim. Callers after rollback: everyone (PUBLIC).
DO $trigger_collaboration_event$
BEGIN
  IF to_regprocedure('public.trigger_collaboration_event()') IS NULL THEN
    RAISE NOTICE 'Skipped: public.trigger_collaboration_event() does not exist';
    RETURN;
  END IF;
  EXECUTE $live$
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
  $live$;
  REVOKE ALL ON FUNCTION public.trigger_collaboration_event() FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.trigger_collaboration_event() TO PUBLIC, anon, authenticated, service_role;
END
$trigger_collaboration_event$;

-- update_modified_column(): live definition, verbatim. Callers after rollback: everyone (PUBLIC).
DO $update_modified_column$
BEGIN
  IF to_regprocedure('public.update_modified_column()') IS NULL THEN
    RAISE NOTICE 'Skipped: public.update_modified_column() does not exist';
    RETURN;
  END IF;
  EXECUTE $live$
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
  $live$;
  REVOKE ALL ON FUNCTION public.update_modified_column() FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.update_modified_column() TO PUBLIC, anon, authenticated, service_role;
END
$update_modified_column$;

-- update_updated_at_column(): live definition, verbatim. Callers after rollback: everyone (PUBLIC).
DO $update_updated_at_column$
BEGIN
  IF to_regprocedure('public.update_updated_at_column()') IS NULL THEN
    RAISE NOTICE 'Skipped: public.update_updated_at_column() does not exist';
    RETURN;
  END IF;
  EXECUTE $live$
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
  $live$;
  REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO PUBLIC, anon, authenticated, service_role;
END
$update_updated_at_column$;

-- calculate_snapshot_size(): live definition, verbatim. Callers after rollback: everyone (PUBLIC).
DO $calculate_snapshot_size$
BEGIN
  IF to_regprocedure('public.calculate_snapshot_size()') IS NULL THEN
    RAISE NOTICE 'Skipped: public.calculate_snapshot_size() does not exist';
    RETURN;
  END IF;
  EXECUTE $live$
CREATE OR REPLACE FUNCTION public.calculate_snapshot_size()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.snapshot_size_bytes := pg_column_size(NEW.canvas_state) + 200;
  RETURN NEW;
END;
$function$
  $live$;
  REVOKE ALL ON FUNCTION public.calculate_snapshot_size() FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.calculate_snapshot_size() TO PUBLIC, anon, authenticated, service_role;
END
$calculate_snapshot_size$;

-- update_hon_evi_sessions_updated_at(): live definition, verbatim. Callers after rollback: everyone (PUBLIC).
DO $update_hon_evi_sessions_updated_at$
BEGIN
  IF to_regprocedure('public.update_hon_evi_sessions_updated_at()') IS NULL THEN
    RAISE NOTICE 'Skipped: public.update_hon_evi_sessions_updated_at() does not exist';
    RETURN;
  END IF;
  EXECUTE $live$
CREATE OR REPLACE FUNCTION public.update_hon_evi_sessions_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
  $live$;
  REVOKE ALL ON FUNCTION public.update_hon_evi_sessions_updated_at() FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.update_hon_evi_sessions_updated_at() TO PUBLIC, anon, authenticated, service_role;
END
$update_hon_evi_sessions_updated_at$;

-- profiles_new and comics_new: the live policies by exact name and definition.
DROP POLICY IF EXISTS profiles_new_owner ON public.profiles_new;
DROP POLICY IF EXISTS comics_new_owner ON public.comics_new;
DROP POLICY IF EXISTS "Users can manage their own profile" ON public.profiles_new;
CREATE POLICY "Users can manage their own profile" ON public.profiles_new AS PERMISSIVE
  FOR ALL TO PUBLIC USING ((id = current_setting('app.current_user_id'::text, true)));
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles_new;
CREATE POLICY "Users can view all profiles" ON public.profiles_new AS PERMISSIVE
  FOR SELECT TO PUBLIC USING (true);
DROP POLICY IF EXISTS "Users can manage their own comics" ON public.comics_new;
CREATE POLICY "Users can manage their own comics" ON public.comics_new AS PERMISSIVE
  FOR ALL TO PUBLIC USING ((creator_id = current_setting('app.current_user_id'::text, true)));

-- The view the migration added.
DROP VIEW IF EXISTS public.profiles_new_public;

-- The live table grants on profiles_new for the client roles: all seven
-- privileges, named one by one. service_role is not touched.
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.profiles_new TO anon, authenticated;

COMMIT;
