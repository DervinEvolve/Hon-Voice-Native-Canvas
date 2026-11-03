-- Replaces the permissive row-level security policies found by the live audit.
-- Run the whole file as one transaction. See docs/LIVE_POLICY_HARDENING.md.
--
-- Postgres combines permissive policies with OR. One old policy left in place
-- keeps its access. This file therefore drops every permissive policy on the
-- listed tables, and every write policy on storage.objects that names the
-- profile-images or hon-assets bucket, before it creates the new set.
-- The check at the end aborts the transaction if a permissive grant remains.
-- Reapplying the file gives the same result.
-- It also creates the view public.profiles_public for public profile reads.
-- Requires PostgreSQL 15 or later (view option security_invoker).
-- Rollback: migrations/rollback_harden_live_policies.sql.
BEGIN;

-- 1. Audited live policies, by exact name.
DROP POLICY IF EXISTS "Service role has full access to sharp_jobs" ON public.sharp_jobs;
DROP POLICY IF EXISTS "Allow all operations on gaussian_jobs" ON public.gaussian_jobs;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
DROP POLICY IF EXISTS "Allow wallet-based profile creation" ON public.profiles;
DROP POLICY IF EXISTS "profiles_public_read" ON public.profiles;
DROP POLICY IF EXISTS "Allow select for authenticated users" ON public.waitlist;

-- 2. Likely names for live policies whose names the audit did not report.
DROP POLICY IF EXISTS "Allow wallet-only profile creation" ON public.profiles;
DROP POLICY IF EXISTS "Allow wallet-only profile updates" ON public.profiles;
DROP POLICY IF EXISTS "Allow users to insert their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Allow users to update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Allow users to view profiles" ON public.profiles;
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
-- The canvas history tables are optional: public.canvas_history does not
-- exist on the live project. This guard is defensive. DROP POLICY IF EXISTS
-- on a missing table only skips with a NOTICE on PostgreSQL 15 to 17, and the
-- statement that raised 42P01 on the first live attempt has not been
-- reproduced (see docs/LIVE_POLICY_HARDENING.md). Each drop runs only for a
-- table that exists, and a NOTICE names each table that was skipped.
DO $canvas_names$
DECLARE
  d record;
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['canvas_history', 'canvas_history_events', 'canvas_history_snapshots']
  LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      RAISE NOTICE 'Skipped: public.% does not exist', t;
    END IF;
  END LOOP;
  FOR d IN
    SELECT * FROM (VALUES
      ('canvas_history', 'canvas_history_wallet_access'),
      ('canvas_history_events', 'canvas_history_events_wallet_access'),
      ('canvas_history_snapshots', 'canvas_history_snapshots_wallet_access'),
      ('canvas_history_events', 'Users can view their own canvas events'),
      ('canvas_history_events', 'Users can insert their own canvas events'),
      ('canvas_history_snapshots', 'Users can view their own canvas snapshots'),
      ('canvas_history_snapshots', 'Users can insert their own canvas snapshots')
    ) AS v(tbl, policy)
    WHERE to_regclass(format('public.%I', v.tbl)) IS NOT NULL
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', d.policy, 'public', d.tbl);
  END LOOP;
END
$canvas_names$;
DROP POLICY IF EXISTS "Anyone can view comment votes" ON public.comment_votes;
DROP POLICY IF EXISTS "Anyone can insert comment votes" ON public.comment_votes;
DROP POLICY IF EXISTS "Anyone can update comment votes" ON public.comment_votes;
DROP POLICY IF EXISTS "Anyone can delete comment votes" ON public.comment_votes;
DROP POLICY IF EXISTS "subscriptions_select_policy" ON public.subscriptions;
DROP POLICY IF EXISTS "Anyone can insert subscriptions" ON public.subscriptions;
DROP POLICY IF EXISTS "Anyone can update subscriptions" ON public.subscriptions;
DROP POLICY IF EXISTS "Anyone can delete subscriptions" ON public.subscriptions;
DROP POLICY IF EXISTS "Allow public uploads to profile-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow public updates to profile-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow public deletes from profile-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow anon uploads to hon-assets" ON storage.objects;
DROP POLICY IF EXISTS "Allow anonymous insert" ON public.waitlist;

