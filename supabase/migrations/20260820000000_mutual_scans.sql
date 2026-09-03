-- Fixes an asymmetry: scanning someone's QR code only ever credited the
-- scanner (a `scans` row with scanner_id = the person holding the camera).
-- ContactsScreen only shows rows where scanner_id = me, and the leaderboard
-- view's scan_count only counts rows where scanner_id = profile.id — so the
-- *scanned* person got no contact and no points unless they separately
-- scanned back. Per user request: one scan should credit both people.
--
-- Fix: a security-definer RPC inserts BOTH directions of the pair
-- atomically, then the direct insert policy is dropped so this RPC becomes
-- the only path to create a scan — same pattern as
-- create_profile_with_code in 20260818000000. This means ContactsScreen and
-- the leaderboard view need NO changes at all: both already read purely off
-- scanner_id = me, and after this migration that's now true for both
-- parties to every scan, automatically.

drop policy if exists "scans_insert_self" on public.scans;

create or replace function public.record_mutual_scan(p_scanned_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_scanned_id = auth.uid() then
    raise exception 'Cannot scan your own code';
  end if;

  -- idempotent both ways: harmless if either direction already exists,
  -- e.g. the other person already scanned this one first.
  insert into public.scans (scanner_id, scanned_id)
  values (auth.uid(), p_scanned_id)
  on conflict (scanner_id, scanned_id) do nothing;

  insert into public.scans (scanner_id, scanned_id)
  values (p_scanned_id, auth.uid())
  on conflict (scanner_id, scanned_id) do nothing;
end;
$$;

revoke all on function public.record_mutual_scan(uuid) from public;
grant execute on function public.record_mutual_scan(uuid) to authenticated;
