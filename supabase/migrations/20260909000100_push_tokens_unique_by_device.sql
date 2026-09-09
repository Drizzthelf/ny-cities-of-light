-- push_tokens was unique on (user_id, token), not token alone. An Expo
-- push token identifies a physical device/install, not an account, so
-- every time someone signed out and back in as a different test account
-- on the same device, the old (user_id, token) row was left behind
-- instead of being reassigned -- the device just accumulated one row per
-- account it had ever been signed into. notify-double-points (and the
-- other notify-* functions) select every row with no dedup, so a single
-- physical device with N stale rows gets pushed to N times for one event.
-- Confirmed directly: one device had 4 rows (Sept 1/3/3/5), all the same
-- token under 4 different user_ids, and got 4 copies of one push.

-- Keep only the newest row per token before tightening the constraint --
-- can't add a unique index over duplicates.
delete from public.push_tokens a
  using public.push_tokens b
  where a.token = b.token
    and a.created_at < b.created_at;

alter table public.push_tokens drop constraint if exists push_tokens_user_id_token_key;
alter table public.push_tokens add constraint push_tokens_token_key unique (token);
