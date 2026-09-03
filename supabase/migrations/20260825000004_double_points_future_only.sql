-- An admin cannot create a double-points window with a start or end time
-- that's already in the past. Enforced in the insert policy's with check
-- (not a table CHECK constraint) so it only applies at creation time —
-- a CHECK constraint referencing now() would also re-evaluate on any
-- future UPDATE to an existing row, incorrectly failing a window that was
-- valid when created but has since started.
drop policy if exists "double_points_windows_insert_admin" on public.double_points_windows;
create policy "double_points_windows_insert_admin"
  on public.double_points_windows for insert
  to authenticated
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
    and start_time > now()
    and end_time > now()
  );
