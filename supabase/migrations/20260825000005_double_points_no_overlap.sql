-- Prevents two double-points windows from overlapping. Done as a real
-- exclusion constraint (not just an RLS check) so it's enforced atomically
-- against concurrent inserts and against updates too, not just a
-- check-then-insert that could race. '[)' bounds (start inclusive, end
-- exclusive) so back-to-back windows — one ending exactly when the next
-- starts — are allowed, only genuine overlap is rejected.
alter table public.double_points_windows
  add constraint double_points_windows_no_overlap
  exclude using gist (tstzrange(start_time, end_time, '[)') with &&);
