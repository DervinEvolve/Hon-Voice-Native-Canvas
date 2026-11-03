# Live policy hardening

> Scope note: the client call sites named below were analysed before the canvas-only snapshot. The profile, feed, comment, subscription and tipping pages and their services are no longer in this repository (they remain in the private original), so those rows describe why each column or policy was chosen, not code that still ships here. The SQL, its tests and its rollback are unchanged by that removal.

`migrations/harden_live_policies.sql` replaces the permissive row-level security policies found by the owner's audit of the live Supabase project. It also adds the view `public.profiles_public` and limits `public.waitlist` to checked inserts. `migrations/rollback_harden_live_policies.sql` puts the audited state back. `tests/sql/live-policy-fixture.sql` and `tests/sql/live-policy-security.sql` test both files against a disposable PostgreSQL.

Postgres combines permissive policies with OR. A new strict policy does nothing while an old open policy on the same table remains. The migration therefore drops the old policies first, then creates the new set, then checks the result.

## Status: applied to the live project (2026-11-03)

The owner applied the combined package (this migration, `migrations/secure_canvas_history.sql` and `migrations/harden_rpc_exposure.sql`, from repository commit `f6f4506`) to the live Supabase project in one transaction and verified the result from metadata only: both public profile views exist; `anon` has no SELECT on `profiles` or `profiles_new`; `authenticated` has no SELECT on `waitlist`; neither view carries a private column; `authenticated` holds exactly CRUD on `profiles_new` and `anon` nothing; the five existing triggers are intact; canvas history is owner-scoped by `auth.uid()`; job and cleanup routines are service-only; definer search paths are pinned; row-level security is enabled and no definer routine is executable by PUBLIC. No application rows were read or deleted. The "Confirm before applying" section below is kept as the record of what was checked first.

## Confirm before applying (record)

The audit did not report every policy name or column. Before applying, export the metadata and confirm the items below. These queries read metadata only:

```sql
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE (schemaname = 'public'
       AND tablename IN ('sharp_jobs', 'gaussian_jobs', 'profiles', 'canvas_history',
                         'canvas_history_events', 'canvas_history_snapshots',
                         'comment_votes', 'subscriptions', 'waitlist'))
   OR (schemaname = 'storage' AND tablename = 'objects')
ORDER BY schemaname, tablename, policyname;

SELECT table_name, column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name IN ('profiles', 'waitlist')
ORDER BY table_name, ordinal_position;
```

Confirm:

1. The public column list of `profiles_public` (see "profiles" below). Every listed column must exist on `public.profiles`: `id`, `username`, `first_name`, `last_name`, `avatar_url`, `social_links`, `youtube`, `x`, `linkedin`, `thread`, `solana_wallet`, `wallet_address`. If one is missing, `CREATE VIEW` fails and the whole migration rolls back with no change. Remove the column from the view, and from the client code that reads it, before applying.
2. Whether any public page needs a creator wallet address, and which column holds it (`solana_wallet`, `wallet_address` or both). The view includes both today; see the reasons below. If the owner decides wallets must not be public, remove both columns from the view and the client calls listed under "Compatibility impacts" stop working.
3. The `waitlist` policy names are confirmed from the live export: `"Allow anonymous insert"` (anon INSERT, WITH CHECK true) and `"Allow select for authenticated users"` (authenticated SELECT, USING true). The migration drops both by name; the rollback recreates both.
4. Which `source` values other front-ends (for example a landing page outside this repository) write to `waitlist`. The insert policy accepts only `landing_page` and `login_page_waitlist`.
5. That `waitlist.id` and `waitlist.created_at` have defaults, and whether `waitlist.email` has a unique constraint. Clients can no longer set `id` or `created_at`.
6. `SHOW server_version;` is 15 or later. The view uses the `security_invoker` option.
7. That the role running the migration owns `public.profiles` or has `BYPASSRLS`, and that `profiles` does not have `FORCE ROW LEVEL SECURITY`. The view reads rows with its owner's rights. The self-check aborts if this does not hold.
8. Which canvas history tables exist: `canvas_history`, `canvas_history_events`, `canvas_history_snapshots`. For each, the name of the wallet-string policy, the wallet column, and the type of `user_id`.
9. The names of the `storage.objects` INSERT, UPDATE and DELETE policies for `profile-images`, and whether any of them also covers another bucket.
10. The name of the `hon-assets` INSERT policy for `anon`.
11. The names of the `comment_votes` SELECT, INSERT, UPDATE and DELETE policies.
12. The names of the `subscriptions` SELECT, INSERT, UPDATE and DELETE policies.
13. The `with_check` value of `profiles_update_own`. The audit lists only its `USING` condition.
14. The type of `profiles.id` (assumed `uuid`). `comment_votes.user_id`, `subscriptions.subscriber_id` and `subscriptions.creator_id` are `text` (owner export).
15. That `storage.objects.owner` is set on existing `profile-images` rows (`SELECT count(*) FROM storage.objects WHERE bucket_id = 'profile-images' AND owner IS NULL;`).
16. The table grants (`SELECT * FROM information_schema.role_table_grants WHERE table_name IN (...)`). The rollback restores the Supabase defaults (ALL to `anon` and `authenticated`), which include the audited SELECT grants.
17. `SECURITY DEFINER` functions that read or write these tables (see "Not covered").