-- 3. Every other permissive policy on these tables, whatever its name.
DO $drop_unknown$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('sharp_jobs', 'gaussian_jobs', 'profiles', 'canvas_history',
                        'canvas_history_events', 'canvas_history_snapshots',
                        'comment_votes', 'subscriptions', 'waitlist')
      AND permissive = 'PERMISSIVE'
  LOOP
    RAISE NOTICE 'Dropping policy "%" on %.%', p.policyname, p.schemaname, p.tablename;
    EXECUTE format('DROP POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
  END LOOP;

  -- Storage write policies for the two buckets, and any write policy open to
  -- PUBLIC or anon with a qualifier of true. Read policies are left alone.
  FOR p IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND permissive = 'PERMISSIVE'
      AND cmd <> 'SELECT'
      AND (
        concat_ws(' ', qual, with_check) ~ '(profile-images|hon-assets)'
        OR (roles && ARRAY['public', 'anon']::name[] AND (qual = 'true' OR with_check = 'true'))
      )
  LOOP
    RAISE NOTICE 'Dropping policy "%" on storage.objects', p.policyname;
    EXECUTE format('DROP POLICY %I ON storage.objects', p.policyname);
  END LOOP;
END
$drop_unknown$;

-- 4. sharp_jobs and gaussian_jobs: service role only.
ALTER TABLE public.sharp_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gaussian_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sharp_jobs, public.gaussian_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sharp_jobs, public.gaussian_jobs TO service_role;

-- For the API routes, which use the service key.
DROP POLICY IF EXISTS sharp_jobs_service_role ON public.sharp_jobs;
CREATE POLICY sharp_jobs_service_role ON public.sharp_jobs
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- For server jobs that use the service key.
DROP POLICY IF EXISTS gaussian_jobs_service_role ON public.gaussian_jobs;
CREATE POLICY gaussian_jobs_service_role ON public.gaussian_jobs
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- 5. profiles: each signed-in user reads and writes only their own row.
-- The full row holds email, linked identities and preferences, so anon has
-- no table privilege at all. Public pages read public.profiles_public.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO service_role;

-- For a signed-in user reading the full row of their own account.
DROP POLICY IF EXISTS profiles_owner_select ON public.profiles;
CREATE POLICY profiles_owner_select ON public.profiles
  FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()));

-- For a signed-in user creating the profile row for their own account.
DROP POLICY IF EXISTS profiles_owner_insert ON public.profiles;
CREATE POLICY profiles_owner_insert ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = (SELECT auth.uid()));

-- For a signed-in user editing the profile row of their own account.
DROP POLICY IF EXISTS profiles_owner_update ON public.profiles;
CREATE POLICY profiles_owner_update ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

-- For server routes that use the service key, such as a verified wallet sign-in.
DROP POLICY IF EXISTS profiles_service_role ON public.profiles;
CREATE POLICY profiles_service_role ON public.profiles
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- Public profile columns for visitors and signed-in users.
-- The view runs with its owner's rights (security_invoker = false), so it
-- reads every row while the table policies stay owner-only. It lists only
-- the columns that public pages use; see docs/LIVE_POLICY_HARDENING.md.
-- Never add email, discord_id, twitter_id, google_id,
-- notification_preferences, privy_user_id or wallet_id. Recreate the view
-- when a public column is added to the table; SELECT * is not used on purpose.
-- Clients get SELECT only. Supabase default privileges grant ALL on new views,
-- and a write through this view would skip the table policies.
DROP VIEW IF EXISTS public.profiles_public;
CREATE VIEW public.profiles_public
  WITH (security_invoker = false, security_barrier = true)
AS
SELECT
  p.id,
  p.username,
  p.first_name,
  p.last_name,
  p.avatar_url,
  p.social_links,
  p.youtube,
  p.x,
  p.linkedin,
  p.thread,
  p.solana_wallet,
  p.wallet_address
FROM public.profiles AS p;
REVOKE ALL ON public.profiles_public FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.profiles_public TO anon, authenticated, service_role;
COMMENT ON VIEW public.profiles_public IS
  'Public profile columns. Owner rights on purpose; see docs/LIVE_POLICY_HARDENING.md.';

-- 6. Canvas history: owner only, by user_id. Each table is optional.
DO $canvas$
DECLARE
  t text;
  user_id_type text;
  owner_check text;
BEGIN
  FOREACH t IN ARRAY ARRAY['canvas_history', 'canvas_history_events', 'canvas_history_snapshots']
  LOOP
    CONTINUE WHEN to_regclass(format('public.%I', t)) IS NULL;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', t);

    -- For server routes that use the service key.
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_service_role', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
                   t || '_service_role', t);

    SELECT data_type INTO user_id_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = t AND column_name = 'user_id';

    IF user_id_type IS NULL THEN
      RAISE WARNING 'public.% has no user_id column; it is now service-role only', t;
      CONTINUE;
    END IF;

    owner_check := CASE WHEN user_id_type = 'uuid'
                        THEN 'user_id = (SELECT auth.uid())'
                        ELSE 'user_id = (SELECT auth.uid())::text' END;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);

    -- For the signed-in user who owns the history rows.
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_owner', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (%s) WITH CHECK (%s)',
                   t || '_owner', t, owner_check, owner_check);
  END LOOP;
