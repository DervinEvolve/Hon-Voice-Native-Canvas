# RPC hardening

> Scope note: the client call sites named below were analysed before the canvas-only snapshot. The profile, feed, comment, subscription and tipping pages and their services are no longer in this repository (they remain in the private original), so those rows describe why each column or policy was chosen, not code that still ships here. The SQL, its tests and its rollback are unchanged by that removal.

`migrations/harden_rpc_exposure.sql` changes:

- the 33 `SECURITY DEFINER` routines that the owner exported from the live project;
- the two `SECURITY INVOKER` trigger helpers;
- the policies of `public.profiles_new` and `public.comics_new`.

`migrations/rollback_harden_rpc_exposure.sql` puts the exported state back. `tests/sql/rpc-fixture.sql` and `tests/sql/rpc-security.sql` test both files against a disposable PostgreSQL.

The inputs are the owner's read-only exports:

- the definitions (`pg_get_functiondef`) and ACLs of the 26 non-trigger routines, the 7 trigger functions and the 2 trigger helpers;
- column types of the tables these routines use, and of `profiles_new` and `comics_new`;
- the four live policies on `profiles_new` and `comics_new`;
- the five live trigger attachments;
- every routine in `public` that `anon` or `authenticated` can execute.

### Verified live metadata

The owner verified these on the live project with SELECT-only metadata queries (PostgreSQL 15.14):

- Table grants on `public.profiles_new`: `anon`, `authenticated` and `service_role` each hold all seven table privileges: SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER.
- Column types: `profiles.created_at` and `hon_evi_sessions.updated_at` are `timestamptz`; `auth.users.email` is `varchar`.
- `auth.role()` is a stable SQL function, owned by `supabase_auth_admin`, that returns `coalesce(request.jwt.claim.role, request.jwt.claims->>'role')`: the role claim setting, or else the `role` key of the claims JSON.

`tests/sql/rpc-fixture.sql` matches all three: it grants the seven privileges to the three roles, uses these column types and stops if an earlier fixture left a different type on them, and recreates `auth.role()` in that form, owned by a stand-in `supabase_auth_admin` role.

A `SECURITY DEFINER` routine runs with its owner's rights. Row-level security does not apply inside it. On the live project (PostgreSQL 15.14, owner `postgres`) all 35 routines have the ACL `{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}`: PUBLIC, `anon`, `authenticated` and `service_role` may execute them. Of the 33 definer routines, only `set_bookmark_user_id` refers to `auth.uid()`.

The live canvas history routines take a client-supplied `p_user_id` and have no `auth.uid()` check. This showed that `migrations/secure_canvas_history.sql` had not been applied live at the time of the audit; it was applied with the combined package on 2026-11-03.

All changes run in one transaction. The migration:

- creates, empties and drops no table;
- deletes no row;
- creates, drops or alters no trigger.

It creates one view, `public.profiles_new_public`. Each routine step runs only when the routine exists with the exact live signature; a missing routine is skipped with a `NOTICE`.

## What a client can do today

On the fixture, which uses the exact live bodies, ACLs, policies, triggers and column types, a caller with the anon key can:

- find a user ID from an email address (`get_user_id_from_identifier`);
- read every `profiles_new` row with its email, preferences and subscription data (`"Users can view all profiles"`);
- read user B's canvas snapshot (`get_canvas_snapshot`) and any canvas history;
- delete canvas history with a chosen retention (`cleanup_old_events`, `cleanup_old_snapshots`);
- call `set_current_user_id` with any value. In the same transaction, the `app.current_user_id` policies then show and allow changes to that user's `profiles_new` and `comics_new` rows, including unpublished comics.

A signed-in user can also read another user's vote (`get_comment_votes(uuid,text)`).

## Prerequisites and preflight

The migration checks each of these at the start. If any check fails, it raises before any change and names the object.