Every name the migration drops without knowing it in advance appears as a `NOTICE: Dropping policy ...` line. Compare those lines with the export.

## What the migration changes

| Object | Before (audit) | After |
|---|---|---|
| `public.sharp_jobs` | ALL to PUBLIC, `true` | Service role only. Grants revoked from PUBLIC, `anon`, `authenticated`. |
| `public.gaussian_jobs` | ALL to PUBLIC, `true` | Service role only. Grants revoked from PUBLIC, `anon`, `authenticated`. |
| `public.profiles` | `profiles_public_read` SELECT to PUBLIC, `true`; table SELECT for `anon` and `authenticated`; UPDATE and INSERT for any row with a wallet | No privilege for `anon`. SELECT, INSERT and UPDATE for `authenticated` only on the row where `id = auth.uid()`. No client DELETE. |
| `public.profiles_public` (new view) | did not exist | SELECT for `anon` and `authenticated`. Public columns only, every row. |
| `public.waitlist` | `"Allow select for authenticated users"` SELECT, `true`; table SELECT for `anon` and `authenticated` | No client SELECT, UPDATE or DELETE. INSERT of `email` and `source` only, for `anon` and `authenticated`, with checks. Service role reads and manages rows. |
| canvas history | wallet string equals row wallet | ALL for `authenticated` when `user_id = auth.uid()`. Applied to each of the three tables that exists. A table without `user_id` becomes service role only, with a `WARNING`. |
| `public.comment_votes` | INSERT, UPDATE, DELETE `true` to PUBLIC | SELECT for `anon` and `authenticated`. INSERT, UPDATE, DELETE for `authenticated` when `user_id = auth.uid()::text`. |
| `public.subscriptions` | INSERT, UPDATE, DELETE `true` to PUBLIC | SELECT for `authenticated` when the row names the caller as subscriber or creator. INSERT and DELETE when `subscriber_id = auth.uid()::text`. No UPDATE. New function `public.subscriber_count(text)` for public counts. |
| `storage.objects`, `profile-images` | INSERT, UPDATE, DELETE checked only `bucket_id` | INSERT, UPDATE, DELETE for `authenticated` when `owner = auth.uid()` and the path is `profiles/<auth.uid()>/<file>`. Read policies unchanged. |
| `storage.objects`, `hon-assets` | INSERT for `anon` | Writes for the service role only. Read policies unchanged. |

Every table also gets a `service_role` policy. The service role has `BYPASSRLS` on Supabase, so these policies are a second layer only.

### profiles

The full row holds `email`, `discord_id`, `twitter_id`, `google_id`, `notification_preferences`, `privy_user_id` and `wallet_id`. Before this change anyone with the anon key could read all of them for every user, through `profiles_public_read` and the table SELECT grant.

After the change:

- `anon` has no privilege on `public.profiles`. Any query from `anon` fails with `permission denied for table profiles`.
- `authenticated` reads, inserts and updates only its own row (`profiles_owner_select`, `profiles_owner_insert`, `profiles_owner_update`). The full row, with email and linked identities, is visible only to its owner.
- Public pages read `public.profiles_public`.

`public.profiles_public` columns, taken from the code that reads other users' rows:

