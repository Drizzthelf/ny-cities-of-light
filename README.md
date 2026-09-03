# QR Meetup

A React Native + Expo app for an event: each person gets a QR code; scanning someone else's QR adds them as a contact. Includes contacts list, leaderboard, and admin controls.

## Stack
- Expo (SDK 54) + React Native + TypeScript
- Supabase (auth, Postgres, storage, realtime)
- Email OTP auth, persistent session (migrated from phone OTP — old
  `PhoneEntryScreen.tsx` is stale, see `docs/production-launch-plan.md`)
- QR encodes the user's UUID only — latest profile is fetched on scan

## Environments

There are (or should be) three Supabase projects:

| Environment | Purpose                                   | `.env` file          |
|--------------|--------------------------------------------|----------------------|
| local/dev    | your own sandbox, free tier is fine        | `.env`               |
| staging      | pre-release testing, mirrors prod schema   | `.env.staging`        |
| production   | real attendee data — Pro plan, Micro compute | `.env.production`   |

Never point `.env.production` at anything but the real production project,
and never run destructive testing (load tests, RLS attack tests, schema
experiments) against it — use staging for that.

## Setup

### 1. Supabase project (schema is now CLI-managed)

Schema changes are managed with the Supabase CLI under `supabase/migrations/`
— `supabase/schema.sql` is now a historical snapshot only, not something to
hand-paste into the SQL editor. To stand up a new project (staging or
production):

1. Go to https://supabase.com and create the project.
2. Authenticate the CLI once: `npx supabase login` (opens a browser).
3. Link this repo to that project: `npx supabase link --project-ref <ref>`
   (the ref is in the project's dashboard URL / Project Settings → General).
4. Apply all migrations: `npx supabase db push`.
5. Open **Authentication → Providers → Email** and confirm it's enabled
   (this is the current auth method — not Phone/SMS).
6. Open **Project Settings → API** and copy:
   - `Project URL`
   - `anon public` key

To pull down whatever's *already* live in a project (e.g. to check an
existing project for drift from the migrations folder), use
`npx supabase db pull` instead of step 4 — it generates a new migration file
capturing anything not yet represented locally.

### 2. Make yourself an admin

After you sign up once through the app, run this in the Supabase SQL editor (replace the email):

```sql
update public.profiles
set is_admin = true
where id = (select id from auth.users where email = 'you@example.com');
```

### 3. Configure the app

Create a `.env` file in the project root for local dev (see `.env.example`),
or `.env.staging` / `.env.production` for those environments (see
`.env.staging.example` / `.env.production.example`):

```
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

### 4. Run it

```bash
npm install
npx expo start
```

Scan the QR code in the terminal with the **Expo Go** app (iOS App Store / Android Play Store) on your phone, or press `a` / `i` to launch an emulator.

> **Note:** `expo-camera` works in Expo Go on Android but not on iOS — for iOS testing you'll need a dev build (`npx expo run:ios`, requires macOS + Xcode) or deploy via EAS Build.

## Project layout

```
qr-meetup/
├── App.tsx                      # Root — wraps AuthProvider + navigator
├── app.json                     # Expo config (camera/photo permission text)
├── supabase/schema.sql          # Tables, RLS, view, RPC, storage bucket
└── src/
    ├── lib/supabase.ts          # Supabase client (uses AsyncStorage)
    ├── context/AuthContext.tsx  # Session + profile state
    ├── navigation/RootNavigator.tsx
    ├── types/database.ts
    └── screens/
        ├── AuthFlow.tsx         # Phone → OTP
        ├── PhoneEntryScreen.tsx
        ├── OtpVerifyScreen.tsx
        ├── ProfileSetupScreen.tsx  # Also used for edit
        ├── HomeScreen.tsx       # Your QR + scan count
        ├── ScannerScreen.tsx    # Camera + add-contact modal
        ├── ContactsScreen.tsx
        ├── LeaderboardScreen.tsx
        └── AdminScreen.tsx
```

## Data model

- **profiles** — one row per user, linked to `auth.users`. Fields: full_name, background, hometown, photo_url, phone, is_admin.
- **scans** — `(scanner_id, scanned_id)` with a unique constraint so duplicate scans don't inflate counts.
- **leaderboard** (view) — profiles with a `scan_count` aggregate.
- **admin_reset_scans()** (RPC) — wipes all scans; callable only by admins.

Row-level security is on everywhere:
- Authenticated users can read all profiles + scans (needed for scanner + leaderboard).
- Users can only insert/update their own profile and insert scans where they are the scanner.
- Only admins can delete profiles, delete scans, or update others' profiles.

## Admin capabilities

Users with `is_admin = true` get an extra "Admin" tab showing:
- All profiles with Edit (name, background, hometown, admin flag) and Delete.
- A **Reset all scans** button that calls the `admin_reset_scans` RPC.
