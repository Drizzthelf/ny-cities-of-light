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
  onVerified: (code: string) => void;
};

export function RegistrationCodeScreen({ onVerified }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);

  async function handleContinue() {
    const trimmed = code.trim();
    if (!trimmed) {
      Alert.alert('Missing code', 'Enter the registration code from conference staff.');
      return;
    }
    setChecking(true);
    const { data, error } = await supabase.rpc('verify_event_access_code', { p_code: trimmed });
    setChecking(false);
    if (error) {
      Alert.alert('Could not verify code', error.message);
      return;
    }
    if (!data) {
      Alert.alert('Incorrect code', 'Check with conference staff and try again.');
      return;
    }
    onVerified(trimmed);
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.title}>QR Meetup</Text>
      <Text style={styles.subtitle}>Enter the registration code from conference staff to get started.</Text>
      <TextInput
        style={styles.input}
        value={code}
        onChangeText={setCode}
        placeholder="Registration code"
        placeholderTextColor={colors.textFaint}
        autoCapitalize="characters"
        autoCorrect={false}
        editable={!checking}
      />
      <TouchableOpacity
        style={[styles.button, checking && styles.buttonDisabled]}
        onPress={handleContinue}
        disabled={checking}
      >
        <Text style={styles.buttonText}>{checking ? 'Checking...' : 'Continue'}</Text>
      </TouchableOpacity>
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
