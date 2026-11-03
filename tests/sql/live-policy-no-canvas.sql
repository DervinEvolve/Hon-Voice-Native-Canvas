-- Layout probe with no canvas history table at all. Removes the two tables
-- that tests/sql/live-policy-fixture.sql creates. Disposable test only.
\set ON_ERROR_STOP on
DROP TABLE IF EXISTS public.canvas_history_events, public.canvas_history_snapshots;
