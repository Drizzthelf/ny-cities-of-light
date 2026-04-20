import React, { useState } from 'react';
import { PhoneEntryScreen } from './PhoneEntryScreen';
import { OtpVerifyScreen } from './OtpVerifyScreen';

export function AuthFlow() {
  const [phone, setPhone] = useState<string | null>(null);

  if (!phone) return <PhoneEntryScreen onCodeSent={setPhone} />;
  return <OtpVerifyScreen phone={phone} onBack={() => setPhone(null)} />;
}
