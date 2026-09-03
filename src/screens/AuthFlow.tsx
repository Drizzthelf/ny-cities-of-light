import React, { useState } from 'react';
import { RegistrationCodeScreen } from './RegistrationCodeScreen';
import { WelcomeScreen } from './WelcomeScreen';
import { EmailEntryScreen } from './EmailEntryScreen';
import { OtpVerifyScreen } from './OtpVerifyScreen';
import { useAuth } from '../context/AuthContext';

export function AuthFlow() {
  const { setPendingRegistrationCode } = useAuth();
  const [code, setCode] = useState<string | null>(null);
  const [welcomed, setWelcomed] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  if (!code) {
    return (
      <RegistrationCodeScreen
        onVerified={(verified) => {
          setPendingRegistrationCode(verified);
          setCode(verified);
        }}
      />
    );
  }
  if (!welcomed) return <WelcomeScreen onContinue={() => setWelcomed(true)} />;
  if (!email) return <EmailEntryScreen onCodeSent={setEmail} />;
  return <OtpVerifyScreen email={email} onBack={() => setEmail(null)} />;
}
