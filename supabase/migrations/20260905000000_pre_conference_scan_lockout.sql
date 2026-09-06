-- The conference starts September 18, 2026. Before real attendees arrive,
-- there's no reason for the repeat-scan/bonus-points system (20260903000100)
-- to be live yet, and no reason for anyone to have already banked a 2nd or
-- 3rd scan of the same pair before the event even starts. So:
--   - Any scan on or before Sept 18 (Eastern) is worth a flat 10 points,
--     regardless of a double-points window or which scan number it'd
--     otherwise be.
--   - A pair's 2nd (or 3rd) scan cannot happen until Sept 19 or later, even
--     if their 1st scan happened well before that — "the earliest someone
--     should be able to scan someone else for the second time is Sept 19."
-- From Sept 19 onward, behavior is exactly what 20260903000100 already
-- describes; this migration only adds an earlier, temporary gate in front
-- of it.
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
  pre_conference_cutoff constant date := '2026-09-18';
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

  if prior_count >= 1 and today_et <= pre_conference_cutoff then
    raise exception 'You can scan this person again starting September 19';
  end if;

  if today_et <= pre_conference_cutoff then
    awarded := 10;
  else
    select exists (
      select 1 from public.double_points_windows where now() between start_time and end_time
    ) into double_active;

    awarded := case
      when prior_count = 0 then (case when double_active then 20 else 10 end)
      when prior_count = 1 then 15
      else 20 -- prior_count = 2 -> this is the 3rd and final scan
    end;
  end if;

  insert into public.scans (scanner_id, scanned_id, points, scan_date)
  values (auth.uid(), p_scanned_id, awarded, today_et)
  on conflict (scanner_id, scanned_id, scan_date) do nothing;

  insert into public.scans (scanner_id, scanned_id, points, scan_date)
  values (p_scanned_id, auth.uid(), awarded, today_et)
  on conflict (scanner_id, scanned_id, scan_date) do nothing;
end;
$$;

revoke all on function public.record_mutual_scan(uuid) from public;

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
  pre_conference_cutoff constant date := '2026-09-18';
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

  if prior_count >= 1 and today_et <= pre_conference_cutoff then
    raise exception 'You can scan this person again starting September 19';
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
