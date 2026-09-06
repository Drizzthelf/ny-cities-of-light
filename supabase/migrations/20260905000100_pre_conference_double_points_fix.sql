-- Correction to 20260905000000: the conference actually STARTS September
-- 18, so double-points windows should work normally that day (flat-10 was
-- wrongly applying through Sept 18 instead of stopping before it). Splits
-- what was one cutoff into two:
--   - pricing_cutoff (Sept 17): flat 10 points applies only through this
--     date. From Sept 18 (conference start) onward, a double-points window
--     works exactly as it always has.
--   - repeat_cutoff (Sept 18): a pair's 2nd/3rd scan is still blocked
--     through this date — "the earliest someone should be able to scan
--     someone else for the second time is September 19" is unchanged.
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

  if today_et <= pricing_cutoff then
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

-- request_connection doesn't need the pricing_cutoff split — it never
-- awards points itself, only pre-checks the repeat-scan gate, which is
-- unchanged.
