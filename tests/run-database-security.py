"""Run actual owner/RLS/quota tests in disposable Unix-socket-only Postgres clusters.

Requires an installed PostgreSQL with pg_config. Never accepts a live DB URL.
Phase 1 checks canvas history and the request budget. Phase 2 checks the live
policy hardening migration, its rollback and a second apply, including the
profiles_public view, the waitlist limits and the self-check probes. Phase 3
checks the hardening of the 33 live SECURITY DEFINER routines, two SECURITY
INVOKER trigger helpers and the profiles_new and comics_new policies, the
no-drift preflights, the rollback and two reapplies. Phase 4 runs the live
policy migration, its rollback and a reapply on three canvas history layouts:
the live one (no canvas_history), the legacy one (with canvas_history) and
one with no canvas history table at all.
"""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
import os, re, shutil, subprocess, tempfile
root = Path(__file__).resolve().parents[1]
bindir = Path(subprocess.check_output(['pg_config','--bindir'], text=True).strip())

@contextmanager
def disposable_cluster(port):
    work = Path(tempfile.mkdtemp(prefix='hon-security-db-'))
    data = work/'data'
    env = {**os.environ, 'PGHOST':str(work), 'PGPORT':str(port), 'PGUSER':'hon_test', 'PGDATABASE':'postgres'}
    # Remove any inherited target/service configuration; this process creates its DB.
    for key in ('PGSERVICE','PGSERVICEFILE','PGOPTIONS','PGPASSWORD','PGPASSFILE','PGHOSTADDR'):
        env.pop(key,None)
    def run(args, **kwargs):
        return subprocess.run([str(bindir/args[0]),*args[1:]],env=env,text=True,check=True,capture_output=True,**kwargs)
    def sql(value): return run(['psql','-X','-v','ON_ERROR_STOP=1','-At'],input=value).stdout
    # The full result, for checks that read NOTICE lines on stderr.
    sql.full = lambda value: run(['psql','-X','-v','ON_ERROR_STOP=1','-At'],input=value)
    def apply(path):
        try: return sql((root/path).read_text())
        except subprocess.CalledProcessError as error: raise RuntimeError(f'{path}: {error.stderr}') from error
    started=False
    try:
        run(['initdb','-D',str(data),'-A','trust','--no-locale','-U','hon_test'])
        run(['pg_ctl','-D',str(data),'-l',str(work/'postgres.log'),'-o',f"-c listen_addresses='' -k {work} -p {port}",'start']);started=True
        yield sql, apply
    finally:
        if started: run(['pg_ctl','-D',str(data),'-m','fast','stop'])
        shutil.rmtree(work)

# Phase 1: canvas history ownership and the atomic request budget.
with disposable_cluster(55439) as (sql, apply):
    for path in ['tests/sql/database-bootstrap.sql','migrations/secure_canvas_history.sql','migrations/api_request_budget.sql',
                 'migrations/secure_canvas_history.sql','migrations/api_request_budget.sql','tests/sql/canvas-history-security.sql']:
        apply(path)
    # Parallel clients must share one atomic limit, with no check-then-write race.
    def claim(_):
        return sql("SET ROLE service_role; SELECT public.claim_hon_api_request('fixture-parallel-owner',5);").splitlines()[-1]
    with ThreadPoolExecutor(max_workers=12) as pool: results=list(pool.map(claim,range(24)))
    assert results.count('t')==5, results
    assert results.count('f')==19, results
    assert sql("SELECT requests FROM public.hon_api_request_windows WHERE actor_id='fixture-parallel-owner';").strip()=='5'
    print('PASS: migration reapply, owner save/read/update, cross-owner read/write/link denial, obsolete RPC/anonymous denial, service-only atomic quota (24 parallel requests, exactly 5 accepted).')

# Audited live policies that the rollback must restore, by table and name.
AUDITED_POLICIES = [
    ('public', 'sharp_jobs', 'Service role has full access to sharp_jobs'),
    ('public', 'gaussian_jobs', 'Allow all operations on gaussian_jobs'),
    ('public', 'profiles', 'profiles_update_own'),
    ('public', 'profiles', 'Allow wallet-based profile creation'),
    ('public', 'profiles', 'profiles_public_read'),
    ('public', 'waitlist', 'Allow select for authenticated users'),
    ('public', 'waitlist', 'Allow anonymous insert'),
    ('public', 'canvas_history_events', 'canvas_history_events_wallet_access'),
    ('public', 'canvas_history_snapshots', 'canvas_history_snapshots_wallet_access'),
    ('public', 'comment_votes', 'Anyone can view comment votes'),
    ('public', 'comment_votes', 'Anyone can insert comment votes'),
    ('public', 'comment_votes', 'Anyone can update comment votes'),
    ('public', 'comment_votes', 'Anyone can delete comment votes'),
    ('public', 'subscriptions', 'subscriptions_select_policy'),
    ('public', 'subscriptions', 'Anyone can insert subscriptions'),
    ('public', 'subscriptions', 'Anyone can update subscriptions'),
    ('public', 'subscriptions', 'Anyone can delete subscriptions'),
    ('storage', 'objects', 'Allow public uploads to profile-images'),
    ('storage', 'objects', 'Allow public updates to profile-images'),
    ('storage', 'objects', 'Allow public deletes from profile-images'),
    ('storage', 'objects', 'Allow anon uploads to hon-assets'),
]
def policy_names(sql):
    rows = sql("SELECT schemaname || '|' || tablename || '|' || policyname FROM pg_policies;").splitlines()
    return {tuple(row.split('|', 2)) for row in rows if row}
def expect_failure(sql, statement, needle, label):
    try: sql(statement)
    except subprocess.CalledProcessError as error:
        assert needle in error.stderr, f'{label}: {error.stderr}'
        return
    raise AssertionError(f'{label}: statement was accepted')
# Anonymous and cross-user writes the audited live policies allow.
PERMISSIVE_PROBE = """
BEGIN;
SET ROLE anon;
INSERT INTO public.sharp_jobs (id, image_url) VALUES ('probe', 'https://example.test/p.png');
INSERT INTO public.comment_votes (comment_id, user_id, vote_type) VALUES (gen_random_uuid(), 'guest-user', 1);
INSERT INTO public.profiles (wallet_id, solana_wallet) VALUES (gen_random_uuid(), 'WalletProbe');
INSERT INTO storage.objects (bucket_id, name) VALUES ('hon-assets', 'worlds/probe.ply');
SELECT count(*) FROM public.sharp_jobs WHERE id = 'probe';
ROLLBACK;
"""

