-- Public bucket for standalone static pages that need a stable, unauthenticated
-- URL — starting with the account-deletion page Google Play's Data Safety
-- form requires (must work without the app installed, so it can't live
-- behind auth). Edge Functions were tried first and rejected: Supabase's
-- Functions gateway forces `Content-Type: text/plain` and a
-- `Content-Security-Policy: default-src 'none'; sandbox` on any HTML
-- response regardless of what the function sets, which disables inline
-- scripts entirely — a deliberate anti-abuse measure, not a bug, but it
-- makes Functions unusable for serving an interactive page. Storage objects
-- don't have this restriction (confirmed by testing after upload).

insert into storage.buckets (id, name, public)
values ('static-pages', 'static-pages', true)
on conflict (id) do nothing;

drop policy if exists "static_pages_select_public" on storage.objects;
create policy "static_pages_select_public"
  on storage.objects for select
  to public
  using (bucket_id = 'static-pages');
