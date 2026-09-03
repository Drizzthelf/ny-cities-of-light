-- Event check-ins now worth 50 points instead of 30, per user request.
-- Person-to-person connections stay at 10. create or replace is fine here
-- (unlike the earlier full-name rename) since the output column list is
-- unchanged — only the points expression's constant changes.
create or replace view public.leaderboard as
select
  p.id,
  p.first_name,
  p.photo_url,
  coalesce(s.scan_count, 0) as scan_count,
  coalesce(c.event_count, 0) as event_count,
  coalesce(s.scan_count, 0) * 10 + coalesce(c.event_count, 0) * 50 as points
from public.profiles p
left join (
  select scanner_id, count(*) as scan_count
  from public.scans
  group by scanner_id
) s on s.scanner_id = p.id
left join (
  select user_id, count(*) as event_count
  from public.event_checkins
  group by user_id
) c on c.user_id = p.id
order by points desc, p.first_name asc;
