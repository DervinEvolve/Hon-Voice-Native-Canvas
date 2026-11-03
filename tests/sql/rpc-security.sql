-- Assertions for migrations/harden_rpc_exposure.sql on the disposable fixture
-- (tests/sql/rpc-fixture.sql, then migrations/secure_canvas_history.sql).
-- Each failure names its assertion. User A and user B come from
-- tests/sql/database-bootstrap.sql. The file can run more than once; it
-- removes the rows it adds.
\set ON_ERROR_STOP on
RESET ROLE;
RESET request.jwt.claim.sub;
RESET request.jwt.claim.role;

CREATE SCHEMA IF NOT EXISTS hon_test;
GRANT USAGE ON SCHEMA hon_test TO anon, authenticated, service_role;

-- Fake private values from the fixture that no result may contain.
DROP TABLE IF EXISTS hon_test.rpc_private_markers;
CREATE TABLE hon_test.rpc_private_markers AS
SELECT DISTINCT m AS marker
FROM public.profiles p,
     LATERAL unnest(ARRAY[p.email, p.discord_id, p.twitter_id, p.google_id, p.privy_user_id,
                          p.notification_preferences ->> 'marker', p.wallet_id::text]) AS m
WHERE m IS NOT NULL
UNION
SELECT DISTINCT m
FROM public.profiles_new p,
     LATERAL unnest(ARRAY[p.email, p.preferences ->> 'marker', p.subscription_tier, p.subscription_status,
                          to_char(p.subscription_expiry AT TIME ZONE 'UTC', 'YYYY-MM-DD')]) AS m
WHERE m IS NOT NULL;
GRANT SELECT ON hon_test.rpc_private_markers TO anon, authenticated, service_role;

