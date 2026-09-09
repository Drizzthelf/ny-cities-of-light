-- 20260905000100 only ever checked double_active for the 1st scan of a
-- pair (prior_count = 0); the 2nd/3rd repeat scans (15/20 pts) were flat
-- amounts that ignored an active double-points window entirely. A
-- double-points window should double whatever the scan would otherwise be
-- worth, not just make the 1st scan worth 20 — e.g. a 2nd scan (normally
-- 15) should be 30 during a window, a 3rd (normally 20) should be 40.
create or replace function public.record_mutual_scan(p_scanned_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  awarded int;
  base int;
  today_et date;
  prior_count int;
  double_active boolean;
  pricing_cutoff constant date := '2026-09-17';
  repeat_cutoff constant date := '2026-09-18';
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

  if prior_count >= 1 and today_et <= repeat_cutoff then
    raise exception 'You can scan this person again starting September 19';
  end if;

  base := case
    when prior_count = 0 then 10
    when prior_count = 1 then 15
    else 20 -- prior_count = 2 -> this is the 3rd and final scan
  end;

  if today_et <= pricing_cutoff then
    awarded := base;
  else
    select exists (
      select 1 from public.double_points_windows where now() between start_time and end_time
    ) into double_active;

    awarded := case when double_active then base * 2 else base end;
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
