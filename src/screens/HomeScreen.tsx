import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

type Props = {
  onEditProfile: () => void;
};

export function HomeScreen({ onEditProfile }: Props) {
  const { profile, signOut } = useAuth();
  const [scanCount, setScanCount] = useState<number | null>(null);

  const loadCount = useCallback(async () => {
    if (!profile) return;
    const { count } = await supabase
      .from('scans')
      .select('id', { count: 'exact', head: true })
      .eq('scanner_id', profile.id);
    setScanCount(count ?? 0);
  }, [profile]);

  useEffect(() => {
    loadCount();
    const channel = supabase
      .channel('home-scans')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'scans' },
        () => loadCount()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadCount]);

  if (!profile) return <ActivityIndicator style={{ flex: 1 }} />;

  return (
    <View style={styles.container}>
      <Text style={styles.greeting}>Hi, {profile.full_name.split(' ')[0]}</Text>

      <View style={styles.qrBox}>
        <QRCode value={profile.id} size={220} />
      </View>
      <Text style={styles.hint}>Let someone scan this to connect.</Text>

      <View style={styles.countBox}>
        <Text style={styles.countNumber}>{scanCount ?? '—'}</Text>
        <Text style={styles.countLabel}>
          {scanCount === 1 ? 'person scanned' : 'people scanned'}
        </Text>
      </View>

      <TouchableOpacity style={styles.secondaryButton} onPress={onEditProfile}>
        <Text style={styles.secondaryButtonText}>Edit profile</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.linkButton} onPress={signOut}>
        <Text style={styles.linkText}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', padding: 24, backgroundColor: '#fff' },
  greeting: { fontSize: 24, fontWeight: '700', marginTop: 12, marginBottom: 24 },
  qrBox: {
    padding: 20,
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 16,
    backgroundColor: '#fff',
  },
  hint: { color: '#666', marginTop: 14, fontSize: 14 },
  countBox: { alignItems: 'center', marginTop: 28 },
  countNumber: { fontSize: 48, fontWeight: '700', color: '#2563eb' },
  countLabel: { color: '#555', fontSize: 15 },
  secondaryButton: {
    marginTop: 28,
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2563eb',
  },
  secondaryButtonText: { color: '#2563eb', fontSize: 15, fontWeight: '600' },
  linkButton: { marginTop: 16 },
  linkText: { color: '#888', fontSize: 13 },
});