# Reads the audited state allows: user A reads user B's email and the whole
# waitlist; anon reads every profile email.
OPEN_READ_PROBE = """
BEGIN;
SET ROLE authenticated;
SET request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SELECT 'b-email:' || count(*) FROM public.profiles WHERE email = 'b@example.test';
SELECT 'waitlist:' || count(*) FROM public.waitlist;
SET ROLE anon;
SET request.jwt.claim.sub = '';
SELECT 'anon-email:' || count(*) FROM public.profiles WHERE email LIKE '%@example.test';
ROLLBACK;
"""
def open_reads(sql):
    rows = dict(line.split(':', 1) for line in sql(OPEN_READ_PROBE).splitlines() if ':' in line)
    return int(rows['b-email']), int(rows['waitlist']), int(rows['anon-email'])
def client_grants(sql):
    query = """SELECT string_agg(r || ' ' || t || ' ' || has_any_column_privilege(r, t, 'SELECT'), ',' ORDER BY r, t)
                 FROM unnest(ARRAY['anon', 'authenticated']) r, unnest(ARRAY['public.profiles', 'public.waitlist']) t;"""
    return dict((row.rsplit(' ', 1)[0], row.rsplit(' ', 1)[1] == 'true') for row in sql(query).strip().split(','))
def profiles_new_grants(sql):
    """Direct table grants on profiles_new per client role, from information_schema.role_table_grants."""
    return sql("""SELECT coalesce(string_agg(grantee || ':' || privs, ' ' ORDER BY grantee), '')
                  FROM (SELECT grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
                        FROM information_schema.role_table_grants
                        WHERE table_schema = 'public' AND table_name = 'profiles_new'
                          AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role')
                        GROUP BY grantee) g;""").strip()
def view_exists(sql):
    return sql("SELECT to_regclass('public.profiles_public') IS NOT NULL;").strip() == 't'
HARDENED_GRANTS = {'anon public.profiles': False, 'anon public.waitlist': False,
                   'authenticated public.profiles': True, 'authenticated public.waitlist': False}
AUDITED_GRANTS = {key: True for key in HARDENED_GRANTS}
# Each probe adds one forbidden policy, grant or view change; the self-check must abort.
SELF_CHECK_PROBES = [
    ('CREATE POLICY probe_open ON public.comment_votes FOR INSERT TO anon WITH CHECK (true);',
     'Permissive PUBLIC or anon policy remains', 'open policy'),
    ("CREATE POLICY probe_wallet ON public.profiles FOR UPDATE TO authenticated "
     "USING (solana_wallet = current_setting('request.jwt.claim.sub', true));",
     'Wallet-string policy remains', 'wallet policy'),
    ('CREATE POLICY probe_profiles_read ON public.profiles FOR SELECT TO authenticated USING (true);',
     'Open read policy on profiles or waitlist remains', 'profiles read policy for authenticated'),
    ('CREATE POLICY probe_profiles_anon ON public.profiles FOR SELECT TO anon USING (true);',
     'Open read policy on profiles or waitlist remains', 'profiles read policy for anon'),
    ('CREATE POLICY probe_waitlist_read ON public.waitlist FOR SELECT TO authenticated USING (true);',
     'Open read policy on profiles or waitlist remains', 'waitlist read policy for authenticated'),
    ('CREATE POLICY probe_waitlist_insert ON public.waitlist FOR INSERT TO anon WITH CHECK (true);',
     'Permissive PUBLIC or anon policy remains', 'unchecked waitlist insert policy'),
    ('GRANT SELECT ON public.profiles TO anon;',
     'anon SELECT on public.profiles', 'anon table SELECT on profiles'),
    ('GRANT SELECT (email) ON public.profiles TO anon;',
     'anon SELECT on public.profiles', 'anon column SELECT on profiles'),
    ('GRANT SELECT ON public.waitlist TO anon;',
     'anon SELECT on public.waitlist', 'anon table SELECT on waitlist'),
    ('GRANT SELECT ON public.waitlist TO authenticated;',
     'authenticated SELECT on public.waitlist', 'authenticated table SELECT on waitlist'),
    ('GRANT SELECT ON public.waitlist TO PUBLIC;',
     'anon SELECT on public.waitlist', 'PUBLIC table SELECT on waitlist'),
    ('GRANT DELETE ON public.waitlist TO authenticated;',
     'authenticated DELETE on public.waitlist', 'authenticated DELETE on waitlist'),
    ('GRANT UPDATE ON public.profiles_public TO authenticated;',
     'authenticated UPDATE on public.profiles_public', 'authenticated UPDATE on profiles_public'),
    ('DROP VIEW public.profiles_public; CREATE VIEW public.profiles_public AS SELECT id, email FROM public.profiles; '
     'REVOKE ALL ON public.profiles_public FROM anon, authenticated;',
     'profiles_public exposes a private column', 'email in profiles_public'),
    ('ALTER VIEW public.profiles_public SET (security_invoker = true);',
     'profiles_public must be a view with owner rights', 'invoker-rights profiles_public'),
]
# Grants held through role membership survive the migration's REVOKE ... FROM anon,
# so the whole migration must abort and leave nothing changed.
MEMBERSHIP_PROBES = [
    ('anon', 'public.profiles', 'anon SELECT on public.profiles'),
    ('authenticated', 'public.waitlist', 'authenticated SELECT on public.waitlist'),
]

