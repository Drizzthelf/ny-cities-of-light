-- Reconciles public.profiles with the app code, which already uses
-- first_name/instagram (ProfileSetupScreen.tsx, AdminScreen.tsx,
-- LeaderboardScreen.tsx) instead of the original full_name/background/
-- hometown/phone columns. See docs/production-launch-plan.md §0.

alter table public.profiles
  rename column full_name to first_name;

alter table public.profiles
  add column if not exists instagram text;

alter table public.profiles
  drop column if exists background,
  drop column if exists hometown,
  drop column if exists phone;
