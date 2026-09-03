-- Gates profile creation (i.e. account registration) behind a single
-- shared event access code, per user decision in user-to-do.txt: "Let's
-- have one registration code that will be distributed to the attendees.
-- They must have the code to create an account on the app." Eventbrite
-- allow-list (docs/production-launch-plan.md §3.3) was explicitly shelved
-- in favor of this simpler approach.
--
-- A client-side-only check would be trivially bypassable — anyone with the
-- anon key can call `.from('profiles').insert(...)` directly. So this must
-- be enforced server-side: the code check lives inside a `security definer`
-- RPC (same pattern as `admin_reset_scans`), and the previously-open
-- `profiles_insert_self` policy is dropped so that RPC becomes the ONLY
-- path to create a profile. Editing an existing profile is unaffected —
-- that's an UPDATE, governed by the separate `profiles_update_self_or_admin`
-- policy, which already existed and still does.

-- Singleton table (the `id boolean primary key default true check (id)`
-- trick guarantees exactly one row ever exists). Not exposed to
-- `authenticated`/`anon` at all — RLS is enabled with zero policies, so
-- only the security-definer function below (which bypasses RLS) can read
-- it. Storing it in a table rather than hardcoding it in the function body
-- means the code can be rotated later with a plain UPDATE, no redeploy.
create table if not exists public.event_access_code (
  id boolean primary key default true check (id),
  code text not null
);

alter table public.event_access_code enable row level security;

insert into public.event_access_code (id, code)
values (true, 'NYCYSACONF')
on conflict (id) do update set code = excluded.code;

drop policy if exists "profiles_insert_self" on public.profiles;

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
  values (auth.uid(), trim(p_first_name), p_photo_url);
end;
$$;

revoke all on function public.create_profile_with_code(text, text, text) from public;
grant execute on function public.create_profile_with_code(text, text, text) to authenticated;
