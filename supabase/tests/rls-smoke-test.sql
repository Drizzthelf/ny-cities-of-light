-- RLS smoke test — impersonates real authenticated sessions (not just the
-- anon key) to verify row-level security actually restricts what it should.
-- Per docs/production-launch-plan.md §3.1/§9: run this against staging
-- before every release, not just once pre-launch.
--
-- Run with:
--   npx supabase db query -f supabase/tests/rls-smoke-test.sql --linked
--
-- Everything runs inside a transaction that is always rolled back at the
-- end (success or failure), so no test rows are ever left behind. A failed
-- assertion raises an exception, so a non-zero/error result means RLS is
-- broken — a clean "PASS"/"ALL CHECKS PASSED" NOTICE for every check means
-- it isn't.

begin;

do $$
declare
  user_a uuid := gen_random_uuid();
  user_b uuid := gen_random_uuid();
  admin_c uuid := gen_random_uuid();
  user_d uuid := gen_random_uuid(); -- has no profile yet, for registration-code checks
  req_id uuid;
  report_id uuid := gen_random_uuid();
  conn_req_1 uuid;
  conn_req_2 uuid;
  resp_status text;
  visible_count int;
  insert_succeeded boolean;
  code_ok boolean;
  dp_req_id uuid;
  dp_window_id uuid;
  raffle_prize_id uuid;
  raffle_closed_prize_id uuid;
  raffle_delete_prize_id uuid;
  remaining_entries int;
  raffle_winner uuid;
  raffle_loser uuid;
  win_seen boolean;
  push_token_id uuid;
  push_token_count int;
  raffle_topup int;
