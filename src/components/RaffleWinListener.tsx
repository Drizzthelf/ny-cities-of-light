import React, { useEffect, useMemo, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import type { RafflePrize } from '../types/database';
import { fonts, type ColorScheme } from '../theme';

// Global, mounted once (see RootNavigator.tsx) — not the RaffleScreen, since
// a win should surface wherever the winner happens to be in the app, not
// only if they happen to open the Raffle tab. This is intentionally a
// single-purpose "you won" notice, not a revival of the general messaging
// feature that was removed — it only ever reads/writes the one prize row
// naming this user as winner_id.
export function RaffleWinListener() {
  const { profile } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const [queue, setQueue] = useState<RafflePrize[]>([]);

  async function checkForWins() {
    if (!profile) return;
    const { data } = await supabase
      .from('raffle_prizes')
      .select('*')
      .eq('winner_id', profile.id)
      .eq('winner_seen', false);
    if (data && data.length) setQueue(data as RafflePrize[]);
  }

  useEffect(() => {
    if (!profile) return;
    checkForWins();

    // See HomeScreen.tsx's double-points-windows effect for why this guard
    // exists — a fast unmount/remount can hand back an already-subscribed
    // channel of the same topic, and calling .on() on it throws.
    supabase
      .getChannels()
      .filter((c) => c.topic === 'realtime:raffle-win-listener')
      .forEach((c) => supabase.removeChannel(c));

    const channel = supabase
      .channel('raffle-win-listener')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'raffle_prizes', filter: `winner_id=eq.${profile.id}` },
        (payload) => {
          const row = payload.new as RafflePrize;
          if (!row.winner_seen) {
            setQueue((prev) => (prev.some((p) => p.id === row.id) ? prev : [...prev, row]));
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
    // profile?.id, not profile — refreshProfile() (called on every Profile
    // tab focus) hands back a brand-new profile object each time even when
    // nothing changed. Depending on the whole object tore this down and
    // re-subscribed + re-polled on every such refresh, and if that repoll
    // landed in the gap between dismiss()'s optimistic local clear and its
    // ack_raffle_win RPC actually committing server-side, it would refetch
    // the still-winner_seen=false row and show the "You won" modal a second
    // time right after it had just been dismissed. Keying on the id keeps
    // this effect stable across those refreshes and only rerun on a real
    // sign-in/out.
  }, [profile?.id]);

  async function dismiss() {
    const current = queue[0];
    if (!current) return;
    setQueue((prev) => prev.slice(1));
    await supabase.rpc('ack_raffle_win', { p_prize_id: current.id });
  }

  const current = queue[0] ?? null;

  return (
    <Modal visible={!!current} transparent animationType="fade" onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.emoji}>🎉</Text>
          <Text style={styles.title}>You won!</Text>
          <Text style={styles.prizeTitle}>{current?.title}</Text>
          <TouchableOpacity style={styles.button} onPress={dismiss}>
            <Text style={styles.buttonText}>Nice!</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function getStyles(colors: ColorScheme) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', alignItems: 'center', padding: 24 },
    card: { width: '100%', backgroundColor: colors.surface, borderRadius: 20, padding: 28, alignItems: 'center' },
    emoji: { fontSize: 48 },
    title: { fontSize: 26, fontFamily: fonts.title, color: colors.text, marginTop: 8 },
    prizeTitle: { fontSize: 16, color: colors.highlightText, fontWeight: '600', marginTop: 8, textAlign: 'center' },
    button: { marginTop: 20, backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 40 },
    buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  });
}
