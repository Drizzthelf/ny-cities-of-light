-- Fixes a gap discovered while running supabase/tests/rls-smoke-test.sql:
-- `authenticated` has RLS policies on every table but no underlying
-- Postgres GRANT, so every query fails with `permission denied` (42501)
-- before RLS is even evaluated — this affects every table, not just the
-- ones added in the previous migration.
--
-- Root cause: the original profiles/scans tables were created by hand in
-- the Supabase SQL Editor, which runs as the `postgres` role and so
-- inherited this project's default privileges automatically. Migrations
-- pushed via `supabase db push` (Management API) run as a different,
-- scoped role, so that automatic inheritance never applied — nobody
-- noticed because no table had ever been created through the CLI before.
-- Any future migration that adds a new table needs an explicit grant like
-- this one; ALTER DEFAULT PRIVILEGES isn't reliable here since it's scoped
-- to the role that creates future objects, which may differ per push.
--
-- Deliberately NOT granting anon anything — every table's RLS is written
-- `to authenticated` only, and the app is entirely session-gated.

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
