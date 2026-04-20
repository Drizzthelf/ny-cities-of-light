import React, { useState } from 'react';
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

type Props = {
  phone: string;
  onBack: () => void;
};

export function OtpVerifyScreen({ phone, onBack }: Props) {
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);

  async function handleVerify() {
    if (code.length < 4) {
      Alert.alert('Invalid code', 'Enter the code you received.');
      return;
    }
    setVerifying(true);
    const { error } = await supabase.auth.verifyOtp({ phone, token: code, type: 'sms' });
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
      <Text style={styles.subtitle}>We sent a code to {phone}.</Text>
      <TextInput
        style={styles.input}
        placeholder="123456"
        placeholderTextColor="#999"
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
        <Text style={styles.linkText}>Use a different number</Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#fff' },
  title: { fontSize: 28, fontWeight: '700', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 15, color: '#555', textAlign: 'center', marginBottom: 28 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 10,
    padding: 14,
    fontSize: 22,
    letterSpacing: 4,
    textAlign: 'center',
    marginBottom: 16,
  },
  button: { backgroundColor: '#2563eb', padding: 14, borderRadius: 10, alignItems: 'center' },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  linkButton: { marginTop: 16, alignItems: 'center' },
  linkText: { color: '#2563eb', fontSize: 14 },
});