END
$canvas$;

-- 7. comment_votes: public read, owner writes. user_id is text on the live
-- project (commentService.ts stores text IDs), so auth.uid() is cast to text.
ALTER TABLE public.comment_votes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.comment_votes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.comment_votes TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.comment_votes TO authenticated, service_role;

-- For visitors and signed-in users reading vote counts.
DROP POLICY IF EXISTS comment_votes_public_read ON public.comment_votes;
CREATE POLICY comment_votes_public_read ON public.comment_votes
  FOR SELECT TO anon, authenticated
  USING (true);

-- For a signed-in user casting their own vote.
DROP POLICY IF EXISTS comment_votes_owner_insert ON public.comment_votes;
CREATE POLICY comment_votes_owner_insert ON public.comment_votes
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid())::text);

-- For a signed-in user changing their own vote.
DROP POLICY IF EXISTS comment_votes_owner_update ON public.comment_votes;
CREATE POLICY comment_votes_owner_update ON public.comment_votes
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())::text)
  WITH CHECK (user_id = (SELECT auth.uid())::text);

-- For a signed-in user removing their own vote.
DROP POLICY IF EXISTS comment_votes_owner_delete ON public.comment_votes;
CREATE POLICY comment_votes_owner_delete ON public.comment_votes
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid())::text);

-- For server routes that use the service key.
DROP POLICY IF EXISTS comment_votes_service_role ON public.comment_votes;
CREATE POLICY comment_votes_service_role ON public.comment_votes
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- 8. subscriptions: rows visible to the two parties only, counts through a
-- function. Both ID columns are text on the live project (ProfileV2.tsx
-- stores wallet addresses in them), so auth.uid() is cast to text.
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.subscriptions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.subscriptions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subscriptions TO service_role;

-- For a signed-in subscriber or creator reading rows that name them.
DROP POLICY IF EXISTS subscriptions_party_read ON public.subscriptions;
CREATE POLICY subscriptions_party_read ON public.subscriptions
  FOR SELECT TO authenticated
  USING (subscriber_id = (SELECT auth.uid())::text
         OR creator_id = (SELECT auth.uid())::text);

-- For a signed-in user subscribing as themselves.
DROP POLICY IF EXISTS subscriptions_owner_insert ON public.subscriptions;
CREATE POLICY subscriptions_owner_insert ON public.subscriptions
  FOR INSERT TO authenticated
  WITH CHECK (subscriber_id = (SELECT auth.uid())::text);

-- For a signed-in user ending their own subscription.
DROP POLICY IF EXISTS subscriptions_owner_delete ON public.subscriptions;
CREATE POLICY subscriptions_owner_delete ON public.subscriptions
  FOR DELETE TO authenticated
  USING (subscriber_id = (SELECT auth.uid())::text);

-- For server routes that use the service key.
DROP POLICY IF EXISTS subscriptions_service_role ON public.subscriptions;
CREATE POLICY subscriptions_service_role ON public.subscriptions
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- Public subscriber count without exposing who subscribes to whom.
-- The argument is text because the client passes creator wallet addresses.
CREATE OR REPLACE FUNCTION public.subscriber_count(p_creator_id text)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT count(*) FROM public.subscriptions s WHERE s.creator_id = p_creator_id;
$$;
REVOKE ALL ON FUNCTION public.subscriber_count(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.subscriber_count(text) TO anon, authenticated, service_role;

-- 9. waitlist: rows are readable by the service role only. Browsers may add
-- an email; waitlistService.ts inserts { email, source } without reading the
-- row back. Only email and source can be set; id and created_at take their
-- defaults. No client role can read, change or delete rows.
ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.waitlist FROM PUBLIC, anon, authenticated;
GRANT INSERT (email, source) ON public.waitlist TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.waitlist TO service_role;

-- For visitors joining the waitlist from the sign-up form.
DROP POLICY IF EXISTS waitlist_public_insert ON public.waitlist;
CREATE POLICY waitlist_public_insert ON public.waitlist
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    char_length(email) BETWEEN 6 AND 254
    AND email ~ '^[A-Za-z0-9._%+''-]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}$'
    AND source IN ('landing_page', 'login_page_waitlist')
  );