# Phase 2: the live policy hardening migration on a copy of the audited state.
with disposable_cluster(55440) as (sql, apply):
    apply('tests/sql/database-bootstrap.sql')
    apply('tests/sql/live-policy-fixture.sql')
    audited = {(schema, table, name) for schema, table, name in AUDITED_POLICIES}
    assert audited <= policy_names(sql), audited - policy_names(sql)
    assert '1' in sql(PERMISSIVE_PROBE).splitlines(), 'fixture is not permissive before the migration'
    assert open_reads(sql) == (1, 2, 2), open_reads(sql)
    assert client_grants(sql) == AUDITED_GRANTS, client_grants(sql)
    apply('migrations/harden_live_policies.sql')
    assert not audited & policy_names(sql), audited & policy_names(sql)
    assert client_grants(sql) == HARDENED_GRANTS, client_grants(sql)
    assert view_exists(sql)
    apply('tests/sql/live-policy-security.sql')
    # The self-check must abort when a forbidden policy, grant or view is present.
    migration = (root/'migrations/harden_live_policies.sql').read_text()
    self_check = re.search(r'-- self-check:start\n(.*)-- self-check:end', migration, re.S).group(1)
    for statement, needle, label in SELF_CHECK_PROBES:
        expect_failure(sql, 'BEGIN;\n' + statement + '\n' + self_check + 'ROLLBACK;\n', needle, f'self-check ({label})')
    for role, table, needle in MEMBERSHIP_PROBES:
        before = policy_names(sql)
        sql(f'CREATE ROLE hon_probe_reader NOLOGIN; GRANT SELECT ON {table} TO hon_probe_reader; '
            f'GRANT hon_probe_reader TO {role};')
        expect_failure(sql, migration, needle, f'migration abort ({role} reads {table} through a role)')
        assert policy_names(sql) == before, 'aborted migration changed policies'
        sql(f'REVOKE hon_probe_reader FROM {role}; DROP OWNED BY hon_probe_reader; DROP ROLE hon_probe_reader;')
    apply('migrations/rollback_harden_live_policies.sql')
    assert audited <= policy_names(sql), audited - policy_names(sql)
    assert '1' in sql(PERMISSIVE_PROBE).splitlines(), 'rollback did not restore the audited state'
    assert open_reads(sql) == (1, 5, 2), open_reads(sql)
    assert client_grants(sql) == AUDITED_GRANTS, client_grants(sql)
    assert not view_exists(sql), 'rollback left profiles_public'
    apply('migrations/harden_live_policies.sql')
    apply('migrations/harden_live_policies.sql')
    assert client_grants(sql) == HARDENED_GRANTS, client_grants(sql)
    assert not audited & policy_names(sql), audited & policy_names(sql)
    apply('tests/sql/live-policy-security.sql')
    print('PASS: live policy hardening on the audited fixture: exact-name and unknown-name drops, '
          'anonymous write denial (jobs, votes, subscriptions, profiles, profile-images, hon-assets), '
          'cross-user denial (profiles, votes, subscriptions, profile-images folder, canvas history with a supplied wallet), '
          'owner writes, public vote reads and subscriber count, service-role writes, '
          'no PUBLIC true or anon write policy left, self-check aborts on an open or wallet policy, '
          f'rollback restores the {len(AUDITED_POLICIES)} audited policies by name and the open writes, '
          'reapply after rollback and twice in a row.')
    print('PASS: round 2: anon has no profiles privilege and reads no email, linked ID, preference or wallet_id '
          'in any readable relation; user A reads only its own profiles row; profiles_public returns both rows, is read-only for clients '
          'with no private column; waitlist has no client read, update or delete, accepts only checked '
          'email/source inserts and is readable by the service role; real sharp_jobs and gaussian_jobs shapes '
          'are service-role only; text IDs on votes and subscriptions; '
          f'{len(SELF_CHECK_PROBES)} self-check probes and {len(MEMBERSHIP_PROBES)} whole-migration aborts; '
          'rollback restores profiles_public_read, the waitlist policies and the SELECT grants, and drops the view.')

# Phase 3: hardening of the 33 SECURITY DEFINER routines exported from the
# live project, on live column types. The fixture holds their live bodies.
USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
LIVE_ROUTINES = [
    'add_comment(text,text,text,uuid)', 'cleanup_old_events(integer)', 'cleanup_old_snapshots(text,integer,integer)',
    'create_canvas_snapshot(text,text,jsonb,uuid,text,text,text,text,text)', 'get_canvas_snapshot(uuid)',
    'get_canvas_timeline(text,integer)', 'get_comic_id_from_draft_id(text)', 'get_comment_votes(uuid)',
    'get_comment_votes(uuid,text)', 'get_comments_for_comic(text)', 'get_pg_version()',
    'get_project_storage_stats(text)', 'get_user_bookmarks(uuid)', 'get_user_id_from_identifier(text)',
    'get_user_likes(uuid)', 'get_user_subscriptions(uuid)', 'get_user_subscriptions(text)',
    'increment_comic_views(text)', 'is_comic_bookmarked(uuid,text)', 'is_comic_liked(uuid,text)',
    'is_subscribed(text,text)', 'is_subscribed(uuid,uuid)',
    'save_canvas_event(text,text,uuid,text,text,text,text,text,jsonb,uuid)', 'set_current_user_id(text)',
    'setup_collaboration_tables()', 'update_canvas_snapshot_thumbnail(uuid,text)']
TRIGGERS = ['handle_new_user()', 'handle_updated_at()', 'notify_waitlist_signup()', 'set_bookmark_user_id()',
            'trigger_collaboration_event()', 'update_modified_column()', 'update_updated_at_column()']
INVOKERS = ['calculate_snapshot_size()', 'update_hon_evi_sessions_updated_at()']
ALL_LIVE = LIVE_ROUTINES + TRIGGERS + INVOKERS
def routine_state(sql, names):
    """Definition hash, security, settings, sorted grants, arguments and result per routine."""
    sigs = ', '.join(f"'public.{n}'" for n in names)
    query = f"""SELECT s || '|' || md5(pg_get_functiondef(p.oid)) || '|' || p.prosecdef || '|' || coalesce(p.proconfig::text, '-')
                    || '|' || (SELECT string_agg(g, ',' ORDER BY g)
                               FROM (SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END AS g
                                     FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a) grants)
                    || '|' || pg_get_function_identity_arguments(p.oid) || '|' || pg_get_function_result(p.oid)
                FROM unnest(ARRAY[{sigs}]) s JOIN pg_proc p ON p.oid = to_regprocedure(s) ORDER BY s;"""
    rows = [row.split('|') for row in sql(query).splitlines() if row]
    assert len(rows) == len(names), (len(rows), len(names))
    return {r[0]: r[1:] for r in rows}
def grants_only(state):
    return {k: v[3] for k, v in state.items()}
def interface(state):
    return {k: (v[4], v[5]) for k, v in state.items()}
def relations(sql):
    """Every table and schema outside the system schemas and the test helpers, and every trigger."""
    return sql("""SELECT string_agg(n.nspname || '.' || c.relname, ',' ORDER BY n.nspname, c.relname) FROM pg_class c
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'hon_test')
                    AND n.nspname NOT LIKE 'pg_toast%';
                  SELECT string_agg(nspname, ',' ORDER BY nspname) FROM pg_namespace
                  WHERE nspname <> 'hon_test' AND nspname NOT LIKE 'pg_temp%' AND nspname NOT LIKE 'pg_toast_temp%';
                  SELECT string_agg(pg_get_triggerdef(oid), ' ;; ' ORDER BY pg_get_triggerdef(oid)) FROM pg_trigger WHERE NOT tgisinternal;""")
def view_exists(sql):
    return sql("SELECT to_regclass('public.profiles_new_public') IS NOT NULL;").strip() == 't'
def policies(sql):
    return sql("""SELECT string_agg(tablename || ' ' || policyname, ', ' ORDER BY tablename, policyname) FROM pg_policies
                  WHERE tablename IN ('profiles_new', 'comics_new');""").strip()
def policy_definitions(sql):
    return sql("""SELECT string_agg(format('%s|%s|%s|%s|%s|%s', tablename, policyname, cmd, roles::text,
                                           coalesce(qual, '-'), coalesce(with_check, '-')), ' ;; ' ORDER BY tablename, policyname)
                  FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('profiles_new', 'comics_new');""").strip()