1. `migrations/harden_live_policies.sql` is applied (`public.profiles_public` exists).
2. `migrations/secure_canvas_history.sql` is applied. The migration aborts while any of `save_canvas_event`, `create_canvas_snapshot`, `get_canvas_timeline`, `get_canvas_snapshot`, `update_canvas_snapshot_thumbnail`, `cleanup_old_snapshots`, `cleanup_old_events`, `get_project_storage_stats` or `calculate_snapshot_size` is still `SECURITY DEFINER`.
3. Column types: `comic_comments.comic_id` and `comic_comments.user_id` are `uuid`; `comment_votes.user_id` is `text`; `subscriptions.subscriber_id` and `subscriptions.creator_id` are `text`; `creator_subscriptions.subscriber_id` and `creator_subscriptions.creator_id` are `uuid`.
4. No drift in routines. The 33 routines the migration changes are checked against expected values that were computed when the file was generated and are written into it:
   - `md5(pg_get_functiondef(oid))` must equal one expected value;
   - `pg_proc.proacl` must hold the same entries as the expected ACL. Order is ignored: the same grants can be stored in a different order (the fixture shows this), and the order carries no meaning.

   Each routine is accepted in one of two states: the state before the migration, or the state the migration leaves (so the file can be reapplied).
   - For routines that `secure_canvas_history.sql` does not change, "before" is the exported definition and ACL. On PostgreSQL 16, `pg_get_functiondef` reproduced the 35 exported texts byte for byte.
   - For the canvas routines that `secure_canvas_history.sql` replaces or alters, "before" is the state after that migration, measured in the fixture.
5. No drift in policies. The policies on `profiles_new` and `comics_new` (name, command, roles, USING, WITH CHECK) must be exactly the four exported ones, or exactly the set the migration leaves.
6. Grants on `profiles_new`. All seven table privileges (SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER) are compared for `anon` and `authenticated`. Two states are accepted:
   - before (the verified live state): `anon` and `authenticated` both hold all seven;
   - after (the state the migration leaves, so it can be reapplied): `anon` holds none of the seven, also not on a single column; `authenticated` holds exactly SELECT, INSERT, UPDATE and DELETE, and none of TRUNCATE, REFERENCES or TRIGGER.

   Any other combination aborts the transaction. The error names each role and privilege that differs from the nearer of the two states, for example `nearest is the live state (anon and authenticated hold all seven): authenticated lacks TRIGGER`. `service_role` is reported in a `NOTICE` and not required. It holds all seven live and the migration does not change it.

The rollback has the same preflight against the state the migration leaves (or the already rolled-back state), and refuses to run on a database that differs from both. For the `profiles_new` grants it accepts:

- the hardened state: `anon` holds none of the seven (table or column), `authenticated` holds exactly SELECT, INSERT, UPDATE and DELETE;
- the live state, for a database that is already rolled back: `anon` and `authenticated` both hold all seven.

Any other combination aborts and names the role and privilege, for example `nearest is the hardened state (...): authenticated holds TRUNCATE`.

## Inventory and changes

"Client call" is a `supabase.rpc(...)` call at commit `26b2187`. "Rollback" is what `rollback_harden_rpc_exposure.sql` does. "Live verbatim" means it recreates the routine from the exported text, with the live `SET search_path` and the live ACL.

### Routines

| Live routine | Live problem | Result | Callers after | Client call | Rollback |
|---|---|---|---|---|---|
| `add_comment(text,text,text,uuid)` | Caller-supplied `p_user_id`; fails for every call (inserts `text` into `uuid` columns, 42804) | **Rewritten**: `user_id` from `auth.uid()`; `p_comic_id::uuid` with 22P02 on bad input; 42501 when `p_user_id` differs | `authenticated`, `service_role` | `commentService.ts:100` | live verbatim |
| `get_comment_votes(uuid,text)` | Returns any user's vote | **Rewritten**: vote from `auth.uid()::text`; 42501 for a different ID when signed in; visitors get counts | `anon`, `authenticated`, `service_role` | `commentService.ts:317` | live verbatim |
| `get_user_subscriptions(uuid)` | Caller-supplied ID; fails (42702) | **Rewritten**: own only; creator fields from `profiles_public` | `authenticated`, `service_role` | none | live verbatim |
| `get_user_subscriptions(text)` | Caller-supplied ID; fails (42883) | **Rewritten**: own only; `subscriber_id = auth.uid()` | `authenticated`, `service_role` | none | live verbatim |
| `is_subscribed(text,text)` | Caller-supplied ID; fails (42883) | **Rewritten**: own only; uuid casts, 22P02 for a creator ID that is not a uuid | `authenticated`, `service_role` | none | live verbatim |
| `is_subscribed(uuid,uuid)` | Caller-supplied ID; fails (42883) | **Rewritten**: own only; compares as text | `authenticated`, `service_role` | none | live verbatim |
| `get_user_id_from_identifier(text)` | Matches on `profiles.email` | **Rewritten**: ID or username from `profiles_public` | `service_role` | none | live verbatim |
| `get_canvas_snapshot(uuid)`, `get_canvas_timeline(text,integer)`, `update_canvas_snapshot_thumbnail(uuid,text)` | Any user's canvas history | **Rewritten** from the `secure_canvas_history.sql` versions plus a `user_id = auth.uid()` filter; invoker | `authenticated` | `canvasHistory.ts:369`, `:418`, `:451`, `:519` | live verbatim |
| `save_canvas_event(...)`, `create_canvas_snapshot(...)` | Caller-supplied `p_user_id` | Replaced by `secure_canvas_history.sql`; not changed here | `authenticated` | `canvasHistory.ts:590`, `:255` | live verbatim |
| `get_user_bookmarks(uuid)`, `is_comic_bookmarked(uuid,text)` | Read `public.bookmarks`, which does not exist live | **Service-only**; body unchanged | `service_role` | `bookmarkService.ts:116`, `:171` | live verbatim |
| `get_user_likes(uuid)`, `is_comic_liked(uuid,text)` | Read `public.likes`, which does not exist live | **Service-only**; body unchanged | `service_role` | none | live verbatim |
| `cleanup_old_events(integer)`, `cleanup_old_snapshots(text,integer,integer)`, `get_project_storage_stats(text)`, `get_pg_version()`, `setup_collaboration_tables()` | Open admin and cleanup helpers | **Service-only** | `service_role` | `SupabaseDiagnostic.tsx:47`, `:65` (last two) | live verbatim |
| `set_current_user_id(text)` | Sets `app.current_user_id` to any value | **Service-only**; the policies that trusted it are replaced (below) | `service_role` | none | live verbatim |
| `get_comments_for_comic(text)` | Fails (42883); see "Broken before, unchanged" | **Kept public**; `search_path = ''`; body unchanged | `anon`, `authenticated`, `service_role` | none | live verbatim |
| `get_comment_votes(uuid)`, `get_comic_id_from_draft_id(text)`, `increment_comic_views(text)` | Public reads; see notes | **Kept public**; `search_path = ''` | `anon`, `authenticated`, `service_role` | `comicService.ts:334` (last) | live verbatim |
| 7 trigger functions | PUBLIC could call them directly | **Rewritten**: exported body, `search_path = ''`; client EXECUTE revoked | none | none | live verbatim |
| `calculate_snapshot_size()`, `update_hon_evi_sessions_updated_at()` (invoker) | Clients could call them directly | `ALTER FUNCTION ... SET search_path = ''` (bodies use only `pg_column_size` and `now()`, unchanged); client EXECUTE revoked | none | none | live verbatim |

No routine is dropped. Rewritten routines keep their live name, argument names, defaults and result type.

### Policies and the view

