# QR Meetup

A React Native + Expo app for an event: each person gets a QR code; scanning someone else's QR adds them as a contact. Includes contacts list, leaderboard, and admin controls.

## Stack
- Expo (SDK 54) + React Native + TypeScript
- Supabase (auth, Postgres, storage, realtime)
- Phone OTP auth, persistent session
- QR encodes the user's UUID only — latest profile is fetched on scan

## Setup

### 1. Supabase project

1. Go to https://supabase.com and create a new project (free tier is fine).
2. Once created, open **SQL editor** and run the contents of `supabase/schema.sql`.
3. Open **Authentication → Providers → Phone** and enable it. You'll need an SMS provider:
   - **Twilio** (easiest): sign up at twilio.com, get an Account SID + Auth Token + Messaging Service SID, paste into Supabase.
   - **MessageBird / Vonage / Textlocal** also supported.
   - For dev-only testing, Supabase lets you configure a static OTP (set in **Authentication → Providers → Phone → Test OTP**) so you don't need to wire up SMS.
4. Open **Project Settings → API** and copy:
   - `Project URL`
   - `anon public` key

### 2. Make yourself an admin

After you sign up once through the app, run this in the Supabase SQL editor (replace the phone number):

```sql
update public.profiles
set is_admin = true
where phone = '+15551234567';
```

### 3. Configure the app

Create a `.env` file in the project root (see `.env.example`):

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
