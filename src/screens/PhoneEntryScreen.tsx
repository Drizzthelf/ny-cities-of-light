import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { supabase } from '../lib/supabase';

type Props = {
  onCodeSent: (phone: string) => void;
};

function normalizePhone(input: string): string {
  // Strip everything except digits and leading +.
  const trimmed = input.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  return hasPlus ? `+${digits}` : `+${digits}`;
}

export function PhoneEntryScreen({ onCodeSent }: Props) {
  const [phone, setPhone] = useState('');
  const [sending, setSending] = useState(false);

  async function handleSend() {
    const normalized = normalizePhone(phone);
    if (normalized.length < 8) {
      Alert.alert('Invalid phone', 'Enter a phone number in international format.');
      return;
    }
    setSending(true);
    const { error } = await supabase.auth.signInWithOtp({ phone: normalized });
    setSending(false);
    if (error) {
      Alert.alert('Could not send code', error.message);
      return;
    }
    onCodeSent(normalized);
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.title}>QR Meetup</Text>
      <Text style={styles.subtitle}>Enter your phone to get a code.</Text>
      <TextInput
        style={styles.input}
        placeholder="+15551234567"
        placeholderTextColor="#999"
        keyboardType="phone-pad"
        autoComplete="tel"
        value={phone}
        onChangeText={setPhone}
        editable={!sending}
      />
      <TouchableOpacity
        style={[styles.button, sending && styles.buttonDisabled]}
        onPress={handleSend}
        disabled={sending}
      >
        <Text style={styles.buttonText}>{sending ? 'Sending...' : 'Send code'}</Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#fff' },
  title: { fontSize: 32, fontWeight: '700', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 16, color: '#555', textAlign: 'center', marginBottom: 32 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 10,
    padding: 14,
    fontSize: 18,
    marginBottom: 16,
  },
  button: {
    backgroundColor: '#2563eb',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