| Object | Live | After | Rollback |
|---|---|---|---|
| `profiles_new` `"Users can manage their own profile"` | ALL to PUBLIC, `id = current_setting('app.current_user_id', true)` | **Dropped**, replaced by `profiles_new_owner` | recreated by exact name and definition |
| `profiles_new` `"Users can view all profiles"` | SELECT to PUBLIC, `true` | **Dropped** | recreated by exact name and definition |
| `profiles_new` `profiles_new_owner` (new) | none | ALL to `authenticated`, USING and WITH CHECK `id = (SELECT auth.uid())::text` | dropped |
| `comics_new` `"Users can manage their own comics"` | ALL to PUBLIC, `creator_id = current_setting('app.current_user_id', true)` | **Dropped**, replaced by `comics_new_owner` | recreated by exact name and definition |
| `comics_new` `comics_new_owner` (new) | none | ALL to `authenticated`, USING and WITH CHECK `creator_id = (SELECT auth.uid())::text` | dropped |
| `comics_new` `"Anyone can view published comics"` | SELECT to PUBLIC, `is_published = true` | kept as is | not touched |
| `profiles_new` table grants | all seven privileges for `anon`, `authenticated` and `service_role` (verified; checked by the preflight) | `anon`: none of the seven; `authenticated`: exactly SELECT, INSERT, UPDATE, DELETE (own row only through the policy), with TRUNCATE, REFERENCES and TRIGGER revoked explicitly; `service_role`: unchanged (all seven) | SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER granted by name to `anon` and `authenticated`; `service_role` not touched |
| `profiles_new_public` (new view) | none | owner rights, `security_barrier`; columns `id`, `username`, `display_name`, `first_name`, `last_name`, `avatar_url`, `bio`, `wallet_address`, `solana_wallet`, `social_links`, `is_verified`, `is_creator`, `created_at`; SELECT only for `anon`, `authenticated`, `service_role` | dropped |

`profiles_new` holds `email`, `preferences`, `subscription_tier`, `subscription_status` and `subscription_expiry`. These columns are left out of the view, as are `updated_at` and the columns from the private list for `profiles`. The wallet columns stay public, as in `profiles_public`.

Nothing in `src/` or `api/` references `profiles_new`, `comics_new` or `set_current_user_id`, so no client path in this repository changes. An external consumer that relied on `set_current_user_id` to reach these rows must send a Supabase session; the owner policies then apply to `auth.uid()`.

### Triggers

Only five trigger attachments exist live. The migration does not change any of them:

| Trigger | Table | Function |
|---|---|---|
| `calculate_snapshot_size_trigger` (BEFORE INSERT OR UPDATE) | `public.canvas_history_snapshots` | `calculate_snapshot_size()` |
| `update_hon_evi_sessions_updated_at` (BEFORE UPDATE) | `public.hon_evi_sessions` | `update_hon_evi_sessions_updated_at()` |
| `update_profiles_updated_at` (BEFORE UPDATE) | `public.profiles` | `handle_updated_at()` |
| `waitlist_signup_notification` (AFTER INSERT) | `public.waitlist` | `notify_waitlist_signup()` |
| `on_auth_user_created` (AFTER INSERT) | `auth.users` | `handle_new_user()` |

`set_bookmark_user_id`, `trigger_collaboration_event`, `update_modified_column` and `update_updated_at_column` are not attached. They still get `search_path = ''` and lose client EXECUTE, and the rollback restores their bodies. A trigger runs without an EXECUTE check, so the five attached functions keep working. The test fires each of the five after pinning, from a role without EXECUTE on the function.

### Broken before, unchanged

These fail for every caller on the live project and still fail after the migration. The migration only pins `search_path` and changes grants:

- `get_comments_for_comic(text)`: compares the `uuid` column `comic_comments.comic_id` with the `text` argument (42883). Decision: left as is. No code in `src/` or `api/` calls it. `commentService.ts:33` calls `get_comic_comments` with `p_comic_id`, a routine that does not exist live. The client's comic IDs are `draft-${nanoid()}` (`src/App.tsx:103`, `src/components/ComicGrid.tsx:31`), which are not uuids. So there is no client contract that would show whether callers pass comic uuids. A `p_comic_id::uuid` fix would turn the client's draft IDs into 22P02 errors instead of 42883.
- `get_user_bookmarks(uuid)`, `is_comic_bookmarked(uuid,text)`, `get_user_likes(uuid)`, `is_comic_liked(uuid,text)`: read tables that do not exist live. Now `service_role` only; not created here.
- The one-argument call to `get_comment_votes(uuid)` is ambiguous (42725) while `get_comment_votes(uuid, text DEFAULT NULL)` exists.