| Column | Used by |
|---|---|
| `id` | Public profile lookups that continue to comics and generations (`comicService.getComicsByUsername`, `recentGenerationsService.listForUsername`), comment authors, collaborator rows, `SupportModal.tsx` creator lookup. |
| `username` | Public profile page (`ProfileService.getProfileByUsername`), comment authors, collaborator names, username availability check in `ProfileV2.tsx`. |
| `first_name`, `last_name` | Public profile page header (`ProfileV2.tsx` via `mapSupabaseToUserProfile`). |
| `avatar_url` | Public profile page, comment authors, collaborators, recent generations. |
| `social_links`, `youtube`, `x`, `linkedin`, `thread` | Public profile page links (`ProfileV2.tsx`). |
| `solana_wallet` | `SupportModal.tsx` sends a tip to the creator's wallet. `ProfileService.getSubscriberCount` maps a creator's user ID to the wallet stored in `subscriptions.creator_id`. `ProfileService.getProfileByWallet` and the `ProfileV2.tsx` username check filter on it. |
| `wallet_address` | The same `SupportModal.tsx` and `getSubscriberCount` code reads it as the fallback when `solana_wallet` is empty. `recentGenerationsService.listForWalletAddress` filters on it. |

Left out on purpose: `email`, `discord_id`, `twitter_id`, `google_id`, `notification_preferences`, `privy_user_id`, `wallet_id`. Also left out because no public page reads them: `bio` and any display-name column (the mapper in `profileService.ts` does not read them), `auth_method`, `wallet_connected`, `is_creator`, `subscription_tier`, `subscription_status`, `preferences`, `created_at`, `updated_at`.

Wallet columns: a Solana address is public on chain, and the tip feature needs it. Publishing it next to a username links the two. If the owner does not want that link public, the tip and subscriber-count code needs a server route that resolves the wallet instead.

Why the view uses owner rights: the table's policies allow each user only their own row. A view that runs with the caller's rights (`security_invoker = true`) would show visitors nothing. The view is created with `security_invoker = false`, so it reads `public.profiles` with the rights of its owner (the role that ran the migration) and returns every row, but only the listed columns. `security_barrier = true` is also set. The view has no `WHERE` clause today, so the option matters only if a filter is added later.

Supabase's database linter reports this view as `security_definer_view` (lint 0010). That is expected here. The view is the intended public surface, and the column list is the control. Do not "fix" the warning by switching to `security_invoker = true`; public profile pages would then return no rows.

The view lists columns explicitly. A column added to `profiles` later is not public until the view is recreated with it. To change the list, edit the `CREATE VIEW` statement in the migration and run the migration again (it drops and recreates the view and its grant). Never add the columns in the "Left out on purpose" list.

### waitlist

`waitlistService.ts` inserts from the browser on the sign-up form (`WaitlistSignup.tsx`, shown by `Login.tsx` in waitlist mode), so the migration keeps a client INSERT. Controls:

- Column grant `INSERT (email, source)` for `anon` and `authenticated`. `id` and `created_at` take their defaults; any other column in the insert fails with `permission denied`.
- `waitlist_public_insert` WITH CHECK: `email` is 6 to 254 characters and matches `^[A-Za-z0-9._%+'-]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}$`; `source` is `landing_page` or `login_page_waitlist`. Addresses with non-ASCII characters are rejected.
- No SELECT, UPDATE or DELETE grant or policy for `anon` or `authenticated`. The INSERT must not ask for the row back (`RETURNING` a column fails without SELECT). supabase-js `insert()` without `.select()` does not ask for it.
- `waitlist_service_role` for server tools that read the list.

### Job tables

The fixture now uses the live shapes from the owner's export:

- `public.sharp_jobs`: `id text, image_url, status, ply_data, ply_url, filename, size_bytes, error, created_at, completed_at`. There is no `owner_id` and no `storage_path` yet.
- `public.gaussian_jobs`: `id integer, job_id varchar, video_url, panel_id, quality, status, progress, stage, result, error_message, start_time, updated_at, created_at`.

Both stay service role only. The migration does not read or add columns on these tables.

Prerequisite for the SHARP API: `api/sharp/submit.js`, `status.js` and `result.js` read and write `owner_id` and `storage_path`. `migrations/secure_sharp_jobs.sql` adds them and the private bucket `hon-private-splats`. It has not been applied. Until it is, the SHARP routes fail on the missing columns whether or not this migration runs. `secure_sharp_jobs.sql` can run before or after this migration: it recreates `"Service role has full access to sharp_jobs"` for `service_role` only, which the self-check accepts. A later run of this migration drops that policy again and keeps `sharp_jobs_service_role`.

### Choices that differ from the requested design

