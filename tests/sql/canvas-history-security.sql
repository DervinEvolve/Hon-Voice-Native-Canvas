\set ON_ERROR_STOP on
-- Each synthetic user can save and retrieve their own history.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
SELECT public.create_canvas_snapshot('same-draft','manual','{"marker":"owner-a"}',NULL,'untrusted-wallet') AS a_snapshot \gset
SELECT public.save_canvas_event('same-draft','panel_create',NULL,'untrusted-wallet',NULL,NULL,NULL,NULL,'{}',:'a_snapshot');
SELECT public.update_canvas_snapshot_thumbnail(:'a_snapshot','https://example.test/a.png');
SELECT set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false);
SELECT public.create_canvas_snapshot('same-draft','manual','{"marker":"owner-b"}') AS b_snapshot \gset
SELECT public.save_canvas_event('same-draft','panel_create');
DO $$ BEGIN
  IF (SELECT count(*) FROM public.get_canvas_timeline('same-draft',1000000)) <> 1 THEN RAISE EXCEPTION 'Timeline crossed owners'; END IF;
  IF (SELECT count(*) FROM public.canvas_history_snapshots) <> 1 THEN RAISE EXCEPTION 'Direct select crossed owners'; END IF;
  BEGIN
    PERFORM public.create_canvas_snapshot('other-draft','manual','{}','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    RAISE EXCEPTION 'Forged owner was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.canvas_history_events(project_id,user_id,event_type) VALUES ('forged','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','panel_create');
    RAISE EXCEPTION 'Direct forged owner was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.get_canvas_timeline('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,10);
    RAISE EXCEPTION 'Legacy elevated overload is callable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT 1 / (CASE WHEN count(*)=0 THEN 1 ELSE 0 END) FROM public.get_canvas_snapshot(:'a_snapshot');
SELECT 1 / ((NOT public.update_canvas_snapshot_thumbnail(:'a_snapshot','https://example.test/attack'))::integer);
-- An attacker also cannot link to the other owner's snapshot via an event.
SELECT set_config('test.foreign_snapshot',:'a_snapshot',false);
DO $$ BEGIN
  BEGIN
    PERFORM public.save_canvas_event('same-draft','panel_create',NULL,NULL,NULL,NULL,NULL,NULL,'{}',current_setting('test.foreign_snapshot')::uuid);
    RAISE EXCEPTION 'Foreign snapshot link accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT canvas_state->>'marker' FROM public.canvas_history_snapshots WHERE user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 'owner-a' THEN RAISE EXCEPTION 'Owner A state changed'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('create_canvas_snapshot','save_canvas_event','get_canvas_snapshot','get_canvas_timeline','update_canvas_snapshot_thumbnail','cleanup_old_snapshots','get_project_storage_stats') AND p.prosecdef) THEN RAISE EXCEPTION 'Elevated history function remains'; END IF;
END $$;
SET ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM public.get_canvas_snapshot('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'); RAISE EXCEPTION 'Anonymous RPC accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.claim_hon_api_request('attacker',10000); RAISE EXCEPTION 'Anonymous quota override accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM public.claim_hon_api_request('attacker',10000); RAISE EXCEPTION 'Browser quota override accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
