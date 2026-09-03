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
import { useTheme } from '../context/ThemeContext';
import { fonts, type ColorScheme } from '../theme';

type Props = {
  email: string;
  onBack: () => void;
};

export function OtpVerifyScreen({ email, onBack }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);

  async function handleVerify() {
    if (code.length < 4) {
      Alert.alert('Invalid code', 'Enter the code you received.');
      return;
    }
    setVerifying(true);
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
    setVerifying(false);
    if (error) {
      Alert.alert('Verification failed', error.message);
      return;
    }
    // AuthContext listens to auth state changes and will route us forward.
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.title}>Enter code</Text>
      <Text style={styles.subtitle}>We sent a code to {email}.</Text>
      <TextInput
        style={styles.input}
        placeholder="123456"
        placeholderTextColor={colors.textFaint}
        keyboardType="number-pad"
        value={code}
        onChangeText={setCode}
        editable={!verifying}
        maxLength={8}
      />
      <TouchableOpacity
        style={[styles.button, verifying && styles.buttonDisabled]}
        onPress={handleVerify}
        disabled={verifying}
      >
        <Text style={styles.buttonText}>{verifying ? 'Verifying...' : 'Verify'}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.linkButton} onPress={onBack} disabled={verifying}>
        <Text style={styles.linkText}>Use a different email</Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

function getStyles(colors: ColorScheme) {
  return StyleSheet.create({
    container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: colors.background },
    title: { fontSize: 30, fontFamily: fonts.title, color: colors.text, textAlign: 'center', marginBottom: 8 },
    subtitle: { fontSize: 15, color: colors.textMuted, textAlign: 'center', marginBottom: 28 },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      padding: 14,
      fontSize: 22,
      letterSpacing: 4,
      textAlign: 'center',
      marginBottom: 16,
      color: colors.text,
      backgroundColor: colors.surface,
    },
    button: { backgroundColor: colors.primary, padding: 14, borderRadius: 10, alignItems: 'center' },
    buttonDisabled: { opacity: 0.6 },
    buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
    linkButton: { marginTop: 16, alignItems: 'center' },
    linkText: { color: colors.primary, fontSize: 14 },
  });
}
