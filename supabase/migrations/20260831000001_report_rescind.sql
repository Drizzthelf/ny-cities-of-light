-- Lets a reporter withdraw ("rescind") their own report — distinct from
-- `resolved_at`/`resolved_by`, which is the admin's own resolution signal.
-- A rescinded report still shows up in the admin queue (it's never
-- deleted), just flagged so admins can see it was withdrawn by the
-- reporter rather than acted on.
alter table public.reports add column if not exists rescinded_at timestamptz;

-- "Can't report the same person twice while there's an open report" — an
-- open report is one the reporter hasn't rescinded. Once rescinded, the
-- pair is free again and a new report can be filed. Partial unique index
-- enforces this at the database level rather than relying on a client-side
-- check alone (the client still does a friendly pre-check — see
-- ReportModal.tsx — but this is the actual guarantee).
create unique index if not exists reports_reporter_reported_open_uniq
  on public.reports (reporter_id, reported_id)
  where rescinded_at is null;

-- Self-select-only, mirroring the favorites/raffle_entries/push_tokens
-- privacy pattern — a reporter can see their own filed reports (needed so
-- the client can check "do I already have an open report against this
-- person" and offer to rescind it), but this is additive to, not a
-- replacement for, the existing admin-only queue visibility.
drop policy if exists "reports_select_own" on public.reports;
create policy "reports_select_own"
  on public.reports for select
  to authenticated
  using (auth.uid() = reporter_id);

-- Security definer rather than a broad update policy for authenticated
-- users, so a reporter can only ever flip their own report's
-- rescinded_at — never reason/reported_id/resolved_at/resolved_by, which
-- stay admin-only via the existing reports_update_admin policy.
create or replace function public.rescind_report(p_report_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.reports
  set rescinded_at = now()
  where id = p_report_id
    and reporter_id = auth.uid()
    and rescinded_at is null;
end;
$$;

grant execute on function public.rescind_report(uuid) to authenticated;
