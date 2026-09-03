-- 20260826000000 added RLS policies for raffle_prizes but forgot the base
-- table grant — RLS restricts which rows a role can touch, it doesn't
-- substitute for the role having table privileges in the first place. This
-- project's auto_expose_new_tables is off, so new tables get no default
-- grants. Caught by the smoke test: "permission denied for table
-- raffle_prizes" on an insert that should have succeeded under RLS.
grant select, insert, update, delete on public.raffle_prizes to authenticated;