-- For server tools that read or manage the list with the service key.
DROP POLICY IF EXISTS waitlist_service_role ON public.waitlist;
CREATE POLICY waitlist_service_role ON public.waitlist
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- 10. storage.objects. Existing read policies are not changed.
-- imageUploadService.ts writes profiles/<user id>/<file>. The user ID is the
-- second path segment, so the owner column is the main check and the path
-- check pins the folder.

-- For a signed-in user uploading into their own profiles/<user id>/ folder.
DROP POLICY IF EXISTS profile_images_owner_insert ON storage.objects;
CREATE POLICY profile_images_owner_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'profile-images'
    AND auth.role() = 'authenticated'
    AND owner = (SELECT auth.uid())
    AND (storage.foldername(name))[1] = 'profiles'
    AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
  );

-- For a signed-in user replacing their own profile image.
DROP POLICY IF EXISTS profile_images_owner_update ON storage.objects;
CREATE POLICY profile_images_owner_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'profile-images'
    AND auth.role() = 'authenticated'
    AND owner = (SELECT auth.uid())
    AND (storage.foldername(name))[1] = 'profiles'
    AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
  )
  WITH CHECK (
    bucket_id = 'profile-images'
    AND auth.role() = 'authenticated'
    AND owner = (SELECT auth.uid())
    AND (storage.foldername(name))[1] = 'profiles'
    AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
  );

-- For a signed-in user deleting their own profile image.
DROP POLICY IF EXISTS profile_images_owner_delete ON storage.objects;
CREATE POLICY profile_images_owner_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'profile-images'
    AND auth.role() = 'authenticated'
    AND owner = (SELECT auth.uid())
    AND (storage.foldername(name))[1] = 'profiles'
    AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
  );

-- For server routes that use the service key.
DROP POLICY IF EXISTS profile_images_service_role ON storage.objects;
CREATE POLICY profile_images_service_role ON storage.objects
  FOR ALL TO service_role
  USING (bucket_id = 'profile-images')
  WITH CHECK (bucket_id = 'profile-images');

-- For server routes that use the service key, such as api/splat/process-lod.js.
-- WorldScenesPanel.tsx writes worlds/<random name> with no user ID in the
-- path, so there is no client write policy for this bucket.
DROP POLICY IF EXISTS hon_assets_service_role ON storage.objects;
CREATE POLICY hon_assets_service_role ON storage.objects
  FOR ALL TO service_role
  USING (bucket_id = 'hon-assets')
  WITH CHECK (bucket_id = 'hon-assets');

-- 11. Self-check. Any failure aborts the transaction and nothing above is kept.
-- self-check:start
DO $self_check$
DECLARE
  bad text;
