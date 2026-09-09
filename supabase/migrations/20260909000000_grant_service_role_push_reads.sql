-- Root-causes why no push notification (raffle win, connection request, or
-- double-points start) has ever actually gone out: every notify-* edge
-- function authenticates to Postgres as `service_role`, and while
-- service_role has BYPASSRLS (confirmed: rolbypassrls = true), that only
-- skips row-level security *policies* -- it does not substitute for the
-- base SQL GRANT every role still needs to touch a table at all. None of
-- the tables these functions read (or, for double_points_windows, write
-- back to) ever granted anything to service_role -- only TRUNCATE/
-- REFERENCES/TRIGGER, which Postgres hands out by default, were present.
-- So every select from these tables came back as a permission-denied
-- PostgREST error, which the edge functions never checked for (`const {
-- data } = await admin.from(...).select(...)` ignores `error`), so it was
-- silently treated identically to "no matching rows" -- always resulting
-- in the {"skipped": ...} response visible in net._http_response, even
-- when matching rows plainly existed.
grant select on public.push_tokens to service_role;
grant select, update on public.double_points_windows to service_role;
grant select on public.raffle_prizes to service_role;
grant select on public.connection_requests to service_role;
grant select on public.profiles to service_role;
