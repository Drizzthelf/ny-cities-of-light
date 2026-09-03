-- Verifies the leaderboard view and event_checkins/scans lookups actually
-- use their indexes at a representative scale, not just on today's near-
-- empty tables (where Postgres would seq-scan regardless and tell us
-- nothing). Per docs/production-launch-plan.md §4 index review.
--
-- Run with:
--   npx supabase db query -f supabase/tests/leaderboard-scale-check.sql --linked
--
-- Seeds synthetic profiles/scans/event_checkins inside a transaction that
-- is always rolled back at the end, so nothing is left behind. Adjust
-- n_profiles/n_events below to model a specific expected attendance.

begin;

do $$
declare
  n_profiles int := 1000;   -- adjust to expected attendance
  n_events int := 15;       -- adjust to expected schedule size
  avg_scans_per_person int := 8;   -- each attendee connects with ~8 others
  avg_checkins_per_person int := 4; -- each attendee checks into ~4 sessions
begin
  insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
         'scale-check-' || g || '@example.invalid', now(), now(), '{}', '{}'
  from generate_series(1, n_profiles) g;

  insert into public.profiles (id, first_name, is_admin)
  select id, 'Scale ' || row_number() over (), false
  from auth.users where email like 'scale-check-%@example.invalid';

  insert into public.events (title, start_time, end_time, location_name, address)
  select 'Scale event ' || g, now() + (g || ' hours')::interval, now() + (g || ' hours')::interval + interval '1 hour', 'Hall', 'x'
  from generate_series(1, n_events) g;

  -- Random scan pairs (scanner <> scanned enforced by the table's own check).
  insert into public.scans (scanner_id, scanned_id)
  select p1.id, p2.id
  from public.profiles p1
  cross join lateral (
    select id from public.profiles p2
    where p2.id <> p1.id
    order by random()
    limit avg_scans_per_person
  ) p2
  on conflict do nothing;

  -- Random check-ins.
  insert into public.event_checkins (user_id, event_id)
  select p.id, e.id
  from public.profiles p
  cross join lateral (
    select id from public.events e
    order by random()
    limit avg_checkins_per_person
  ) e
  on conflict do nothing;

  raise notice 'Seeded % profiles, % scans, % event_checkins',
    (select count(*) from public.profiles),
    (select count(*) from public.scans),
    (select count(*) from public.event_checkins);
end $$;

-- Force a fresh plan against the data just seeded (autovacuum won't have
-- run yet inside this transaction).
analyze public.profiles, public.scans, public.event_checkins;

-- `db query` only returns the last statement's result set, so capture all
-- three EXPLAINs into a temp table (still rolled back with everything else)
-- and select them together at the end instead of running them bare.
create temp table plan_output (label text, ord serial, line text);

do $$
declare
  line text;
begin
  for line in execute
    'explain (analyze, buffers, format text) select * from public.leaderboard limit 100'
  loop
    insert into plan_output (label, line) values ('leaderboard', line);
  end loop;

  for line in execute
    'explain (analyze, buffers, format text) select count(*) from public.event_checkins where user_id = (select id from public.profiles limit 1)'
  loop
    insert into plan_output (label, line) values ('event_checkins_by_user', line);
  end loop;

  for line in execute
    'explain (analyze, buffers, format text) select * from public.scans where scanner_id = (select id from public.profiles limit 1) order by created_at desc'
  loop
    insert into plan_output (label, line) values ('scans_by_scanner', line);
  end loop;
end $$;

select label, line from plan_output order by label, ord;

rollback;
