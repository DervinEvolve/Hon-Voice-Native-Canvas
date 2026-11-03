# Old comic-app SQL (do not apply)

These files come from the comic app Hon started as. They are kept only as a record of what that app's database looked like. **They are not part of the canvas setup, nothing in this repo applies them, and they must not be run against any database.**

Some of the policies in them are unsafe:

| File | Problem |
|---|---|
| `wallet_rls_policy.sql` | `"Allow wallet-only profile updates"` lets any caller, including the anonymous role, update any profile row that has a wallet set |
| `setup_database.sql` | `comic_stats` insert and update policies use `USING (true)` for every signed-in user; several tables are readable by everyone |
| `fix_social_features.sql` | Bookmarks, subscriptions and comments are readable by everyone |

The canvas database setup lives in [`migrations/`](../../migrations/README.md). That is the only setup path.

If a Supabase project was ever set up from these files, check its live policies in the Supabase dashboard (Database, then Policies) or with:

```sql
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```

Drop any policy that grants writes on a condition other than `auth.uid()` ownership, for example:

```sql
drop policy if exists "Allow wallet-only profile updates" on public.profiles;
```