-- Passes only when the statement fails with the given SQLSTATE.
CREATE OR REPLACE FUNCTION hon_test.rpc_expect_error(label text, statement text, state text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = state THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'Assertion failed: % (got % %, expected %)', label, SQLSTATE, SQLERRM, state;
  END;
  RAISE EXCEPTION 'Assertion failed: % (statement was accepted)', label;
END
$$;

-- Passes when a one-value query returns the expected text.
CREATE OR REPLACE FUNCTION hon_test.rpc_expect_text(label text, query text, expected text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  found text;
BEGIN
  BEGIN
    EXECUTE query INTO found;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Assertion failed: % (% %)', label, SQLSTATE, SQLERRM;
  END;
  IF found IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'Assertion failed: % (got %, expected %)', label, found, expected;
  END IF;
END
$$;

-- Runs a query, turns all its rows into text and fails if the text contains
-- a private marker. Fails as well when the query returns no rows.
CREATE OR REPLACE FUNCTION hon_test.rpc_no_private(label text, query text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  result text;
  hit text;
BEGIN
  BEGIN
    EXECUTE format('SELECT json_agg(t)::text FROM (%s) t', query) INTO result;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Assertion failed: % (% %)', label, SQLSTATE, SQLERRM;
  END;
  IF result IS NULL THEN
    RAISE EXCEPTION 'Assertion failed: % (no rows returned)', label;
  END IF;
  SELECT string_agg(marker, ', ') INTO hit
  FROM hon_test.rpc_private_markers
  WHERE strpos(lower(result), lower(marker)) > 0;
  IF hit IS NOT NULL THEN
    RAISE EXCEPTION 'Assertion failed: % (result contains %)', label, hit;
  END IF;
END
$$;

-- Shorthand used below: A = aaaaaaaa-..., B = bbbbbbbb-..., comic one
-- c0c0...0001 (user B), comic two c0c0...0002 (user A), comment c0c0...00c1
-- (user B), canvas snapshot c0c0...00e1 (user B).

-- 1. Attributes and grants.
DO $$
DECLARE
  got text;
BEGIN
  -- Routines in public that anon may execute (extensions excluded).
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO got
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND NOT EXISTS (SELECT 1 FROM pg_depend d
                    WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
    AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF got IS DISTINCT FROM 'get_comic_id_from_draft_id(text), get_comment_votes(uuid), get_comment_votes(uuid,text), '
                          'get_comments_for_comic(text), increment_comic_views(text), subscriber_count(text)' THEN
    RAISE EXCEPTION 'Assertion failed: anon executes only the public reads (got %)', got;
  END IF;

  -- Routines in public that authenticated may execute.
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO got
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND NOT EXISTS (SELECT 1 FROM pg_depend d
                    WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE');
  IF got IS DISTINCT FROM
     'add_comment(text,text,text,uuid), create_canvas_snapshot(text,text,jsonb,uuid,text,text,text,text,text), '
     'get_canvas_snapshot(uuid), get_canvas_timeline(text,integer), get_comic_id_from_draft_id(text), '
     'get_comment_votes(uuid), get_comment_votes(uuid,text), get_comments_for_comic(text), '
     'get_user_subscriptions(text), get_user_subscriptions(uuid), increment_comic_views(text), '
     'is_subscribed(text,text), is_subscribed(uuid,uuid), '
     'save_canvas_event(text,text,uuid,text,text,text,text,text,jsonb,uuid), subscriber_count(text), '
     'update_canvas_snapshot_thumbnail(uuid,text)' THEN
    RAISE EXCEPTION 'Assertion failed: authenticated executes only the client routines (got %)', got;
  END IF;

  -- service_role keeps every one of the 26 live non-trigger routines.
  SELECT string_agg(s, ', ') INTO got
  FROM unnest(ARRAY['add_comment(text,text,text,uuid)', 'cleanup_old_events(integer)',
                    'cleanup_old_snapshots(text,integer,integer)', 'get_comic_id_from_draft_id(text)',
                    'get_comment_votes(uuid)', 'get_comment_votes(uuid,text)', 'get_comments_for_comic(text)',
                    'get_pg_version()', 'get_project_storage_stats(text)', 'get_user_bookmarks(uuid)',
                    'get_user_id_from_identifier(text)', 'get_user_likes(uuid)', 'get_user_subscriptions(uuid)',
                    'get_user_subscriptions(text)', 'increment_comic_views(text)', 'is_comic_bookmarked(uuid,text)',
                    'is_comic_liked(uuid,text)', 'is_subscribed(text,text)', 'is_subscribed(uuid,uuid)',
                    'set_current_user_id(text)', 'setup_collaboration_tables()']) AS s
  WHERE NOT has_function_privilege('service_role', to_regprocedure('public.' || s), 'EXECUTE');
  IF got IS NOT NULL THEN
    RAISE EXCEPTION 'Assertion failed: service_role executes the server routines (missing %)', got;
  END IF;

  -- Every SECURITY DEFINER routine is pinned and not open to PUBLIC.
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO got
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prosecdef
    AND (NOT coalesce('search_path=""' = ANY (p.proconfig), false)
         OR has_function_privilege('public', p.oid, 'EXECUTE'));
  IF got IS NOT NULL THEN
    RAISE EXCEPTION 'Assertion failed: definer routines pinned and closed to PUBLIC (%)', got;
  END IF;

  -- The three canvas reads run with the caller's rights and filter on auth.uid().
  SELECT string_agg(s, ', ') INTO got
  FROM unnest(ARRAY['get_canvas_snapshot(uuid)', 'get_canvas_timeline(text,integer)',
                    'update_canvas_snapshot_thumbnail(uuid,text)']) AS s
  JOIN pg_proc p ON p.oid = to_regprocedure('public.' || s)
  WHERE p.prosecdef OR pg_get_functiondef(p.oid) !~ 'auth\.uid\(\)';
  IF got IS NOT NULL THEN
    RAISE EXCEPTION 'Assertion failed: canvas reads are invoker with an auth.uid() filter (%)', got;
  END IF;

  -- Trigger functions: definer, pinned, no client grant. The two invoker
  -- routines: no client grant, search_path and body unchanged.
  SELECT string_agg(s, ', ') INTO got
  FROM unnest(ARRAY['handle_new_user()', 'handle_updated_at()', 'notify_waitlist_signup()',
                    'set_bookmark_user_id()', 'trigger_collaboration_event()', 'update_modified_column()',
                    'update_updated_at_column()']) AS s
  JOIN pg_proc p ON p.oid = to_regprocedure('public.' || s)
  WHERE NOT p.prosecdef
     OR NOT coalesce('search_path=""' = ANY (p.proconfig), false)
     OR has_function_privilege('anon', p.oid, 'EXECUTE')
     OR has_function_privilege('authenticated', p.oid, 'EXECUTE');
  IF got IS NOT NULL THEN
    RAISE EXCEPTION 'Assertion failed: trigger functions pinned and closed to clients (%)', got;
  END IF;
  SELECT string_agg(s, ', ') INTO got
  FROM unnest(ARRAY['calculate_snapshot_size()', 'update_hon_evi_sessions_updated_at()']) AS s
  JOIN pg_proc p ON p.oid = to_regprocedure('public.' || s)
  WHERE p.prosecdef
     OR NOT coalesce('search_path=""' = ANY (p.proconfig), false)
     OR has_function_privilege('anon', p.oid, 'EXECUTE')
     OR has_function_privilege('authenticated', p.oid, 'EXECUTE');
  IF got IS NOT NULL THEN
    RAISE EXCEPTION 'Assertion failed: invoker trigger helpers pinned and closed to clients (%)', got;
  END IF;

  -- The migration did not create public.bookmarks or public.likes.
  IF to_regclass('public.bookmarks') IS NOT NULL OR to_regclass('public.likes') IS NOT NULL THEN
    RAISE EXCEPTION 'Assertion failed: public.bookmarks and public.likes do not exist';
  END IF;
END
$$;

-- 2. Admin helpers and routines on missing tables are refused for clients.
SET ROLE anon;
SET request.jwt.claim.sub = '';
SET request.jwt.claim.role = 'anon';
DO $$
BEGIN
  PERFORM hon_test.rpc_expect_error('anon cannot run cleanup_old_events', 'SELECT public.cleanup_old_events(0)', '42501');
  PERFORM hon_test.rpc_expect_error('anon cannot run cleanup_old_snapshots', 'SELECT public.cleanup_old_snapshots(NULL, 0, 0)', '42501');
  PERFORM hon_test.rpc_expect_error('anon cannot read get_project_storage_stats', $q$SELECT * FROM public.get_project_storage_stats('canvas-b')$q$, '42501');
  PERFORM hon_test.rpc_expect_error('anon cannot read get_pg_version', 'SELECT public.get_pg_version()', '42501');
  PERFORM hon_test.rpc_expect_error('anon cannot set app.current_user_id', $q$SELECT public.set_current_user_id('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')$q$, '42501');
  PERFORM hon_test.rpc_expect_error('anon cannot run setup_collaboration_tables', 'SELECT public.setup_collaboration_tables()', '42501');
  PERFORM hon_test.rpc_expect_error('anon cannot look up a user by identifier', $q$SELECT public.get_user_id_from_identifier('b@example.test')$q$, '42501');
  PERFORM hon_test.rpc_expect_error('anon cannot call get_user_bookmarks', $q$SELECT * FROM public.get_user_bookmarks('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')$q$, '42501');
  PERFORM hon_test.rpc_expect_error('anon cannot call get_user_likes', $q$SELECT * FROM public.get_user_likes('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')$q$, '42501');
  PERFORM hon_test.rpc_expect_error('anon cannot call is_comic_bookmarked', $q$SELECT public.is_comic_bookmarked('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'draft-1')$q$, '42501');
  PERFORM hon_test.rpc_expect_error('anon cannot call is_comic_liked', $q$SELECT public.is_comic_liked('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'draft-1')$q$, '42501');
  PERFORM hon_test.rpc_expect_error('anon cannot call calculate_snapshot_size directly', 'SELECT public.calculate_snapshot_size()', '42501');
  PERFORM hon_test.rpc_expect_error('anon cannot call update_hon_evi_sessions_updated_at directly', 'SELECT public.update_hon_evi_sessions_updated_at()', '42501');
END
$$;
SET ROLE authenticated;
SET request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SET request.jwt.claim.role = 'authenticated';
DO $$
BEGIN
  PERFORM hon_test.rpc_expect_error('user A cannot run cleanup_old_events', 'SELECT public.cleanup_old_events(0)', '42501');
  PERFORM hon_test.rpc_expect_error('user A cannot run cleanup_old_snapshots', 'SELECT public.cleanup_old_snapshots(NULL, 0, 0)', '42501');
  PERFORM hon_test.rpc_expect_error('user A cannot read get_project_storage_stats', $q$SELECT * FROM public.get_project_storage_stats('canvas-b')$q$, '42501');
  PERFORM hon_test.rpc_expect_error('user A cannot read get_pg_version', 'SELECT public.get_pg_version()', '42501');
  PERFORM hon_test.rpc_expect_error('user A cannot run setup_collaboration_tables', 'SELECT public.setup_collaboration_tables()', '42501');
  PERFORM hon_test.rpc_expect_error('user A cannot look up a user by identifier', $q$SELECT public.get_user_id_from_identifier('b@example.test')$q$, '42501');
  PERFORM hon_test.rpc_expect_error('user A cannot call get_user_bookmarks', $q$SELECT * FROM public.get_user_bookmarks('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$q$, '42501');
  PERFORM hon_test.rpc_expect_error('user A cannot call get_user_likes', $q$SELECT * FROM public.get_user_likes('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$q$, '42501');
  PERFORM hon_test.rpc_expect_error('user A cannot call is_comic_bookmarked', $q$SELECT public.is_comic_bookmarked('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'draft-1')$q$, '42501');
  PERFORM hon_test.rpc_expect_error('user A cannot call is_comic_liked', $q$SELECT public.is_comic_liked('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'draft-1')$q$, '42501');
  PERFORM hon_test.rpc_expect_error('user A cannot call calculate_snapshot_size directly', 'SELECT public.calculate_snapshot_size()', '42501');
  PERFORM hon_test.rpc_expect_error('user A cannot call handle_new_user directly', 'SELECT public.handle_new_user()', '42501');
  PERFORM hon_test.rpc_expect_error('user A cannot call set_bookmark_user_id directly', 'SELECT public.set_bookmark_user_id()', '42501');
  PERFORM hon_test.rpc_expect_error('user A cannot call trigger_collaboration_event directly', 'SELECT public.trigger_collaboration_event()', '42501');
  PERFORM hon_test.rpc_expect_error('user A cannot call update_modified_column directly', 'SELECT public.update_modified_column()', '42501');
  PERFORM hon_test.rpc_expect_error('user A cannot call update_updated_at_column directly', 'SELECT public.update_updated_at_column()', '42501');
  -- The two live policies that trust app.current_user_id.
  PERFORM hon_test.rpc_expect_error('user A cannot set app.current_user_id to user B',
    $q$SELECT public.set_current_user_id('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')$q$, '42501');
  PERFORM hon_test.rpc_expect_text('user A sees only its own profiles_new row',
    'SELECT string_agg(id, $s$,$s$) FROM public.profiles_new', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  PERFORM hon_test.rpc_expect_text('user A sees published comics_new rows and its own, not the draft of user B',
    'SELECT string_agg(id, $s$,$s$ ORDER BY id) FROM public.comics_new', 'comic-new-a-draft,comic-new-b-published');
END
$$;

-- 3. User A cannot act as user B through any overload.
DO $$
BEGIN
  PERFORM hon_test.rpc_expect_error('user A cannot comment as user B',
    $q$SELECT public.add_comment('c0c0c0c0-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'rpc-test forged', NULL)$q$, '42501');
  PERFORM hon_test.rpc_expect_error('user A cannot comment as user B in upper case',
    $q$SELECT public.add_comment('c0c0c0c0-0000-4000-8000-000000000001', 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB', 'rpc-test forged', NULL)$q$, '42501');
  PERFORM hon_test.rpc_expect_error('user A cannot comment as guest-user',
    $q$SELECT public.add_comment('c0c0c0c0-0000-4000-8000-000000000001', 'guest-user', 'rpc-test forged', NULL)$q$, '42501');
  PERFORM hon_test.rpc_expect_error('user A cannot read the vote of user B',
    $q$SELECT public.get_comment_votes('c0c0c0c0-0000-4000-8000-0000000000c1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')$q$, '42501');
  PERFORM hon_test.rpc_expect_error('user A cannot list the subscriptions of user B (uuid)',
    $q$SELECT * FROM public.get_user_subscriptions('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid)$q$, '42501');
  PERFORM hon_test.rpc_expect_error('user A cannot list the subscriptions of user B (text)',
    $q$SELECT * FROM public.get_user_subscriptions('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::text)$q$, '42501');
  PERFORM hon_test.rpc_expect_error('user A cannot read a subscription of user B (text)',
    $q$SELECT public.is_subscribed('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::text, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text)$q$, '42501');
  PERFORM hon_test.rpc_expect_error('user A cannot read a subscription of a wallet string',
    $q$SELECT public.is_subscribed('WalletBBB'::text, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text)$q$, '42501');
  PERFORM hon_test.rpc_expect_error('user A cannot read a subscription of user B (uuid)',
    $q$SELECT public.is_subscribed('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid)$q$, '42501');
  PERFORM hon_test.rpc_expect_error('user A cannot save a canvas event as user B',
    $q$SELECT public.save_canvas_event('canvas-b', 'panel_create', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')$q$, '42501');
  PERFORM hon_test.rpc_expect_error('user A cannot create a canvas snapshot as user B',
    $q$SELECT public.create_canvas_snapshot('canvas-b', 'manual', '{}', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')$q$, '42501');
  PERFORM hon_test.rpc_expect_text('user A cannot read the canvas snapshot of user B',
    $q$SELECT count(*)::text FROM public.get_canvas_snapshot('c0c0c0c0-0000-4000-8000-0000000000e1')$q$, '0');
  PERFORM hon_test.rpc_expect_text('user A cannot read the canvas timeline of user B',
    $q$SELECT count(*)::text FROM public.get_canvas_timeline('canvas-b', 10)$q$, '0');
  PERFORM hon_test.rpc_expect_text('user A cannot change the canvas thumbnail of user B',
    $q$SELECT public.update_canvas_snapshot_thumbnail('c0c0c0c0-0000-4000-8000-0000000000e1', 'https://example.test/x.png')::text$q$, 'false');
END
$$;

-- User A still acts as itself.
DO $$
BEGIN
  PERFORM hon_test.rpc_expect_text('user A comments as itself',
    $q$SELECT (public.add_comment('c0c0c0c0-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'rpc-test own', NULL) IS NOT NULL)::text$q$, 'true');
  PERFORM hon_test.rpc_expect_text('user A comments without an ID',
    $q$SELECT (public.add_comment('c0c0c0c0-0000-4000-8000-000000000002', NULL, 'rpc-test own null', NULL) IS NOT NULL)::text$q$, 'true');
  PERFORM hon_test.rpc_expect_error('a comic ID that is not a uuid is refused with 22P02',
    $q$SELECT public.add_comment('draft-2', NULL, 'rpc-test bad id', NULL)$q$, '22P02');
  PERFORM hon_test.rpc_expect_text('user A reads counts and its own vote',
    $q$SELECT public.get_comment_votes('c0c0c0c0-0000-4000-8000-0000000000c1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')::text$q$,
    '{"upvotes": 0, "downvotes": 1, "user_vote": null}');
  PERFORM hon_test.rpc_expect_text('user A lists its own subscriptions with public creator fields',
    $q$SELECT string_agg(username || ' ' || wallet_address, ',') FROM public.get_user_subscriptions('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid)$q$,
    'user_b WalletBBB');
  PERFORM hon_test.rpc_expect_text('user A lists its own creator subscriptions',
    $q$SELECT count(*)::text FROM public.get_user_subscriptions('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text)$q$, '0');
  PERFORM hon_test.rpc_expect_text('user A reads its own creator subscription state',
    $q$SELECT public.is_subscribed('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::text)::text$q$, 'false');
  PERFORM hon_test.rpc_expect_error('a creator ID that is not a uuid is refused with 22P02',
    $q$SELECT public.is_subscribed('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text, 'WalletBBB'::text)$q$, '22P02');
  PERFORM hon_test.rpc_expect_text('user A reads its own subscription state (uuid)',
    $q$SELECT public.is_subscribed('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid)::text$q$, 'true');
END
$$;

-- User B's rows are unchanged; user A's comments are stored under user A.
RESET ROLE;
DO $$
BEGIN
  PERFORM hon_test.rpc_expect_text('user B rows unchanged after user A calls',
    $q$SELECT (SELECT count(*) FROM public.comic_comments WHERE user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
           || ' ' || (SELECT count(*) FROM public.creator_subscriptions WHERE subscriber_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
           || ' ' || (SELECT count(*) FROM public.subscriptions WHERE subscriber_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
           || ' ' || (SELECT count(*) FROM public.canvas_history_snapshots WHERE user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' AND canvas_state ? 'thumbnail')
           || ' ' || (SELECT count(*) FROM public.canvas_history_events WHERE project_id = 'canvas-b')
           || ' ' || (SELECT count(*) FROM public.profiles_new WHERE display_name = 'B on profiles_new')
           || ' ' || (SELECT count(*) FROM public.comics_new WHERE creator_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')$q$,
    '1 1 1 0 1 1 2');
  PERFORM hon_test.rpc_expect_text('user A comments are stored under user A',
    $q$SELECT count(*)::text FROM public.comic_comments
       WHERE content LIKE 'rpc-test own%' AND user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$q$, '2');
END
$$;

-- 4. Visitors use the public reads and nothing that needs an identity.
SET ROLE anon;
SET request.jwt.claim.sub = '';
SET request.jwt.claim.role = 'anon';
DO $$
BEGIN
  -- The live get_comments_for_comic compares a uuid column with a text
  -- argument and fails for every caller (42883); the migration does not change its body.
  PERFORM hon_test.rpc_expect_error('get_comments_for_comic fails as on the live project',
    $q$SELECT * FROM public.get_comments_for_comic('c0c0c0c0-0000-4000-8000-000000000001')$q$, '42883');
  -- get_comment_votes(uuid) cannot be called with one argument while
  -- get_comment_votes(uuid, text DEFAULT NULL) exists (42725, not unique).
  PERFORM hon_test.rpc_expect_error('get_comment_votes with one argument is ambiguous, as on the live project',
    $q$SELECT public.get_comment_votes('c0c0c0c0-0000-4000-8000-0000000000c1'::uuid)$q$, '42725');
  PERFORM hon_test.rpc_expect_text('anon reads vote counts; a supplied user ID is ignored',
    $q$SELECT public.get_comment_votes('c0c0c0c0-0000-4000-8000-0000000000c1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')::text$q$,
    '{"upvotes": 0, "downvotes": 1, "user_vote": null}');
  PERFORM hon_test.rpc_expect_text('anon maps a draft ID to a comic ID',
    $q$SELECT public.get_comic_id_from_draft_id('draft-1')::text$q$, 'c0c0c0c0-0000-4000-8000-000000000001');
  PERFORM hon_test.rpc_expect_text('anon counts a view',
    $q$SELECT public.increment_comic_views('c0c0c0c0-0000-4000-8000-000000000001')::text$q$, '');
  PERFORM hon_test.rpc_expect_text('anon reads a subscriber count',
    $q$SELECT public.subscriber_count('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')::text$q$, '1');
  PERFORM hon_test.rpc_expect_error('anon cannot comment',
    $q$SELECT public.add_comment('c0c0c0c0-0000-4000-8000-000000000001', 'guest-user', 'rpc-test anon', NULL)$q$, '42501');
  PERFORM hon_test.rpc_expect_error('anon cannot list subscriptions',
    $q$SELECT * FROM public.get_user_subscriptions('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid)$q$, '42501');
  PERFORM hon_test.rpc_expect_error('anon cannot read a subscription',
    $q$SELECT public.is_subscribed('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::text, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text)$q$, '42501');
  PERFORM hon_test.rpc_expect_error('anon cannot read a canvas snapshot',
    $q$SELECT * FROM public.get_canvas_snapshot('c0c0c0c0-0000-4000-8000-0000000000e1')$q$, '42501');
  PERFORM hon_test.rpc_no_private('get_comment_votes as anon returns no private value',
    $q$SELECT public.get_comment_votes('c0c0c0c0-0000-4000-8000-0000000000c1', NULL) AS v$q$);
END
$$;
RESET ROLE;
DO $$
BEGIN
  PERFORM hon_test.rpc_expect_text('the view was counted',
    $q$SELECT view_count::text FROM public.comic_stats WHERE comic_id = 'c0c0c0c0-0000-4000-8000-000000000001'$q$, '1');
END
$$;

-- 5. Results with profile data hold only public columns.
SET ROLE authenticated;
SET request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SET request.jwt.claim.role = 'authenticated';
DO $$
BEGIN
  PERFORM hon_test.rpc_no_private('get_user_subscriptions(uuid) as user A returns no private value',
    $q$SELECT * FROM public.get_user_subscriptions('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid)$q$);
END
$$;

-- 6. service_role runs the admin helpers and acts for a named user.
SET ROLE service_role;
SET request.jwt.claim.sub = '';
SET request.jwt.claim.role = 'service_role';
DO $$
BEGIN
  PERFORM hon_test.rpc_expect_text('service_role reads the server version',
    $q$SELECT left(public.get_pg_version(), 10)$q$, 'PostgreSQL');
  PERFORM hon_test.rpc_expect_text('service_role runs setup_collaboration_tables',
    $q$SELECT public.setup_collaboration_tables()::text$q$, '');
  PERFORM hon_test.rpc_expect_text('service_role sets app.current_user_id',
    $q$SELECT public.set_current_user_id('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')::text$q$, '');
  PERFORM hon_test.rpc_expect_text('service_role reads project storage stats',
    $q$SELECT total_snapshots::text FROM public.get_project_storage_stats('canvas-b')$q$, '1');
  PERFORM hon_test.rpc_expect_text('service_role runs cleanup_old_events',
    $q$SELECT public.cleanup_old_events(100000)::text$q$, '0');
  PERFORM hon_test.rpc_expect_text('service_role runs cleanup_old_snapshots',
    $q$SELECT public.cleanup_old_snapshots(NULL, 50, 100000)::text$q$, '0');
  PERFORM hon_test.rpc_expect_error('get_user_likes fails because public.likes does not exist',
    $q$SELECT * FROM public.get_user_likes('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')$q$, '42P01');
  PERFORM hon_test.rpc_expect_error('is_comic_bookmarked fails because public.bookmarks does not exist',
    $q$SELECT public.is_comic_bookmarked('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'draft-1')$q$, '42P01');
  PERFORM hon_test.rpc_expect_text('service_role resolves a username',
    $q$SELECT public.get_user_id_from_identifier('user_b')::text$q$, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  PERFORM hon_test.rpc_expect_text('service_role resolves a user ID',
    $q$SELECT public.get_user_id_from_identifier('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')::text$q$, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  PERFORM hon_test.rpc_expect_text('get_user_id_from_identifier no longer matches an email',
    $q$SELECT coalesce(public.get_user_id_from_identifier('b@example.test')::text, 'none')$q$, 'none');
  PERFORM hon_test.rpc_expect_text('service_role reads a creator subscription of user B',
    $q$SELECT public.is_subscribed('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::text, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text)::text$q$, 'true');
  PERFORM hon_test.rpc_expect_text('service_role lists the creator subscriptions of user B',
    $q$SELECT count(*)::text FROM public.get_user_subscriptions('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::text)$q$, '1');
  PERFORM hon_test.rpc_expect_text('service_role reads the vote of user B',
    $q$SELECT public.get_comment_votes('c0c0c0c0-0000-4000-8000-0000000000c1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')->>'user_vote'$q$, '-1');
  PERFORM hon_test.rpc_expect_text('service_role comments for user B',
    $q$SELECT (public.add_comment('c0c0c0c0-0000-4000-8000-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'rpc-test service', NULL) IS NOT NULL)::text$q$, 'true');
  PERFORM hon_test.rpc_expect_error('service_role with a user ID that is not a uuid gets 22P02',
    $q$SELECT public.add_comment('c0c0c0c0-0000-4000-8000-000000000002', 'guest-user', 'rpc-test bad user', NULL)$q$, '22P02');
  PERFORM hon_test.rpc_expect_error('service_role without a user ID cannot comment',
    $q$SELECT public.add_comment('c0c0c0c0-0000-4000-8000-000000000002', NULL, 'rpc-test no user', NULL)$q$, '42501');
  PERFORM hon_test.rpc_no_private('get_user_subscriptions(uuid) for user B returns no private value',
    $q$SELECT * FROM public.get_user_subscriptions('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid)$q$);
  PERFORM hon_test.rpc_no_private('get_user_subscriptions(text) for user B returns no private value',
    $q$SELECT * FROM public.get_user_subscriptions('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::text)$q$);
END
$$;

-- 7. profiles_new and comics_new: owner policies on auth.uid(), public
-- columns through profiles_new_public.
SET ROLE anon;
SET request.jwt.claim.sub = '';
SET request.jwt.claim.role = 'anon';
DO $$
BEGIN
  PERFORM hon_test.rpc_expect_error('anon cannot read profiles_new',
    'SELECT count(*) FROM public.profiles_new', '42501');
  PERFORM hon_test.rpc_expect_text('anon reads both rows of profiles_new_public',
    'SELECT string_agg(username, $s$,$s$ ORDER BY username) FROM public.profiles_new_public', 'new_a,new_b');
  PERFORM hon_test.rpc_no_private('profiles_new_public as anon returns no private value',
    'SELECT * FROM public.profiles_new_public');
  PERFORM hon_test.rpc_expect_error('anon cannot write through profiles_new_public',
    $q$UPDATE public.profiles_new_public SET username = 'x'$q$, '42501');
  PERFORM hon_test.rpc_expect_text('anon reads only published comics_new rows',
    'SELECT string_agg(id, $s$,$s$) FROM public.comics_new', 'comic-new-b-published');
END
$$;
SET ROLE authenticated;
SET request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SET request.jwt.claim.role = 'authenticated';
DO $$
BEGIN
  PERFORM hon_test.rpc_no_private('profiles_new_public as user A returns no private value',
    'SELECT * FROM public.profiles_new_public');
  PERFORM hon_test.rpc_expect_text('user A updates its own profiles_new row',
    $q$WITH u AS (UPDATE public.profiles_new SET bio = 'rpc-test bio' WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' RETURNING 1) SELECT count(*)::text FROM u$q$, '1');
  PERFORM hon_test.rpc_expect_text('user A cannot update the profiles_new row of user B',
    $q$WITH u AS (UPDATE public.profiles_new SET bio = 'rpc-test forged' WHERE id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' RETURNING 1) SELECT count(*)::text FROM u$q$, '0');
  PERFORM hon_test.rpc_expect_error('user A cannot insert a profiles_new row for user B',
    $q$INSERT INTO public.profiles_new (id, username) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'rpc_test_forged')$q$, '42501');
  PERFORM hon_test.rpc_expect_text('user A creates its own comics_new row',
    $q$WITH i AS (INSERT INTO public.comics_new (id, title, creator_id) VALUES ('rpc-test-comic-a', 'rpc-test', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') RETURNING 1) SELECT count(*)::text FROM i$q$, '1');
  PERFORM hon_test.rpc_expect_error('user A cannot create a comics_new row for user B',
    $q$INSERT INTO public.comics_new (id, title, creator_id) VALUES ('rpc-test-comic-b', 'rpc-test', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')$q$, '42501');
  PERFORM hon_test.rpc_expect_text('user A cannot update the published comic of user B',
    $q$WITH u AS (UPDATE public.comics_new SET title = 'rpc-test forged' WHERE id = 'comic-new-b-published' RETURNING 1) SELECT count(*)::text FROM u$q$, '0');
  PERFORM hon_test.rpc_expect_text('user A cannot delete the published comic of user B',
    $q$WITH d AS (DELETE FROM public.comics_new WHERE id = 'comic-new-b-published' RETURNING 1) SELECT count(*)::text FROM d$q$, '0');
END
$$;
SET ROLE service_role;
SET request.jwt.claim.sub = '';
SET request.jwt.claim.role = 'service_role';
DO $$
BEGIN
  PERFORM hon_test.rpc_expect_text('service_role reads every profiles_new row',
    'SELECT count(*)::text FROM public.profiles_new', '2');
END
$$;

-- profiles_new table grants after hardening, by role: anon none of the seven
-- (also not on a column), authenticated exactly SELECT, INSERT, UPDATE and
-- DELETE, service_role all seven as live (unchanged). Direct grants from
-- information_schema.role_table_grants and effective privileges must agree.
SET ROLE authenticated;
SET request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SET request.jwt.claim.role = 'authenticated';
DO $$
BEGIN
  PERFORM hon_test.rpc_expect_error('user A cannot truncate profiles_new',
    'TRUNCATE public.profiles_new', '42501');
END
$$;
SET ROLE anon;
SET request.jwt.claim.sub = '';
SET request.jwt.claim.role = 'anon';
DO $$
BEGIN
  PERFORM hon_test.rpc_expect_error('anon cannot truncate profiles_new',
    'TRUNCATE public.profiles_new', '42501');
END
$$;
RESET ROLE;
RESET request.jwt.claim.sub;
RESET request.jwt.claim.role;
DO $$
BEGIN
  PERFORM hon_test.rpc_expect_text('direct table grants on profiles_new after hardening',
    $q$SELECT string_agg(grantee || ':' || privs, ' ' ORDER BY grantee)
       FROM (SELECT grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
             FROM information_schema.role_table_grants
             WHERE table_schema = 'public' AND table_name = 'profiles_new'
               AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role')
             GROUP BY grantee) g$q$,
    'authenticated:DELETE,INSERT,SELECT,UPDATE service_role:DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE');
  PERFORM hon_test.rpc_expect_text('effective profiles_new privileges after hardening',
    $q$SELECT string_agg(r || ':' || coalesce((SELECT string_agg(v, ',' ORDER BY v)
                                               FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) v
                                               WHERE has_table_privilege(r, 'public.profiles_new', v)), '-'), ' ' ORDER BY r)
       FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r$q$,
    'anon:- authenticated:DELETE,INSERT,SELECT,UPDATE service_role:DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE');
  PERFORM hon_test.rpc_expect_text('no column privilege on profiles_new for anon, no column REFERENCES for authenticated',
    $q$SELECT (has_any_column_privilege('anon', 'public.profiles_new', 'SELECT')
               OR has_any_column_privilege('anon', 'public.profiles_new', 'INSERT')
               OR has_any_column_privilege('anon', 'public.profiles_new', 'UPDATE')
               OR has_any_column_privilege('anon', 'public.profiles_new', 'REFERENCES')
               OR has_any_column_privilege('authenticated', 'public.profiles_new', 'REFERENCES'))::text$q$, 'false');
END
$$;

-- 8. The five live triggers still fire after search_path is pinned, for
-- roles without EXECUTE on the trigger function. Timestamps are first set
-- back without firing triggers. The four unattached trigger functions are
-- checked at call level only (section 2).
RESET ROLE;
RESET request.jwt.claim.sub;
RESET request.jwt.claim.role;
SET session_replication_role = replica;
UPDATE public.profiles SET updated_at = '2000-01-01' WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
UPDATE public.hon_evi_sessions SET updated_at = '2000-01-01';
RESET session_replication_role;

SET ROLE hon_auth_admin;
INSERT INTO auth.users (id, email) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'c@example.test');
SET ROLE authenticated;
SET request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SET request.jwt.claim.role = 'authenticated';
UPDATE public.profiles SET first_name = first_name WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
UPDATE public.hon_evi_sessions SET updated_at = updated_at;
SELECT public.create_canvas_snapshot('rpc-test-canvas-a', 'manual', '{"marker": "canvas-a"}') IS NOT NULL AS created;
RESET ROLE;
RESET request.jwt.claim.sub;
RESET request.jwt.claim.role;
DO $$
BEGIN
  PERFORM hon_test.rpc_expect_text('on_auth_user_created: handle_new_user created the profile with a wallet_id',
    $q$SELECT (wallet_id IS NOT NULL)::text FROM public.profiles WHERE id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'$q$, 'true');
  PERFORM hon_test.rpc_expect_text('update_profiles_updated_at: handle_updated_at set updated_at',
    $q$SELECT (updated_at > '2001-01-01')::text FROM public.profiles WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$q$, 'true');
  PERFORM hon_test.rpc_expect_text('update_hon_evi_sessions_updated_at set updated_at',
    $q$SELECT (updated_at > '2001-01-01')::text FROM public.hon_evi_sessions$q$, 'true');
  PERFORM hon_test.rpc_expect_text('calculate_snapshot_size_trigger set snapshot_size_bytes',
    $q$SELECT (snapshot_size_bytes > 0)::text FROM public.canvas_history_snapshots WHERE project_id = 'rpc-test-canvas-a'$q$, 'true');
END
$$;

-- Remove the rows this file added.
DELETE FROM public.profiles WHERE id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
DELETE FROM auth.users WHERE id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
DELETE FROM public.canvas_history_snapshots WHERE project_id = 'rpc-test-canvas-a';
DELETE FROM public.comics_new WHERE id LIKE 'rpc-test%';
UPDATE public.profiles_new SET bio = NULL WHERE bio LIKE 'rpc-test%';
DELETE FROM public.comic_comments WHERE content LIKE 'rpc-test%';
DELETE FROM public.comic_stats WHERE comic_id = 'c0c0c0c0-0000-4000-8000-000000000001';
DO $$
BEGIN
  PERFORM hon_test.rpc_expect_text('fixture rows restored',
    $q$SELECT (SELECT count(*) FROM public.comic_comments) || ' ' || (SELECT count(*) FROM public.comic_stats)
           || ' ' || (SELECT count(*) FROM auth.users) || ' ' || (SELECT count(*) FROM public.comics_new)
           || ' ' || (SELECT count(*) FROM public.profiles_new WHERE bio IS NOT NULL)$q$, '1 0 2 3 0');
END
$$;
