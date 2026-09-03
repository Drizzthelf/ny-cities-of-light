import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { ScreenHeader } from '../components/ScreenHeader';
import type { RafflePrize } from '../types/database';
import { type ColorScheme } from '../theme';

// History view for prizes that have already been drawn — split out of
// RaffleScreen so the main Raffle page only ever shows raffles you can
// still do something about (open or recently closed, not yet drawn).
// Winner identity is intentionally not shown here to other participants —
// only the winner themselves sees "You won"; the raffle-drawn Updates
// announcement is anonymous too (see draw_raffle_winner). Admins can still
// see who won on the Admin Raffle tab, for prize fulfillment.
export function CompletedRaffleScreen() {
  const { profile } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const [prizes, setPrizes] = useState<RafflePrize[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data: prizeData } = await supabase
      .from('raffle_prizes')
      .select('*')
      .not('drawn_at', 'is', null)
      .order('drawn_at', { ascending: false });
    setPrizes((prizeData ?? []) as RafflePrize[]);
    setLoading(false);
  }, []);

  // Focus-reload rather than realtime — this is a history list, not
  // something that needs to update live while you're staring at it (same
  // reasoning as LeaderboardScreen).
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <>
      <ScreenHeader title="Completed Raffles" backLabel="Raffle" variant="banner" />
      {loading ? (
        <ActivityIndicator style={{ flex: 1 }} />
      ) : (
        <FlatList
          style={styles.container}
          contentContainerStyle={styles.list}
          data={prizes}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={<Text style={styles.empty}>No raffles have been drawn yet.</Text>}
          renderItem={({ item }) => {
            const isWinner = item.winner_id === profile?.id;
            return (
              <View style={styles.card}>
                {item.image_url ? <Image source={{ uri: item.image_url }} style={styles.photo} /> : null}
                <Text style={styles.title}>{item.title}</Text>
                {item.description ? <Text style={styles.description}>{item.description}</Text> : null}
                <View style={[styles.drawnBox, isWinner && styles.drawnBoxWon]}>
                  <Text style={[styles.drawnText, isWinner && styles.drawnTextWon]}>
                    {isWinner ? '🎉 You won this prize!' : 'A winner has been drawn'}
                  </Text>
                </View>
              </View>
            );
          }}
        />
      )}
    </>
  );
}

function getStyles(colors: ColorScheme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    list: { padding: 16, paddingBottom: 32 },
    empty: { textAlign: 'center', marginTop: 40, color: colors.textFaint },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      padding: 14,
      marginBottom: 12,
    },
    photo: { width: '100%', height: 140, borderRadius: 10, marginBottom: 10, backgroundColor: colors.borderLight },
    // Plain bold sans, not fonts.title (PlayfairDisplay italic) — matches
    // RaffleScreen's prize-title treatment.
    title: { fontSize: 18, fontWeight: '700', color: colors.text },
    description: { fontSize: 13, color: colors.textMuted, marginTop: 4, lineHeight: 18 },
    drawnBox: { marginTop: 12, backgroundColor: colors.borderLight, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12 },
    drawnBoxWon: { backgroundColor: colors.highlightTint },
    drawnText: { color: colors.textMuted, fontSize: 13, fontWeight: '600', textAlign: 'center' },
    drawnTextWon: { color: colors.highlightText },
  });
}
