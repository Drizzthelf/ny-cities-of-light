// Fixed-code sign-in for the single Apple/Google App Review demo account
// (src/lib/testAccount.ts TEST_ACCOUNT_EMAIL). Real users always go through
// GoTrue's normal signInWithOtp/verifyOtp (EmailEntryScreen.tsx,
// OtpVerifyScreen.tsx) — this function only ever mints a session for that
// one pre-created, pre-approved-admin account, and only when the caller
// supplies the code stored in this function's TEST_ACCOUNT_CODE secret
// (set via `supabase secrets set`, never committed to the repo).
//
// Rate-limited via public.test_account_rate_limit (a service-role-only
// singleton row) rather than an in-memory counter, since edge function
// instances aren't guaranteed to stay warm between requests — an in-memory
// counter would reset on every cold start and do nothing to stop a
// 6-digit code from being brute-forced against a live admin account.

import { createClient } from 'npm:@supabase/supabase-js@2';

const MAX_FAILURES = 8;
const LOCKOUT_MS = 15 * 60 * 1000;

Deno.serve(async (req) => {
  try {
    const { email, code } = await req.json();
    const expectedEmail = Deno.env.get('TEST_ACCOUNT_EMAIL');
    const expectedCode = Deno.env.get('TEST_ACCOUNT_CODE');
    if (!expectedEmail || !expectedCode) {
      return json({ error: 'Test account not configured' }, 500);
    }
    if (
      typeof email !== 'string' ||
      typeof code !== 'string' ||
      email.trim().toLowerCase() !== expectedEmail.toLowerCase()
    ) {
      return json({ error: 'Invalid credentials' }, 401);
    }

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: limitRow } = await adminClient
      .from('test_account_rate_limit')
      .select('fail_count, locked_until')
      .eq('id', true)
      .single();

    const now = Date.now();
    if (limitRow?.locked_until && new Date(limitRow.locked_until).getTime() > now) {
      return json({ error: 'Too many attempts. Try again later.' }, 429);
    }

    if (code.trim() !== expectedCode) {
      const failCount = (limitRow?.fail_count ?? 0) + 1;
      const lockedOut = failCount >= MAX_FAILURES;
      await adminClient
        .from('test_account_rate_limit')
        .update({
          fail_count: lockedOut ? 0 : failCount,
          locked_until: lockedOut ? new Date(now + LOCKOUT_MS).toISOString() : null,
        })
        .eq('id', true);
      return json({ error: 'Invalid credentials' }, 401);
    }

    // Reset on success so a genuine reviewer isn't penalized by earlier typos.
    await adminClient
      .from('test_account_rate_limit')
      .update({ fail_count: 0, locked_until: null })
      .eq('id', true);

    // No password/OTP flow fits a server-minted session, so borrow GoTrue's
    // magic-link machinery purely as a session-issuing primitive: generate a
    // link token for the pre-created account, then immediately redeem it
    // ourselves instead of emailing it anywhere.
    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: 'magiclink',
      email: expectedEmail,
    });
    if (linkError || !linkData) {
      return json({ error: linkError?.message ?? 'Could not generate session' }, 500);
    }

    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!
    );
    const { data: sessionData, error: verifyError } = await anonClient.auth.verifyOtp({
      token_hash: linkData.properties.hashed_token,
      type: 'magiclink',
    });
    if (verifyError || !sessionData.session) {
      return json({ error: verifyError?.message ?? 'Could not create session' }, 500);
    }

    return json({
      access_token: sessionData.session.access_token,
      refresh_token: sessionData.session.refresh_token,
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