### Broken before, fixed by the rewrite

`add_comment` (42804), `get_user_subscriptions(uuid)` (42702), `get_user_subscriptions(text)`, `is_subscribed(text,text)` and `is_subscribed(uuid,uuid)` (42883) now work for the caller's own data. `add_comment` still rejects comic IDs that are not uuids (22P02). That includes the client's `draft-…` IDs.

### Notes

- Service role: in the rewritten routines, a caller with no `auth.uid()` and `auth.role() = 'service_role'` acts for the supplied ID. `setup_collaboration_tables` already relies on `auth.role()` live.
- `increment_comic_views`: visitors can still call it any number of times for any comic ID. Each call writes a `comic_stats` row. A rate limit or a server route would be needed to stop that.
- The three canvas reads get an explicit `auth.uid()` filter, because the self-check refuses client-executable routines without `auth.uid()`. `get_project_storage_stats` and `cleanup_old_snapshots` become service-only, although `secure_canvas_history.sql` grants them to `authenticated`.

## Client impact

| Call | Today (live) | After |
|---|---|---|
| `commentService.ts:100` `add_comment` | Always fails (42804); fallback to a direct insert | Signed-in, uuid comic ID, own or null `p_user_id`: works. Draft IDs: 22P02, same fallback. Visitors: permission error, same fallback. |
| `commentService.ts:317` `get_comment_votes` | Returns any user's vote | Own vote only; visitors get counts. |
| `bookmarkService.ts:116`, `:171` | Fail (missing table) | Permission error; same fallbacks. |
| `comicService.ts:334` `increment_comic_views` | Works | Works. |
| `SupabaseDiagnostic.tsx:47`, `:65` | Version for anyone; setup refused | Permission error for clients. |
| `canvasHistory.ts` | Any caller reads or writes any history | Signed-in owner only (with `secure_canvas_history.sql`); wallet-only sessions cannot save history. |
| `profiles_new`, `comics_new` (no caller in this repository) | Open through PUBLIC policies and `set_current_user_id` | Owner rows for signed-in users; published comics for everyone; public profile columns through `profiles_new_public`. |

## Self-check

The block between `-- self-check:start` and `-- self-check:end` aborts the transaction if any of these is true. Rules 1 to 6 apply to routines in `public` that are not part of an extension:

1. a `SECURITY DEFINER` routine (triggers included) has `search_path` other than exactly `''`;
2. a `SECURITY DEFINER` routine is executable by PUBLIC;
3. a non-trigger `SECURITY DEFINER` routine's definition contains `email`, `discord_id`, `twitter_id`, `google_id`, `notification_preferences`, `privy_user_id`, `wallet_id`, `preferences`, `subscription_tier`, `subscription_status` or `subscription_expiry` as a word;
4. a non-trigger `SECURITY DEFINER` routine's definition names the table `profiles` or `profiles_new` (the `_public` views do not match);
5. a routine executable by `anon` or `authenticated` has no `auth.uid()` in its definition. The exceptions are the public reads `get_comments_for_comic(text)`, `get_comment_votes(uuid)`, `get_comic_id_from_draft_id(text)`, `increment_comic_views(text)` and `subscriber_count(text)`;
6. `anon` can execute a `SECURITY DEFINER` routine other than those public reads and `get_comment_votes(uuid,text)`;
7. `anon` holds any of the seven privileges on `profiles_new`, on the table or on a column; or `authenticated` holds TRUNCATE, TRIGGER or REFERENCES (table or column) on it;
8. a `profiles_new` policy is not for `authenticated` alone, or lacks `auth.uid()` in USING (for SELECT, UPDATE, DELETE, ALL) or in WITH CHECK (for INSERT, UPDATE, ALL);
9. a policy on `profiles_new` or `comics_new` refers to `app.current_user_id`;
10. `profiles_new_public` lists a private column, is not a view with owner rights whose owner reads every row, or lets `anon` or `authenticated` write through it.