BEGIN
  -- No permissive policy open to PUBLIC with a qualifier of true.
  -- No permissive write policy open to PUBLIC or anon.
  SELECT string_agg(format('%s.%s "%s"', schemaname, tablename, policyname), ', ') INTO bad
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('sharp_jobs', 'gaussian_jobs', 'profiles', 'canvas_history',
                      'canvas_history_events', 'canvas_history_snapshots',
                      'comment_votes', 'subscriptions', 'waitlist')
    AND permissive = 'PERMISSIVE'
    AND (
      ('public' = ANY (roles) AND (qual = 'true' OR with_check = 'true'))
      OR (roles && ARRAY['public', 'anon']::name[] AND cmd <> 'SELECT'
          -- The waitlist insert policy is allowed when it checks the email.
          AND NOT (tablename = 'waitlist' AND cmd = 'INSERT'
                   AND with_check IS DISTINCT FROM 'true' AND with_check ~ 'email'))
    );
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Permissive PUBLIC or anon policy remains: %', bad;
  END IF;

  -- No read policy on profiles or waitlist that lets a client role see every row.
  SELECT string_agg(format('%s "%s"', tablename, policyname), ', ') INTO bad
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('profiles', 'waitlist')
    AND permissive = 'PERMISSIVE'
    AND cmd IN ('SELECT', 'ALL')
    AND roles && ARRAY['public', 'anon', 'authenticated']::name[]
    AND qual = 'true';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Open read policy on profiles or waitlist remains: %', bad;
  END IF;

  -- Table and column privileges, including those held through PUBLIC or an
  -- inherited role. anon reads neither table; authenticated cannot read,
  -- change or delete waitlist rows. profiles_public is read-only for clients:
  -- it runs with owner rights, so a write through it would skip the table policies.
  SELECT string_agg(v.who || ' ' || v.priv || ' on ' || v.tbl, ', ') INTO bad
  FROM (VALUES
          ('anon', 'public.profiles', 'SELECT'),
          ('anon', 'public.profiles', 'UPDATE'),
          ('anon', 'public.profiles', 'INSERT'),
          ('anon', 'public.waitlist', 'SELECT'),
          ('anon', 'public.waitlist', 'UPDATE'),
          ('authenticated', 'public.waitlist', 'SELECT'),
          ('authenticated', 'public.waitlist', 'UPDATE'),
          ('anon', 'public.profiles_public', 'INSERT'),
          ('anon', 'public.profiles_public', 'UPDATE'),
          ('authenticated', 'public.profiles_public', 'INSERT'),
          ('authenticated', 'public.profiles_public', 'UPDATE')
       ) AS v(who, tbl, priv)
  WHERE has_any_column_privilege(v.who, v.tbl, v.priv);
  SELECT concat_ws(', ', bad, string_agg(v.who || ' DELETE on ' || v.tbl, ', ')) INTO bad
  FROM (VALUES ('anon', 'public.profiles'), ('anon', 'public.waitlist'),
               ('authenticated', 'public.profiles'), ('authenticated', 'public.waitlist'),
               ('anon', 'public.profiles_public'), ('authenticated', 'public.profiles_public')
       ) AS v(who, tbl)
  WHERE has_table_privilege(v.who, v.tbl, 'DELETE');
  IF bad <> '' THEN
    RAISE EXCEPTION 'Client role holds a privilege it must not have: %', bad;
  END IF;

  -- The public view exposes no private column and keeps owner rights.
  SELECT string_agg(column_name::text, ', ') INTO bad
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'profiles_public'
    AND column_name IN ('email', 'discord_id', 'twitter_id', 'google_id',
                        'notification_preferences', 'privy_user_id', 'wallet_id');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'profiles_public exposes a private column: %', bad;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class v
    JOIN pg_class t ON t.oid = 'public.profiles'::regclass
    JOIN pg_roles r ON r.oid = v.relowner
    WHERE v.oid = 'public.profiles_public'::regclass
      AND v.relkind = 'v'
      AND NOT coalesce('security_invoker=true' = ANY (v.reloptions), false)
      AND NOT coalesce('security_invoker=on' = ANY (v.reloptions), false)
      AND NOT t.relforcerowsecurity
      AND (v.relowner = t.relowner OR r.rolbypassrls OR r.rolsuper)
  ) THEN
    RAISE EXCEPTION 'profiles_public must be a view with owner rights whose owner can read every profile';
  END IF;

  -- Job tables accept only the service role.
  SELECT string_agg(format('%s "%s"', tablename, policyname), ', ') INTO bad
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('sharp_jobs', 'gaussian_jobs')
    AND permissive = 'PERMISSIVE'
    AND roles <> ARRAY['service_role']::name[];
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Job table policy for a client role remains: %', bad;
  END IF;

  -- No profile or canvas history policy reads a wallet column.
  SELECT string_agg(format('%s "%s"', tablename, policyname), ', ') INTO bad
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('profiles', 'canvas_history', 'canvas_history_events', 'canvas_history_snapshots')
    AND permissive = 'PERMISSIVE'
    AND concat_ws(' ', qual, with_check) ILIKE '%wallet%';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Wallet-string policy remains: %', bad;
  END IF;

  -- Storage writes: no PUBLIC or anon write policy with true; bucket writes
  -- only for the service role or with an auth.uid() check (profile-images).
  SELECT string_agg(format('"%s"', policyname), ', ') INTO bad
  FROM pg_policies
  WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND permissive = 'PERMISSIVE'
    AND cmd <> 'SELECT'
    AND (
      (roles && ARRAY['public', 'anon']::name[]
        AND (qual = 'true' OR with_check = 'true'
             OR concat_ws(' ', qual, with_check) ~ '(profile-images|hon-assets)'))
      OR (concat_ws(' ', qual, with_check) ~ 'hon-assets'
          AND roles <> ARRAY['service_role']::name[])
      OR (concat_ws(' ', qual, with_check) ~ 'profile-images'
          AND roles <> ARRAY['service_role']::name[]
          AND concat_ws(' ', qual, with_check) NOT LIKE '%auth.uid()%')
    );
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Open storage write policy remains: %', bad;
  END IF;
END
$self_check$;
-- self-check:end

COMMIT;