def guarded_state(sql):
    """What an aborted migration or rollback must leave unchanged: profiles_new grants, the policies, the view and routines."""
    return profiles_new_grants(sql), policy_definitions(sql), view_exists(sql), routine_state(sql, ALL_LIVE)
def expect_abort_preserving(sql, change, script, needle, label, undo, expected_grants):
    """Commit a drift, run the script, require an abort naming it and an unchanged state, then undo the drift."""
    sql(change)
    before = guarded_state(sql)
    assert before[0] == expected_grants, f'{label}: grants before the run {before[0]}'
    expect_failure(sql, script, needle, label)
    assert guarded_state(sql) == before, f'{label}: the aborted script changed grants, policies, the view or routines'
    sql(undo)
ALL7 = 'DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE'
# Verified live: anon, authenticated and service_role each hold all seven table privileges.
NEW_LIVE_GRANTS = f'anon:{ALL7} authenticated:{ALL7} service_role:{ALL7}'
NEW_HARDENED_GRANTS = f'authenticated:DELETE,INSERT,SELECT,UPDATE service_role:{ALL7}'
LIVE_POLICIES = ('comics_new Anyone can view published comics, comics_new Users can manage their own comics, '
                 'profiles_new Users can manage their own profile, profiles_new Users can view all profiles')
HARDENED_POLICIES = 'comics_new Anyone can view published comics, comics_new comics_new_owner, profiles_new profiles_new_owner'
# What the live routines allow: anon finds a user ID by email and reads user
# B's canvas snapshot; user A reads B's vote and, by setting
# app.current_user_id, B's profiles_new row; anon may run cleanup.
# A refused call (42501) is recorded as denied.
IMPERSONATION_PROBE = f"""
BEGIN;
SET ROLE anon;
SET request.jwt.claim.sub = '';
SET request.jwt.claim.role = 'anon';
DO $$ BEGIN
  PERFORM set_config('probe.email', coalesce(public.get_user_id_from_identifier('b@example.test')::text, 'none'), true);
EXCEPTION WHEN insufficient_privilege THEN PERFORM set_config('probe.email', 'denied', true); END $$;
DO $$ BEGIN
  PERFORM set_config('probe.profiles_new', (SELECT count(email) FROM public.profiles_new)::text, true);
EXCEPTION WHEN insufficient_privilege THEN PERFORM set_config('probe.profiles_new', 'denied', true); END $$;
DO $$ BEGIN
  PERFORM set_config('probe.canvas', (SELECT count(*) FROM public.get_canvas_snapshot('c0c0c0c0-0000-4000-8000-0000000000e1'))::text, true);
EXCEPTION WHEN insufficient_privilege THEN PERFORM set_config('probe.canvas', 'denied', true); END $$;
SET ROLE authenticated;
SET request.jwt.claim.sub = '{USER_A}';
SET request.jwt.claim.role = 'authenticated';
DO $$ BEGIN
  PERFORM set_config('probe.vote', coalesce(public.get_comment_votes('c0c0c0c0-0000-4000-8000-0000000000c1', '{USER_B}') ->> 'user_vote', 'none'), true);
EXCEPTION WHEN insufficient_privilege THEN PERFORM set_config('probe.vote', 'denied', true); END $$;
DO $$ BEGIN
  PERFORM public.set_current_user_id('{USER_B}');
  PERFORM set_config('probe.setting', (SELECT count(*) FROM public.comics_new WHERE NOT is_published)::text, true);
EXCEPTION WHEN insufficient_privilege THEN PERFORM set_config('probe.setting', 'denied', true); END $$;
SELECT 'email:' || current_setting('probe.email');
SELECT 'canvas:' || current_setting('probe.canvas');
SELECT 'vote:' || current_setting('probe.vote');
SELECT 'setting:' || current_setting('probe.setting');
SELECT 'profiles-new:' || current_setting('probe.profiles_new');
SELECT 'cleanup-exec:' || has_function_privilege('anon', 'public.cleanup_old_events(integer)', 'EXECUTE');
ROLLBACK;
"""
def impersonation(sql):
    return dict(line.split(':', 1) for line in sql(IMPERSONATION_PROBE).splitlines() if re.match(r'^[a-z-]+:', line))
LIVE_OPEN = {'email': USER_B, 'canvas': '1', 'vote': '-1', 'setting': '1', 'profiles-new': '2', 'cleanup-exec': 'true'}
HARDENED = {'email': 'denied', 'canvas': 'denied', 'vote': 'denied', 'setting': 'denied', 'profiles-new': 'denied',
            'cleanup-exec': 'false'}
# waitlist_signup_notification: anon adds a waitlist row without EXECUTE on
# notify_waitlist_signup; the notification still arrives.
NOTIFY_PROBE = """
LISTEN waitlist_signup;
SET ROLE anon;
INSERT INTO public.waitlist (email, source) VALUES ('wait-three@example.test', 'landing_page');
RESET ROLE;
DELETE FROM public.waitlist WHERE email = 'wait-three@example.test';
"""
def notifications(sql):
    out = sql(NOTIFY_PROBE)
    return '"waitlist_signup"' in out and 'wait-three@example.test' in out
UNPINNED_PROBE = ("CREATE FUNCTION public.hon_probe_unpinned() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$; "
                  "REVOKE ALL ON FUNCTION public.hon_probe_unpinned() FROM PUBLIC, anon, authenticated;")