The text rules look for names. They do not catch a private column reached through dynamic SQL, another view or another routine.

## Disposable test

```sh
python3 tests/run-database-security.py
```

`initdb` does not run as root. Copy `tests/` and `migrations/` to a directory the `postgres` user can read, for example under `/var/tmp`. Then run `runuser -u postgres -- python3 -I <copy>/tests/run-database-security.py`.

The RPC phase (fourth `PASS` line) runs in its own throwaway cluster:

1. Fixture: bootstrap, `live-policy-fixture.sql`, `harden_live_policies.sql`, `rpc-fixture.sql`. `rpc-fixture.sql` creates:
   - all 35 routines from the exact exported text, by a role named `postgres`, so hashes and ACL entries match the export;
   - the four live policies;
   - the five live trigger attachments;
   - the live column types of `comic_comments`, `comics_new` and `profiles_new`;
   - fake rows, including fake emails, preferences and subscription data in `profiles_new`;
   - the verified live grants on `profiles_new` (all seven privileges for `anon`, `authenticated` and `service_role`), the verified column types and the verified form of `auth.role()`.

   It does not create `bookmarks` or `likes`. The runner checks the fixture's grants (from `information_schema.role_table_grants`) and policy names. The migration's own drift check then confirms that the fixture's routine definitions, ACLs and policies are the exported ones; it would abort otherwise.
2. Probe of the live state. `anon` finds user B's ID by email, reads B's canvas snapshot and reads both `profiles_new` emails. User A reads B's vote and, through `set_current_user_id`, B's unpublished `comics_new` row. `anon` may run `cleanup_old_events`.
3. Precondition and drift checks. Each one aborts the migration and changes nothing:
   - live definer canvas routines;
   - missing `profiles_public`;
   - three column-type drifts;
   - eight drift probes: a changed body, a changed ACL, a changed trigger setting, a changed policy, an extra policy, and three `profiles_new` grant changes (DELETE or TRUNCATE revoked from `anon`, REFERENCES revoked from `authenticated`), each named in the error;
   - a committed drift: TRIGGER is revoked from `authenticated` and committed before the migration runs. The migration aborts naming `authenticated lacks TRIGGER`. A snapshot of the `profiles_new` grants (`information_schema.role_table_grants`), the full policy list of both tables, the view and all 35 routines is the same before and after the aborted run, so the revoked state is preserved. The grant is then put back.
4. The migration. No table, schema or trigger is added, removed or changed. The view and the new policy set exist. The `profiles_new` grants are exactly: `anon` none, `authenticated` SELECT, INSERT, UPDATE, DELETE, `service_role` all seven. The probe gets 42501 everywhere. Argument names and result types are unchanged.
5. `tests/sql/rpc-security.sql` runs the routine checks from round 2. It also checks:
   - `anon` cannot read `profiles_new` and reads `profiles_new_public` without any fake private value;
   - user A reads and updates only its own `profiles_new` row and cannot insert one for another user;
   - user A sees published comics plus its own, and cannot create, change or delete another user's comic;
   - `service_role` reads every row;
   - `anon` and user A cannot TRUNCATE `profiles_new`; the direct grants and the effective privileges on `profiles_new` are the hardened set above, with no column privilege for `anon` and no column REFERENCES for `authenticated`;
   - the five live triggers fire after pinning.

   The runner also checks the waitlist notification.
