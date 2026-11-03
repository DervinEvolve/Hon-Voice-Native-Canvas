-- EMERGENCY USE ONLY.
-- This rollback restores the permissive state found by the live audit. After it
-- runs, anyone with the public anon key can again read and write sharp_jobs and
-- gaussian_jobs, read every profile row including email, linked identity IDs
-- and notification preferences, create and edit wallet profiles, read canvas
-- history by wallet string, vote and subscribe as any user, and write to the
-- profile-images and hon-assets buckets. Any signed-in user can again list every
-- waitlist email. Use it only to restore service while a fix is prepared.
--
-- It undoes migrations/harden_live_policies.sql. Policies with names from the
-- audit are recreated with those names. The other names are stand-ins; replace
-- them with the confirmed live names before use (docs/LIVE_POLICY_HARDENING.md).
-- Table grants go back to the Supabase defaults (ALL to anon and authenticated),
-- which include the audited SELECT grants on profiles and waitlist.
BEGIN;

-- 1. Remove the policies and the function added by the hardening migration.
DROP POLICY IF EXISTS sharp_jobs_service_role ON public.sharp_jobs;
DROP POLICY IF EXISTS gaussian_jobs_service_role ON public.gaussian_jobs;
DROP POLICY IF EXISTS profiles_owner_select ON public.profiles;
DROP POLICY IF EXISTS profiles_owner_insert ON public.profiles;
DROP POLICY IF EXISTS profiles_owner_update ON public.profiles;
DROP POLICY IF EXISTS profiles_service_role ON public.profiles;
DROP POLICY IF EXISTS comment_votes_public_read ON public.comment_votes;
DROP POLICY IF EXISTS comment_votes_owner_insert ON public.comment_votes;
DROP POLICY IF EXISTS comment_votes_owner_update ON public.comment_votes;
DROP POLICY IF EXISTS comment_votes_owner_delete ON public.comment_votes;
DROP POLICY IF EXISTS comment_votes_service_role ON public.comment_votes;
DROP POLICY IF EXISTS subscriptions_party_read ON public.subscriptions;
DROP POLICY IF EXISTS subscriptions_owner_insert ON public.subscriptions;
DROP POLICY IF EXISTS subscriptions_owner_delete ON public.subscriptions;
DROP POLICY IF EXISTS subscriptions_service_role ON public.subscriptions;
DROP POLICY IF EXISTS profile_images_owner_insert ON storage.objects;
DROP POLICY IF EXISTS profile_images_owner_update ON storage.objects;
DROP POLICY IF EXISTS profile_images_owner_delete ON storage.objects;
DROP POLICY IF EXISTS profile_images_service_role ON storage.objects;
DROP POLICY IF EXISTS hon_assets_service_role ON storage.objects;
DROP POLICY IF EXISTS waitlist_public_insert ON public.waitlist;
DROP POLICY IF EXISTS waitlist_service_role ON public.waitlist;
DROP FUNCTION IF EXISTS public.subscriber_count(text);
DROP VIEW IF EXISTS public.profiles_public;

-- 2. Restore the Supabase default table grants. The column grant on waitlist
-- is removed first so that only the table grant remains.
REVOKE INSERT (email, source) ON public.waitlist FROM anon, authenticated;
GRANT ALL ON public.sharp_jobs, public.gaussian_jobs, public.profiles,
  public.comment_votes, public.subscriptions, public.waitlist
  TO anon, authenticated, service_role;

-- 3. Recreate the audited live policies with their exact names.
DROP POLICY IF EXISTS "Service role has full access to sharp_jobs" ON public.sharp_jobs;
CREATE POLICY "Service role has full access to sharp_jobs" ON public.sharp_jobs
  FOR ALL TO PUBLIC
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all operations on gaussian_jobs" ON public.gaussian_jobs;
CREATE POLICY "Allow all operations on gaussian_jobs" ON public.gaussian_jobs
  FOR ALL TO PUBLIC
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE TO PUBLIC
  USING (wallet_id IS NOT NULL AND solana_wallet IS NOT NULL);

DROP POLICY IF EXISTS "Allow wallet-based profile creation" ON public.profiles;
CREATE POLICY "Allow wallet-based profile creation" ON public.profiles
  FOR INSERT TO PUBLIC
  WITH CHECK (wallet_id IS NOT NULL AND solana_wallet IS NOT NULL);

DROP POLICY IF EXISTS "profiles_public_read" ON public.profiles;
CREATE POLICY "profiles_public_read" ON public.profiles
  FOR SELECT TO PUBLIC
  USING (true);