# Each probe adds or changes one routine; the self-check must abort.
RPC_SELF_CHECK_PROBES = [
    (UNPINNED_PROBE, 'without search_path', 'new definer function with no search_path'),
    ("ALTER FUNCTION public.get_comments_for_comic(text) SET search_path = public, auth;",
     'without search_path', 'public read with search_path public, auth'),
    ("ALTER FUNCTION public.handle_new_user() RESET search_path;",
     'without search_path', 'trigger function with its search_path reset'),
    ("CREATE FUNCTION public.hon_probe_email(p uuid) RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = '' "
     "AS $$ SELECT email FROM public.profiles WHERE id = p $$; "
     "REVOKE ALL ON FUNCTION public.hon_probe_email(uuid) FROM PUBLIC, anon, authenticated;",
     'references a private profile column', 'definer function that selects email'),
    ("CREATE FUNCTION public.hon_probe_privy(p uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' "
     "AS $$ BEGIN RETURN (SELECT jsonb_build_object('p', pr.privy_user_id) FROM public.profiles_public pr WHERE pr.id = p); END $$; "
     "REVOKE ALL ON FUNCTION public.hon_probe_privy(uuid) FROM PUBLIC, anon, authenticated;",
     'references a private profile column', 'definer function that builds JSON with privy_user_id'),
    ("CREATE FUNCTION public.hon_probe_row(p uuid) RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path = '' "
     "AS $$ SELECT row_to_json(pr) FROM public.profiles pr WHERE pr.id = p $$; "
     "REVOKE ALL ON FUNCTION public.hon_probe_row(uuid) FROM PUBLIC, anon, authenticated;",
     'reads public.profiles directly', 'definer function that returns whole profiles rows'),
    ("CREATE FUNCTION public.hon_probe_public() RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = '' "
     "AS $$ SELECT auth.uid() $$; REVOKE ALL ON FUNCTION public.hon_probe_public() FROM anon, authenticated;",
     'executable by PUBLIC', 'new definer function executable by PUBLIC'),
    ("GRANT EXECUTE ON FUNCTION public.get_user_subscriptions(uuid) TO PUBLIC;",
     'executable by PUBLIC', 'get_user_subscriptions granted to PUBLIC again'),
    ("GRANT EXECUTE ON FUNCTION public.cleanup_old_events(integer) TO authenticated;",
     'without an auth.uid() reference', 'cleanup_old_events granted to authenticated'),
    ("GRANT EXECUTE ON FUNCTION public.get_project_storage_stats(text) TO authenticated;",
     'without an auth.uid() reference', 'canvas storage stats granted to authenticated'),
    ("GRANT EXECUTE ON FUNCTION public.get_user_likes(uuid) TO authenticated;",
     'without an auth.uid() reference', 'get_user_likes (missing table) granted to authenticated'),
    ("GRANT EXECUTE ON FUNCTION public.get_pg_version() TO anon;",
     'without an auth.uid() reference', 'get_pg_version granted to anon'),
    ("GRANT EXECUTE ON FUNCTION public.handle_new_user() TO authenticated;",
     'without an auth.uid() reference', 'trigger function granted to authenticated'),
    ("GRANT EXECUTE ON FUNCTION public.calculate_snapshot_size() TO anon;",
     'without an auth.uid() reference', 'invoker trigger helper granted to anon'),
    ("GRANT EXECUTE ON FUNCTION public.update_hon_evi_sessions_updated_at() TO PUBLIC;",
     'without an auth.uid() reference', 'invoker trigger granted to PUBLIC'),
    ("CREATE FUNCTION public.hon_probe_invoker() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$; "
     "REVOKE ALL ON FUNCTION public.hon_probe_invoker() FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.hon_probe_invoker() TO anon;",
     'without an auth.uid() reference', 'invoker function for anon with no auth.uid()'),
    ("CREATE FUNCTION public.hon_probe_anon() RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = '' "
     "AS $$ SELECT auth.uid() $$; REVOKE ALL ON FUNCTION public.hon_probe_anon() FROM PUBLIC; "
     "GRANT EXECUTE ON FUNCTION public.hon_probe_anon() TO anon;",
     'not a public read', 'definer function for anon'),
    ("GRANT EXECUTE ON FUNCTION public.add_comment(text,text,text,uuid) TO anon;",
     'not a public read', 'add_comment granted to anon again'),
    ("GRANT SELECT ON public.profiles_new TO anon;",
     'anon holds privileges on public.profiles_new', 'anon table SELECT on profiles_new'),
    ("GRANT SELECT (email) ON public.profiles_new TO anon;",
     'anon holds privileges on public.profiles_new', 'anon column SELECT on profiles_new'),
    ("GRANT TRIGGER ON public.profiles_new TO anon;",
     'anon holds privileges on public.profiles_new: TRIGGER', 'anon TRIGGER on profiles_new'),
    ("GRANT TRUNCATE ON public.profiles_new TO authenticated;",
     'beyond SELECT, INSERT, UPDATE, DELETE on public.profiles_new: TRUNCATE', 'authenticated TRUNCATE on profiles_new'),
    ("GRANT REFERENCES ON public.profiles_new TO authenticated;",
     'beyond SELECT, INSERT, UPDATE, DELETE on public.profiles_new: REFERENCES', 'authenticated REFERENCES on profiles_new'),
    ("GRANT REFERENCES (id) ON public.profiles_new TO authenticated;",
     'beyond SELECT, INSERT, UPDATE, DELETE on public.profiles_new: REFERENCES', 'authenticated column REFERENCES on profiles_new'),
    ("GRANT TRIGGER ON public.profiles_new TO authenticated;",
     'beyond SELECT, INSERT, UPDATE, DELETE on public.profiles_new: TRIGGER', 'authenticated TRIGGER on profiles_new'),
    ("CREATE POLICY probe_open ON public.profiles_new FOR SELECT TO authenticated USING (true);",
     'Open or setting-based policy', 'open read policy on profiles_new'),
    ("ALTER POLICY profiles_new_owner ON public.profiles_new USING (true);",
     'Open or setting-based policy', 'profiles_new owner policy with USING (true)'),
    ("CREATE POLICY probe_insert ON public.profiles_new FOR INSERT TO authenticated WITH CHECK (true);",
     'Open or setting-based policy', 'unchecked insert policy on profiles_new'),
    ("CREATE POLICY probe_setting ON public.comics_new FOR ALL TO authenticated "
     "USING (creator_id = current_setting('app.current_user_id', true));",
     'Open or setting-based policy', 'app.current_user_id policy on comics_new'),
    ("CREATE OR REPLACE VIEW public.profiles_new_public AS SELECT p.id, p.username, p.display_name, p.first_name, "
     "p.last_name, p.avatar_url, p.bio, p.wallet_address, p.solana_wallet, p.social_links, p.is_verified, "
     "p.is_creator, p.created_at, p.email FROM public.profiles_new p;",
     'profiles_new_public exposes a private column', 'email in profiles_new_public'),
    ("ALTER VIEW public.profiles_new_public SET (security_invoker = true);",
     'profiles_new_public must be a view with owner rights', 'invoker-rights profiles_new_public'),
    ("GRANT UPDATE ON public.profiles_new_public TO authenticated;",
     'Client role can write through profiles_new_public', 'UPDATE on profiles_new_public'),
]
# Each change makes the database differ from the reviewed pre-state; the
# migration must abort before any change and name the object.
MIGRATION_DRIFT_PROBES = [
    ("CREATE OR REPLACE FUNCTION public.get_pg_version() RETURNS text LANGUAGE sql SECURITY DEFINER "
     "SET search_path TO 'public' AS $function$ SELECT 'changed'; $function$;",
     'Routine differs from the reviewed definition or ACL: get_pg_version()', 'changed body'),
    ("REVOKE EXECUTE ON FUNCTION public.get_comic_id_from_draft_id(text) FROM anon;",
     'Routine differs from the reviewed definition or ACL: get_comic_id_from_draft_id(text)', 'changed ACL'),
    ("ALTER FUNCTION public.handle_new_user() SET search_path = public;",
     'Routine differs from the reviewed definition or ACL: handle_new_user()', 'changed trigger setting'),
    ("ALTER POLICY \"Users can view all profiles\" ON public.profiles_new USING (id IS NOT NULL);",
     'Policies on profiles_new or comics_new differ', 'changed policy'),
    ("CREATE POLICY probe_extra ON public.comics_new FOR SELECT TO anon USING (true);",
     'Policies on profiles_new or comics_new differ', 'extra policy'),
    ("REVOKE DELETE ON public.profiles_new FROM anon;",
     'Grants on public.profiles_new differ from the reviewed state; nearest is the live state', 'changed table grant'),
    ("REVOKE TRUNCATE ON public.profiles_new FROM anon;",
     'anon lacks TRUNCATE', 'anon without TRUNCATE'),
    ("REVOKE REFERENCES ON public.profiles_new FROM authenticated;",
     'authenticated lacks REFERENCES', 'authenticated without REFERENCES'),
]
# On the hardened database, a reapply must abort when the profiles_new grants
# differ from the state the migration leaves.
MIGRATION_REAPPLY_DRIFT_PROBES = [
    ("GRANT TRUNCATE ON public.profiles_new TO authenticated;", 'authenticated holds TRUNCATE', 'authenticated TRUNCATE'),
    ("GRANT SELECT (email) ON public.profiles_new TO anon;", 'anon holds SELECT', 'anon column SELECT'),
    ("REVOKE DELETE ON public.profiles_new FROM authenticated;", 'authenticated lacks DELETE', 'authenticated without DELETE'),
]
# The same for the rollback, against the state the migration leaves.
ROLLBACK_DRIFT_PROBES = [
    ("ALTER FUNCTION public.get_pg_version() SET search_path = public;",
     'Routine differs from the state the migration leaves: get_pg_version()', 'changed setting'),
    ("GRANT EXECUTE ON FUNCTION public.add_comment(text,text,text,uuid) TO anon;",
     'Routine differs from the state the migration leaves: add_comment(text,text,text,uuid)', 'changed ACL'),
    ("ALTER POLICY profiles_new_owner ON public.profiles_new USING (true);",
     'Policies on profiles_new or comics_new differ from the state the migration leaves', 'changed policy'),
    ("GRANT SELECT (email) ON public.profiles_new TO anon;",
     'Grants on public.profiles_new differ from the state the migration leaves; nearest is the hardened state '
     '(anon none, authenticated exactly SELECT, INSERT, UPDATE, DELETE): anon holds SELECT',
     'anon column SELECT on profiles_new'),
]
with disposable_cluster(55441) as (sql, apply):
    for path in ['tests/sql/database-bootstrap.sql', 'tests/sql/live-policy-fixture.sql',
                 'migrations/harden_live_policies.sql', 'tests/sql/rpc-fixture.sql']:
        apply(path)
    live_state = routine_state(sql, ALL_LIVE)
    assert all(v[1] == 'true' for k, v in live_state.items() if k[len('public.'):] not in INVOKERS), \
        'fixture routines are not all SECURITY DEFINER'
    assert all(v[3] == 'PUBLIC,anon,authenticated,postgres,service_role' for v in live_state.values()), live_state
    assert policies(sql) == LIVE_POLICIES, policies(sql)
    assert profiles_new_grants(sql) == NEW_LIVE_GRANTS, profiles_new_grants(sql)
    assert impersonation(sql) == LIVE_OPEN, impersonation(sql)
    rpc_migration = (root/'migrations/harden_rpc_exposure.sql').read_text()
    # The live canvas routines are SECURITY DEFINER; the migration refuses to
    # run until secure_canvas_history.sql has replaced them, and changes nothing.
    expect_failure(sql, rpc_migration, 'apply migrations/secure_canvas_history.sql first', 'canvas precondition')
    assert routine_state(sql, ALL_LIVE) == live_state, 'aborted migration changed routines'
    apply('migrations/secure_canvas_history.sql')
    expect_failure(sql, 'BEGIN;\nDROP VIEW public.profiles_public;\n' + rpc_migration,
                   'apply migrations/harden_live_policies.sql first', 'profiles_public precondition')
    # A column type that differs from the reviewed schema stops the migration.
    for change, needle in [
            ('ALTER TABLE public.creator_subscriptions ALTER COLUMN subscriber_id TYPE text;',
             'creator_subscriptions.subscriber_id expected uuid, found text'),
            ('ALTER TABLE public.comic_comments ALTER COLUMN user_id TYPE text;',
             'comic_comments.user_id expected uuid, found text'),
            ('ALTER TABLE public.subscriptions RENAME COLUMN creator_id TO creator_ref;',
             'subscriptions.creator_id expected text, found no column')]:
        expect_failure(sql, 'BEGIN;\n' + change + '\n' + rpc_migration, needle, f'column type precondition ({needle})')
    for change, needle, label in MIGRATION_DRIFT_PROBES:
        expect_failure(sql, 'BEGIN;\n' + change + '\n' + rpc_migration, needle, f'migration drift ({label})')
    # A committed non-CRUD revoke: the migration aborts, changes nothing and
    # leaves the revoked state in place.
    expect_abort_preserving(sql, 'REVOKE TRIGGER ON public.profiles_new FROM authenticated;', rpc_migration,
                            'Grants on public.profiles_new differ from the reviewed state; nearest is the live state '
                            '(anon and authenticated hold all seven): authenticated lacks TRIGGER',
                            'migration abort (authenticated without TRIGGER)',
                            'GRANT TRIGGER ON public.profiles_new TO authenticated;',
                            f'anon:{ALL7} authenticated:DELETE,INSERT,REFERENCES,SELECT,TRUNCATE,UPDATE service_role:{ALL7}')
    assert profiles_new_grants(sql) == NEW_LIVE_GRANTS, profiles_new_grants(sql)
    before_relations = relations(sql)
    apply('migrations/harden_rpc_exposure.sql')
    assert relations(sql) == before_relations, 'the migration created or removed a table, schema or trigger'
    assert view_exists(sql) and policies(sql) == HARDENED_POLICIES, policies(sql)
    assert impersonation(sql) == HARDENED, impersonation(sql)
    assert profiles_new_grants(sql) == NEW_HARDENED_GRANTS, profiles_new_grants(sql)
    assert interface(routine_state(sql, ALL_LIVE)) == interface(live_state), 'argument names or result types changed'
    apply('tests/sql/rpc-security.sql')
    assert notifications(sql), 'waitlist_signup_notification did not fire after search_path was pinned'
    rpc_self_check = re.search(r'-- self-check:start\n(.*)-- self-check:end', rpc_migration, re.S).group(1)
    for statement, needle, label in RPC_SELF_CHECK_PROBES:
        expect_failure(sql, 'BEGIN;\n' + statement + '\n' + rpc_self_check + 'ROLLBACK;\n', needle, f'rpc self-check ({label})')
    for change, needle, label in MIGRATION_REAPPLY_DRIFT_PROBES:
        expect_failure(sql, 'BEGIN;\n' + change + '\n' + rpc_migration, needle, f'migration reapply drift ({label})')
    rollback_text = (root/'migrations/rollback_harden_rpc_exposure.sql').read_text()
    for change, needle, label in ROLLBACK_DRIFT_PROBES:
        expect_failure(sql, 'BEGIN;\n' + change + '\n' + rollback_text, needle, f'rollback drift ({label})')
    # A committed extra grant on the hardened database: the rollback aborts,
    # names it, and the extra grant and all hardening stay in place.
    for priv in ['TRUNCATE', 'REFERENCES', 'TRIGGER']:
        extra = ','.join(sorted(['DELETE', 'INSERT', 'SELECT', 'UPDATE', priv]))
        expect_abort_preserving(sql, f'GRANT {priv} ON public.profiles_new TO authenticated;', rollback_text,
                                'Grants on public.profiles_new differ from the state the migration leaves; nearest is the '
                                f'hardened state (anon none, authenticated exactly SELECT, INSERT, UPDATE, DELETE): authenticated holds {priv}',
                                f'rollback abort (authenticated {priv})',
                                f'REVOKE {priv} ON public.profiles_new FROM authenticated;',
                                f'authenticated:{extra} service_role:{ALL7}')
    expect_abort_preserving(sql, 'GRANT SELECT ON public.profiles_new TO anon;', rollback_text,
                            'nearest is the hardened state (anon none, authenticated exactly SELECT, INSERT, UPDATE, DELETE): anon holds SELECT',
                            'rollback abort (anon SELECT)',
                            'REVOKE SELECT ON public.profiles_new FROM anon;',
                            f'anon:SELECT {NEW_HARDENED_GRANTS}')
    assert view_exists(sql) and policies(sql) == HARDENED_POLICIES and profiles_new_grants(sql) == NEW_HARDENED_GRANTS
    assert impersonation(sql) == HARDENED, impersonation(sql)
    apply('migrations/rollback_harden_rpc_exposure.sql')
    # Every routine is back exactly: definition, security, settings and grants.
    restored = routine_state(sql, ALL_LIVE)
    assert restored == live_state, {k: (v, live_state[k]) for k, v in restored.items() if v != live_state[k]}
    assert relations(sql) == before_relations, 'the rollback created or removed a table, schema or trigger'
    assert not view_exists(sql) and policies(sql) == LIVE_POLICIES, policies(sql)
    assert profiles_new_grants(sql) == NEW_LIVE_GRANTS, profiles_new_grants(sql)
    assert impersonation(sql) == LIVE_OPEN, impersonation(sql)
    # The rollback restored the live definer canvas routines, so the canvas
    # migration runs again first. An unknown unsafe definer routine then makes
    # the whole migration abort and change nothing.
    apply('migrations/secure_canvas_history.sql')
    before_abort = routine_state(sql, ALL_LIVE)
    sql(UNPINNED_PROBE)
    expect_failure(sql, rpc_migration, 'without search_path', 'rpc migration abort (unknown unpinned function)')
    assert routine_state(sql, ALL_LIVE) == before_abort, 'aborted migration changed routines'
    sql('DROP FUNCTION public.hon_probe_unpinned();')
    apply('migrations/harden_rpc_exposure.sql')
    apply('migrations/harden_rpc_exposure.sql')
    assert impersonation(sql) == HARDENED, impersonation(sql)
    apply('tests/sql/rpc-security.sql')
    assert notifications(sql), 'waitlist_signup_notification did not fire after reapply'
    # Apply, rollback, reapply, rollback: the second rollback restores the live
    # state again, and a rollback on the rolled-back database is accepted.
    for _ in range(2):
        apply('migrations/rollback_harden_rpc_exposure.sql')
        restored = routine_state(sql, ALL_LIVE)
        assert restored == live_state, {k: (v, live_state[k]) for k, v in restored.items() if v != live_state[k]}
        assert not view_exists(sql) and policies(sql) == LIVE_POLICIES, policies(sql)
        assert profiles_new_grants(sql) == NEW_LIVE_GRANTS, profiles_new_grants(sql)
        assert relations(sql) == before_relations, 'the rollback created or removed a table, schema or trigger'
        assert impersonation(sql) == LIVE_OPEN, impersonation(sql)
    print('PASS: RPC hardening of the 33 live SECURITY DEFINER routines, 2 invoker trigger helpers and the profiles_new and '
          'comics_new policies (exact exported bodies, ACLs, policies, triggers and column types): '
          'preconditions (canvas routines, profiles_public, 3 column-type drifts); '
          f'{len(MIGRATION_DRIFT_PROBES)} migration, {len(MIGRATION_REAPPLY_DRIFT_PROBES)} reapply and '
          f'{len(ROLLBACK_DRIFT_PROBES)} rollback no-drift aborts; '
          'profiles_new grants compared on all seven privileges: committed drift (authenticated without TRIGGER before '
          'the migration; authenticated TRUNCATE, REFERENCES or TRIGGER, or anon SELECT, before the rollback) aborts '
          'and leaves grants, policies, view and routines unchanged; '
          'no table or trigger created or changed; '
          'admin helpers, the 4 routines on missing tables and the trigger routines refused for anon and user A (42501), server ones run by service_role; '
          'user A cannot comment, read votes, subscriptions or canvas history as user B or a wallet string through any overload '
          '(42501 or no rows, B rows unchanged), nor set app.current_user_id to pass the profiles_new and comics_new policies; '
          'own actions work; bad IDs get 22P02; anon keeps the public reads only; no email lookup; no private profile value in any result; '
          'app.current_user_id policies replaced by auth.uid() owner policies; profiles_new owner-only, anon reads only '
          'profiles_new_public with no email, preference or subscription value; '
          'argument names and result types unchanged; the 5 live triggers fire after pinning for roles without EXECUTE; '
          f'{len(RPC_SELF_CHECK_PROBES)} self-check probes and a whole-migration abort; '
          f'rollback restores all {len(ALL_LIVE)} live definitions and ACLs verbatim, the 3 replaced policies by name, '
          'all seven profiles_new privileges for anon and authenticated and drops the view; '
          'hardened grants are anon none, authenticated exactly CRUD, service_role unchanged; '
          'reapply twice, rollback again and once more on the rolled-back database.')

