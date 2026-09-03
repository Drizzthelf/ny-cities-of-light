# Production Launch Plan — QR Meetup ("NY Cities of Light")

Status: draft — for team review
Owner: Jason Yu
Last updated: 2026-08-17
Incorporates: initial scoping email (Kaitlyn), client security/privacy review
(this doc's §3, §7, §8 reflect that feedback directly)

> **Correction (2026-09-03):** `service_requests` ("Ask the organizers") has
> since been **removed from the client entirely** — no `ServiceScreen`, no
> route in `RootNavigator.tsx`, no Admin "Msgs" tab. This was a deliberate
> decision, not a regression. Every reference to it below (§3.5, §7, §8, §9,
> §10, and the change-log entries in §0/§1) describes its state at the time
> it was written and is now historical only — do not treat it as describing
> current behavior. The `service_requests` table and its RPCs still exist in
> the database with no UI to read or manage them; nobody can currently see a
> `service_requests` row through the app. `user-to-do.txt`'s moderation-duty
> answer for this feature is likewise moot. Nothing further is planned here
> unless the feature is explicitly revived.

## 0. Where we are today

- Demo approved. Moving from a single free-tier Supabase project used for the
  demo to a real production build for App Store + Play Store release.
- One Supabase project exists so far (`QRCode`, ref `oggrlanwgmmdnvjltqel`),
  on the **Pro plan, Micro compute add-on**, created under the
  conference/org account (not personal) — this is now being run as **the
  staging environment**. A separate production project still needs to be
  created before launch (§1).
- Stack: Expo (SDK 54) + React Native + TypeScript, Supabase (Postgres, Auth,
  Storage, Realtime).
- **Auth has moved from phone OTP to email OTP** in the working tree
  (`EmailEntryScreen.tsx` / `OtpVerifyScreen.tsx`, using
  `supabase.auth.signInWithOtp({ email })`) — `PhoneEntryScreen.tsx` and the
  phone-based README instructions are now stale. This is a material change
  for the attendee-email discussion in §3.3: email is no longer just an
  allow-list detail, it's the login identifier itself.
- **Corrected finding (2026-07-21):** the app code already references
  `events`, `event_checkins`, `service_requests`, and `announcements` tables
  that don't appear in `supabase/schema.sql`. Initially assumed these were
  live, undocumented "prototype tables" (the exact risk the client flagged).
  Having now linked the CLI to the real project and run `supabase db pull`,
  this is confirmed **not** the case — those tables don't exist in the
  database at all yet. This is front-end/type-level work in progress
  (`AdminScreen.tsx`, `AnnouncementsScreen.tsx`, `types/database.ts`, etc.)
  that hasn't been backed by a real migration. Good news for the security
  posture (nothing ungoverned is live); it does mean those screens are
  currently non-functional against a real database until the schema for
  them is designed and pushed. Treat this as new-table design work (§2),
  not schema archaeology.
- **Schema/RLS gap closed (2026-08-17):** `events`, `event_checkins`,
  `service_requests`, and `announcements` are designed and pushed to staging
  (migrations `20260814000000`–`20260814000001`), along with the overdue
  `profiles` rename to `first_name`/`instagram` that the app code already
  assumed. See §1/§2/§3.1.
- **Two real bugs found and fixed while pushing this** — worth knowing about
  since they're not specific to these four tables:
  1. Staging's migration-history table falsely claimed the original baseline
     was already applied; the actual database was completely empty (every
     table 404'd via the REST API). Root cause looked like a stale
     `supabase migration repair` run whose assumption (schema already
     matched) stopped being true, possibly after a project reset. Fixed via
     `supabase migration repair --status reverted 20260721000000` then a
     real `db push`.
  2. **`authenticated` had RLS policies but no underlying Postgres `GRANT`**
     on any table in `public` — not just the four new ones, `profiles` and
     `scans` too. A signed-in user could not have read their own profile.
     Root cause: the original tables were created by hand in the Supabase
     SQL Editor (runs as `postgres`, which inherits this project's default
     privileges automatically); `supabase db push` runs migrations through
     the Management API as a different, scoped role, so that automatic
     inheritance never applied. Fixed in migration `20260817000000`. **Any
     future migration that creates a new table needs its own explicit
     `grant ... to authenticated` — this will bite again otherwise,** and
     the same needs doing on the production project once it exists.
- Added `supabase/tests/rls-smoke-test.sql` — impersonates real authenticated
  sessions (not just the anon key) inside a transaction that always rolls
  back, to verify `service_requests` is actually self/admin-only and a
  non-admin actually can't write `events`. Run before every release per
  §3.1/§9, not just once. Currently passing on staging.
- **Real bug found and fixed (2026-08-20): scans were one-sided.** When A
  scanned B's code, only A got credit — a contact and points — because
  `ContactsScreen.tsx` and the `leaderboard` view's `scan_count` both read
  purely off `scanner_id = me`, and only a `(scanner_id=A, scanned_id=B)`
  row ever got inserted. B got nothing unless B separately scanned A back,
  contradicting the intended "only one of you has to scan" design. Fixed in
  migration `20260820000000_mutual_scans.sql`: a new `security definer` RPC,
  `record_mutual_scan(p_scanned_id)`, inserts **both** directions of the
  pair atomically and idempotently (safe to call again from either side —
  e.g. if the other person scans back later anyway — without erroring or
  duplicating). The direct `scans_insert_self` policy was dropped so this
  RPC is now the only path to create a scan, same pattern as
  `create_profile_with_code`. `ContactsScreen.tsx` and the `leaderboard`
  view needed **no changes** — both already read off `scanner_id = me`,
  which is now true for both parties automatically. Verified via
  `rls-smoke-test.sql`: only A scans, then confirmed B's reciprocal row
  exists, that re-scanning from either side afterward is idempotent (no
  duplicates), and that a raw direct insert is now blocked.
- **Mutual scans replaced with a mutual accept/decline flow (2026-08-23),**
  per user decision, specifically to close a poster-farming risk the mutual
  fix above made worse: printing your own QR and having many people scan it
  instantly credited both the poster owner *and* every scanner, with no
  way to tell a real connection from a farmed one. Migration
  `20260823000000_connection_requests.sql`: a new `connection_requests`
  table (`security definer` RPCs `request_connection`/
  `respond_to_connection_request`) replaces the instant credit — scanning
  someone now sends a live request that the other person must accept
  **while both are actively in the app at that moment**. Two deliberate
  design choices, both explicit user decisions: **no push notifications**
  (the target only sees it if the app is already open — this is the
  point, not a limitation, since it requires genuine in-person presence,
  not an async approval later) and **requests expire after 2 minutes**
  unanswered (a poster can never hold a request open, since nobody's there
  to keep it alive). The lock on a pending request is **per-pair, not
  global** — A having a pending request to B doesn't block C from also
  reaching B at the same time, so normal rapid-fire scanning in a busy
  room isn't affected. `record_mutual_scan` itself was locked down
  (`revoke execute ... from authenticated`) so it's no longer directly
  callable by a client — only reachable from inside the accept path now,
  closing the obvious bypass.
  New global component `IncomingConnectionRequestListener.tsx`, mounted
  once in `RootNavigator.tsx` (not inside `ScannerScreen.tsx`) since the
  person being scanned is usually parked on their Home screen showing
  their own QR, not the scanner screen.
  **A real bug was caught by `rls-smoke-test.sql`, not just a test
  artifact** — worth remembering as a general PL/pgSQL gotcha: the first
  version of the expiry logic did `update ... set status = 'expired'`
  immediately followed by `raise exception`. When that exception is caught
  by the *caller* rather than internally, everything since the caller's
  nearest savepoint rolls back — including that update, even though it ran
  moments before. The safety property still held (an expired request could
  never be accepted), but the row silently stayed `'pending'` in the
  database forever. A first attempted fix (wrapping the update in its own
  nested exception block) also didn't work — releasing an inner savepoint
  only merges its effects into the *still-pending* enclosing scope, it
  doesn't durably commit them against a later outer rollback. Real fix
  (`20260823000003`): the function now returns the outcome as a plain
  value (`'accepted' | 'declined' | 'expired'`) instead of raising for the
  expiry case, since nothing needs to persist alongside a genuine
  authorization/not-found error, but the expiry case does. Re-verified
  with the smoke test after the fix — all checks pass, including that the
  row is now durably marked `'expired'` in the database, not just
  functionally blocked from being accepted.
  Also done in the same pass, per direct request: event check-ins now
  worth **50 points** instead of 30 (`20260823000001_event_points_50.sql`
  plus the two UI copy spots in `ScannerScreen.tsx`/`LeaderboardScreen.tsx`)
  — person-to-person connections stay at 10.

This doc turns the above, plus the client's security/privacy review, into a
concrete plan across environments, security, scalability, store compliance,
and launch/post-launch operations.

---

## 1. Environments & Supabase project setup

- [x] **Environment split decided**: the existing `QRCode` project (Pro,
      Micro compute) is staging. A separate production project still needs
      to be created before launch — same migrations get pushed to it once
      it exists (`supabase link --project-ref <prod-ref>` then
      `supabase db push`).
- [x] **CLI migration tooling scaffolded and linked.** `supabase/config.toml`
      and `supabase/migrations/` exist; `schema.sql` is now a historical
      snapshot (regenerate with `npx supabase db dump --schema public -f
      supabase/schema.sql`, don't hand-edit it). Repo is linked to the
      staging project.
- [x] **Reconciliation done — see the corrected finding in §0.** Ran
      `supabase migration repair` to mark the baseline as applied, then
      `supabase db pull` (required Docker Desktop running locally, for the
      shadow-database diff). Result: `No schema changes found` — staging's
      live schema matches `profiles`/`scans`/`leaderboard`/
      `admin_reset_scans`/storage exactly, and `events`/`event_checkins`/
      `service_requests`/`announcements` **do not exist yet**. Next step is
      designing those tables' schema + RLS from scratch (§2), not auditing
      existing policies.
- [x] Migration management workflow is now `supabase migration new <name>`
      + `supabase db push`, replacing hand-pasting into the SQL editor —
      documented in `README.md`.
- [x] `.env.staging` populated from the staging project's actual API
      settings (URL + the new-format publishable/anon key — the
      service_role key was deliberately not written anywhere in the repo).
      `.env.production.example` is ready for whenever the production
      project exists. `eas.json` added with `development` / `staging` /
      `production` build profiles wired to EAS's own environment-variable
      store via the `environment` field — **note** EAS only has three fixed
      environment slots (`development`, `preview`, `production`), so the
      `staging` build profile points at the `preview` slot.
      **EAS account created (2026-08-18)** — under Jason's personal Expo
      account (`ja123yu`), not an org account, since org credentials aren't
      available yet; transferable to an org later if that changes. Project
      linked (`eas init`, wrote `extra.eas.projectId` into `app.json`), and
      all three environment slots populated via `eas env:push` from
      `.env.staging` (same values for all three, matching the earlier
      staging=production decision — no separate `.env.production` was ever
      created). **Side effect worth knowing**: `eas init` triggered a config
      plugin evaluation that silently added `android.permission.RECORD_AUDIO`
      to `app.json` — `expo-camera`'s plugin defaults `recordAudioAndroid`
      to `true`, and this app only does barcode scanning, never records
      audio. Removed the permission and set `recordAudioAndroid: false`
      explicitly in the plugin config so it doesn't silently reappear on a
      future build (this project has no committed native folders, so
      permissions get re-derived from `app.json` + plugin config at every
      build, not just written once).
- [x] **Micro compute limits confirmed**: 60 direct database connections,
      200 pooler (Supavisor) max clients. Use these as the hard ceiling
      when load-testing peak concurrency in §4 — if modeled peak traffic
      gets close to 200 concurrent pooled clients, that's the trigger to
      upgrade compute before the event, not during it.
- [x] **PITR decision: skip for now.** Pro already includes daily backups
      with 7-day retention **at no extra cost** — PITR ($100/mo for 7-day
      retention, up to $400/mo for 28-day) only buys second-level restore
      granularity on top of that, and stops the daily backups once enabled
      (mutually exclusive, not additive). For a staging project this adds
      nothing — recreate test data instead of paying for it. Recommendation:
      revisit for the *production* project specifically, and only pay for
      it if losing up to ~24 hours of scans/check-ins during the live event
      window would be genuinely unacceptable — for most conference-app
      incidents (bad migration, accidental delete, security incident caught
      same/next day), the free daily backup already covers recovery. If the
      motivation is closer to "forensic precision during a security
      incident" than "recovery," that's a real but different argument for
      it — flag if that's the actual concern.
- [x] **`events`/`event_checkins`/`service_requests`/`announcements` designed
      and pushed to staging** (2026-08-17) — see §0 corrected finding and §2.
      Also fixed two pre-existing bugs surfaced in the process: a false
      "already applied" migration-history entry, and a missing `GRANT` for
      `authenticated` on every table (not just these four).
- [x] **Decided (2026-08-17): the `QRCode` project stays the single
      environment** — no separate production project will be created.
      "Staging" in this doc now means "the real thing." This raises the
      stakes on everything below in this section and in §3 — there is no
      longer a lower-risk environment to test config changes against first.
- [x] **Production email provider configured (2026-08-17)** — Resend, on a
      newly registered domain (required: Resend's no-domain sandbox sender
      can only deliver to the account owner's own address). Set up and
      tested working by you directly against production.
- [x] **hCaptcha site key live (2026-08-17)** — confirmed
      `EXPO_PUBLIC_HCAPTCHA_SITE_KEY` is set in both `.env` and
      `.env.staging`. App-side widget (`src/components/HCaptchaModal.tsx`,
      wired into `EmailEntryScreen.tsx`) built 2026-08-17.
      **Verified via direct probe (2026-08-17) that the dashboard's "Enable
      CAPTCHA protection" toggle is NOT yet flipped on** — `POST
      /auth/v1/otp` with no `captcha_token` still returns `200`. That's the
      *correct* current state per the required sequence (ship the app
      update to real devices first, flip the toggle after) — flagging it
      only so it's not mistaken for already-enforced. Once the app update
      has actually reached real devices, flip the toggle and re-run this
      same probe — it should then return an error about a missing/invalid
      captcha token.
- [ ] Auth rate limiting — separate from hCaptcha; still needs the "emails
      per hour" limit in Dashboard → Authentication → Rate Limits raised
      from the tiny default now that custom SMTP is live, sized against
      §4's peak-concurrency estimate.

### 1a. Account ownership & credential custody

Raised directly by the client — right now there's a single personal account
holding this.

- [x] Supabase project (staging, and production once created) is under the
      **conference/org account**, not personal.
- [x] Second admin identified and set up (Jason's personal account has admin
      access on the org).
- [ ] Same org-account treatment still needed for the **Apple Developer** and
      **Google Play Developer** accounts (§5–6) — not yet set up.
- [ ] Confirm the second admin's access actually works end to end (can log
      in, can see the project) *before* the event, not discovered missing
      during an incident — worth a quick verification once convenient,
      rather than assuming it's fine.

## 2. Data model / access-control review before real users touch it

- [x] Re-reviewed `profiles_select_all` and `scans_select_all` (2026-08-17)
      — every authenticated user can currently read **all** profiles and
      scans. Conclusion: still acceptable — scanner + leaderboard need it,
      and email lives only in `auth.users`, never in the client-readable
      `profiles` table. Keep it that way; never add an `email` column to a
      table covered by `profiles_select_all` or any other broad
      "authenticated can read all" policy.
- [x] Extended this same review to `events`, `event_checkins`,
      `service_requests`, and `announcements`, now that their RLS exists in
      version control (§1). `events`/`event_checkins`/`announcements` are
      broadly readable (by design — schedule and feed content).
      `service_requests` is **not** broadly readable: only the submitting
      user and admins can select a given row (`service_requests_select_self_or_admin`
      in migration `20260814000001`) — verified against a real impersonated
      non-admin session, not just inspected, via
      `supabase/tests/rls-smoke-test.sql`.
- [ ] If an Eventbrite-based allow-list ships, design it per §3.3 below:
      salted-hash comparison via a `security definer` RPC or Edge Function,
      not a client-readable table of plaintext emails.
- [x] **Audited (2026-08-17)** — `admin_reset_scans()` already uses
      `security definer` + explicit `is_admin` check. Every admin write
      added since (`service_requests` reply, `announcements` post/delete,
      `reports` resolve, profile delete/update) goes through RLS
      admin-only policies rather than RPCs — an equally valid version of
      the same trust boundary, still server-side, still keyed on
      `is_admin`. No admin logic found anywhere client-side-only.
- [ ] Decide the data retention story for real production use — see §7.

## 3. Security

This is the section the client flagged as most sensitive, and it now drives
the rest of the plan. Treat every unchecked item here as a launch blocker,
not a nice-to-have.

### 3.1 Row Level Security — the actual trust boundary

The anon key is meant to be public (it ships in the client bundle by
design — that part is normal for Supabase). The risk isn't the key being
readable; it's RLS being off, or on with a too-permissive policy, on any
table it protects.

- [x] RLS is enabled on **every** table in the project, including
      `events`, `event_checkins`, `service_requests`, and `announcements`
      (migrations `20260814000000`–`20260814000001`, verified live on
      staging via `supabase db dump`).
- [x] **Storage RLS tested, not just inspected (2026-08-17)** — extended
      `rls-smoke-test.sql` with two more checks: a user can upload into
      their own `profile-photos/{uid}/` folder, and cannot upload into
      another user's folder. Both pass. The new `static-pages` bucket
      (§6, account-deletion page) is intentionally fully public-read, no
      insert policy for any role — already confirmed separately via a
      direct curl of the live URL.
- [ ] Grep the built app bundle for the `service_role` key — **repo-level
      check done (2026-08-17)**, clean: `grep -rn "service_role" src/
      app.json eas.json` found nothing; the only reference anywhere is
      `supabase/functions/delete-account/index.ts`, and even there it's
      read from `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`, never
      hardcoded — the correct server-side-only context. **Still open**:
      the actual *built bundle* (EAS Build output) hasn't been grepped,
      since no build exists yet — do this once one does, as a repeatable
      pre-submission step, not a one-time assumption.
- [x] **Test it like an attacker, after every schema change**: built
      `supabase/tests/rls-smoke-test.sql` — run via
      `npx supabase db query -f supabase/tests/rls-smoke-test.sql --linked`.
      Impersonates real authenticated sessions (not just the anon key)
      inside a transaction that always rolls back, so it leaves no test
      data. Currently checks `service_requests` self/admin-only select and
      that a non-admin can't insert an `events` row; extend it as more
      tables/policies are added. Confirmed passing on staging 2026-08-17 —
      this is also where the missing-`GRANT` bug (§0) was actually caught,
      which a purely visual policy read would have missed since RLS and
      GRANTs are enforced independently and a missing GRANT just looks like
      "permission denied" regardless of how correct the policy is.
      Re-run this before every release, per the plan's own instruction here
      — it's cheap and it already found one real bug.

### 3.2 Account ownership

See §1a.

### 3.3 Attendee emails

Auth is now email-based (§0), which changes the framing from the earlier
"should we store emails at all" question:

- [ ] Supabase's own `auth.users.email` column necessarily holds the real
      email in order to send OTPs and manage sessions — that's an
      unavoidable cost of choosing email OTP as the login method, encrypted
      at rest by Supabase, and doesn't need a workaround.
- [ ] The scenario that still needs care is a **separate Eventbrite
      registrant cross-check** (verifying the signup email matches someone
      who actually registered for the event). If that ships:
        - Prefer comparing a **salted hash of the normalized email**
          (lowercased, trimmed) rather than storing/matching plaintext.
          Compute the hash server-side (Edge Function) using a secret salt
          that never reaches the client; the app sends what the user typed,
          the function normalizes + hashes it, and compares against the
          precomputed hash list from the Eventbrite export.
        - If plaintext matching turns out to be unavoidable, every
          registrant needs an explicit notice **before they sign in** that
          their registration email will be used for app access — this
          can't be buried in a privacy policy footnote.
- [ ] Either way, keep any Eventbrite-derived email/hash table out of every
      broad `select`-for-authenticated policy (§2).

### 3.4 Passwords

- [x] **Confirmed (2026-08-17)** — `grep -rni "password" src/` finds
      nothing; auth is OTP-only end to end. Keep it off the table if a
      future feature request implies adding one.

### 3.5 The "questions to admin" field

- [x] **Warning copy added (2026-08-17)** — `ServiceScreen.tsx` now shows a
      warning box between the friendly prompt and the input itself ("Not
      confidential — admins can read every message sent here. This isn't a
      channel for personal or ecclesiastical matters; for those, please
      talk to your bishop."), rendered in the list header so it's visible
      before the user ever taps into the input, not buried in a policy doc.
- [ ] Define a routing plan for questions that need a real leader's
      attention: who monitors `service_requests` during the event, how a
      message gets escalated to an actual person, and confirm that escalation
      happens (and the sensitive content is out of the database) **before**
      any post-event wipe (§7).

### 3.6 Moderation and impersonation

Nothing users submit (name, photo, hometown/background text) is validated
today. Concrete mitigations, in the order they're likely needed:

- [x] **Decided and built (2026-08-18)** — one shared registration code
      (`NYCYSACONF`), required to create a profile. Eventbrite allow-list
      (§3.3) explicitly shelved in favor of this. Migration
      `20260818000000_registration_access_code.sql`:
        - `event_access_code` singleton table (not exposed to
          `authenticated`/`anon` at all — RLS enabled, zero policies — only
          reachable from inside the function below).
        - `create_profile_with_code(p_code, p_first_name, p_photo_url)`,
          `security definer`, same pattern as `admin_reset_scans()`. Checks
          the code (case/whitespace-insensitive) before inserting a
          `profiles` row for `auth.uid()`.
        - The previously-open `profiles_insert_self` policy was **dropped**
          — a client-side-only code check would have been trivially
          bypassable by calling `.from('profiles').insert(...)` directly
          with the anon key, so the RPC had to become the *only* path to
          create a profile, not an additional gate in front of an
          already-open one. Editing an existing profile is unaffected
          (`ProfileSetupScreen.tsx` now calls `.update()` for edits instead
          of `.upsert()`, since upsert requires INSERT privilege even when
          the row already exists and only an UPDATE would actually happen).
        - Verified, not just written: extended `rls-smoke-test.sql` —
          direct profile inserts now correctly rejected, the RPC rejects a
          wrong code, accepts the right one case/whitespace-insensitively,
          and (checked live over the real REST API, not just SQL) the RPC
          rejects calls from the anon key with no real user session at all,
          even when the code is correct. All passing on production.
- [x] **Report button + admin moderation queue built (2026-08-17)** —
      `reports` table (migration `20260817200000_reports.sql`): admin-only
      read (deliberately not self-readable, unlike `service_requests` —
      confirmed via `supabase/tests/rls-smoke-test.sql`, extended with two
      new checks: reporter cannot read their own submitted report back,
      admin can). Report button added to `ScannerScreen.tsx`'s
      scanned-profile modal and each row in `ContactsScreen.tsx`
      (`src/components/ReportModal.tsx`, shared between them). New
      "Reports" tab in `AdminScreen.tsx`: queue of unresolved reports with
      reporter/reported names and reason, a "Mark resolved" action, and a
      "Delete user" shortcut that removes the reported profile directly
      from the queue (feeds the speed concern in the next line).
- [x] Admin **delete-any-profile-from-a-phone** capability — already built,
      and now also reachable directly from a report via the "Delete user"
      button above, one tap closer than going through the Users tab
      separately. **Still open**: confirm this is fast enough to use live
      during the event and that whoever's on moderation duty has admin
      access and knows how to use it — that's a real-world verification
      only you can do, added to user-to-do.txt.
- [ ] Add a **code-of-conduct acknowledgment screen on first launch** —
      not present today. Must require explicit acknowledgment (not just
      display-and-continue) before profile setup, covering: upload a photo
      of yourself only, don't impersonate anyone, don't contact people
      who've asked you to stop. Once the client's draft code of conduct /
      acceptable use policy doc is shared, base this screen's copy on it
      (see §7).
- [ ] Staff the **moderation queue for the actual event hours**, explicitly
      including Friday night and Saturday — not just business-hours/Monday
      coverage. Name who's on call and what "action within N minutes" means
      for a report during a live session.

### 3.7 Paid tier

- [x] Done — Supabase Pro + Micro compute is provisioned.
- [ ] Enable the PITR/backup options Pro unlocks (§1) — being on Pro alone
      doesn't turn these on automatically; confirm in the dashboard.
- [ ] Read the actual Pro-tier SLA and support terms rather than assuming
      parity with a generic "enterprise" expectation.

### 3.8 Camera / QR scanning

- [x] Verified in code: `ScannerScreen.tsx` uses `expo-camera`'s
      `CameraView` with `onBarcodeScanned`, which decodes QR codes on-device
      and hands back only the decoded string (`{ data }`) — no camera frame
      or image is ever uploaded. The only network calls in that handler are
      Supabase lookups keyed on the decoded UUID. Keep this invariant true
      for any future scanning feature — if a "verify this is a real photo"
      or similar feature is ever added, it would need its own explicit
      privacy review since it would change this.

### 3.9 Ongoing hygiene

- [ ] **Dependency hygiene**: run `npm audit` and set up Dependabot/Renovate
      for the Expo/RN/Supabase JS dependency tree; pin and review before
      each release build.
- [x] **Session handling — real gap found and fixed (2026-08-17).**
      `src/lib/supabase.ts` already had `autoRefreshToken: true`, but
      `AuthContext.tsx` was missing the `AppState`-driven
      `startAutoRefresh()`/`stopAutoRefresh()` pattern Supabase's own React
      Native guide calls for — without it, the refresh timer gets throttled
      while the app is backgrounded, which matters a lot for a multi-day
      event where people close the app between sessions. Added. Separately,
      "fails gracefully if profile data is wiped" is already true by
      construction: `AuthContext`'s `loadProfile` uses `.maybeSingle()` and
      falls back to `profile: null`, and `RootNavigator` routes a session
      with no profile straight to profile setup rather than crashing.
- [ ] Before submission, run this repo's `/security-review` skill against
      the final diff as an automated pass, and consider an outside/manual
      review given real PII (email, photos) is now involved.

## 4. Handling server traffic / scalability

- [x] **Estimate peak concurrency (2026-08-17)** — one correction to how
      this item was originally framed: the app never opens a direct Postgres
      or pooler connection. Every call goes through PostgREST over HTTPS,
      which maintains its own internal connection pool to Postgres (sized by
      Supabase per compute tier — not publicly documented as an exact
      number, and not something we configure). So "N concurrent app users"
      is **not** 1:1 with "N of the 60 direct / 200 pooler connections
      used." Those two limits mainly matter for direct tooling connections
      (e.g. the `supabase db push`/`db query` CLI usage in this repo).
      The two things that *do* scale directly with concurrent users:
        - **Realtime connections** — real and quantified below.
        - **Aggregate PostgREST request throughput** — real but not
          precisely documented by Supabase for Micro (2-core shared, 1GB
          RAM); see the load-test gap below for why this stays an estimate,
          not a measurement.
      No real attendance figure exists yet anywhere in this repo — the
      table below is parameterized so you can pick the row (or re-run
      `supabase/tests/leaderboard-scale-check.sql` with different numbers)
      once you have one:

      | Attendance (N) | Peak Realtime connections (≈N, if most have the app open) | vs. 500 limit | Rough REST request rate* |
      |---|---|---|---|
      | 100  | 100  | 20%  | ~1–2 req/s avg, low burst |
      | 300  | 300  | 60%  | ~4 req/s avg |
      | 500  | 500  | **at the limit** | ~7 req/s avg |
      | 1000 | 1000 | **exceeds limit** | ~14 req/s avg |

      \* assumes each attendee does ~5 scans during a 30–60 min opening
      window, ~3 requests per scan (profile lookup + duplicate check +
      insert) — i.e. `N × 15 / 1800s`. Bursts will be several times the
      average for short stretches, not a flat rate.
- [x] **Realtime usage checked (2026-08-17).** `HomeScreen`/`ScheduleScreen`/
      `NavigateScreen`/`AnnouncementsScreen` each call `.channel(...)`, but
      `supabase-js` multiplexes all of a client's channel subscriptions over
      a **single websocket** (confirmed via Supabase's Realtime docs — up to
      100 channels per connection), so each active app instance costs one
      Realtime connection, not one per screen. This project is Pro plan, so
      the limit is **500 concurrent connections** by default (10,000
      available at extra spend). Per the table above, this is the actual
      hard ceiling to watch, not the DB connection limits — **if expected
      attendance is anywhere near 500, this needs a conversation with
      Supabase support about raising it (or accepting the extra-spend tier)
      before the event, not during it.**
- [x] **Client-side backoff/retry added (2026-08-17)** —
      `src/lib/withRetry.ts`: bounded exponential backoff + jitter (3
      attempts), retrying only on network/timeout failures, never on RLS
      denials or duplicate-key conflicts (retrying those would just repeat
      them). Wired into all three call sites the plan named:
      `ScannerScreen.tsx`'s profile fetch, event fetch, scan insert, and
      event check-in insert.
- [ ] **Load test** before the event — **gap, not done.** A real load test
      needs to exercise the actual PostgREST/HTTP path (where a Micro-tier
      bottleneck would actually show up), which needs many real authenticated
      sessions. Neither option to get those is available in this session:
      the `service_role` key (deliberately never stored in this repo) for a
      script that mints sessions directly, or enough real OTP-verified test
      accounts (impractical without live email access to a mailbox this
      session can read). What *was* verified instead, safely, via SQL: see
      the index-review item below — real evidence the query patterns
      perform well at representative scale, just not the end-to-end HTTP
      path under concurrent load. If you want a true load test, the
      practical path is a short-lived local script using the `service_role`
      key (never committed) run from your machine, sized to a real
      attendance number.
- [x] **Monitoring — decided and scoped down (2026-08-20).** Full on-call/
      escalation tooling (Better Stack rotations, paging a team) was
      considered and deliberately skipped: the owner will be personally on
      the app throughout the conference, so the fast-detection and
      "who gets paged" problems that setup solves don't apply here.
      What's still worth having, and what it's *for*: a single free
      UptimeRobot monitor on the REST API endpoint, as a backup against a
      blind spot personal use can't cover — the admin's own session working
      fine doesn't mean everyone else's does. Concretely, this app hits its
      own concurrency ceilings before it would ever go fully down (the
      Realtime connection cap, the auth email rate limit) — those fail
      *some* users while the admin, already signed in, sees nothing wrong.
      Supabase's dashboard (Project → Reports: DB CPU, connections, API
      error rate) needs no setup and is worth checking before the event
      regardless. **Caveat worth remembering**: a plain uptime monitor
      checks whether the service responds, not whether a *new* user could
      actually complete signup — it would not catch the auth rate limit
      being exhausted, since GoTrue stays up and healthy even when it's
      refusing OTP sends. A monitor that tested the full signup flow would
      need its own disposable test account and would itself consume rate
      limit budget — not worth building for a one-time event.
      Setup steps in `user-to-do.txt`; needs your UptimeRobot account, the
      only step that can't be done from here.
- [x] **Upgrade path verified (2026-08-17)**, via Supabase's own compute
      add-on docs: resizing Micro → the next tier is typically **under 2
      minutes of downtime** (can be longer depending on the cloud
      provider's state at the time — not instant, don't resize *during* the
      event's peak window if avoidable). Exact resize duration isn't
      documented per-tier beyond that "usually <2 min" figure.
- [x] **Index review, with real evidence (2026-08-17)** — built
      `supabase/tests/leaderboard-scale-check.sql`: seeds 1,000 profiles /
      ~8,000 scans / ~4,000 event_checkins inside a transaction that's
      always rolled back (same safe pattern as the RLS smoke test), then
      runs `EXPLAIN ANALYZE` on the three query shapes that matter. Results
      at that scale: `event_checkins` lookup by user and `scans` lookup by
      scanner both correctly use their indexes
      (`event_checkins_user_idx`/`scans_scanner_idx`, 0.09ms/0.4ms). The
      `leaderboard` view does a sequential scan over `scans`/`event_checkins`
      inside its two aggregation subqueries — **this is the correct plan,
      not a missing index**: a `GROUP BY` over the whole table can't be
      served by a point-lookup index, and a full-table hash-aggregate is
      cheaper here regardless. Whole view (with its `LIMIT 100`) rendered in
      ~9ms. Re-run this script (bump `n_profiles`/`avg_scans_per_person`/
      `avg_checkins_per_person` at the top) once a real attendance estimate
      exists, to confirm it still holds at the real scale.

## 5. Apple App Store readiness

- [ ] Enroll in the **Apple Developer Program** ($99/yr) under the
      conference/org account (§1a), not a personal one.
- [ ] **Sign in with Apple**: required *if* the app offers a
      third-party/social login option. Email-OTP-only is generally exempt
      (it's the primary/only method), but confirm this against current App
      Review Guideline 4.8 before submission.
- [ ] **App Privacy (nutrition label)** in App Store Connect: declare data
      collected — name, email, photo, and hometown/background text — and
      whether it's linked to identity and used for tracking (it isn't —
      no ads/analytics SDKs in the dependency list; keep it that way or
      re-declare if that changes).
- [ ] **Privacy Policy URL** — required in App Store Connect metadata; use
      the client's draft once finalized (§7).
- [x] **Account deletion built (2026-08-17)**, satisfying Apple Guideline
      5.1.1(v): `supabase/functions/delete-account` (the project's first
      Edge Function) verifies the caller's own JWT, then uses `service_role`
      *only inside the function* to delete exactly that caller's
      `auth.users` row — the target id always comes from the verified JWT,
      never the request body, so this can only ever delete the caller's own
      account. Wired into `ProfileScreen.tsx` behind a destructive
      confirmation. FK cascade confirmed correct on every child table
      (`scans`/`event_checkins`/`service_requests`/`profile_socials` all
      `on delete cascade` from `profiles`; `announcements.admin_id` and
      `service_requests.replied_by` correctly `on delete set null` instead,
      so historical content doesn't vanish when its author does) — verified
      via `supabase db dump`, not assumed. Deployed to production and
      confirmed rejecting unauthenticated / non-user-session / malformed-JWT
      requests with 401. **Not yet tested**: the actual authenticated
      happy path (a real user successfully deleting their own account) —
      doing that from this session would need either a real email inbox to
      complete the OTP flow, or the `service_role` key used in a script
      (deliberately not available here). Test this for real on a throwaway
      account before relying on it for store submission.
- [ ] Permission usage strings already exist for camera
      (`NSCameraUsageDescription`) and photo library
      (`NSPhotoLibraryUsageDescription`) in `app.json` — keep them accurate
      if new permissions are added.
- [ ] Set an appropriate **age rating** and content description in App Store
      Connect.
- [ ] Build via **EAS Build** for a real iOS binary (Expo Go can't be
      submitted) and run at least one **TestFlight** internal + external
      beta round before public submission.
- [ ] Prepare required screenshots per device size class and app preview
      metadata.
- [ ] Budget review time: first-time submissions and any use of camera +
      account deletion flows can trigger manual review; don't submit at the
      deadline.

## 6. Google Play readiness

- [ ] Register a **Google Play Developer account** ($25 one-time) under the
      conference/org account (§1a).
- [ ] Complete the **Data Safety** section in Play Console, matching the
      same data inventory used for Apple's privacy label.
- [x] In-app deletion path built (2026-08-17) — see §5, same
      `delete-account` function serves both platforms.
- [x] **Web-accessible deletion URL built (2026-08-17)** —
      `supabase/static/delete-account.html`, same email-OTP flow as the app
      (no app install required, per Google's requirement), then calls the
      same `delete-account` Edge Function. **Two dead ends hit and worth
      remembering**: Supabase Edge Functions and Supabase Storage's public
      objects *both* force `Content-Type: text/plain` plus a
      `Content-Security-Policy: default-src 'none'; sandbox` on any HTML
      response — confirmed by testing, not documented anywhere obvious —
      which silently disables all JavaScript. **Supabase's own domain
      cannot serve an interactive HTML page, full stop; don't try this
      again for some other page later.** Ended up on GitHub Pages instead,
      via a `gh-pages` branch containing only this one file (deliberately
      not the existing `docs/` folder, which has this very planning doc in
      it — don't reuse that folder for anything public).
      **One step left, only you can do it** (no `gh` CLI available in this
      environment): go to the repo's Settings → Pages → Source → pick the
      `gh-pages` branch, root folder. **Note the URL will use the repo's
      *current* name, not `qr-meetup`** — GitHub reported this repo was
      renamed to `ny-cities-of-light` at some point (old git remote URL
      still redirects fine, nothing broken, just surfacing it since it
      changes the actual URL). Once Pages is enabled, the URL to put in
      Play Console's Data Safety form will be
      `https://drizzthelf.github.io/ny-cities-of-light/`. Like the in-app
      flow, the actual authenticated happy path isn't tested end-to-end yet
      (same limitation: no real inbox / no `service_role` key here) — test
      it for real once Pages is live.
- [ ] Confirm **target API level** meets Play's current minimum requirement
      at time of submission.
- [ ] Declare the `CAMERA` permission's purpose in Play Console (already
      declared in `app.json`'s `android.permissions`).
- [ ] Same **Privacy Policy URL** requirement as Apple.
- [ ] Use a **closed/internal testing track** before promoting to production.
- [ ] Build via **EAS Build** for Android (AAB format) — same pipeline as
      iOS.

## 7. Legal / privacy documentation

- [ ] **Incorporate the client's draft Privacy Policy and draft Code of
      Conduct / Acceptable Use Policy** — referenced in their review email
      but not actually attached to the message text received here. Get the
      actual documents (files or pasted text) and drop them into
      `docs/privacy-policy.md` and `docs/code-of-conduct.md`, then revise
      for tone as invited. Until then, treat §5/§6's Privacy Policy URL and
      §3.6's code-of-conduct screen as blocked on receiving these.
- [ ] Once drafted/finalized, the Privacy Policy needs to explicitly cover:
      data collected (name, email, photo, hometown/background,
      questions submitted to admin), that email is used both for login and
      (if the allow-list ships) for Eventbrite-registration matching per
      §3.3, that profile content is unverified, and the retention/deletion
      policy below.
- [ ] Write down the **data retention policy** explicitly now that this is a
      recurring/real app rather than a one-off demo: does data get wiped
      after each event, kept for repeat attendees across events, or
      retained until a user deletes their account? This decision drives the
      account-deletion flow design in §5/§6 and the Privacy Policy language.
      If wiping, take a backup first in case of disputes, and confirm
      `service_requests` needing human follow-up (§3.5) are extracted first.
- [ ] Confirm no under-13 users are expected (COPPA) — if the event's
      audience could include minors, this needs explicit handling.
- [ ] If attendees may be outside the US, do a light pass on GDPR/CCPA
      applicability (right to access/delete — likely satisfied by the
      account-deletion work above).

## 8. Feature work still needed for store compliance / event readiness

- [x] In-app **account deletion** flow built (2026-08-17) — see §5.
- [x] **Report button** on profiles + admin report queue built (2026-08-17)
      — see §3.6.
- [ ] **Code-of-conduct acknowledgment screen** on first launch, gating
      profile setup (§3.6) — blocked on receiving the client's draft copy
      (§7).
- [x] **In-field warning copy** on the "ask the organizers" input built
      2026-08-17 — see §3.5.
- [x] Design and migrate `events`/`event_checkins`/`service_requests`/
      `announcements` — done 2026-08-17, see §0/§1/§2.
- [x] **hCaptcha React Native integration built** (2026-08-17) — custom
      WebView modal (`src/components/HCaptchaModal.tsx`), not the
      unusable-in-RN `@hcaptcha/react-hcaptcha` web package. Wired into
      `EmailEntryScreen.tsx`, gated behind `EXPO_PUBLIC_HCAPTCHA_SITE_KEY`
      so it's inert until that's set. **Remaining sequence, in order:**
      (1) create the hCaptcha site/keys, (2) set the site key in
      `.env`/`.env.staging`/`.env.production` and the secret key in the
      Supabase dashboard, (3) build and ship that app update to real
      devices, (4) only then flip "Enable CAPTCHA protection" in the
      dashboard. Flipping it before step 3 reaches real users locks
      everyone out immediately.
- [x] **Attendee access code** flow decided and built (2026-08-18) — see
      §3.6. Solves same-day walk-up registration too: whoever's handling
      walk-ups just hands out the same code, no sync dependency.
- [ ] ~~**Eventbrite sync**~~ — shelved (2026-08-18) in favor of the
      registration code above. Original plan kept below for reference in
      case this gets revisited: keep attendee allow-list current so late
      registrants aren't locked out; design as a scheduled Edge
      Function/webhook using the salted-hash approach in §3.3, not a
      client-side call (needs the Eventbrite API key server-side only).
- [ ] Same-day / walk-up registration path that doesn't depend on the
      Eventbrite sync having already run.
- [x] **Remove the "Reset all scans" admin button** — done (2026-09-03).
      Button and its `confirmResetScans` handler removed from
      `AdminScreen.tsx`'s Users tab.

## 9. Testing plan

- [ ] Device matrix: at least one recent iOS device + one Android device,
      plus the lowest OS version you intend to support.
- [ ] Full user-journey test: email signup → OTP → profile setup (with and
      without photo) → code-of-conduct acknowledgment → scan flow (note:
      `expo-camera` doesn't work in Expo Go on iOS — needs a dev build) →
      event check-in → leaderboard → service request → report flow → admin
      flows → account deletion.
- [ ] Run the **anon-key attacker test** (§3.1) against staging as a
      required pre-release step, not just once.
- [ ] Load test against staging per §4 before the event, not just before
      store submission.
- [ ] TestFlight (iOS) + closed testing track (Android) with a handful of
      real external testers before production release.

## 10. Post-launch operations

- [ ] Monitoring dashboard/alerting live for the event window (§4).
- [ ] Documented on-call/escalation for the event day itself, **including a
      named moderation contact for Friday night and Saturday** specifically
      (§3.6) — not just business-hours coverage.
- [ ] Post-event data handling executed per the retention policy in §7
      (wipe/export/retain as decided) — extract any `service_requests` that
      need real follow-up first (§3.5), and take a backup before wiping in
      case of disputes.
- [ ] Decide whether the app stays live between events or gets pulled from
      the stores and resubmitted each time — resubmission has review-time
      cost, staying live has ongoing Supabase Pro + store account cost.

---

## Suggested sequencing

1. **Schema/RLS reconciliation** (§1, §2, §3.1) — the `events` /
   `service_requests` / `announcements` gap is the top priority; nothing
   else in the security section can be verified until this is done.
2. Security hardening (§3.2–3.9) in parallel with account-deletion,
   report/moderation, and code-of-conduct feature work (§8), since they
   touch overlapping schema/UI.
3. Store compliance prep (§5–7) — developer org accounts and the privacy
   policy/code-of-conduct docs can start as soon as they're received from
   the client, in parallel with feature work.
4. Load testing + monitoring (§4) once staging has the real, reconciled
   schema and policies.
5. Beta testing (§9) → submission (§5–6) → launch (§10).
