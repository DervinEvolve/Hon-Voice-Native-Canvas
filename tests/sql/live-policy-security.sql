-- Assertions for migrations/harden_live_policies.sql on the disposable fixture
-- (tests/sql/live-policy-fixture.sql). Each failure names its assertion.
-- User A and user B come from tests/sql/database-bootstrap.sql.
\set ON_ERROR_STOP on
RESET ROLE;

CREATE SCHEMA IF NOT EXISTS hon_test;
GRANT USAGE ON SCHEMA hon_test TO anon, authenticated, service_role;

-- Passes when the statement is refused or changes no rows.
CREATE OR REPLACE FUNCTION hon_test.expect_denied(label text, statement text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  changed bigint;
BEGIN
  BEGIN
    EXECUTE statement;
    GET DIAGNOSTICS changed = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN
    RETURN;
  END;
  IF changed > 0 THEN
    RAISE EXCEPTION 'Assertion failed: % (% rows changed)', label, changed;
  END IF;
END
$$;

-- Passes when the statement changes exactly the expected number of rows.
CREATE OR REPLACE FUNCTION hon_test.expect_rows(label text, statement text, expected bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  changed bigint;
BEGIN
  BEGIN
    EXECUTE statement;
    GET DIAGNOSTICS changed = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Assertion failed: % (%)', label, SQLERRM;
  END;
  IF changed <> expected THEN
    RAISE EXCEPTION 'Assertion failed: % (% rows, expected %)', label, changed, expected;
  END IF;
END
$$;

-- Passes when a count query returns the expected value.
CREATE OR REPLACE FUNCTION hon_test.expect_count(label text, query text, expected bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  found bigint;
BEGIN
  BEGIN
    EXECUTE query INTO found;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Assertion failed: % (%)', label, SQLERRM;
  END;
  IF found IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'Assertion failed: % (got %, expected %)', label, found, expected;
  END IF;
END
$$;

-- Passes when a count query is refused or returns zero.
CREATE OR REPLACE FUNCTION hon_test.expect_hidden(label text, query text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  found bigint;
BEGIN
  BEGIN
    EXECUTE query INTO found;
  EXCEPTION WHEN insufficient_privilege THEN
    RETURN;
  END;
  IF found > 0 THEN
    RAISE EXCEPTION 'Assertion failed: % (% rows visible)', label, found;
  END IF;
END
$$;

-- Passes only when the statement fails with the given SQLSTATE.
CREATE OR REPLACE FUNCTION hon_test.expect_error(label text, statement text, state text) RETURNS void
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
CREATE OR REPLACE FUNCTION hon_test.expect_text(label text, query text, expected text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  found text;
BEGIN
  BEGIN
    EXECUTE query INTO found;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Assertion failed: % (%)', label, SQLERRM;
  END;
  IF found IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'Assertion failed: % (got %, expected %)', label, found, expected;
  END IF;
END
$$;

-- Reads every table and view the current role may select from, in every
-- non-system schema, and fails if any visible value contains one of the
-- markers. Only columns the role may read are selected.
CREATE OR REPLACE FUNCTION hon_test.expect_no_marker(label text, markers text[]) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  r record;
  cols text;
  found bigint;
BEGIN
  FOR r IN
    SELECT c.oid, n.nspname, c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'hon_test')
      AND n.nspname NOT LIKE 'pg_toast%'
      AND has_any_column_privilege(c.oid, 'SELECT')
  LOOP
    SELECT string_agg(quote_ident(a.attname), ', ') INTO cols
    FROM pg_attribute a
    WHERE a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
      AND has_column_privilege(r.oid, a.attnum, 'SELECT');
    CONTINUE WHEN cols IS NULL;
    EXECUTE format('SELECT count(*) FROM (SELECT %s FROM %I.%I) t WHERE to_jsonb(t)::text ILIKE ANY ($1)',
                   cols, r.nspname, r.relname)
      INTO found
      USING (SELECT array_agg('%' || m || '%') FROM unnest(markers) AS m);
    IF found > 0 THEN
      RAISE EXCEPTION 'Assertion failed: % (% rows in %.% show a marker)', label, found, r.nspname, r.relname;
    END IF;
  END LOOP;
END
$$;

-- Fresh rows for every run. User B owns data; user A creates its profile in (c).
TRUNCATE public.sharp_jobs, public.gaussian_jobs, public.profiles,
  public.comment_votes, public.subscriptions, public.waitlist, storage.objects;
-- The canvas history tables depend on the layout under test.
DO $canvas_rows$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['canvas_history', 'canvas_history_events', 'canvas_history_snapshots'] LOOP
    CONTINUE WHEN to_regclass(format('public.%I', t)) IS NULL;
    EXECUTE format('TRUNCATE public.%I', t);
    EXECUTE format('INSERT INTO public.%I (project_id, user_id, wallet_address%s) VALUES '
                   '(''draft-b'', ''bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'', ''WalletBBB''%s)',
                   t, CASE WHEN t = 'canvas_history_events' THEN ', event_type' ELSE '' END,
                   CASE WHEN t = 'canvas_history_events' THEN ', ''panel_create''' ELSE '' END);
  END LOOP;
END
$canvas_rows$;
INSERT INTO public.sharp_jobs (id, image_url, status, ply_url, filename, size_bytes)
  VALUES ('job-1', 'https://example.test/a.png', 'completed', 'https://example.test/a.ply', 'output.ply', 10);
INSERT INTO public.gaussian_jobs (job_id, video_url, panel_id, quality, status)
  VALUES ('gaussian-1', 'https://example.test/v.mp4', 'panel-1', 'high', 'processing');
INSERT INTO public.profiles (id, email, discord_id, twitter_id, google_id, notification_preferences,
                             solana_wallet, wallet_address, privy_user_id, username, first_name,
                             last_name, avatar_url, bio, social_links)
VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b@example.test', 'discord-fake-b', 'twitter-fake-b',
        'google-fake-b', '{"support_received": false, "new_stories": true, "marker": "prefs-fake-b"}',
        'WalletBBB', 'WalletBBB', 'privy-fake-b', 'user_b', 'Bo', 'Beta',
        'https://example.test/b.png', 'bio b', '[]');
SELECT set_config('hon_test.b_wallet_id', wallet_id::text, false)
FROM public.profiles WHERE id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
INSERT INTO public.waitlist (email, source) VALUES
  ('wait-one@example.test', 'landing_page'),
  ('wait-two@example.test', 'login_page_waitlist');
INSERT INTO public.comment_votes (comment_id, user_id, vote_type)
  VALUES ('11111111-1111-4111-8111-111111111111', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 1);
INSERT INTO public.subscriptions (subscriber_id, creator_id) VALUES
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'WalletCCC'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
INSERT INTO storage.objects (bucket_id, name, owner) VALUES
  ('profile-images', 'profiles/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/avatar_b_1.png', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  ('hon-assets', 'worlds/world-1.ply', NULL);

-- (c) User A can create and change their own rows.
SET ROLE authenticated;
SET request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SET request.jwt.claim.role = 'authenticated';
SET request.headers = '{}';
DO $own$
BEGIN
  PERFORM hon_test.expect_rows('(c) A inserts own profile',
    $q$INSERT INTO public.profiles (id, email, discord_id, twitter_id, google_id,
                                   notification_preferences, solana_wallet, wallet_address,
                                   privy_user_id, username, first_name, last_name, avatar_url)
       VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@example.test', 'discord-fake-a',
               'twitter-fake-a', 'google-fake-a', '{"marker": "prefs-fake-a"}', 'WalletAAA',
               'WalletAAA', 'privy-fake-a', 'user_a', 'Ada', 'Alpha', 'https://example.test/a.png')$q$, 1);
  PERFORM hon_test.expect_rows('(c) A updates own profile',
    $q$UPDATE public.profiles SET bio = 'mine' WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$q$, 1);

  PERFORM hon_test.expect_rows('(c) A votes as A',
    $q$INSERT INTO public.comment_votes (comment_id, user_id, vote_type)
       VALUES ('22222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 1)$q$, 1);
  PERFORM hon_test.expect_rows('(c) A changes own vote',
    $q$UPDATE public.comment_votes SET vote_type = -1
       WHERE user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$q$, 1);
  PERFORM hon_test.expect_rows('(c) A removes own vote',
    $q$DELETE FROM public.comment_votes WHERE user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$q$, 1);

  PERFORM hon_test.expect_rows('(c) A subscribes as A',
    $q$INSERT INTO public.subscriptions (subscriber_id, creator_id)
       VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'WalletCCC')$q$, 1);
  PERFORM hon_test.expect_count('(c) A reads own subscription',
    $q$SELECT count(*) FROM public.subscriptions
       WHERE subscriber_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$q$, 1);
  PERFORM hon_test.expect_rows('(c) A unsubscribes as A',
    $q$DELETE FROM public.subscriptions WHERE subscriber_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$q$, 1);

  PERFORM hon_test.expect_rows('(c) A uploads into own profile-images folder',
    $q$INSERT INTO storage.objects (bucket_id, name, owner)
       VALUES ('profile-images', 'profiles/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/avatar_a_1.png',
               'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$q$, 1);
  PERFORM hon_test.expect_rows('(c) A replaces own profile image',
    $q$UPDATE storage.objects SET name = 'profiles/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/avatar_a_2.png'
       WHERE name = 'profiles/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/avatar_a_1.png'$q$, 1);
  PERFORM hon_test.expect_rows('(c) A deletes own profile image',
    $q$DELETE FROM storage.objects
       WHERE name = 'profiles/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/avatar_a_2.png'$q$, 1);

  IF to_regclass('public.canvas_history') IS NOT NULL THEN
    PERFORM hon_test.expect_rows('(c) A saves own canvas_history row',
      $q$INSERT INTO public.canvas_history (project_id, user_id)
         VALUES ('draft-a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$q$, 1);
  END IF;
  IF to_regclass('public.canvas_history_events') IS NOT NULL THEN
    PERFORM hon_test.expect_rows('(c) A saves own canvas_history_events row',
      $q$INSERT INTO public.canvas_history_events (project_id, user_id, event_type)
         VALUES ('draft-a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'panel_create')$q$, 1);
  END IF;
  IF to_regclass('public.canvas_history_snapshots') IS NOT NULL THEN
    PERFORM hon_test.expect_rows('(c) A saves own canvas_history_snapshots row',
      $q$INSERT INTO public.canvas_history_snapshots (project_id, user_id)
         VALUES ('draft-a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$q$, 1);
  END IF;
  IF to_regclass('public.canvas_history') IS NOT NULL THEN
    PERFORM hon_test.expect_count('(c) A reads only own canvas_history',
      'SELECT count(*) FROM public.canvas_history', 1);
  END IF;
  IF to_regclass('public.canvas_history_events') IS NOT NULL THEN
    PERFORM hon_test.expect_count('(c) A reads only own canvas_history_events',
      'SELECT count(*) FROM public.canvas_history_events', 1);
  END IF;
  IF to_regclass('public.canvas_history_snapshots') IS NOT NULL THEN
    PERFORM hon_test.expect_count('(c) A reads only own canvas_history_snapshots',
      'SELECT count(*) FROM public.canvas_history_snapshots', 1);
  END IF;
END
$own$;

-- (b) User A cannot act on user B's rows.
SET request.headers = '{"x-wallet-address": "WalletBBB"}';
DO $cross$
BEGIN
  PERFORM hon_test.expect_denied('(b) A updates B profile',
    $q$UPDATE public.profiles SET username = 'taken' WHERE id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'$q$);
  PERFORM hon_test.expect_denied('(b) A updates B profile by wallet',
    $q$UPDATE public.profiles SET username = 'taken' WHERE solana_wallet = 'WalletBBB'$q$);
  PERFORM hon_test.expect_denied('(b) A inserts profile with id of B',
    $q$INSERT INTO public.profiles (id, solana_wallet, username)
       VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'WalletB2', 'b_two')$q$);
  PERFORM hon_test.expect_denied('(b) A inserts wallet-only profile',
    $q$INSERT INTO public.profiles (wallet_id, solana_wallet, username)
       VALUES (gen_random_uuid(), 'WalletDDD', 'wallet_d')$q$);
  PERFORM hon_test.expect_denied('(b) A moves own profile to id of B',
    $q$UPDATE public.profiles SET id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
       WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$q$);

  PERFORM hon_test.expect_denied('(b) A votes as B',
    $q$INSERT INTO public.comment_votes (comment_id, user_id, vote_type)
       VALUES ('22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 1)$q$);
  PERFORM hon_test.expect_denied('(b) A changes B vote',
    $q$UPDATE public.comment_votes SET vote_type = -1 WHERE user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'$q$);
  PERFORM hon_test.expect_denied('(b) A deletes B vote',
    $q$DELETE FROM public.comment_votes WHERE user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'$q$);

  PERFORM hon_test.expect_denied('(b) A subscribes as B',
    $q$INSERT INTO public.subscriptions (subscriber_id, creator_id)
       VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'WalletZZZ')$q$);
  PERFORM hon_test.expect_denied('(b) A deletes B subscription',
    $q$DELETE FROM public.subscriptions WHERE subscriber_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'$q$);
  PERFORM hon_test.expect_denied('(b) A updates a subscription',
    $q$UPDATE public.subscriptions SET creator_id = 'WalletZZZ'$q$);
  PERFORM hon_test.expect_hidden('(b) A reads B subscription to another creator',
    $q$SELECT count(*) FROM public.subscriptions WHERE creator_id = 'WalletCCC'$q$);
  PERFORM hon_test.expect_count('(b) A as creator reads only rows naming A',
    'SELECT count(*) FROM public.subscriptions', 1);

  PERFORM hon_test.expect_denied('(b) A writes into B profile-images folder as A',
    $q$INSERT INTO storage.objects (bucket_id, name, owner)
       VALUES ('profile-images', 'profiles/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/evil.png',
               'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$q$);
  PERFORM hon_test.expect_denied('(b) A writes into B profile-images folder as owner B',
    $q$INSERT INTO storage.objects (bucket_id, name, owner)
       VALUES ('profile-images', 'profiles/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/evil.png',
               'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')$q$);
  PERFORM hon_test.expect_denied('(b) A writes outside the profiles/ prefix',
    $q$INSERT INTO storage.objects (bucket_id, name, owner)
       VALUES ('profile-images', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/evil.png',
               'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$q$);
  PERFORM hon_test.expect_denied('(b) A replaces B profile image',
    $q$UPDATE storage.objects SET owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
       WHERE bucket_id = 'profile-images'$q$);
  PERFORM hon_test.expect_denied('(b) A deletes B profile image',
    $q$DELETE FROM storage.objects WHERE bucket_id = 'profile-images'$q$);
  PERFORM hon_test.expect_denied('(b) A uploads to hon-assets',
    $q$INSERT INTO storage.objects (bucket_id, name, owner)
       VALUES ('hon-assets', 'worlds/world-a.ply', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$q$);
  PERFORM hon_test.expect_denied('(b) A changes hon-assets objects',
    $q$UPDATE storage.objects SET owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' WHERE bucket_id = 'hon-assets'$q$);

  IF to_regclass('public.canvas_history') IS NOT NULL THEN
    PERFORM hon_test.expect_count('(b) A reads B canvas_history with B wallet supplied',
      $q$SELECT count(*) FROM public.canvas_history WHERE wallet_address = 'WalletBBB'$q$, 0);
  END IF;
  IF to_regclass('public.canvas_history_events') IS NOT NULL THEN
    PERFORM hon_test.expect_count('(b) A reads B canvas_history_events with B wallet supplied',
      $q$SELECT count(*) FROM public.canvas_history_events WHERE wallet_address = 'WalletBBB'$q$, 0);
  END IF;
  IF to_regclass('public.canvas_history_snapshots') IS NOT NULL THEN
    PERFORM hon_test.expect_count('(b) A reads B canvas_history_snapshots with B wallet supplied',
      $q$SELECT count(*) FROM public.canvas_history_snapshots WHERE wallet_address = 'WalletBBB'$q$, 0);
  END IF;
  IF to_regclass('public.canvas_history') IS NOT NULL THEN
    PERFORM hon_test.expect_denied('(b) A writes canvas_history as B',
      $q$INSERT INTO public.canvas_history (project_id, user_id, wallet_address)
         VALUES ('draft-b', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'WalletBBB')$q$);
  END IF;
  IF to_regclass('public.canvas_history_snapshots') IS NOT NULL THEN
    PERFORM hon_test.expect_denied('(b) A changes B canvas_history_snapshots',
      $q$UPDATE public.canvas_history_snapshots SET canvas_state = '{}' WHERE wallet_address = 'WalletBBB'$q$);
  END IF;

  PERFORM hon_test.expect_hidden('(b) A reads sharp_jobs', 'SELECT count(*) FROM public.sharp_jobs');
  PERFORM hon_test.expect_denied('(b) A writes sharp_jobs',
    $q$INSERT INTO public.sharp_jobs (id, image_url) VALUES ('job-a', 'https://example.test/a.png')$q$);
  PERFORM hon_test.expect_hidden('(b) A reads gaussian_jobs', 'SELECT count(*) FROM public.gaussian_jobs');
  PERFORM hon_test.expect_denied('(b) A writes gaussian_jobs',
    $q$INSERT INTO public.gaussian_jobs (job_id) VALUES ('gaussian-a')$q$);
  PERFORM hon_test.expect_denied('(b) A updates sharp_jobs', $q$UPDATE public.sharp_jobs SET status = 'done'$q$);
  PERFORM hon_test.expect_denied('(b) A deletes sharp_jobs', 'DELETE FROM public.sharp_jobs');
  PERFORM hon_test.expect_denied('(b) A updates gaussian_jobs', $q$UPDATE public.gaussian_jobs SET progress = 100$q$);
  PERFORM hon_test.expect_denied('(b) A deletes gaussian_jobs', 'DELETE FROM public.gaussian_jobs');
END
$cross$;

-- (a) The anon key cannot write any of these tables or buckets.
SET ROLE anon;
SET request.jwt.claim.sub = '';
SET request.jwt.claim.role = 'anon';
DO $anon_write$
BEGIN
  PERFORM hon_test.expect_denied('(a) anon inserts sharp_jobs',
    $q$INSERT INTO public.sharp_jobs (id, image_url) VALUES ('job-anon', 'https://example.test/a.png')$q$);
  PERFORM hon_test.expect_denied('(a) anon updates sharp_jobs', $q$UPDATE public.sharp_jobs SET status = 'done'$q$);
  PERFORM hon_test.expect_denied('(a) anon deletes sharp_jobs', 'DELETE FROM public.sharp_jobs');
  PERFORM hon_test.expect_hidden('(a) anon reads sharp_jobs', 'SELECT count(*) FROM public.sharp_jobs');
  PERFORM hon_test.expect_denied('(a) anon inserts gaussian_jobs',
    $q$INSERT INTO public.gaussian_jobs (job_id) VALUES ('gaussian-anon')$q$);
  PERFORM hon_test.expect_denied('(a) anon updates gaussian_jobs', $q$UPDATE public.gaussian_jobs SET status = 'done'$q$);
  PERFORM hon_test.expect_denied('(a) anon deletes gaussian_jobs', 'DELETE FROM public.gaussian_jobs');
  PERFORM hon_test.expect_hidden('(a) anon reads gaussian_jobs', 'SELECT count(*) FROM public.gaussian_jobs');

  PERFORM hon_test.expect_denied('(a) anon votes as guest-user',
    $q$INSERT INTO public.comment_votes (comment_id, user_id, vote_type)
       VALUES ('22222222-2222-4222-8222-222222222222', 'guest-user', 1)$q$);
  PERFORM hon_test.expect_denied('(a) anon changes votes', 'UPDATE public.comment_votes SET vote_type = -1');
  PERFORM hon_test.expect_denied('(a) anon deletes votes', 'DELETE FROM public.comment_votes');

  PERFORM hon_test.expect_denied('(a) anon subscribes',
    $q$INSERT INTO public.subscriptions (subscriber_id, creator_id) VALUES ('WalletEEE', 'WalletCCC')$q$);
  PERFORM hon_test.expect_denied('(a) anon updates subscriptions', $q$UPDATE public.subscriptions SET creator_id = 'x'$q$);
  PERFORM hon_test.expect_denied('(a) anon deletes subscriptions', 'DELETE FROM public.subscriptions');
  PERFORM hon_test.expect_hidden('(a) anon reads subscription rows', 'SELECT count(*) FROM public.subscriptions');

  PERFORM hon_test.expect_denied('(a) anon creates wallet-only profile',
    $q$INSERT INTO public.profiles (wallet_id, solana_wallet, username)
       VALUES (gen_random_uuid(), 'WalletEEE', 'wallet_e')$q$);
  PERFORM hon_test.expect_denied('(a) anon updates profile by wallet',
    $q$UPDATE public.profiles SET username = 'taken' WHERE solana_wallet = 'WalletBBB'$q$);

  PERFORM hon_test.expect_denied('(a) anon uploads to profile-images',
    $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('profile-images', 'profiles/WalletEEE/avatar.png')$q$);
  PERFORM hon_test.expect_denied('(a) anon changes profile-images',
    $q$UPDATE storage.objects SET name = 'profiles/x/y.png' WHERE bucket_id = 'profile-images'$q$);
  PERFORM hon_test.expect_denied('(a) anon deletes profile-images',
    $q$DELETE FROM storage.objects WHERE bucket_id = 'profile-images'$q$);
  PERFORM hon_test.expect_denied('(a) anon uploads to hon-assets',
    $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('hon-assets', 'worlds/world-anon.ply')$q$);
  PERFORM hon_test.expect_denied('(a) anon changes hon-assets',
    $q$UPDATE storage.objects SET name = 'worlds/x.ply' WHERE bucket_id = 'hon-assets'$q$);
  PERFORM hon_test.expect_denied('(a) anon deletes hon-assets',
    $q$DELETE FROM storage.objects WHERE bucket_id = 'hon-assets'$q$);

  IF to_regclass('public.canvas_history') IS NOT NULL THEN
    PERFORM hon_test.expect_hidden('(a) anon reads canvas_history with B wallet supplied',
      'SELECT count(*) FROM public.canvas_history');
  END IF;
  IF to_regclass('public.canvas_history_events') IS NOT NULL THEN
    PERFORM hon_test.expect_hidden('(a) anon reads canvas_history_events with B wallet supplied',
      'SELECT count(*) FROM public.canvas_history_events');
  END IF;
  IF to_regclass('public.canvas_history_snapshots') IS NOT NULL THEN
    PERFORM hon_test.expect_hidden('(a) anon reads canvas_history_snapshots with B wallet supplied',
      'SELECT count(*) FROM public.canvas_history_snapshots');
  END IF;
END
$anon_write$;

-- (d) The anon key keeps public reads.
SET request.headers = '{}';
DO $anon_read$
BEGIN
  PERFORM hon_test.expect_count('(d) anon reads vote rows',
    $q$SELECT count(*) FROM public.comment_votes WHERE comment_id = '11111111-1111-4111-8111-111111111111'$q$, 1);
  PERFORM hon_test.expect_count('(d) anon reads subscriber count by wallet',
    $q$SELECT public.subscriber_count('WalletCCC')$q$, 1);
  PERFORM hon_test.expect_count('(d) anon reads subscriber count by user ID',
    $q$SELECT public.subscriber_count('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$q$, 1);
END
$anon_read$;

-- (e) The service role can write every table and both buckets.
SET ROLE service_role;
SET request.jwt.claim.role = 'service_role';
DO $service$
BEGIN
  PERFORM hon_test.expect_rows('(e) service inserts sharp_jobs',
    $q$INSERT INTO public.sharp_jobs (id, image_url) VALUES ('job-s', 'https://example.test/s.png')$q$, 1);
  PERFORM hon_test.expect_rows('(e) service updates sharp_jobs',
    $q$UPDATE public.sharp_jobs SET status = 'done' WHERE id = 'job-s'$q$, 1);
  PERFORM hon_test.expect_rows('(e) service deletes sharp_jobs', $q$DELETE FROM public.sharp_jobs WHERE id = 'job-s'$q$, 1);
  PERFORM hon_test.expect_count('(e) service reads sharp_jobs', 'SELECT count(*) FROM public.sharp_jobs', 1);
  PERFORM hon_test.expect_count('(e) service reads gaussian_jobs', 'SELECT count(*) FROM public.gaussian_jobs', 1);
  PERFORM hon_test.expect_rows('(e) service inserts gaussian_jobs',
    $q$INSERT INTO public.gaussian_jobs (job_id, video_url) VALUES ('gaussian-s', 'https://example.test/s.mp4')$q$, 1);
  PERFORM hon_test.expect_rows('(e) service updates gaussian_jobs',
    $q$UPDATE public.gaussian_jobs SET status = 'done', progress = 100 WHERE job_id = 'gaussian-s'$q$, 1);
  PERFORM hon_test.expect_rows('(e) service deletes gaussian_jobs',
    $q$DELETE FROM public.gaussian_jobs WHERE job_id = 'gaussian-s'$q$, 1);
  PERFORM hon_test.expect_rows('(e) service inserts wallet profile',
    $q$INSERT INTO public.profiles (solana_wallet, username) VALUES ('WalletSSS', 'wallet_s')$q$, 1);
  PERFORM hon_test.expect_rows('(e) service updates wallet profile',
    $q$UPDATE public.profiles SET bio = 'verified' WHERE solana_wallet = 'WalletSSS'$q$, 1);
  PERFORM hon_test.expect_rows('(e) service deletes wallet profile',
    $q$DELETE FROM public.profiles WHERE solana_wallet = 'WalletSSS'$q$, 1);
  IF to_regclass('public.canvas_history') IS NOT NULL THEN
    PERFORM hon_test.expect_rows('(e) service writes canvas_history',
      $q$INSERT INTO public.canvas_history (project_id, user_id) VALUES ('draft-s', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')$q$, 1);
  END IF;
  IF to_regclass('public.canvas_history_events') IS NOT NULL THEN
    PERFORM hon_test.expect_rows('(e) service writes canvas_history_events',
      $q$INSERT INTO public.canvas_history_events (project_id, user_id, event_type)
         VALUES ('draft-s', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'panel_create')$q$, 1);
  END IF;
  IF to_regclass('public.canvas_history_snapshots') IS NOT NULL THEN
    PERFORM hon_test.expect_rows('(e) service writes canvas_history_snapshots',
      $q$INSERT INTO public.canvas_history_snapshots (project_id, user_id)
         VALUES ('draft-s', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')$q$, 1);
  END IF;
  IF to_regclass('public.canvas_history') IS NOT NULL THEN
    PERFORM hon_test.expect_rows('(e) service deletes canvas_history',
      $q$DELETE FROM public.canvas_history WHERE project_id = 'draft-s'$q$, 1);
  END IF;
  PERFORM hon_test.expect_rows('(e) service inserts comment_votes',
    $q$INSERT INTO public.comment_votes (comment_id, user_id, vote_type)
       VALUES ('33333333-3333-4333-8333-333333333333', 'service-check', 1)$q$, 1);
  PERFORM hon_test.expect_rows('(e) service updates comment_votes',
    $q$UPDATE public.comment_votes SET vote_type = -1 WHERE user_id = 'service-check'$q$, 1);
  PERFORM hon_test.expect_rows('(e) service deletes comment_votes',
    $q$DELETE FROM public.comment_votes WHERE user_id = 'service-check'$q$, 1);
  PERFORM hon_test.expect_rows('(e) service inserts subscriptions',
    $q$INSERT INTO public.subscriptions (subscriber_id, creator_id) VALUES ('service-check', 'WalletCCC')$q$, 1);
  PERFORM hon_test.expect_rows('(e) service updates subscriptions',
    $q$UPDATE public.subscriptions SET creator_id = 'WalletSSS' WHERE subscriber_id = 'service-check'$q$, 1);
  PERFORM hon_test.expect_rows('(e) service deletes subscriptions',
    $q$DELETE FROM public.subscriptions WHERE subscriber_id = 'service-check'$q$, 1);
  PERFORM hon_test.expect_rows('(e) service writes profile-images',
    $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('profile-images', 'profiles/service/check.png')$q$, 1);
  PERFORM hon_test.expect_rows('(e) service writes hon-assets',
    $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('hon-assets', 'worlds/lod/service/check.json')$q$, 1);
  PERFORM hon_test.expect_rows('(e) service updates hon-assets',
    $q$UPDATE storage.objects SET name = 'worlds/lod/service/meta.json' WHERE name = 'worlds/lod/service/check.json'$q$, 1);
  PERFORM hon_test.expect_rows('(e) service deletes storage objects',
    $q$DELETE FROM storage.objects WHERE name IN ('profiles/service/check.png', 'worlds/lod/service/meta.json')$q$, 2);
END
$service$;

-- (g) profiles: anon has no table access; each user sees only their own full row.
SET ROLE anon;
SET request.jwt.claim.sub = '';
SET request.jwt.claim.role = 'anon';
DO $profiles_anon$
BEGIN
  PERFORM hon_test.expect_error('(g) anon selects from profiles',
    'SELECT count(*) FROM public.profiles', '42501');
  PERFORM hon_test.expect_error('(g) anon selects email from profiles',
    'SELECT email FROM public.profiles', '42501');
  PERFORM hon_test.expect_count('(g) anon reads both rows of profiles_public',
    'SELECT count(*) FROM public.profiles_public', 2);
  PERFORM hon_test.expect_text('(g) anon reads B username from profiles_public',
    $q$SELECT username FROM public.profiles_public WHERE id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'$q$, 'user_b');
  PERFORM hon_test.expect_error('(g) anon selects email from profiles_public',
    'SELECT email FROM public.profiles_public', '42703');
  PERFORM hon_test.expect_error('(g) anon updates through profiles_public',
    $q$UPDATE public.profiles_public SET username = 'taken'$q$, '42501');
  PERFORM hon_test.expect_error('(g) anon inserts through profiles_public',
    $q$INSERT INTO public.profiles_public (username) VALUES ('anon_view')$q$, '42501');
  PERFORM hon_test.expect_error('(g) anon deletes through profiles_public',
    'DELETE FROM public.profiles_public', '42501');
  PERFORM hon_test.expect_no_marker('(g) anon reads no email, linked ID, preference or wallet_id anywhere',
    ARRAY['@example.test', 'discord-fake', 'twitter-fake', 'google-fake', 'prefs-fake', 'privy-fake',
          current_setting('hon_test.b_wallet_id'), 'wait-one', 'wait-two']);
END
$profiles_anon$;

SET ROLE authenticated;
SET request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SET request.jwt.claim.role = 'authenticated';
DO $profiles_owner$
BEGIN
  PERFORM hon_test.expect_count('(g) A reads exactly one profiles row',
    'SELECT count(*) FROM public.profiles', 1);
  PERFORM hon_test.expect_text('(g) A reads own email', 'SELECT email FROM public.profiles', 'a@example.test');
  PERFORM hon_test.expect_count('(g) A reads B row by id',
    $q$SELECT count(*) FROM public.profiles WHERE id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'$q$, 0);
  PERFORM hon_test.expect_count('(g) A reads B row by email',
    $q$SELECT count(*) FROM public.profiles WHERE email = 'b@example.test'$q$, 0);
  PERFORM hon_test.expect_count('(g) A reads B row by linked IDs',
    $q$SELECT count(*) FROM public.profiles
       WHERE discord_id = 'discord-fake-b' OR twitter_id = 'twitter-fake-b'
          OR google_id = 'google-fake-b' OR privy_user_id = 'privy-fake-b'$q$, 0);
  PERFORM hon_test.expect_count('(g) A reads B row by wallet_id',
    format('SELECT count(*) FROM public.profiles WHERE wallet_id = %L', current_setting('hon_test.b_wallet_id')), 0);
  PERFORM hon_test.expect_count('(g) A reads B preferences',
    $q$SELECT count(*) FROM public.profiles WHERE notification_preferences::text LIKE '%prefs-fake-b%'$q$, 0);
  PERFORM hon_test.expect_count('(g) A reads both rows of profiles_public',
    'SELECT count(*) FROM public.profiles_public', 2);
  PERFORM hon_test.expect_error('(g) A updates B through profiles_public',
    $q$UPDATE public.profiles_public SET username = 'taken'
       WHERE id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'$q$, '42501');
  PERFORM hon_test.expect_error('(g) A deletes through profiles_public',
    'DELETE FROM public.profiles_public', '42501');
  PERFORM hon_test.expect_no_marker('(g) A reads no B email, linked ID, preference or wallet_id anywhere',
    ARRAY['b@example.test', 'discord-fake-b', 'twitter-fake-b', 'google-fake-b', 'prefs-fake-b',
          'privy-fake-b', current_setting('hon_test.b_wallet_id'), 'wait-one', 'wait-two']);
END
$profiles_owner$;

RESET ROLE;
DO $profiles_view$
BEGIN
  PERFORM hon_test.expect_count('(g) profiles_public has no private column',
    $q$SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'profiles_public'
         AND column_name IN ('email', 'discord_id', 'twitter_id', 'google_id',
                             'notification_preferences', 'privy_user_id', 'wallet_id')$q$, 0);
  PERFORM hon_test.expect_text('(g) profiles_public column list',
    $q$SELECT string_agg(column_name::text, ',' ORDER BY ordinal_position) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'profiles_public'$q$,
    'id,username,first_name,last_name,avatar_url,social_links,youtube,x,linkedin,thread,solana_wallet,wallet_address');
  PERFORM hon_test.expect_count('(g) anon holds no privilege on profiles',
    $q$SELECT count(*) FROM (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) v(p)
       WHERE has_any_column_privilege('anon', 'public.profiles', v.p)$q$, 0);
END
$profiles_view$;

-- (h) waitlist: no client reads, changes or deletes; checked inserts only.
SET ROLE anon;
SET request.jwt.claim.sub = '';
SET request.jwt.claim.role = 'anon';
DO $waitlist_anon$
BEGIN
  PERFORM hon_test.expect_error('(h) anon selects waitlist', 'SELECT count(*) FROM public.waitlist', '42501');
  PERFORM hon_test.expect_error('(h) anon updates waitlist', $q$UPDATE public.waitlist SET source = 'x'$q$, '42501');
  PERFORM hon_test.expect_error('(h) anon deletes waitlist', 'DELETE FROM public.waitlist', '42501');
  PERFORM hon_test.expect_rows('(h) anon joins with a plausible email',
    $q$INSERT INTO public.waitlist (email, source) VALUES ('new.person+hon@example.test', 'landing_page')$q$, 1);
  PERFORM hon_test.expect_rows('(h) anon joins with an apostrophe in the address',
    $q$INSERT INTO public.waitlist (email, source) VALUES ('o''neil@example.test', 'login_page_waitlist')$q$, 1);
  PERFORM hon_test.expect_error('(h) anon joins with a malformed email',
    $q$INSERT INTO public.waitlist (email, source) VALUES ('not-an-email', 'landing_page')$q$, '42501');
  PERFORM hon_test.expect_error('(h) anon joins with an email containing a space',
    $q$INSERT INTO public.waitlist (email, source) VALUES ('a b@example.test', 'landing_page')$q$, '42501');
  PERFORM hon_test.expect_error('(h) anon joins with an over-long email',
    format('INSERT INTO public.waitlist (email, source) VALUES (%L, %L)',
           repeat('a', 60) || '@' || repeat('b', 200) || '.test', 'landing_page'), '42501');
  PERFORM hon_test.expect_error('(h) anon joins with a disallowed source',
    $q$INSERT INTO public.waitlist (email, source) VALUES ('c@example.test', 'admin_import')$q$, '42501');
  PERFORM hon_test.expect_error('(h) anon joins without a source',
    $q$INSERT INTO public.waitlist (email) VALUES ('c@example.test')$q$, '42501');
  PERFORM hon_test.expect_error('(h) anon sets id',
    $q$INSERT INTO public.waitlist (id, email, source)
       VALUES (gen_random_uuid(), 'c@example.test', 'landing_page')$q$, '42501');
  PERFORM hon_test.expect_error('(h) anon sets created_at',
    $q$INSERT INTO public.waitlist (email, source, created_at)
       VALUES ('c@example.test', 'landing_page', now() - interval '1 year')$q$, '42501');
  PERFORM hon_test.expect_error('(h) anon reads the new row back with RETURNING',
    $q$INSERT INTO public.waitlist (email, source) VALUES ('d@example.test', 'landing_page') RETURNING email$q$, '42501');
END
$waitlist_anon$;

SET ROLE authenticated;
SET request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SET request.jwt.claim.role = 'authenticated';
DO $waitlist_user$
BEGIN
  PERFORM hon_test.expect_error('(h) A selects waitlist', 'SELECT count(*) FROM public.waitlist', '42501');
  PERFORM hon_test.expect_error('(h) A selects waitlist emails', 'SELECT email FROM public.waitlist', '42501');
  PERFORM hon_test.expect_error('(h) A updates waitlist', $q$UPDATE public.waitlist SET source = 'x'$q$, '42501');
  PERFORM hon_test.expect_error('(h) A deletes waitlist', 'DELETE FROM public.waitlist', '42501');
  PERFORM hon_test.expect_rows('(h) A joins with a plausible email',
    $q$INSERT INTO public.waitlist (email, source) VALUES ('a@example.test', 'login_page_waitlist')$q$, 1);
  PERFORM hon_test.expect_error('(h) A joins with a disallowed source',
    $q$INSERT INTO public.waitlist (email, source) VALUES ('e@example.test', 'x')$q$, '42501');
END
$waitlist_user$;

SET ROLE service_role;
SET request.jwt.claim.role = 'service_role';
DO $waitlist_service$
BEGIN
  PERFORM hon_test.expect_count('(h) service reads every waitlist row', 'SELECT count(*) FROM public.waitlist', 5);
  PERFORM hon_test.expect_count('(h) rejected inserts left no row',
    $q$SELECT count(*) FROM public.waitlist
       WHERE email IN ('not-an-email', 'a b@example.test', 'c@example.test', 'd@example.test', 'e@example.test')$q$, 0);
END
$waitlist_service$;

-- (i) comment_votes and subscriptions use text IDs, and no policy casts to uuid.
RESET ROLE;
DO $text_ids$
BEGIN
  PERFORM hon_test.expect_count('(i) ID columns are text',
    $q$SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND data_type = 'text'
         AND (table_name, column_name) IN (('comment_votes', 'user_id'),
                                           ('subscriptions', 'subscriber_id'),
                                           ('subscriptions', 'creator_id'))$q$, 3);
  PERFORM hon_test.expect_count('(i) no uuid cast in vote or subscription policies',
    $q$SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public' AND tablename IN ('comment_votes', 'subscriptions')
         AND concat_ws(' ', qual, with_check) LIKE '%::uuid%'$q$, 0);
END
$text_ids$;

-- (f) No PUBLIC policy with a qualifier of true remains (policies are OR-ed).
RESET ROLE;
DO $or_semantics$
BEGIN
  PERFORM hon_test.expect_count('(f) PUBLIC policies with true on hardened tables',
    $q$SELECT count(*) FROM pg_policies
       WHERE ((schemaname = 'public'
               AND tablename IN ('sharp_jobs', 'gaussian_jobs', 'profiles', 'canvas_history',
                                 'canvas_history_events', 'canvas_history_snapshots',
                                 'comment_votes', 'subscriptions', 'waitlist'))
              OR (schemaname = 'storage' AND tablename = 'objects'))
         AND roles = '{public}'
         AND (qual = 'true' OR with_check = 'true')$q$, 0);
  PERFORM hon_test.expect_count('(f) PUBLIC or anon write policies on hardened tables',
    $q$SELECT count(*) FROM pg_policies
       WHERE ((schemaname = 'public'
               AND tablename IN ('sharp_jobs', 'gaussian_jobs', 'profiles', 'canvas_history',
                                 'canvas_history_events', 'canvas_history_snapshots',
                                 'comment_votes', 'subscriptions'))
              OR (schemaname = 'storage' AND tablename = 'objects'
                  AND concat_ws(' ', qual, with_check) ~ '(profile-images|hon-assets)'))
         AND roles && '{public,anon}'::name[]
         AND cmd <> 'SELECT'$q$, 0);
  PERFORM hon_test.expect_count('(f) storage read policies are kept',
    $q$SELECT count(*) FROM pg_policies
       WHERE schemaname = 'storage' AND tablename = 'objects'
         AND policyname IN ('Public read profile-images', 'Public read hon-assets')$q$, 2);
END
$or_semantics$;
