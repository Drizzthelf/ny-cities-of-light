import React, { useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { HCaptchaModal, HCAPTCHA_ENABLED } from '../components/HCaptchaModal';
import { useTheme } from '../context/ThemeContext';
import { fonts, type ColorScheme } from '../theme';
import { TEST_ACCOUNT_EMAIL } from '../lib/testAccount';

type Props = {
  onCodeSent: (email: string) => void;
};

export function EmailEntryScreen({ onCodeSent }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [showCaptcha, setShowCaptcha] = useState(false);

  async function sendCode(normalized: string, captchaToken?: string) {
    setSending(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: normalized,
      options: captchaToken ? { captchaToken } : undefined,
    });
    setSending(false);
    if (error) {
      Alert.alert('Could not send code', error.message);
      return;
    }
    onCodeSent(normalized);
  }

  async function handleSend() {
    const normalized = email.trim().toLowerCase();
    if (!normalized.includes('@')) {
      Alert.alert('Invalid email', 'Enter a valid email address.');
      return;
    }
    // App Review demo account: no real OTP is ever sent for this address —
    // OtpVerifyScreen verifies its fixed code against the server instead.
    if (normalized === TEST_ACCOUNT_EMAIL) {
      onCodeSent(normalized);
      return;
    }
    if (HCAPTCHA_ENABLED) {
      setShowCaptcha(true);
      return;
    }
    await sendCode(normalized);
  }

  function handleCaptchaToken(token: string) {
    setShowCaptcha(false);
    sendCode(email.trim().toLowerCase(), token);
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.title}>QR Meetup</Text>
      <Text style={styles.subtitle}>Enter your email to get a code.</Text>
      <TextInput
        style={styles.input}
        placeholder="you@example.com"
        placeholderTextColor={colors.textFaint}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        value={email}
        onChangeText={setEmail}
        editable={!sending}
      />
      <TouchableOpacity
        style={[styles.button, sending && styles.buttonDisabled]}
        onPress={handleSend}
        disabled={sending}
      >
        <Text style={styles.buttonText}>{sending ? 'Sending...' : 'Send code'}</Text>
      </TouchableOpacity>
      <HCaptchaModal
        visible={showCaptcha}
        onToken={handleCaptchaToken}
        onClose={() => setShowCaptcha(false)}
      />
    </KeyboardAvoidingView>
  );
}

function getStyles(colors: ColorScheme) {
  return StyleSheet.create({
    container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: colors.background },
    title: { fontSize: 36, fontFamily: fonts.title, color: colors.text, textAlign: 'center', marginBottom: 8 },
    subtitle: { fontSize: 16, color: colors.textMuted, textAlign: 'center', marginBottom: 32 },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      padding: 14,
      fontSize: 18,
      marginBottom: 16,
      color: colors.text,
      backgroundColor: colors.surface,
    },
    button: {
      backgroundColor: colors.primary,
      padding: 14,
      borderRadius: 10,
      alignItems: 'center',
    },
    buttonDisabled: { opacity: 0.6 },
    buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  });
}
