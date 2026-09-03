import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Avatar } from './Avatar';
import type { Profile } from '../types/database';
import { fonts, type ColorScheme } from '../theme';

// Matches the server-side expiry in
// supabase/migrations/20260823000000_connection_requests.sql. Mounted once,
// globally (see RootNavigator.tsx) — not inside ScannerScreen — because the
// person being scanned is usually sitting on their Home screen showing
// their own QR, not on the scanner screen themselves.
const EXPIRY_MS = 2 * 60 * 1000;

export function IncomingConnectionRequestListener() {
  const { profile } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [requester, setRequester] = useState<Profile | null>(null);
  const [responding, setResponding] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!profile) return;

    // See HomeScreen.tsx's double-points-windows effect for why this guard
    // exists — a fast unmount/remount can hand back an already-subscribed
    // channel of the same topic, and calling .on() on it throws.
    supabase
      .getChannels()
      .filter((c) => c.topic === 'realtime:incoming-connection-requests')
      .forEach((c) => supabase.removeChannel(c));

    const channel = supabase
      .channel('incoming-connection-requests')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'connection_requests', filter: `target_id=eq.${profile.id}` },
        async (payload) => {
          const row = payload.new as { id: string; requester_id: string };
          const { data } = await supabase
            .from('profiles')
            .select('*, profile_socials(*)')
            .eq('id', row.requester_id)
            .maybeSingle();
          setRequester((data as Profile) ?? null);
          setRequestId(row.id);
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          // Client-side mirror of the server's 2-minute TTL, so the popup
          // doesn't sit there forever if nobody taps anything — the server
          // is still the source of truth (respond_to_connection_request
          // re-checks expiry itself), this just clears the local UI.
          timeoutRef.current = setTimeout(() => {
            setRequestId(null);
            setRequester(null);
          }, EXPIRY_MS);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [profile]);

  async function respond(accept: boolean) {
    if (!requestId) return;
    setResponding(true);
    const { data, error } = await supabase.rpc('respond_to_connection_request', {
      p_request_id: requestId,
      p_accept: accept,
    });
    setResponding(false);
    if (error) {
      Alert.alert(accept ? 'Could not accept' : 'Could not decline', error.message);
    } else if (accept && data === 'expired') {
      // Rare edge case: the tap landed right as the 2-minute window closed —
      // the RPC round-trip itself pushed it past expiry.
      Alert.alert('Request expired', 'This request just expired — ask them to scan again.');
    }
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setRequestId(null);
    setRequester(null);
  }

  return (
    <Modal visible={!!requestId} transparent animationType="slide" onRequestClose={() => respond(false)}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Avatar photoUrl={requester?.photo_url} name={requester?.first_name} size={90} style={styles.photo} />
          <Text style={styles.title}>{requester?.first_name ?? 'Someone'} wants to connect</Text>
          <Text style={styles.sub}>+10 pts for both of you if you accept.</Text>
          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.button, styles.declineButton]}
              onPress={() => respond(false)}
              disabled={responding}
            >
              <Text style={styles.declineText}>Decline</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.acceptButton]}
              onPress={() => respond(true)}
              disabled={responding}
            >
              <Text style={styles.acceptText}>{responding ? '...' : 'Accept'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function getStyles(colors: ColorScheme) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', alignItems: 'center' },
    card: {
      width: '85%',
      backgroundColor: colors.surface,
      borderRadius: 20,
      padding: 24,
      alignItems: 'center',
    },
    photo: { marginBottom: 14 },
    title: { fontSize: 21, fontFamily: fonts.title, color: colors.text, textAlign: 'center' },
    sub: { fontSize: 13, color: colors.primary, fontWeight: '600', marginTop: 8 },
    buttonRow: { flexDirection: 'row', gap: 10, marginTop: 20, alignSelf: 'stretch' },
    button: { flex: 1, paddingVertical: 13, borderRadius: 10, alignItems: 'center' },
    declineButton: { backgroundColor: colors.borderLight },
    declineText: { color: colors.textMuted, fontWeight: '600', fontSize: 15 },
    acceptButton: { backgroundColor: colors.primary },
    acceptText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  });
}