- `subscriber_count` takes `text`, not `uuid`. `ProfileV2.tsx` and `profileService.ts` pass creator wallet addresses as `creator_id`. It hides who subscribes to whom; the table rows are visible only to the two parties.
- `profile-images`: `imageUploadService.ts` writes `profiles/<userId>/<type>_<userId>_<time>.<ext>`. The user ID is the second path segment, not the first. The policy checks `owner = auth.uid()` and also pins the folder to `profiles/<auth.uid()>/`.
- `hon-assets`: `WorldScenesPanel.tsx` writes `worlds/<random name>` with no user ID in the path. There is no client write policy. `api/splat/process-lod.js` uses the service key and is unaffected.
- `comment_votes.user_id`, `subscriptions.subscriber_id`, `subscriptions.creator_id` are `text` on the live project. The policies compare them with `auth.uid()::text`. There is no cast to `uuid`, which would fail on values such as `'guest-user'` or wallet addresses.
- `waitlist` INSERT is open to `authenticated` as well as `anon`, with the same checks, so a signed-in visitor on the form is not refused.
- Unknown names: the migration drops every permissive policy on the listed public tables, not only those open to PUBLIC or `anon` with `true` or a wallet check. A permissive policy for `authenticated` with `true` would also keep access open. Restrictive policies are kept.
- Storage: the migration drops every non-SELECT policy on `storage.objects` whose condition names `profile-images` or `hon-assets`, and every non-SELECT policy open to PUBLIC or `anon` with `true`.

## Drop list

By exact audited name:

- `"Service role has full access to sharp_jobs"` on `public.sharp_jobs`
- `"Allow all operations on gaussian_jobs"` on `public.gaussian_jobs`
- `"profiles_update_own"` on `public.profiles`
- `"Allow wallet-based profile creation"` on `public.profiles`
- `"profiles_public_read"` on `public.profiles`
- `"Allow select for authenticated users"` on `public.waitlist`

