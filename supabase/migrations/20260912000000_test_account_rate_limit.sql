-- Brute-force guard for supabase/functions/verify-test-account, which lets
-- the single Apple/Google App Review demo account (an admin) sign in with a
-- fixed 6-digit code instead of a real emailed OTP. A 6-digit code has only
-- 1e6 possibilities and GoTrue's own token_verifications rate limit doesn't
-- apply to this custom function, so without a lockout here it would be
-- brute-forceable into a live admin account. Stored in Postgres (not an
-- in-memory counter) since edge function instances aren't guaranteed to
-- stay warm between requests.
--
-- Singleton table, same `id boolean primary key default true check (id)`
-- pattern as event_access_code. RLS enabled with zero policies — only the
-- edge function's service-role client can read/write it.
create table if not exists public.test_account_rate_limit (
  id boolean primary key default true check (id),
  fail_count int not null default 0,
  locked_until timestamptz
);

insert into public.test_account_rate_limit (id) values (true)
on conflict (id) do nothing;

alter table public.test_account_rate_limit enable row level security;