# Phase 4: the live policy migration on three canvas history layouts. The live
# project has canvas_history_events and canvas_history_snapshots but no
# canvas_history. Each layout runs the migration, the assertions, the
# rollback, a reapply and the assertions again.
LEGACY_CANVAS_POLICY = ('public', 'canvas_history', 'canvas_history_wallet_access')
CANVAS_TABLES = ['canvas_history', 'canvas_history_events', 'canvas_history_snapshots']
HARDENED_TABLES = ['sharp_jobs', 'gaussian_jobs', 'profiles', 'waitlist', 'comment_votes', 'subscriptions'] + CANVAS_TABLES
LAYOUTS = [('live layout', [], {'canvas_history_events', 'canvas_history_snapshots'}),
           ('legacy layout', ['tests/sql/live-policy-legacy-canvas.sql'], set(CANVAS_TABLES)),
           ('no canvas tables', ['tests/sql/live-policy-no-canvas.sql'], set())]
# The earlier form of the exact-name drops, without a table check. On this
# server DROP POLICY IF EXISTS on a missing table only prints a NOTICE; the
# probe records that, so the evidence for the live 42P01 is stated, not assumed.
UNGUARDED_CANVAS_DROPS = """DROP POLICY IF EXISTS "canvas_history_wallet_access" ON public.canvas_history;
DROP POLICY IF EXISTS "canvas_history_events_wallet_access" ON public.canvas_history_events;
DROP POLICY IF EXISTS "canvas_history_snapshots_wallet_access" ON public.canvas_history_snapshots;
DROP POLICY IF EXISTS "Users can view their own canvas events" ON public.canvas_history_events;
DROP POLICY IF EXISTS "Users can insert their own canvas events" ON public.canvas_history_events;
DROP POLICY IF EXISTS "Users can view their own canvas snapshots" ON public.canvas_history_snapshots;
DROP POLICY IF EXISTS "Users can insert their own canvas snapshots" ON public.canvas_history_snapshots;
"""
def hardened_state(sql):
    """Policies (name, command, roles, USING, WITH CHECK) and client grants per hardened table that exists."""
    tables = ', '.join(f"'{t}'" for t in HARDENED_TABLES)
    rows = sql(f"""SELECT 'policy:' || schemaname || '.' || tablename || '|'
                         || string_agg(policyname || ':' || cmd || ':' || roles::text || ':' || coalesce(qual, '-')
                                       || ':' || coalesce(with_check, '-'), ' ;; ' ORDER BY policyname)
                    FROM pg_policies
                    WHERE (schemaname = 'public' AND tablename IN ({tables}))
                       OR (schemaname = 'storage' AND tablename = 'objects')
                    GROUP BY schemaname, tablename ORDER BY 1;
                    SELECT 'grant:' || t || '|' || string_agg(r || ':' || v || ':' || has_table_privilege(r, 'public.' || t, v),
                                                         ',' ORDER BY r, v)
                    FROM unnest(ARRAY[{tables}]) t, unnest(ARRAY['anon', 'authenticated', 'service_role']) r,
                         unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) v
                    WHERE to_regclass('public.' || t) IS NOT NULL
                    GROUP BY t ORDER BY 1;""")
    return dict(line.split('|', 1) for line in rows.splitlines() if line)
