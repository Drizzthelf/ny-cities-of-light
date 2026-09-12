-- The App Review demo account's profile is pre-seeded (see
-- 20260912000100_test_account_grants_and_seed.sql) with is_admin already
-- set, since that account skips real signup entirely. But
-- create_profile_with_code (ProfileSetupScreen.tsx "create" mode) can still
-- run for it: RootNavigator shows ProfileSetupScreen whenever `!profile`,
-- which is momentarily true right after sign-in until AuthContext's async
-- profile fetch resolves. For a brand-new real user that's a harmless
-- flash (no row exists yet). For the pre-seeded demo account, hitting
-- "create" during that window did a plain insert against an id that
-- already has a row, raising `profiles_pkey` and surfacing "Could not save
-- profile" to the reviewer.
--
-- Upserting fixes both: a genuinely new user still just gets their row
-- created, and the demo account's is_admin flag (never touched by this
-- function — only first_name/photo_url are written here) survives
-- untouched.
create or replace function public.create_profile_with_code(
  p_code text,
  p_first_name text,
  p_photo_url text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  expected text;
begin
  select code into expected from public.event_access_code where id = true;
  if expected is null or lower(trim(p_code)) <> lower(trim(expected)) then
    raise exception 'Incorrect registration code. Check with conference staff and try again.';
  end if;

  insert into public.profiles (id, first_name, photo_url)
  values (auth.uid(), trim(p_first_name), p_photo_url)
  on conflict (id) do update
    set first_name = excluded.first_name,
        photo_url = excluded.photo_url;
end;
$$;
