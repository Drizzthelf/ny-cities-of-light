-- Adds an optional background photo per event, shown behind its row on the
-- Schedule page, with an admin-adjustable dark overlay so title/time text
-- stays legible over busy photos. image_opacity is the overlay's strength
-- (0 = photo shows through fully, 1 = photo fully obscured), not the
-- photo's own opacity.
alter table public.events
  add column if not exists image_url text,
  add column if not exists image_opacity real not null default 0.4
    check (image_opacity >= 0 and image_opacity <= 1);

-- Separate bucket from profile-photos since these are admin-managed, not
-- per-user — profile-photos' policies gate by "own folder", which doesn't
-- apply here; any admin may upload/replace/remove any event's photo.
insert into storage.buckets (id, name, public)
values ('event-photos', 'event-photos', true)
on conflict (id) do nothing;

drop policy if exists "event_photos_select_public" on storage.objects;
create policy "event_photos_select_public"
  on storage.objects for select
  using (bucket_id = 'event-photos');

drop policy if exists "event_photos_insert_admin" on storage.objects;
create policy "event_photos_insert_admin"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'event-photos'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

drop policy if exists "event_photos_update_admin" on storage.objects;
create policy "event_photos_update_admin"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'event-photos'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

drop policy if exists "event_photos_delete_admin" on storage.objects;
create policy "event_photos_delete_admin"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'event-photos'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );
