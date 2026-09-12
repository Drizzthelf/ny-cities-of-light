-- Same root cause as 20260909000000_grant_service_role_push_reads.sql:
-- service_role has BYPASSRLS but still needs an explicit base GRANT to
-- touch a table at all. verify-test-account (edge function) reads/updates
-- test_account_rate_limit as service_role on every invocation, so it needs
-- that grant permanently — unlike the profiles row below, which is seeded
-- once here at migration privilege specifically to avoid permanently
-- widening service_role's write access to profiles.
grant select, update on public.test_account_rate_limit to service_role;

-- Seeds the pre-created Apple/Google App Review demo account's profile
-- (auth.users row already created via the Admin API, which a SQL migration
-- can't safely replicate — password hashing/identities/etc). Done as a
-- plain insert here, at migration privilege, rather than granting
-- service_role insert/update on profiles just for this one-off write.
insert into public.profiles (id, first_name, is_admin)
values ('fcadfac9-96b0-4554-bae1-457cfbafead1', 'Apple Review', true)
on conflict (id) do update set first_name = 'Apple Review', is_admin = true;