def canvas_tables_present(sql):
    rows = sql("SELECT t FROM unnest(ARRAY['canvas_history', 'canvas_history_events', 'canvas_history_snapshots']) t "
               "WHERE to_regclass('public.' || t) IS NOT NULL;")
    return set(rows.split())
policy_migration = (root/'migrations/harden_live_policies.sql').read_text()
guarded_block = re.search(r'DO \$canvas_names\$.*?\$canvas_names\$;\n', policy_migration, re.S).group(0)
layout_states = {}
for port, (layout, extra, expected_tables) in zip((55442, 55443, 55444), LAYOUTS):
    with disposable_cluster(port) as (sql, apply):
        for path in ['tests/sql/database-bootstrap.sql', 'tests/sql/live-policy-fixture.sql'] + extra:
            apply(path)
        assert canvas_tables_present(sql) == expected_tables, (layout, canvas_tables_present(sql))
        audited = {p for p in AUDITED_POLICIES if p[1] not in CANVAS_TABLES or p[1] in expected_tables}
        if 'canvas_history' in expected_tables:
            audited.add(LEGACY_CANVAS_POLICY)
        assert audited <= policy_names(sql), (layout, audited - policy_names(sql))
        if layout == 'live layout':
            # The earlier unguarded form, in a transaction that is rolled back.
            unguarded = policy_migration.replace(guarded_block, UNGUARDED_CANVAS_DROPS)
            assert unguarded != policy_migration
            before = hardened_state(sql)
            probe = sql.full('BEGIN;\n' + UNGUARDED_CANVAS_DROPS + 'ROLLBACK;\n')
            assert 'relation "public.canvas_history" does not exist, skipping' in probe.stderr, probe.stderr
            unguarded_on_this_server = 'did not raise'
            assert hardened_state(sql) == before, 'the probe changed policies or grants'
        result = sql.full(policy_migration)
        for table in CANVAS_TABLES:
            skipped = f'Skipped: public.{table} does not exist' in result.stderr
            assert skipped == (table not in expected_tables), (layout, table, result.stderr)
        first = hardened_state(sql)
        assert not audited & policy_names(sql), (layout, audited & policy_names(sql))
        apply('tests/sql/live-policy-security.sql')
        apply('migrations/rollback_harden_live_policies.sql')
        assert audited <= policy_names(sql), (layout, audited - policy_names(sql))
        apply('migrations/harden_live_policies.sql')
        assert hardened_state(sql) == first, (layout, 'reapply after rollback gave a different state')
        apply('tests/sql/live-policy-security.sql')
        layout_states[layout] = first
live_state, legacy_state, none_state = (layout_states[name] for name, _, _ in LAYOUTS)
canvas_keys = {f'{kind}:{prefix}{t}' for t in CANVAS_TABLES for kind, prefix in (('policy', 'public.'), ('grant', ''))}
shared = set(live_state) - canvas_keys
assert shared and all(legacy_state[k] == live_state[k] == none_state[k] for k in shared), 'shared tables differ by layout'
for key in set(live_state) & canvas_keys:
    assert legacy_state[key] == live_state[key], key
assert not (set(none_state) & canvas_keys), set(none_state) & canvas_keys
assert {k for k in legacy_state if 'canvas_history|' in k + '|' and k.endswith('canvas_history')} == \
    {'policy:public.canvas_history', 'grant:canvas_history'}, sorted(legacy_state)
print('PASS: policy migration on three canvas layouts (live: events and snapshots only; legacy: with canvas_history; '
      'none): a NOTICE names each skipped table; migration, assertions, rollback, reapply and assertions pass on each; '
      'identical policies and grants for every table present in more than one layout; on this server the earlier '
      f'unguarded DROP POLICY IF EXISTS on public.canvas_history {unguarded_on_this_server} (NOTICE only).')
