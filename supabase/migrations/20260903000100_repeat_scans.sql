-- Lets the same two people scan each other again on a later day (Eastern
-- time, resetting at midnight), up to 3 times total per pair, with a
-- points curve that goes up per repeat scan: 1st scan is the existing
-- 10pts (20 during a double-points window), 2nd scan is a flat 15pts, 3rd
-- (and final) scan is a flat 20pts — the double-points window only affects
-- the 1st scan, not the fixed 2nd/3rd amounts.

-- scan_date, not just created_at — "different day" has to mean the same
-- calendar day in America/New_York specifically (per the conference's own
-- clock), not the scanning device's local timezone or a rolling 24h
-- window. Backfilled from existing rows' created_at converted the same way.
alter table public.scans add column if not exists scan_date date;
update public.scans set scan_date = (created_at at time zone 'America/New_York')::date where scan_date is null;
alter table public.scans alter column scan_date set not null;
alter table public.scans alter column scan_date set default ((now() at time zone 'America/New_York')::date);

-- Replaces the old "one scan ever per pair" unique constraint — a pair can
-- now have up to 3 rows (one per scan_date), enforced at the count-check
-- level in record_mutual_scan/request_connection below, not by this
-- constraint alone (this constraint's job is just "no two scans on the
-- same day for the same pair", i.e. the "resets at midnight" rule).
alter table public.scans drop constraint if exists scans_scanner_id_scanned_id_key;
alter table public.scans add constraint scans_scanner_scanned_date_key unique (scanner_id, scanned_id, scan_date);

create or replace function public.record_mutual_scan(p_scanned_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  awarded int;
  today_et date;
  prior_count int;
  double_active boolean;
begin
  if p_scanned_id = auth.uid() then
    raise exception 'Cannot scan your own code';
  end if;

  today_et := (now() at time zone 'America/New_York')::date;

  select count(*) into prior_count
  from public.scans
  where scanner_id = auth.uid() and scanned_id = p_scanned_id;

  if prior_count >= 3 then
    raise exception 'You have already scanned this person the maximum 3 times';
  end if;

  if exists (
    select 1 from public.scans
    where scanner_id = auth.uid() and scanned_id = p_scanned_id and scan_date = today_et
  ) then
    raise exception 'You already scanned this person today — try again tomorrow';
  end if;

  select exists (
    select 1 from public.double_points_windows where now() between start_time and end_time
  ) into double_active;

  awarded := case
    when prior_count = 0 then (case when double_active then 20 else 10 end)
    when prior_count = 1 then 15
    else 20 -- prior_count = 2 -> this is the 3rd and final scan
  end;

  -- idempotent both ways, same as before scan_date existed: harmless if
  -- either direction already has today's row, e.g. a race between two
  -- respond_to_connection_request calls for the same pair on the same day.
  insert into public.scans (scanner_id, scanned_id, points, scan_date)
  values (auth.uid(), p_scanned_id, awarded, today_et)
  on conflict (scanner_id, scanned_id, scan_date) do nothing;

  insert into public.scans (scanner_id, scanned_id, points, scan_date)
  values (p_scanned_id, auth.uid(), awarded, today_et)
  on conflict (scanner_id, scanned_id, scan_date) do nothing;
end;
$$;

revoke all on function public.record_mutual_scan(uuid) from public;
-- Deliberately NOT granted to authenticated — same reasoning as
-- 20260825000003: only reachable through respond_to_connection_request
-- (security definer), never called directly by a client.

create or replace function public.request_connection(p_target_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  prior_count int;
  today_et date;
begin
  if p_target_id = auth.uid() then
    raise exception 'Cannot connect with yourself';
  end if;

  today_et := (now() at time zone 'America/New_York')::date;

  select count(*) into prior_count
  from public.scans where scanner_id = auth.uid() and scanned_id = p_target_id;

  if prior_count >= 3 then
    raise exception 'You have already scanned this person the maximum 3 times';
  end if;

  if exists (
    select 1 from public.scans
    where scanner_id = auth.uid() and scanned_id = p_target_id and scan_date = today_et
  ) then
    raise exception 'You already scanned this person today — try again tomorrow';
  end if;

  -- Clear my own stale pending request to this same target first, so a
  -- retry after a timeout isn't blocked by the partial unique index.
  update public.connection_requests
  set status = 'expired', responded_at = now()
  where requester_id = auth.uid()
    and target_id = p_target_id
    and status = 'pending'
    and created_at < now() - interval '2 minutes';

  begin
    insert into public.connection_requests (requester_id, target_id)
    values (auth.uid(), p_target_id)
    returning id into new_id;
  exception
    when unique_violation then
      raise exception 'You already have a pending request to this person — wait for them to respond.';
  end;

  return new_id;
end;
$$;

revoke all on function public.request_connection(uuid) from public;
grant execute on function public.request_connection(uuid) to authenticated;

-- scan_count now means "distinct people scanned" (what the client labels
-- "contacts"), not "total scan events" — those diverge now that the same
-- pair can produce up to 3 scan rows. scan_points (renamed points below)
-- still sums every row, since points earned should include repeat scans.
create or replace view public.leaderboard as
select
  p.id,
  p.first_name,
  p.photo_url,
  coalesce(s.scan_count, 0) as scan_count,
  coalesce(c.event_count, 0) as event_count,
  coalesce(s.scan_points, 0) + coalesce(c.event_count, 0) * 50 as points
from public.profiles p
left join (
  select scanner_id, count(distinct scanned_id) as scan_count, sum(points) as scan_points
  from public.scans
  group by scanner_id
) s on s.scanner_id = p.id
left join (
  select user_id, count(*) as event_count
  from public.event_checkins
  group by user_id
) c on c.user_id = p.id
order by points desc, p.first_name asc;

grant select on public.leaderboard to authenticated;