By likely name (from the repository's older SQL and common templates):

- `public.profiles`: `"Allow wallet-only profile creation"`, `"Allow wallet-only profile updates"`, `"Allow users to insert their own profile"`, `"Allow users to update their own profile"`, `"Allow users to view profiles"`, `"Public profiles are viewable by everyone"`
- `public.waitlist`: `"Allow anonymous insert"`
- canvas history: `"canvas_history_wallet_access"`, `"canvas_history_events_wallet_access"`, `"canvas_history_snapshots_wallet_access"`, `"Users can view their own canvas events"`, `"Users can insert their own canvas events"`, `"Users can view their own canvas snapshots"`, `"Users can insert their own canvas snapshots"`
- `public.comment_votes`: `"Anyone can view comment votes"`, `"Anyone can insert comment votes"`, `"Anyone can update comment votes"`, `"Anyone can delete comment votes"`
- `public.subscriptions`: `"subscriptions_select_policy"`, `"Anyone can insert subscriptions"`, `"Anyone can update subscriptions"`, `"Anyone can delete subscriptions"`
- `storage.objects`: `"Allow public uploads to profile-images"`, `"Allow public updates to profile-images"`, `"Allow public deletes from profile-images"`, `"Allow anon uploads to hon-assets"`

By rule, whatever the name: every permissive policy on `sharp_jobs`, `gaussian_jobs`, `profiles`, the canvas history tables, `comment_votes`, `subscriptions` and `waitlist`, and the storage write policies described above.

The migration also drops and recreates the view `public.profiles_public`.

## Self-check

The last block of the migration raises an exception, and the transaction rolls back, if any of these remain:

- a permissive policy on the listed public tables for PUBLIC with `qual` or `with_check` equal to `true`;
- a permissive INSERT, UPDATE, DELETE or ALL policy on those tables for PUBLIC or `anon`. The one exception is a `waitlist` INSERT policy whose check is not `true` and mentions `email`;
- a permissive SELECT or ALL policy on `profiles` or `waitlist` for PUBLIC, `anon` or `authenticated` with `USING (true)`;
- for `anon`: any SELECT, INSERT, UPDATE or DELETE privilege on `profiles`, or SELECT, UPDATE or DELETE on `waitlist`. For `authenticated`: SELECT, UPDATE or DELETE on `waitlist`, or DELETE on `profiles`. Table and column privileges both count, and so do privileges held through PUBLIC or an inherited role (a role membership is not removed by `REVOKE ... FROM anon`);
- an INSERT, UPDATE or DELETE privilege for `anon` or `authenticated` on `profiles_public`. The view runs with owner rights, so a write through it would skip the table policies. Supabase's default privileges grant ALL on new views; the migration revokes them;
- a column named `email`, `discord_id`, `twitter_id`, `google_id`, `notification_preferences`, `privy_user_id` or `wallet_id` in `profiles_public`;
- `profiles_public` that is not a view, runs with invoker rights, or has an owner that cannot read every `profiles` row (not the table owner and no `BYPASSRLS`, or `FORCE ROW LEVEL SECURITY` on the table);
- a permissive policy on `sharp_jobs` or `gaussian_jobs` for any role other than `service_role`;
- a permissive policy on `profiles` or a canvas history table that mentions a wallet column. This is stricter than "wallet equality without `auth.uid()`": the older repository policies combine `auth.uid()` with a wallet comparison, and the comparison alone grants access;
- a write policy on `storage.objects` for these buckets that is open to PUBLIC or `anon`, a `hon-assets` write policy for a role other than `service_role`, or a `profile-images` write policy without `auth.uid()`.

## Compatibility impacts

Wallet-only sessions (a connected Solana wallet without a Supabase session) and Privy sessions send requests as `anon`. All profile writes and all full-row profile reads from those states stop working.

### profiles, without the client follow-up commit

Every read of another user's profile through `.from('profiles')` fails for `anon` with `permission denied` and returns no row for `authenticated`. This covers every call in the next table. Deploy the client follow-up commit right after the migration.

### profiles, with the client follow-up commit

| Code path | Today | After migration and follow-up |
|---|---|---|
| `profileService.ts`, `getProfileByUsername` (public profile page) | `profiles`, `select('*')` | `profiles_public`, `select('*')`. Same fields for the page. |
| `profileService.ts`, `getProfileByWallet` | `profiles` by `solana_wallet`, then `wallet_address` | `profiles_public`. Works for wallet-only users; returns public columns, which are all the mapper reads. |
| `profileService.ts`, `getSubscriberCount`, creator wallet lookup | `profiles` by `id` | `profiles_public`. The count query itself is unchanged (see the subscriptions row below). |
| `profileService.ts`, `getProfile` (own profile in `useUserProfile`) | `profiles` by `id` | Unchanged. Works for a signed-in user. Fails for Privy IDs without a Supabase session; the hook then tries the wallet lookup. |
| `profileService.ts`, `upsertProfile`, `updateProfile` | `profiles`, wallet lookup reads `wallet_id` | Unchanged. With a session, the lookup sees only the caller's row. Without a session it fails. |
| `collaboratorService.ts`, `getCollaborators` | `profiles` by collaborator `id` | `profiles_public`. |
| `collaboratorService.ts`, `searchUsers` | `profiles`, `select('*')`, filter `username.ilike` OR `email.ilike` | `profiles_public`, `select('id, username, avatar_url')`, filter `username.ilike` only. Searching by email no longer works. The display fallback no longer derives a name from the email. |
| `collaboratorService.ts`, `checkTablesSetup` | head count on `profiles` | Head count on `profiles_public`. |
| `recentGenerationsService.ts`, `listForWalletAddress` | `profiles` by `wallet_address` | `profiles_public`. |
| `recentGenerationsService.ts`, `listForUsername` | `profiles` by `username` | `profiles_public`. |
| `recentGenerationsService.ts`, `listForCurrentUser` | `profiles` by own `id` | Unchanged. |
| `commentService.ts`, `getComments` table fallback | embeds `profiles!left(id, username, avatar_url)` | Embeds `profiles_public!left(...)` under the same `profiles` alias. PostgREST must detect the foreign key through the view; this is not tested here (see "Not verified"). |
| `commentService.ts`, `addComment` | own row by `id` | Unchanged. |
| `comicService.ts`, `getComicsByUsername` | `profiles` by `username` | `profiles_public`. |
| `ProfileV2.tsx`, `checkUsernameUniqueness` | `profiles` by `username`, excluding own wallet | `profiles_public`. Same result. |
| `SupportModal.tsx`, creator wallet lookup | `profiles` by `id` or `username` | `profiles_public`. Same columns. |
| `Login.tsx`, `createUserProfile` | own row by `id` | Unchanged. Works after `SIGNED_IN`. |
| `AuthContext.tsx`, `handleWalletAuth` with a session | own row by `id`, then update | Unchanged. Works. |
| `AuthContext.tsx`, `handleWalletAuth` without a session | reads the profile by `solana_wallet`, inserts with `wallet_id` if missing | The read fails with `permission denied`, the hook sets an error, and `user` stays `null` for wallet-only sessions. Unchanged on purpose: a wallet string from the browser is not proof of ownership. Needs the verified wallet route below. |
| `AuthContext.tsx`, `updateUsername` | reads and updates by `solana_wallet` | Without a session both fail. With a session only the caller's own row matches. |
| `AuthContext.tsx`, `syncPrivyToSupabase` | reads any profile by `email`, inserts without `id` | Fails (`anon`). Before, it could read any user's row by email. |

### waitlist

`waitlistService.ts` has four `.from('waitlist')` calls:

| Call | Today | After the migration | After the follow-up |
|---|---|---|---|
| `ensureTableExists`, `select('id').limit(1)` | Returns rows for signed-in users, none for `anon` | Returns error `42501`. The code acts only on `42P01`, so nothing else happens. | Removed. |
| `addToWaitlist` duplicate check, `select('email').eq('email', …)` | Finds the address only for signed-in users | Returns error `42501`; `data` is `null`, so the code goes on to insert. Duplicates are no longer filtered here. | Removed. |
| `addToWaitlist` insert with `role` | The live table has no `role` column, so PostgREST returns `PGRST204` and the code retries | Same. | Removed; one insert of `{ email, source }`. |
| `addToWaitlist` fallback insert `{ email, source }` | Accepted | Accepted when the email passes the check and `source` is allowed. A malformed email or another source returns an RLS error and the form shows "Failed to join waitlist". | Same insert, now the only one. |

If `waitlist.email` has no unique constraint, a repeated address is stored again. If it has one, the duplicate returns `23505`, which the code treats as success. That response also tells a caller that the address is already on the list.

### Other tables

| Code path | Today | After |
|---|---|---|
| `ProfileV2.tsx` image upload | Path `profiles/<user id or wallet>/...` | Works for signed-in users. Fails for wallet-only users. Old objects with `owner` NULL cannot be replaced or deleted by clients. |
| `WorldScenesPanel.tsx` upload to `hon-assets` | Browser upload to `worlds/<random>` | Fails for every client. Needs a server route with the service key, or a path `worlds/<user id>/...` plus an owner policy. |
| `commentService.ts`, `voteOnComment` table fallback | Writes `user_id = user?.id \|\| 'guest-user'` | Works for signed-in users. Guest votes fail. Reads still work. |
| `subscriptionService.ts` / `ProfileV2.tsx` subscribe | `subscriber_id = user?.id \|\| wallet` | Works with a session. Fails for wallet-only users. |
| `profileService.getSubscriberCount`, `SubscriptionService.getSubscriptionCount` | `count` on `subscriptions` by `creator_id` | `anon` gets a permission error (the code returns 0). A signed-in user counts only rows that name them. Switch to `supabase.rpc('subscriber_count', { p_creator_id })`. Not part of the follow-up commit. |
| `canvasHistory.ts` | History RPCs and a direct `canvas_history_snapshots` update | Works for the signed-in owner when the RPCs are the `SECURITY INVOKER` versions from `secure_canvas_history.sql`. Wallet-only users cannot save history. |
| `api/sharp/*.js`, `api/splat/process-lod.js` | Service key | Not affected by this migration. The SHARP routes need `secure_sharp_jobs.sql` (see "Job tables"). |
| `gaussian_jobs` | No code in this repository reads it | Any outside client using the anon key loses access. |

Replacement for wallet-only profile reads and writes: a server route issues a nonce, verifies the wallet's signature over it, and then reads or writes the profile with the service key, keyed by the verified wallet. The alternative is to give wallet users a Supabase session, so the client policies apply. Neither is implemented here.

## Client follow-up commit

The client changes are in a separate commit after the SQL commit, so the owner can hold them back. They change only the public read call sites listed above, plus `waitlistService.ts`:

- `src/services/profileService.ts`: `getProfileByUsername`, `getProfileByWallet`, and the wallet lookup in `getSubscriberCount` read `profiles_public`.
- `src/services/collaboratorService.ts`: `getCollaborators` and `checkTablesSetup` read `profiles_public`; `searchUsers` reads `profiles_public` with an explicit column list and searches by username only.
- `src/services/recentGenerationsService.ts`: `listForWalletAddress` and `listForUsername` read `profiles_public`.
- `src/services/commentService.ts`: the `getComments` fallback embeds `profiles_public`.
- `src/services/comicService.ts`: `getComicsByUsername` reads `profiles_public`.
- `src/components/ProfileV2.tsx`: `checkUsernameUniqueness` reads `profiles_public`.
- `src/components/media/SupportModal.tsx`: the creator wallet lookup reads `profiles_public`.
- `src/services/waitlistService.ts`: drops the two SELECT calls and the `role` field; inserts `{ email, source }` once.

`Login.tsx`, `AuthContext.tsx` and the own-row calls in the services above keep `.from('profiles')`.

Order: apply the migration first, then deploy the client commit. The client commit reads `profiles_public`, which does not exist before the migration. Between the two steps, public profile pages, comment author names, collaborator names and the tip lookup fail for visitors.

## Prerequisites

- Request budget: the tables from `migrations/api_request_budget.sql` (`public.hon_api_request_windows` and `public.claim_hon_api_request`) are absent on the live project. The `/api` routes that claim a request need them. Apply that file separately. It runs in its own transaction and can be reapplied.
- SHARP jobs: `migrations/secure_sharp_jobs.sql` (see "Job tables").

This migration includes neither.

## Disposable test

```sh
python3 tests/run-database-security.py
```

The script creates two throwaway PostgreSQL clusters on Unix sockets only and deletes them afterwards. It never takes a database URL. `initdb` does not run as root; run the script as an unprivileged user, for example `runuser -u postgres -- python3 -I <copy>/tests/run-database-security.py` on a copy of `tests/` and `migrations/` that user can read.

Phase 2 runs: bootstrap; the live fixture with fake profile and waitlist rows; probes that the fixture is open (anonymous writes, user A reading user B's email and the whole waitlist, `anon` reading every email); the hardening migration; the security assertions; 15 self-check probes, each adding one forbidden policy, grant or view change; two runs of the whole migration with a forbidden grant held through a role membership, which must abort and change nothing; the rollback; checks that the 21 audited policies, the open reads and the SELECT grants are back and the view is gone; the migration twice more; and the assertions again.

The assertions include a scan, as `anon` and as user A, of every table and view the role can read, which fails if any value contains a fake email, linked identity ID, preference marker or `wallet_id` the role must not see.

### Optional tables and canvas layouts

The live project has `canvas_history_events` and `canvas_history_snapshots` (both with `user_id uuid`) and no `canvas_history`. The migration must work whether or not each canvas history table exists. Every statement on one of the three canvas tables runs only when `to_regclass('public.<table>')` is not NULL. This covers the exact-name drops in step 2 (a `DO` block with `EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', ...)`), the drop-by-rule loop and step 6. The block prints `NOTICE: Skipped: public.<table> does not exist` for each missing table. The rollback's canvas step uses the same check. The policies dropped and created for a table that exists are unchanged.

The other tables the two files touch are on the owner's verified list: `profiles`, `waitlist`, `sharp_jobs`, `gaussian_jobs`, `comment_votes`, `subscriptions` and the canvas tables above. They also touch `storage.objects`, which every Supabase project has; it is not on that list.

Phase 4 of the disposable test runs the migration, the assertions, the rollback, a reapply and the assertions again on three layouts. All three pass, with identical policies and grants for every table present in more than one layout:

- the live layout (`canvas_history_events` and `canvas_history_snapshots` only, the primary fixture);
- a legacy layout that adds `canvas_history` (`tests/sql/live-policy-legacy-canvas.sql`, `user_id uuid`);
- a layout with no canvas table (`tests/sql/live-policy-no-canvas.sql`).

First live attempt: the run stopped before COMMIT with 42P01, `public.canvas_history does not exist`, and was rolled back with no change.

The owner later reproduced it in the live Supabase SQL editor: the isolated statement `DROP POLICY IF EXISTS "canvas_history_wallet_access" ON public.canvas_history;` raised 42P01 there, while the guarded dynamic form ran clean in a rollback-only trial, and the guarded package then committed. The internal reason the editor path raises where plain PostgreSQL 15 to 17 only skips is not known. Locally the failure is not reproduced. On PostgreSQL 16.15, `DROP POLICY IF EXISTS ... ON public.canvas_history` prints `NOTICE: relation "public.canvas_history" does not exist, skipping` and does not raise. The whole earlier version of this file also commits on the live layout. No other statement in this file, its rollback, `harden_rpc_exposure.sql` or its rollback names `public.canvas_history` as a relation (no regclass cast, no privilege function, no `format()` statement before a `to_regclass` check). The statement that raised live is therefore not identified. Before the next attempt, the owner should send the full error from the SQL editor: SQLSTATE, `LINE`, `CONTEXT` and the statement text.

### Fixture assumptions not stated by the owner's exports

- `profiles`: column types and keys (`wallet_id uuid` primary key, `id uuid` unique with a foreign key to `auth.users`). The exports name the private columns but not their types. The RPC fixture adds `profiles.created_at`, which `handle_new_user` writes.
- `auth.users.email`: added so that `handle_new_user` runs.
- `canvas_history_events` and `canvas_history_snapshots`: columns other than `user_id` (stated as `uuid`).
- `comment_votes`: the `UNIQUE (comment_id, user_id)` and `CHECK (vote_type IN (-1, 1))` constraints, and `NOT NULL` on its columns.
- `subscriptions`: `UNIQUE (subscriber_id, creator_id)` and `NOT NULL` on its ID columns.
- `waitlist`, `sharp_jobs`, `gaussian_jobs`: from the earlier export round, not from `preflight.json` or `followup.json`.
- `hon_evi_sessions`: only `id` and `updated_at`.
- `storage.buckets`, `storage.objects`, `storage.foldername`, `auth.uid()`, `auth.role()`: minimal mocks with the behaviour the policies need.
- Primary keys and defaults of `comic_drafts`, `comics` and `creator_subscriptions`. Row-level security is enabled on the `comic_*` tables with no client policy; their live policies were not exported.
- The `postgres` role is a superuser in the RPC fixture, so that the definer routines it owns reach every table.

## Applying

1. Confirm the items in "Confirm before applying". Keep the export as the record of the old state.
2. Replace stand-in names in the rollback file with the confirmed names.
3. Run the disposable test.
4. In the Supabase SQL editor, paste the whole migration and run it once. The file has its own `BEGIN` and `COMMIT`. On any error, nothing changes.
5. Read the `NOTICE` lines. Each one names a policy that was dropped by rule.
6. If the editor reports `must be owner of table objects`, the storage part needs the Dashboard storage policy page. The transaction has rolled back; nothing changed.
7. Deploy the client follow-up commit. Until then the calls listed under "Compatibility impacts" fail.

## Rollback

`migrations/rollback_harden_live_policies.sql` restores the audited state. It is for emergency use only. It drops the new policies, `public.subscriber_count(text)` and the view `public.profiles_public`, grants ALL on the tables back to `anon` and `authenticated` (this includes the audited SELECT grants on `profiles` and `waitlist`), and recreates the audited policies, including `profiles_public_read` (SELECT to PUBLIC, `true`) and `"Allow select for authenticated users"` on `waitlist`. Names the audit or export reported are exact. The others are the stand-ins used in the test fixture and must be replaced with the confirmed names before use. Run it the same way as the migration.

The rollback drops `profiles_public`. Revert the client follow-up commit at the same time, or the public reads it changed fail.

## Not covered

- `SECURITY DEFINER` functions bypass row-level security. Older SQL in `legacy/comic-sql/fix_social_features.sql` defines `toggle_subscription` and `add_comment` with a caller-supplied user ID. `commentService.ts` calls `get_comic_comments`, `vote_on_comment` and `get_comment_votes`. If these exist live as `SECURITY DEFINER`, they keep their current behaviour, and any that return profile columns can still return private ones. List them with `SELECT n.nspname, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE p.prosecdef AND n.nspname = 'public';`.
- A signed-in user can still write any column of their own profile row, including `email`, `discord_id`, `twitter_id`, `google_id`, `privy_user_id` and `solana_wallet`. Code that trusts these values as linked identities trusts a value the user chose. Column-level UPDATE limits are not part of this migration.
- `src/contexts/AuthContext 2.tsx` and `src/types/supabase 2.ts` are duplicate files and are not changed.
- Other tables and buckets, including `hon-private-splats`.

## Not verified

- Live column names and types beyond the owner's export. The fixture assumes the types noted in `tests/sql/live-policy-fixture.sql`.
- PostgREST embedding through the view in `commentService.ts` (`profiles_public!left`). PostgREST detects relationships through simple views, but whether `comic_comments.user_id` has a foreign key to `profiles.id` on the live project is unknown. If it has none, the embed already fails today.
- The exact SQL that the live PostgREST version sends for `insert()` without `.select()`. The test confirms that a plain insert works and that `RETURNING` a column is refused.
