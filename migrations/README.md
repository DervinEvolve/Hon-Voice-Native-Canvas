# Database migrations

This folder is the only database setup path for the canvas. The SQL under `legacy/comic-sql/` is from the old comic app and must not be applied.

Apply these in a test Supabase project first, in this order:

| Order | File | What it sets up |
|---|---|---|
| 1 | `secure_canvas_history.sql` | Canvas history tables, owner-only row-level security, the history RPCs; revokes the old RPC overloads. Safe to reapply |
| 2 | `api_request_budget.sql` | The service-only hourly request counter used by every `/api` route |
| 3 | `add_sharp_jobs_table.sql` | The `sharp_jobs` table |
| 4 | `secure_sharp_jobs.sql` | Owner columns, service-only access and the private `hon-private-splats` bucket for SHARP jobs |

`python3 tests/run-database-security.py` applies 1 and 2 twice against a disposable local PostgreSQL and checks owner isolation and the atomic counters.

## Older canvas-history files

`create_canvas_history_table.sql`, `fix_canvas_history_project_id_type.sql`, `fix_canvas_history_project_id_type_no_comments.sql` (the same change without comments), `add_rpc_insert_functions.sql`, `add_thumbnail_update_rpc.sql` and `fix_rpc_user_validation.sql` are the earlier history steps. A new project does not need them. On a project that already ran them, apply `secure_canvas_history.sql` last; it replaces their policies and functions.

## Tables without a migration yet

The code also reads tables that no file here creates, for example `profiles`, `hon_memories`, `hon_sessions`, `hon_evi_sessions`, `recent_generations`, `collaborators`, `collaboration_invites` and `user_characters`. The features that use them (memory, sessions, profiles, collaboration) need their own reviewed migrations before they work on a new project.
