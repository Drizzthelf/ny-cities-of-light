import React, { useState } from 'react';
import { EmailEntryScreen } from './EmailEntryScreen';
import { OtpVerifyScreen } from './OtpVerifyScreen';

export function AuthFlow() {
  const [email, setEmail] = useState<string | null>(null);

  if (!email) return <EmailEntryScreen onCodeSent={setEmail} />;
  return <OtpVerifyScreen email={email} onBack={() => setEmail(null)} />;
}