begin
  -- Three throwaway users: two regular, one admin.
  insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    ('00000000-0000-0000-0000-000000000000', user_a, 'authenticated', 'authenticated', 'rls-smoke-a@example.invalid', now(), now(), '{}', '{}'),
    ('00000000-0000-0000-0000-000000000000', user_b, 'authenticated', 'authenticated', 'rls-smoke-b@example.invalid', now(), now(), '{}', '{}'),
    ('00000000-0000-0000-0000-000000000000', admin_c, 'authenticated', 'authenticated', 'rls-smoke-admin@example.invalid', now(), now(), '{}', '{}'),
    ('00000000-0000-0000-0000-000000000000', user_d, 'authenticated', 'authenticated', 'rls-smoke-d@example.invalid', now(), now(), '{}', '{}');

  insert into public.profiles (id, first_name, is_admin) values
    (user_a, 'RLS Smoke A', false),
    (user_b, 'RLS Smoke B', false),
    (admin_c, 'RLS Smoke Admin', true);

  -- ── leaderboard view: must be selectable by an ordinary authenticated
  -- user — a view needs its own table-level grant separate from any RLS on
  -- its underlying tables, and this one was missing it entirely (caught
  -- live, not by this test, which is why it's here now) ──────────────────
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  perform points from public.leaderboard where id = user_a;
  reset role;
  raise notice 'PASS: an authenticated user can select from the leaderboard view';

  -- ── service_requests: only the submitter and admins may read a row ──────
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  insert into public.service_requests (user_id, message) values (user_a, 'smoke test message') returning id into req_id;
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_b, 'role', 'authenticated')::text, true);
  select count(*) into visible_count from public.service_requests where id = req_id;
  reset role;
  if visible_count <> 0 then
    raise exception 'FAIL: a different non-admin user could read another user''s service_request';
  end if;
  raise notice 'PASS: non-owner, non-admin cannot read another user''s service_request';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  select count(*) into visible_count from public.service_requests where id = req_id;
  reset role;
  if visible_count <> 1 then
    raise exception 'FAIL: the submitting user could not read their own service_request';
  end if;
  raise notice 'PASS: submitter can read their own service_request';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_c, 'role', 'authenticated')::text, true);
  select count(*) into visible_count from public.service_requests where id = req_id;
  reset role;
  if visible_count <> 1 then
    raise exception 'FAIL: an admin could not read a service_request';
  end if;
  raise notice 'PASS: admin can read any service_request';

  -- ── events: non-admins can read but not write ────────────────────────────
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_b, 'role', 'authenticated')::text, true);
  insert_succeeded := true;
  begin
    insert into public.events (title, start_time, end_time, location_name, address)
    values ('rls smoke test event', now(), now() + interval '1 hour', 'x', 'x');
  exception
    when insufficient_privilege then
      insert_succeeded := false;
  end;
  reset role;
  if insert_succeeded then
    raise exception 'FAIL: a non-admin was able to insert an event';
  end if;
  raise notice 'PASS: non-admin cannot insert an event';

  -- ── reports: admin-only read for everyone except the reporter, who can
  -- see (only) their own — needed so the client can check "do I already
  -- have an open report against this person" and offer to rescind it ────
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  insert into public.reports (id, reporter_id, reported_id, reason) values (report_id, user_a, user_b, 'smoke test report');
  select count(*) into visible_count from public.reports where id = report_id;
  reset role;
  if visible_count <> 1 then
    raise exception 'FAIL: the reporter could not read back their own report';
  end if;
  raise notice 'PASS: reporter can read back their own report';

  -- The reported person (the target, not the reporter) must not see it —
  -- self-select-only means exactly that, scoped to reporter_id.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_b, 'role', 'authenticated')::text, true);
  select count(*) into visible_count from public.reports where id = report_id;
  reset role;
  if visible_count <> 0 then
    raise exception 'FAIL: the reported person could read a report filed against them';
  end if;
  raise notice 'PASS: the reported person cannot see a report filed against them';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_c, 'role', 'authenticated')::text, true);
  select count(*) into visible_count from public.reports where id = report_id;
  reset role;
  if visible_count <> 1 then
    raise exception 'FAIL: an admin could not read a report';
  end if;
  raise notice 'PASS: admin can read reports';

  -- Can't file a second open report against the same person while the
  -- first is still open (not yet rescinded) — the partial unique index.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  insert_succeeded := true;
  begin
    insert into public.reports (reporter_id, reported_id, reason) values (user_a, user_b, 'duplicate smoke test report');
    raise exception 'FAIL: a user filed a second open report against someone they already have an open report against';
  exception
    when unique_violation then null;
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  reset role;
  raise notice 'PASS: a duplicate open report against the same person is rejected';

  -- Someone else (not the reporter) cannot rescind the report — silent
  -- no-op, same shape as ack_raffle_win for a non-winner.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_d, 'role', 'authenticated')::text, true);
  perform public.rescind_report(report_id);
  reset role;
  if exists (select 1 from public.reports where id = report_id and rescinded_at is not null) then
    raise exception 'FAIL: a non-reporter was able to rescind someone else''s report';
  end if;
  raise notice 'PASS: a non-reporter rescinding a report has no effect';

  -- The actual reporter can rescind their own report.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  perform public.rescind_report(report_id);
  reset role;
  if not exists (select 1 from public.reports where id = report_id and rescinded_at is not null) then
    raise exception 'FAIL: the reporter could not rescind their own report';
  end if;
  raise notice 'PASS: the reporter can rescind their own report';

  -- Admin can still see it after rescission — it's flagged, not deleted.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_c, 'role', 'authenticated')::text, true);
  select count(*) into visible_count from public.reports where id = report_id and rescinded_at is not null;
  reset role;
  if visible_count <> 1 then
    raise exception 'FAIL: admin could not see the rescinded report';
  end if;
  raise notice 'PASS: a rescinded report still shows for admins, flagged as rescinded';

  -- Once rescinded, the same pair is free again — a fresh report succeeds.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  insert into public.reports (reporter_id, reported_id, reason) values (user_a, user_b, 'follow-up report after rescinding');
  reset role;
  raise notice 'PASS: a new report against the same person succeeds once the prior one is rescinded';

  -- ── storage: users can only upload into their own profile-photos folder.
  -- Storage RLS is a separate policy set from table RLS (§3.1) — easy to
  -- assume the latter covers the former; it doesn't ──────────────────────
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  insert_succeeded := true;
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('profile-photos', user_a::text || '/smoke-test.jpg', user_a);
  exception
    when insufficient_privilege then
      insert_succeeded := false;
  end;
  reset role;
  if not insert_succeeded then
    raise exception 'FAIL: user could not upload into their own profile-photos folder';
  end if;
  raise notice 'PASS: user can upload into their own profile-photos folder';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_b, 'role', 'authenticated')::text, true);
  insert_succeeded := true;
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('profile-photos', user_a::text || '/hijack.jpg', user_b);
  exception
    when insufficient_privilege then
      insert_succeeded := false;
  end;
  reset role;
  if insert_succeeded then
    raise exception 'FAIL: a user was able to upload into another user''s profile-photos folder';
  end if;
  raise notice 'PASS: user cannot upload into another user''s profile-photos folder';

  -- ── storage: event-photos is admin-only (any admin, no per-folder
  -- ownership — unlike profile-photos, since these are event assets an
  -- admin manages on everyone's behalf, not a user's own file) ───────────
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  insert_succeeded := true;
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('event-photos', 'smoke-test-nonadmin.jpg', user_a);
  exception
    when insufficient_privilege then
      insert_succeeded := false;
  end;
  reset role;
  if insert_succeeded then
    raise exception 'FAIL: a non-admin was able to upload into event-photos';
  end if;
  raise notice 'PASS: non-admin cannot upload into event-photos';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_c, 'role', 'authenticated')::text, true);
  insert_succeeded := true;
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('event-photos', 'smoke-test-admin.jpg', admin_c);
  exception
    when insufficient_privilege then
      insert_succeeded := false;
  end;
  reset role;
  if not insert_succeeded then
    raise exception 'FAIL: an admin could not upload into event-photos';
  end if;
  raise notice 'PASS: admin can upload into event-photos';

  -- ── verify_event_access_code: pre-auth check on the new registration-code
  -- screen. Must be callable by `anon` (no session exists yet at that point
  -- in the app), must reject wrong codes and accept the right one, and must
  -- never raise (a raised error could leak information via its message) ───
  set local role anon;
  select public.verify_event_access_code('WRONG-CODE') into code_ok;
  reset role;
  if code_ok then
    raise exception 'FAIL: verify_event_access_code accepted an incorrect code';
  end if;
  raise notice 'PASS: verify_event_access_code (anon) rejects an incorrect code';

  set local role anon;
  select public.verify_event_access_code('nycysaconf') into code_ok;
  reset role;
  if not code_ok then
    raise exception 'FAIL: verify_event_access_code did not accept the correct code (case/whitespace-insensitive) as anon';
  end if;
  raise notice 'PASS: verify_event_access_code (anon) accepts the correct code';

  -- ── registration code: direct profile inserts must be blocked, and the
  -- gating RPC must reject the wrong code and accept the right one ───────
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_d, 'role', 'authenticated')::text, true);
  insert_succeeded := true;
  begin
    insert into public.profiles (id, first_name) values (user_d, 'Should Not Work');
  exception
    when insufficient_privilege then
      insert_succeeded := false;
  end;
  reset role;
  if insert_succeeded then
    raise exception 'FAIL: a user could insert a profile directly, bypassing the registration code';
  end if;
  raise notice 'PASS: direct profile insert is blocked (must go through create_profile_with_code)';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_d, 'role', 'authenticated')::text, true);
  begin
    perform public.create_profile_with_code('WRONG-CODE', 'Should Not Work', null);
    raise exception 'FAIL: create_profile_with_code accepted an incorrect code';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then
        raise;
      end if;
      -- expected: the function's own "incorrect registration code" exception
  end;
  reset role;
  raise notice 'PASS: create_profile_with_code rejects an incorrect code';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_d, 'role', 'authenticated')::text, true);
  perform public.create_profile_with_code('nycysaconf', 'Smoke Test D', null);
  reset role;
  select count(*) into visible_count from public.profiles where id = user_d and first_name = 'Smoke Test D';
  if visible_count <> 1 then
    raise exception 'FAIL: create_profile_with_code did not create a profile with the correct code';
  end if;
  raise notice 'PASS: create_profile_with_code accepts the correct code (case/whitespace-insensitive) and creates the profile';

  -- ── connection requests: scanning no longer instantly credits both
  -- people — it sends a live request the target must accept while both
  -- are actively in the app. record_mutual_scan itself is no longer
  -- directly callable by a client; only reachable via accept. ────────────

  -- Direct scans insert must be blocked (unchanged from the mutual-scans
  -- migration — still true now that record_mutual_scan is gated further).
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_c, 'role', 'authenticated')::text, true);
  insert_succeeded := true;
  begin
    insert into public.scans (scanner_id, scanned_id) values (admin_c, user_a);
  exception
    when insufficient_privilege then
      insert_succeeded := false;
  end;
  reset role;
  if insert_succeeded then
    raise exception 'FAIL: a direct scans insert succeeded';
  end if;
  raise notice 'PASS: direct scans insert is still blocked';

  -- A requests to connect with B.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  conn_req_1 := public.request_connection(user_b);
  reset role;
  select count(*) into visible_count from public.connection_requests where id = conn_req_1 and status = 'pending';
  if visible_count <> 1 then
    raise exception 'FAIL: request_connection did not create a pending row';
  end if;
  raise notice 'PASS: request_connection creates a pending request';

  -- A second request from A to B while the first is still pending must be
  -- rejected — the per-pair lock.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  begin
    perform public.request_connection(user_b);
    raise exception 'FAIL: a second pending request to the same target was allowed';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  reset role;
  raise notice 'PASS: cannot send a second request to the same target while one is already pending';

  -- Per-pair, not global: a DIFFERENT requester can still reach B while
  -- A's request is still pending.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_c, 'role', 'authenticated')::text, true);
  conn_req_2 := public.request_connection(user_b);
  reset role;
  if conn_req_2 is null then
    raise exception 'FAIL: a different requester could not reach B while A''s request was still pending';
  end if;
  raise notice 'PASS: the lock is per-pair, not global — a different requester can still reach the same target';

  -- Only the target may respond — the requester trying to respond to
  -- their own request must be rejected.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  begin
    perform public.respond_to_connection_request(conn_req_1, true);
    raise exception 'FAIL: the requester was able to respond to their own request';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  reset role;
  raise notice 'PASS: only the target can respond to a request, not the requester';

  -- B declines A's request.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_b, 'role', 'authenticated')::text, true);
  perform public.respond_to_connection_request(conn_req_1, false);
  reset role;
  select status into resp_status from public.connection_requests where id = conn_req_1;
  if resp_status <> 'declined' then
    raise exception 'FAIL: decline did not set status to declined (got %)', resp_status;
  end if;
  select count(*) into visible_count from public.scans where (scanner_id, scanned_id) in ((user_a, user_b), (user_b, user_a));
  if visible_count <> 0 then
    raise exception 'FAIL: declining a request still created scans rows';
  end if;
  raise notice 'PASS: declining resolves the request and creates no scans rows';

  -- After a decline, A can send B a fresh request (not permanently blocked).
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  conn_req_1 := public.request_connection(user_b);
  reset role;
  raise notice 'PASS: can send a new request to the same target after a decline';

  -- B accepts this time.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_b, 'role', 'authenticated')::text, true);
  perform public.respond_to_connection_request(conn_req_1, true);
  reset role;
  select count(*) into visible_count from public.scans where (scanner_id, scanned_id) in ((user_a, user_b), (user_b, user_a));
  if visible_count <> 2 then
    raise exception 'FAIL: accepting did not create both scans rows (expected 2, got %)', visible_count;
  end if;
  raise notice 'PASS: accepting creates both directions of the scan (mutual credit)';

  select count(*) into visible_count
  from public.scans
  where (scanner_id, scanned_id) in ((user_a, user_b), (user_b, user_a)) and points = 10;
  if visible_count <> 2 then
    raise exception 'FAIL: scans accepted with no double-points window active were not worth 10 (baseline)';
  end if;
  raise notice 'PASS: scans accepted with no double-points window active are worth 10 (baseline)';

  -- ── repeat scans: the same pair can scan again on a LATER (Eastern-time)
  -- day, up to 3 times total, worth 15pts for the 2nd scan and 20pts for
  -- the 3rd — but never twice on the same day, and never a 4th time ──────
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  insert_succeeded := true;
  begin
    perform public.request_connection(user_b);
    raise exception 'FAIL: was able to request the same person again on the same day';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  reset role;
  raise notice 'PASS: cannot scan the same person again on the same (Eastern) day';

  -- Backdate both directions of A<->B's existing scan to "yesterday" so a
  -- new scan today is a legitimate different-day repeat, not just an
  -- accident of the max-3 check firing first.
  update public.scans set scan_date = scan_date - 1
  where (scanner_id, scanned_id) in ((user_a, user_b), (user_b, user_a));

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  conn_req_1 := public.request_connection(user_b);
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_b, 'role', 'authenticated')::text, true);
  perform public.respond_to_connection_request(conn_req_1, true);
  reset role;

  select count(*) into visible_count
  from public.scans
  where (scanner_id, scanned_id) in ((user_a, user_b), (user_b, user_a)) and points = 15;
  if visible_count <> 2 then
    raise exception 'FAIL: a 2nd scan of the same person on a later day was not worth 15 (got % rows at 15)', visible_count;
  end if;
  raise notice 'PASS: a 2nd scan of the same person on a later day is worth 15 for both people';

  update public.scans set scan_date = scan_date - 1
  where (scanner_id, scanned_id) in ((user_a, user_b), (user_b, user_a));

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  conn_req_1 := public.request_connection(user_b);
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_b, 'role', 'authenticated')::text, true);
  perform public.respond_to_connection_request(conn_req_1, true);
  reset role;

  select count(*) into visible_count
  from public.scans
  where (scanner_id, scanned_id) in ((user_a, user_b), (user_b, user_a)) and points = 20;
  if visible_count <> 2 then
    raise exception 'FAIL: a 3rd scan of the same person on a later day was not worth 20 (got % rows at 20)', visible_count;
  end if;
  raise notice 'PASS: a 3rd scan of the same person on a later day is worth 20 for both people';

  -- A 4th scan must be refused even on yet another day — 3 is a hard cap,
  -- not just a same-day cooldown.
  update public.scans set scan_date = scan_date - 1
  where (scanner_id, scanned_id) in ((user_a, user_b), (user_b, user_a));

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  insert_succeeded := true;
  begin
    perform public.request_connection(user_b);
    raise exception 'FAIL: was able to request a 4th scan of the same person';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  reset role;
  raise notice 'PASS: cannot scan the same person a 4th time — 3 is the max';

  select count(*) into visible_count from public.scans where (scanner_id, scanned_id) in ((user_a, user_b), (user_b, user_a));
  if visible_count <> 6 then
    raise exception 'FAIL: expected exactly 3 scans per direction for A<->B (6 rows total), got %', visible_count;
  end if;
  raise notice 'PASS: exactly 3 scans total were recorded for the A<->B pair, matching the 3-scan max';

  -- record_mutual_scan must no longer be directly callable — otherwise a
  -- modified client could bypass the whole request/accept flow.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  insert_succeeded := true;
  begin
    perform public.record_mutual_scan(admin_c);
  exception
    when insufficient_privilege then
      insert_succeeded := false;
  end;
  reset role;
  if insert_succeeded then
    raise exception 'FAIL: record_mutual_scan is still directly callable, bypassing the request/accept flow';
  end if;
  raise notice 'PASS: record_mutual_scan is no longer directly callable (only reachable via accept)';

  -- Expiry: admin_c's earlier request to B (conn_req_2) was never
  -- resolved — backdate it past the 2-minute TTL and confirm accepting it
  -- now correctly reports 'expired' (a return value, not an exception —
  -- see 20260823000003) and flips the row to expired, not silently accepts.
  update public.connection_requests
  set created_at = now() - interval '3 minutes'
  where id = conn_req_2;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_b, 'role', 'authenticated')::text, true);
  select public.respond_to_connection_request(conn_req_2, true) into resp_status;
  reset role;
  if resp_status <> 'expired' then
    raise exception 'FAIL: accepting a stale request did not report expired (got %)', resp_status;
  end if;

  select count(*) into visible_count from public.scans where (scanner_id, scanned_id) in ((admin_c, user_b), (user_b, admin_c));
  if visible_count <> 0 then
    raise exception 'FAIL: an expired request still created scans rows';
  end if;

  select status into resp_status from public.connection_requests where id = conn_req_2;
  if resp_status <> 'expired' then
    raise exception 'FAIL: a stale unanswered request was not durably marked expired in the row (got %)', resp_status;
  end if;
  raise notice 'PASS: a stale pending request reports expired, creates no scans, and the row is durably marked expired';

  -- ── favorites: can only favorite an actual contact, and — the whole
  -- point of the feature — the favorited person can never see that they
  -- were favorited, not even their own row in someone else's favorites ───
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  insert_succeeded := true;
  begin
    insert into public.favorites (user_id, contact_id) values (user_a, admin_c);
  exception
    when insufficient_privilege then
      insert_succeeded := false;
  end;
  reset role;
  if insert_succeeded then
    raise exception 'FAIL: user_a was able to favorite admin_c despite having no scans row with them';
  end if;
  raise notice 'PASS: cannot favorite someone who is not an actual contact';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  insert_succeeded := true;
  begin
    insert into public.favorites (user_id, contact_id) values (user_a, user_b);
  exception
    when insufficient_privilege then
      insert_succeeded := false;
  end;
  reset role;
  if not insert_succeeded then
    raise exception 'FAIL: user_a could not favorite user_b, an actual contact';
  end if;
  raise notice 'PASS: can favorite an actual contact';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  select count(*) into visible_count from public.favorites where user_id = user_a and contact_id = user_b;
  reset role;
  if visible_count <> 1 then
    raise exception 'FAIL: user_a cannot see their own favorite';
  end if;
  raise notice 'PASS: user_a can see their own favorite';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_b, 'role', 'authenticated')::text, true);
  select count(*) into visible_count from public.favorites where contact_id = user_b;
  reset role;
  if visible_count <> 0 then
    raise exception 'FAIL: user_b (the favorited person) could see that they were favorited';
  end if;
  raise notice 'PASS: the favorited person cannot see that they were favorited by anyone';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  delete from public.favorites where user_id = user_a and contact_id = user_b;
  reset role;
  select count(*) into visible_count from public.favorites where user_id = user_a and contact_id = user_b;
  if visible_count <> 0 then
    raise exception 'FAIL: user_a could not remove their own favorite';
  end if;
  raise notice 'PASS: user_a can unfavorite';

  -- ── double_points_windows: non-admin can't create one, admin can, and a
  -- scan accepted while one is active is worth 20 instead of 10 ──────────
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  insert_succeeded := true;
  begin
    insert into public.double_points_windows (start_time, end_time)
    values (now() - interval '1 minute', now() + interval '1 hour');
  exception
    when insufficient_privilege then
      insert_succeeded := false;
  end;
  reset role;
  if insert_succeeded then
    raise exception 'FAIL: a non-admin was able to create a double-points window';
  end if;
  raise notice 'PASS: non-admin cannot create a double-points window';

  -- An admin cannot create a window with a start or end time already in
  -- the past.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_c, 'role', 'authenticated')::text, true);
  insert_succeeded := true;
  begin
    insert into public.double_points_windows (start_time, end_time)
    values (now() - interval '1 minute', now() + interval '1 hour');
  exception
    when insufficient_privilege then
      insert_succeeded := false;
  end;
  reset role;
  if insert_succeeded then
    raise exception 'FAIL: an admin was able to create a double-points window with a start time in the past';
  end if;
  raise notice 'PASS: admin cannot create a double-points window with a start or end time in the past';

  -- now() is frozen for the whole life of this transaction (this entire do
  -- block), so an admin creating a real *currently active* window can't be
  -- expressed directly here the same way it works in production (each RPC
  -- call there is its own transaction, where now() really is the current
  -- moment). Insert with valid future times, then backdate via UPDATE —
  -- same trick the connection-request expiry check above already uses —
  -- to simulate the window having started. The update policy has no
  -- future-only restriction (only insert does), so this is legitimate.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_c, 'role', 'authenticated')::text, true);
  insert into public.double_points_windows (start_time, end_time)
  values (now() + interval '1 second', now() + interval '1 hour')
  returning id into dp_window_id;
  update public.double_points_windows set start_time = now() - interval '1 minute' where id = dp_window_id;
  dp_req_id := public.request_connection(user_d);
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_d, 'role', 'authenticated')::text, true);
  perform public.respond_to_connection_request(dp_req_id, true);
  reset role;

  select count(*) into visible_count
  from public.scans
  where (scanner_id, scanned_id) in ((admin_c, user_d), (user_d, admin_c)) and points = 20;
  if visible_count <> 2 then
    raise exception 'FAIL: a scan accepted during an active double-points window was not worth 20 (got % rows at 20)', visible_count;
  end if;
  raise notice 'PASS: a scan accepted during an active double-points window is worth 20 for both people';

  -- Overlap prevention: dp_window_id currently spans roughly
  -- [now() - 1 minute, now() + 1 hour). Anything overlapping that range
  -- must be rejected; a back-to-back window starting exactly when it ends
  -- must be allowed.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_c, 'role', 'authenticated')::text, true);
  insert_succeeded := true;
  begin
    insert into public.double_points_windows (start_time, end_time)
    values (now() + interval '30 minutes', now() + interval '2 hours');
  exception
    when exclusion_violation then
      insert_succeeded := false;
  end;
  reset role;
  if insert_succeeded then
    raise exception 'FAIL: an admin was able to schedule a double-points window overlapping an existing one';
  end if;
  raise notice 'PASS: cannot schedule a double-points window that overlaps an existing one';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_c, 'role', 'authenticated')::text, true);
  insert_succeeded := true;
  begin
    insert into public.double_points_windows (start_time, end_time)
    values (now() + interval '1 hour', now() + interval '2 hours');
  exception
    when exclusion_violation then
      insert_succeeded := false;
  end;
  reset role;
  if not insert_succeeded then
    raise exception 'FAIL: a back-to-back (non-overlapping) window was incorrectly rejected';
  end if;
  raise notice 'PASS: a back-to-back window starting exactly when another ends is allowed';

  -- ── raffle: points->tickets curve, admin-only prize management, ticket
  -- assignment bounded by earned tickets, entry privacy, weighted draw,
  -- post-draw lockout, and the private win-ack ────────────────────────────
  -- Tiered curve: 5 tickets at 28pts each, next 5 at 35pts each, next 5 at
  -- 42pts each, etc. (each block of 5 costs 7pts/ticket more than the last).
  if public.points_to_tickets(0) <> 0 or public.points_to_tickets(27) <> 0
     or public.points_to_tickets(28) <> 1 or public.points_to_tickets(140) <> 5
     or public.points_to_tickets(174) <> 5 or public.points_to_tickets(175) <> 6 then
    raise exception 'FAIL: points_to_tickets curve gave unexpected values';
  end if;
  if public.points_for_ticket(0) <> 0 or public.points_for_ticket(1) <> 28
     or public.points_for_ticket(5) <> 140 or public.points_for_ticket(6) <> 175
     or public.points_for_ticket(10) <> 315 then
    raise exception 'FAIL: points_for_ticket curve gave unexpected values';
  end if;
  raise notice 'PASS: points<->tickets curve functions match expected values';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  insert_succeeded := true;
  begin
    insert into public.raffle_prizes (title) values ('Should not work');
  exception
    when insufficient_privilege then
      insert_succeeded := false;
  end;
  reset role;
  if insert_succeeded then
    raise exception 'FAIL: a non-admin was able to create a raffle prize';
  end if;
  raise notice 'PASS: non-admin cannot create a raffle prize';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_c, 'role', 'authenticated')::text, true);
  insert into public.raffle_prizes (title) values ('RLS Smoke Test Prize') returning id into raffle_prize_id;
  reset role;
  raise notice 'PASS: admin can create a raffle prize';

  -- Top user_a and user_d up to exactly 28 and 56 points respectively
  -- (1 and 2 tickets under the tiered curve), regardless of whatever
  -- points they already carry from earlier in this script — added via a
  -- direct scans insert/top-up rather than another round of
  -- record_mutual_scan, since the exact earned total is what's under test
  -- here, not how it was earned.
  select 28 - coalesce(points, 0) into raffle_topup from public.leaderboard where id = user_a;
  if raffle_topup > 0 then
    insert into public.scans (scanner_id, scanned_id, points) values (user_a, admin_c, raffle_topup)
    on conflict (scanner_id, scanned_id, scan_date) do update set points = public.scans.points + excluded.points;
  end if;
  select 56 - coalesce(points, 0) into raffle_topup from public.leaderboard where id = user_d;
  if raffle_topup > 0 then
    insert into public.scans (scanner_id, scanned_id, points) values (user_d, admin_c, raffle_topup)
    on conflict (scanner_id, scanned_id, scan_date) do update set points = public.scans.points + excluded.points;
  end if;
  if (select public.points_to_tickets(points::integer) from public.leaderboard where id = user_a) <> 1
     or (select public.points_to_tickets(points::integer) from public.leaderboard where id = user_d) <> 2 then
    raise exception 'FAIL: raffle test point top-up did not land on the expected ticket counts';
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  perform public.assign_raffle_tickets(raffle_prize_id, 1);
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  begin
    perform public.assign_raffle_tickets(raffle_prize_id, 2);
    raise exception 'FAIL: user_a was allowed to assign more tickets than they have earned';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  reset role;
  raise notice 'PASS: cannot assign more tickets than earned';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_d, 'role', 'authenticated')::text, true);
  perform public.assign_raffle_tickets(raffle_prize_id, 2);
  reset role;

  if (select total_tickets from public.raffle_prize_stats where prize_id = raffle_prize_id) <> 3 then
    raise exception 'FAIL: raffle_prize_stats total_tickets is wrong (expected 3)';
  end if;
  if (select entrant_count from public.raffle_prize_stats where prize_id = raffle_prize_id) <> 2 then
    raise exception 'FAIL: raffle_prize_stats entrant_count is wrong (expected 2)';
  end if;
  raise notice 'PASS: raffle_prize_stats reflects both entrants'' tickets (aggregate only)';

  -- Privacy: user_d can see their own entry but not user_a's, even though
  -- both entered the same prize.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_d, 'role', 'authenticated')::text, true);
  select count(*) into visible_count from public.raffle_entries where prize_id = raffle_prize_id;
  reset role;
  if visible_count <> 1 then
    raise exception 'FAIL: user_d could see other users'' raffle entries (expected to see only their own 1 row, saw %)', visible_count;
  end if;
  raise notice 'PASS: a user can only see their own raffle entries, not other entrants';

  -- A prize whose closes_at has already passed rejects new/changed entries
  -- — assign_raffle_tickets is the only writer of raffle_entries, so this
  -- is the actual enforcement, not just a client-side restriction.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_c, 'role', 'authenticated')::text, true);
  insert into public.raffle_prizes (title, closes_at) values ('RLS Smoke Closed Prize', now() - interval '1 hour')
    returning id into raffle_closed_prize_id;
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  begin
    perform public.assign_raffle_tickets(raffle_closed_prize_id, 1);
    raise exception 'FAIL: assigned tickets to a prize whose closes_at has already passed';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  reset role;
  raise notice 'PASS: cannot assign tickets to a prize after its closes_at has passed';

  -- Deleting a prize an admin no longer wants must actually free up the
  -- tickets a user had committed to it (not fail outright, and not leave
  -- an orphaned entry silently uncounted) — raffle_entries.prize_id is
  -- ON DELETE CASCADE, and Postgres enforces FK cascade actions with its
  -- own internal privileges regardless of the deleting role's own grants
  -- on the cascaded table (authenticated has no direct DELETE grant on
  -- raffle_entries — only assign_raffle_tickets, security definer, writes
  -- it), so this needs an actual end-to-end check, not just trusting the
  -- constraint definition.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_c, 'role', 'authenticated')::text, true);
  insert into public.raffle_prizes (title) values ('RLS Smoke Delete-Me Prize') returning id into raffle_delete_prize_id;
  reset role;

  -- user_a and user_d are both already at their earned-ticket cap from
  -- earlier in this test, so assign_raffle_tickets would correctly refuse
  -- a 3rd prize for either of them — that's not what's under test here.
  -- Inserting the entry directly (as the unrestricted role this whole
  -- script runs as) isolates the thing actually being verified: that
  -- deleting the prize frees it back up, not whether it could be earned.
  insert into public.raffle_entries (user_id, prize_id, tickets) values (user_a, raffle_delete_prize_id, 1);

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_c, 'role', 'authenticated')::text, true);
  delete from public.raffle_prizes where id = raffle_delete_prize_id;
  reset role;

  select count(*) into remaining_entries from public.raffle_entries where prize_id = raffle_delete_prize_id;
  if remaining_entries <> 0 then
    raise exception 'FAIL: deleting a raffle prize left orphaned raffle_entries behind';
  end if;
  raise notice 'PASS: deleting a raffle prize cascades and frees up the tickets a user had committed to it';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  insert_succeeded := true;
  begin
    perform public.draw_raffle_winner(raffle_prize_id);
    raise exception 'FAIL: a non-admin was able to draw a raffle winner';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  reset role;
  raise notice 'PASS: non-admin cannot draw a raffle winner';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_c, 'role', 'authenticated')::text, true);
  select public.draw_raffle_winner(raffle_prize_id) into raffle_winner;
  reset role;
  if raffle_winner is distinct from user_a and raffle_winner is distinct from user_d then
    raise exception 'FAIL: draw_raffle_winner picked someone who never entered (%)', raffle_winner;
  end if;
  raffle_loser := case when raffle_winner = user_a then user_d else user_a end;
  raise notice 'PASS: draw_raffle_winner picked an actual entrant (%)', raffle_winner;

  select drawn_at is not null and winner_id = raffle_winner and winner_seen = false
  into insert_succeeded
  from public.raffle_prizes where id = raffle_prize_id;
  if not insert_succeeded then
    raise exception 'FAIL: raffle_prizes row was not updated correctly after drawing';
  end if;
  raise notice 'PASS: raffle_prizes row records drawn_at, winner_id, and a fresh unseen win';

  select count(*) into visible_count
  from public.announcements
  where admin_id is null
    and title like '%RLS Smoke Test Prize%';
  if visible_count <> 1 then
    raise exception 'FAIL: draw_raffle_winner did not post a drawn-prize announcement to the Updates feed';
  end if;
  raise notice 'PASS: draw_raffle_winner posts a drawn-prize announcement (shown as "— Admin") to the Updates feed';

  select count(*) into visible_count
  from public.announcements
  where admin_id is null
    and title like '%RLS Smoke Test Prize%'
    and body like '%' || (select first_name from public.profiles where id = raffle_winner) || '%';
  if visible_count <> 0 then
    raise exception 'FAIL: the broadcast winner announcement names the winner — it should stay anonymous';
  end if;
  raise notice 'PASS: the broadcast winner announcement does not name the winner';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', raffle_winner, 'role', 'authenticated')::text, true);
  insert_succeeded := true;
  begin
    perform public.assign_raffle_tickets(raffle_prize_id, 1);
    raise exception 'FAIL: tickets could still be assigned to an already-drawn prize';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  reset role;
  raise notice 'PASS: cannot assign tickets to an already-drawn prize';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_c, 'role', 'authenticated')::text, true);
  insert_succeeded := true;
  begin
    perform public.draw_raffle_winner(raffle_prize_id);
    raise exception 'FAIL: an already-drawn prize could be drawn again';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  reset role;
  raise notice 'PASS: an already-drawn prize cannot be drawn again';

  -- The non-winner trying to ack the win notice must be a silent no-op,
  -- not an error and not a way to falsely mark it seen.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', raffle_loser, 'role', 'authenticated')::text, true);
  perform public.ack_raffle_win(raffle_prize_id);
  reset role;
  select winner_seen into win_seen from public.raffle_prizes where id = raffle_prize_id;
  if win_seen then
    raise exception 'FAIL: a non-winner was able to mark someone else''s win as seen';
  end if;
  raise notice 'PASS: a non-winner acking a prize has no effect';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', raffle_winner, 'role', 'authenticated')::text, true);
  perform public.ack_raffle_win(raffle_prize_id);
  reset role;
  select winner_seen into win_seen from public.raffle_prizes where id = raffle_prize_id;
  if not win_seen then
    raise exception 'FAIL: the actual winner acking their win did not mark it seen';
  end if;
  raise notice 'PASS: the winner can ack their own private win notice';

  -- push_tokens: self-serve only, no cross-user visibility even between
  -- two ordinary users (not just "not an admin's business" — nobody but
  -- the owner gets a select policy at all).
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  insert into public.push_tokens (user_id, token, platform) values (user_a, 'ExponentPushToken[test-a]', 'ios')
    returning id into push_token_id;
  reset role;
  raise notice 'PASS: a user can register their own push token';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  insert_succeeded := true;
  begin
    insert into public.push_tokens (user_id, token, platform) values (user_d, 'ExponentPushToken[test-spoof]', 'ios');
    raise exception 'FAIL: a user registered a push token under someone else''s user_id';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  reset role;
  raise notice 'PASS: a user cannot register a push token under another user''s id';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_d, 'role', 'authenticated')::text, true);
  select count(*) into push_token_count from public.push_tokens where user_id = user_a;
  reset role;
  if push_token_count <> 0 then
    raise exception 'FAIL: user_d could see user_a''s push token';
  end if;
  raise notice 'PASS: a push token is invisible to everyone but its owner';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_d, 'role', 'authenticated')::text, true);
  delete from public.push_tokens where id = push_token_id;
  reset role;
  select count(*) into push_token_count from public.push_tokens where id = push_token_id;
  if push_token_count <> 1 then
    raise exception 'FAIL: user_d was able to delete user_a''s push token';
  end if;
  raise notice 'PASS: a push token cannot be deleted by anyone but its owner';

  raise notice 'ALL CHECKS PASSED';
end $$;

-- A plain SELECT after the DO block, before rollback, still returns its
-- result to the client — `db query` doesn't surface RAISE NOTICE output,
-- so this is the visible confirmation that every assertion above passed
-- (if any had failed, the DO block would have raised and this line would
-- never run).
select 'ALL CHECKS PASSED' as result;

rollback;