-- The export gives the name and USING (true); the role is assumed to be authenticated.
DROP POLICY IF EXISTS "Allow select for authenticated users" ON public.waitlist;
CREATE POLICY "Allow select for authenticated users" ON public.waitlist
  FOR SELECT TO authenticated
  USING (true);

-- 4. Recreate the remaining audited live policies. The waitlist names are
-- confirmed from the live export; the storage names below are still stand-ins.
DROP POLICY IF EXISTS "Allow anonymous insert" ON public.waitlist;
CREATE POLICY "Allow anonymous insert" ON public.waitlist
  FOR INSERT TO anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can view comment votes" ON public.comment_votes;
CREATE POLICY "Anyone can view comment votes" ON public.comment_votes
  FOR SELECT TO PUBLIC
  USING (true);
DROP POLICY IF EXISTS "Anyone can insert comment votes" ON public.comment_votes;
CREATE POLICY "Anyone can insert comment votes" ON public.comment_votes
  FOR INSERT TO PUBLIC
  WITH CHECK (true);
DROP POLICY IF EXISTS "Anyone can update comment votes" ON public.comment_votes;
CREATE POLICY "Anyone can update comment votes" ON public.comment_votes
  FOR UPDATE TO PUBLIC
  USING (true)
  WITH CHECK (true);
DROP POLICY IF EXISTS "Anyone can delete comment votes" ON public.comment_votes;
CREATE POLICY "Anyone can delete comment votes" ON public.comment_votes
  FOR DELETE TO PUBLIC
  USING (true);

DROP POLICY IF EXISTS "subscriptions_select_policy" ON public.subscriptions;
CREATE POLICY "subscriptions_select_policy" ON public.subscriptions
  FOR SELECT TO PUBLIC
  USING (true);
DROP POLICY IF EXISTS "Anyone can insert subscriptions" ON public.subscriptions;
CREATE POLICY "Anyone can insert subscriptions" ON public.subscriptions
  FOR INSERT TO PUBLIC
  WITH CHECK (true);
DROP POLICY IF EXISTS "Anyone can update subscriptions" ON public.subscriptions;
CREATE POLICY "Anyone can update subscriptions" ON public.subscriptions
  FOR UPDATE TO PUBLIC
  USING (true)
  WITH CHECK (true);
DROP POLICY IF EXISTS "Anyone can delete subscriptions" ON public.subscriptions;
CREATE POLICY "Anyone can delete subscriptions" ON public.subscriptions
  FOR DELETE TO PUBLIC
  USING (true);

DROP POLICY IF EXISTS "Allow public uploads to profile-images" ON storage.objects;
CREATE POLICY "Allow public uploads to profile-images" ON storage.objects
  FOR INSERT TO PUBLIC
  WITH CHECK (bucket_id = 'profile-images');
DROP POLICY IF EXISTS "Allow public updates to profile-images" ON storage.objects;
CREATE POLICY "Allow public updates to profile-images" ON storage.objects
  FOR UPDATE TO PUBLIC
  USING (bucket_id = 'profile-images');
DROP POLICY IF EXISTS "Allow public deletes from profile-images" ON storage.objects;
CREATE POLICY "Allow public deletes from profile-images" ON storage.objects
  FOR DELETE TO PUBLIC
  USING (bucket_id = 'profile-images');

DROP POLICY IF EXISTS "Allow anon uploads to hon-assets" ON storage.objects;
CREATE POLICY "Allow anon uploads to hon-assets" ON storage.objects
  FOR INSERT TO anon
  WITH CHECK (bucket_id = 'hon-assets');

-- 5. Canvas history: remove owner policies, restore the wallet-string policy.
DO $canvas$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['canvas_history', 'canvas_history_events', 'canvas_history_snapshots']
  LOOP
    CONTINUE WHEN to_regclass(format('public.%I', t)) IS NULL;

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_owner', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_service_role', t);
    EXECUTE format('GRANT ALL ON public.%I TO anon, authenticated, service_role', t);

    CONTINUE WHEN (SELECT count(*) FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = t
                     AND column_name IN ('user_id', 'wallet_address')) < 2;

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_wallet_access', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO PUBLIC '
      'USING (user_id = auth.uid() OR wallet_address = '
      'current_setting(''request.headers'', true)::json ->> ''x-wallet-address'') '
      'WITH CHECK (user_id = auth.uid() OR wallet_address = '
      'current_setting(''request.headers'', true)::json ->> ''x-wallet-address'')',
      t || '_wallet_access', t);
  END LOOP;
END
$canvas$;

COMMIT;
