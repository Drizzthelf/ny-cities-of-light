-- Moves the registration-code prompt to the very first screen, before email
-- entry, per user request. The authoritative gate stays exactly where it
-- was (create_profile_with_code, checked again at profile creation) — this
-- adds an earlier, non-authoritative check so a wrong code fails fast
-- instead of only surfacing after a full email/OTP round-trip. Callable by
-- `anon` since there's no session yet at this point in the flow.
--
-- Returns a bare boolean (never raises, never echoes the stored code back)
-- so it can't be used to enumerate or leak the actual code value.
create or replace function public.verify_event_access_code(p_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  expected text;
begin
  select code into expected from public.event_access_code where id = true;
  return expected is not null and lower(trim(p_code)) = lower(trim(expected));
end;
$$;

revoke all on function public.verify_event_access_code(text) from public;
grant execute on function public.verify_event_access_code(text) to anon, authenticated;