6. 32 self-check probes. Five are new for the `profiles_new` grants: TRIGGER for `anon`, and TRUNCATE, REFERENCES, column REFERENCES or TRIGGER for `authenticated`.
7. Three reapply drift probes on the hardened database: TRUNCATE granted to `authenticated`, column SELECT granted to `anon`, DELETE revoked from `authenticated`. Each makes the migration abort and names the privilege.
8. Four rollback drift probes (changed setting, changed ACL, changed policy, column SELECT for `anon`). Each aborts the rollback. Then four committed drifts on the hardened database: TRUNCATE, REFERENCES or TRIGGER granted to `authenticated` (one probe each), and SELECT granted to `anon`. Each makes the rollback abort and name the role and privilege. The snapshot (grants, policies, view, routines) is unchanged, so the extra grant and all hardening remain. The extra grant is then revoked.
9. Rollback. All 35 routines match the exported definitions and ACLs. The three policies are back, the view is gone, `anon` and `authenticated` hold all seven privileges on `profiles_new` again, and tables and triggers are unchanged. The probe is open again.
10. `secure_canvas_history.sql` again. Then an unknown unpinned definer routine makes the whole migration abort and change nothing.
11. The migration twice, the probe, `rpc-security.sql` and the notification check again.
12. Rollback again (apply, rollback, reapply, rollback), then once more on the rolled-back database. Both times all routines, policies and the seven grants are the live ones.

## Applying (done on the live project 2026-11-03; kept for another project)

1. Apply `migrations/harden_live_policies.sql` and `migrations/secure_canvas_history.sql` if they are not applied.
2. Run the disposable test.
3. In the Supabase SQL editor, paste the whole migration and run it once. It has its own `BEGIN` and `COMMIT`. On any error, nothing changes. A drift error names the routine or policy that differs from the export; re-export it before going further.
4. Read the `NOTICE` lines. Each `Skipped:` line names a routine that does not exist with that signature.

## Rollback

`migrations/rollback_harden_rpc_exposure.sql` is for emergency use only. After its preflight it:

- recreates all 35 routines (26 non-trigger, 7 trigger, 2 helpers) verbatim from the exported definitions and restores the exported ACL. This includes SECURITY DEFINER and the live `SET search_path`. The restored `cleanup_old_*` bodies contain DELETE statements, as live;
- drops `profiles_new_owner`, `comics_new_owner` and `profiles_new_public`, and recreates the three replaced policies by exact name and definition;
- grants SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER on `profiles_new` to `anon` and `authenticated`, named one by one, which is the verified live state. `service_role` is not touched.

The canvas routines go back to the live versions. This undoes the routine part of `secure_canvas_history.sql`, but not its table policies. Apply that migration again before reapplying this one. The rollback creates, empties and drops no table and changes no trigger.

## Not covered

- Table policies of `comic_comments`, `comic_drafts`, `comics`, `comic_stats` and `creator_subscriptions`; grants on `comics_new`.
- A working bookmarks or likes feature; fixing `get_comments_for_comic`; rate limits on `increment_comic_views`.
- Routines outside `public`, and routines that belong to an extension.

## Canvas layouts

The RPC phase runs on the live canvas layout: `canvas_history_events` and `canvas_history_snapshots` exist with `user_id uuid`, and `canvas_history` does not. Every top-level statement in `harden_rpc_exposure.sql` and its rollback is on a table from the owner's verified list (`profiles_new`, `comics_new`). Statements on routines are guarded by `to_regprocedure`. Routine bodies that name a table are not resolved until a call. `docs/LIVE_POLICY_HARDENING.md` covers the three-layout test for the policy migration, the first live attempt, and the fixture assumptions that the exports do not state.

## Not verified

- The expected hashes for the canvas routines after `secure_canvas_history.sql` were measured on PostgreSQL 16. The 35 exported PostgreSQL 15 texts matched PostgreSQL 16 output byte for byte, but these particular hashes were not checked on 15. If they differ, the migration aborts and names the routine; it does not apply partly.
- Columns of `hon_evi_sessions` other than `updated_at`, and other columns not in the exports. The length of `auth.users.email` (the fixture uses `varchar` without a length).
- The exact source text of the live `auth.role()`. Its form, volatility and owner are verified; the fixture reproduces that form, not a byte-for-byte copy.
- That the live service key's JWT carries the role `service_role` on every request path, so that `auth.role()` returns it inside the rewritten routines.
- Column-level grants on `profiles_new` on the live project. The verified metadata covers table privileges; the preflight refuses any column privilege for `anon`, or column REFERENCES for `authenticated`, in the hardened state.
- PostgREST's response to the ambiguous one-argument `get_comment_votes` call.
