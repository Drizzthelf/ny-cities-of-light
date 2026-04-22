import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

type Props = {
  onEditProfile: () => void;
};

export function HomeScreen({ onEditProfile }: Props) {
  const { profile, signOut } = useAuth();
  const navigation = useNavigation<any>();
  const [scanCount, setScanCount] = useState<number | null>(null);
  const [checkinCount, setCheckinCount] = useState<number | null>(null);

  const loadCounts = useCallback(async () => {
    if (!profile) return;
    const [scans, checkins] = await Promise.all([
      supabase.from('scans').select('id', { count: 'exact', head: true }).eq('scanner_id', profile.id),
      supabase.from('event_checkins').select('id', { count: 'exact', head: true }).eq('user_id', profile.id),
    ]);
    setScanCount(scans.count ?? 0);
    setCheckinCount(checkins.count ?? 0);
  }, [profile]);

  useEffect(() => {
    loadCounts();
    const channel = supabase
      .channel('home-counts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scans' }, loadCounts)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_checkins' }, loadCounts)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadCounts]);

  if (!profile) return <ActivityIndicator style={{ flex: 1 }} />;

  const points =
    scanCount !== null && checkinCount !== null
      ? scanCount * 10 + checkinCount * 30
      : null;

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.greeting}>Hi, {profile.full_name.split(' ')[0]}</Text>

      <View style={styles.qrBox}>
        <QRCode value={profile.id} size={200} />
      </View>
      <Text style={styles.hint}>Let someone scan this to connect.</Text>

      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={styles.statNumber}>{scanCount ?? '—'}</Text>
          <Text style={styles.statLabel}>contacts</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <Text style={styles.statNumber}>{checkinCount ?? '—'}</Text>
          <Text style={styles.statLabel}>events</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <Text style={[styles.statNumber, styles.pointsNumber]}>{points ?? '—'}</Text>
          <Text style={styles.statLabel}>points</Text>
        </View>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.actionButton} onPress={() => navigation.navigate('Scan')}>
          <Text style={styles.actionButtonText}>Scan QR</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionButton, styles.actionButtonSecondary]} onPress={() => navigation.navigate('Contacts')}>
          <Text style={[styles.actionButtonText, styles.actionButtonTextSecondary]}>My Contacts</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity style={styles.leaderboardButton} onPress={() => navigation.navigate('Leaderboard')}>
        <Text style={styles.leaderboardButtonText}>Leaderboard</Text>
        <Text style={styles.leaderboardArrow}>›</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.editButton} onPress={onEditProfile}>
        <Text style={styles.editButtonText}>Edit profile</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.linkButton} onPress={signOut}>
        <Text style={styles.linkText}>Sign out</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', padding: 24, backgroundColor: '#fff' },
  greeting: { fontSize: 22, fontWeight: '700', marginTop: 8, marginBottom: 20 },
  qrBox: {
    padding: 18,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 16,
    backgroundColor: '#fff',
  },
  hint: { color: '#94a3b8', marginTop: 12, fontSize: 13 },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 24,
    backgroundColor: '#f8faff',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignSelf: 'stretch',
  },
  stat: { flex: 1, alignItems: 'center' },
  statDivider: { width: 1, height: 30, backgroundColor: '#e2e8f0' },
  statNumber: { fontSize: 28, fontWeight: '700', color: '#1e293b' },
  pointsNumber: { color: '#2563eb' },
  statLabel: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 20, alignSelf: 'stretch' },
  actionButton: {
    flex: 1,
    backgroundColor: '#2563eb',
    padding: 13,
    borderRadius: 10,
    alignItems: 'center',
  },
  actionButtonSecondary: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#2563eb' },
  actionButtonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  actionButtonTextSecondary: { color: '#2563eb' },
  leaderboardButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
    marginTop: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#f0f6ff',
    borderWidth: 1,
    borderColor: '#dbeafe',
  },
  leaderboardButtonText: { color: '#2563eb', fontWeight: '600', fontSize: 15 },
  leaderboardArrow: { fontSize: 20, color: '#2563eb' },
  editButton: {
    marginTop: 20,
    paddingVertical: 11,
    paddingHorizontal: 28,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  editButtonText: { color: '#475569', fontSize: 14, fontWeight: '500' },
  linkButton: { marginTop: 14 },
  linkText: { color: '#94a3b8', fontSize: 13 },
});
