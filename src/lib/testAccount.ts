// Fixed demo account for Apple/Google App Review testers — credentials are
// in the App Store Connect / Play Console review notes, not in this repo.
// This one address always verifies via the server-checked fixed code in
// supabase/functions/verify-test-account instead of a real emailed OTP; see
// EmailEntryScreen.tsx and OtpVerifyScreen.tsx.
export const TEST_ACCOUNT_EMAIL = 'applereview@nycitiesoflight.app';
