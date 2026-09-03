-- Points-per-scan can no longer be a fixed constant now that a double-points
-- window can be active — store the value actually awarded on the scan row
-- itself (locked in at the moment the connection is accepted, not looked up
-- again later), and sum it in the leaderboard view instead of doing
-- count(*) * 10.
alter table public.scans
  add column if not exists points integer not null default 10 check (points > 0);

create or replace function public.record_mutual_scan(p_scanned_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  awarded int;
begin
  if p_scanned_id = auth.uid() then
    raise exception 'Cannot scan your own code';
  end if;

  awarded := case
    when exists (
      select 1 from public.double_points_windows
      where now() between start_time and end_time
    ) then 20
    else 10
  end;

  -- idempotent both ways: harmless if either direction already exists,
  -- e.g. the other person already scanned this one first. Points are only
  -- set on the first insert for a pair — a later no-op conflict doesn't
  -- retroactively change what was already awarded.
  insert into public.scans (scanner_id, scanned_id, points)
  values (auth.uid(), p_scanned_id, awarded)
  on conflict (scanner_id, scanned_id) do nothing;

  insert into public.scans (scanner_id, scanned_id, points)
  values (p_scanned_id, auth.uid(), awarded)
  on conflict (scanner_id, scanned_id) do nothing;
end;
$$;

revoke all on function public.record_mutual_scan(uuid) from public;
grant execute on function public.record_mutual_scan(uuid) to authenticated;

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
  select scanner_id, count(*) as scan_count, sum(points) as scan_points
  from public.scans
  group by scanner_id
) s on s.scanner_id = p.id
left join (
  select user_id, count(*) as event_count
  from public.event_checkins
  group by user_id
) c on c.user_id = p.id
order by points desc, p.first_name asc;
