import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { ScreenHeader } from '../components/ScreenHeader';
import type { RaffleEntry, RafflePrize, RafflePrizeStats } from '../types/database';
import { type ColorScheme } from '../theme';

export function RaffleScreen() {
  const { profile } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const navigation = useNavigation<any>();
  const [points, setPoints] = useState(0);
  const [myTickets, setMyTickets] = useState(0);
  const [pointsToNext, setPointsToNext] = useState<number | null>(null);
  const [prizes, setPrizes] = useState<RafflePrize[]>([]);
  const [stats, setStats] = useState<Record<string, RafflePrizeStats>>({});
  const [entries, setEntries] = useState<RaffleEntry[]>([]);
  const [pending, setPending] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;
    // Drawn prizes moved to CompletedRaffleScreen — this page only ever
    // shows raffles you can still do something about. Entries still fetch
    // unfiltered (below) since tickets committed to an already-drawn
    // prize stay spent and must keep counting against your total.
    const [{ data: lb }, { data: prizeData }, { data: statsData }, { data: entryData }] = await Promise.all([
      supabase.from('leaderboard').select('points').eq('id', profile.id).maybeSingle(),
      supabase.from('raffle_prizes').select('*').is('drawn_at', null).order('created_at', { ascending: false }),
      supabase.from('raffle_prize_stats').select('*'),
      supabase.from('raffle_entries').select('*').eq('user_id', profile.id),
    ]);

    const myPoints = lb?.points ?? 0;
    setPoints(myPoints);

    const [{ data: ticketData }] = await Promise.all([
      supabase.rpc('points_to_tickets', { p_points: myPoints }),
    ]);
    const tickets = (ticketData as number | null) ?? 0;
    setMyTickets(tickets);

    const { data: nextThreshold } = await supabase.rpc('points_for_ticket', { n: tickets + 1 });
    setPointsToNext(nextThreshold != null ? Math.max(0, (nextThreshold as number) - myPoints) : null);

    const prizeList = (prizeData ?? []) as RafflePrize[];
    setPrizes(prizeList);

    const statsMap: Record<string, RafflePrizeStats> = {};
    for (const s of (statsData ?? []) as RafflePrizeStats[]) statsMap[s.prize_id] = s;
    setStats(statsMap);

    const entryList = (entryData ?? []) as RaffleEntry[];
    setEntries(entryList);
    const pendingMap: Record<string, number> = {};
    for (const e of entryList) pendingMap[e.prize_id] = e.tickets;
    setPending(pendingMap);

    setLoading(false);
  }, [profile]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!profile) return;
    // See HomeScreen.tsx's double-points-windows effect for why this guard
    // exists — a fast unmount/remount can hand back an already-subscribed
    // channel of the same topic, and calling .on() on it throws.
    supabase
      .getChannels()
      .filter((c) => c.topic === 'realtime:raffle-updates')
      .forEach((c) => supabase.removeChannel(c));
    const channel = supabase
      .channel('raffle-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'raffle_prizes' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'raffle_entries', filter: `user_id=eq.${profile.id}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile, load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const totalAssigned = entries.reduce((sum, e) => sum + e.tickets, 0);
  const available = Math.max(0, myTickets - totalAssigned);

  function maxForPrize(prizeId: string) {
    const committed = entries.find((e) => e.prize_id === prizeId)?.tickets ?? 0;
    return available + committed;
  }

  function adjust(prizeId: string, delta: number) {
    setPending((prev) => {
      const current = prev[prizeId] ?? 0;
      const next = Math.max(0, Math.min(maxForPrize(prizeId), current + delta));
      return { ...prev, [prizeId]: next };
    });
  }

  async function save(prizeId: string) {
    setSaving((prev) => ({ ...prev, [prizeId]: true }));
    const { error } = await supabase.rpc('assign_raffle_tickets', {
      p_prize_id: prizeId,
      p_tickets: pending[prizeId] ?? 0,
    });
    setSaving((prev) => ({ ...prev, [prizeId]: false }));
    if (error) {
      Alert.alert('Could not update tickets', error.message);
      return;
    }
    await load();
  }

  if (loading) {
    return (
      <>
        <ScreenHeader title="Raffle" backLabel="QR Meetup" variant="banner" />
        <ActivityIndicator style={{ flex: 1 }} />
      </>
    );
  }

  return (
    <>
      <ScreenHeader title="Raffle" backLabel="QR Meetup" variant="banner" />
      <FlatList
        style={styles.container}
        contentContainerStyle={styles.list}
        data={prizes}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={<Text style={styles.empty}>No prizes have been added yet.</Text>}
        ListHeaderComponent={
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <View style={styles.summaryStat}>
                <Text style={styles.summaryNumber}>{points}</Text>
                <Text style={styles.summaryLabel}>points</Text>
              </View>
              <View style={styles.summaryStat}>
                <Text style={styles.summaryNumber}>{myTickets}</Text>
                <Text style={styles.summaryLabel}>tickets earned</Text>
              </View>
              <View style={styles.summaryStat}>
                <Text style={[styles.summaryNumber, styles.summaryNumberAvailable]}>{available}</Text>
                <Text style={styles.summaryLabel}>unassigned</Text>
              </View>
            </View>
            {pointsToNext !== null && (
              <Text style={styles.nextTicketHint}>
                {pointsToNext === 0
                  ? "You've got a new ticket coming up on your next scan!"
                  : `${pointsToNext} more points until your next ticket`}
              </Text>
            )}
            <Text style={styles.curveHint}>
              Your first 5 tickets are 28 points each — every 5 tickets after that cost 7 more points each.
            </Text>
          </View>
        }
        ListFooterComponent={
          <TouchableOpacity style={styles.completedButton} onPress={() => navigation.navigate('CompletedRaffle')}>
            <Text style={styles.completedButtonText}>View completed raffles</Text>
            <Text style={styles.completedButtonArrow}>›</Text>
          </TouchableOpacity>
        }
        renderItem={({ item }) => {
          const prizeStats = stats[item.id];
          const committed = entries.find((e) => e.prize_id === item.id)?.tickets ?? 0;
          const pendingValue = pending[item.id] ?? 0;
          const dirty = pendingValue !== committed;
          const isClosed = !!item.closes_at && new Date(item.closes_at) <= new Date();

          return (
            <View style={styles.card}>
              {item.image_url ? (
                <Image source={{ uri: item.image_url }} style={styles.photo} />
              ) : null}
              <Text style={styles.title}>{item.title}</Text>
              {item.description ? <Text style={styles.description}>{item.description}</Text> : null}
              <Text style={styles.poolHint}>
                {prizeStats?.total_tickets ?? 0} tickets in the pool · {prizeStats?.entrant_count ?? 0} entrants
              </Text>

              {isClosed ? (
                <View style={styles.drawnBox}>
                  <Text style={styles.drawnText}>
                    Entries closed
                    {committed > 0 ? ` — you have ${committed} ticket${committed === 1 ? '' : 's'} in this drawing` : ''}
                  </Text>
                </View>
              ) : (
                <>
                  {item.closes_at && (
                    <Text style={styles.closesHint}>
                      Entries close {new Date(item.closes_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  )}
                  <View style={styles.stepperRow}>
                    <TouchableOpacity
                      style={styles.stepperBtn}
                      onPress={() => adjust(item.id, -1)}
                      disabled={pendingValue <= 0}
                    >
                      <Text style={styles.stepperBtnText}>−</Text>
                    </TouchableOpacity>
                    <Text style={styles.stepperValue}>{pendingValue}</Text>
                    <TouchableOpacity
                      style={styles.stepperBtn}
                      onPress={() => adjust(item.id, 1)}
                      disabled={pendingValue >= maxForPrize(item.id)}
                    >
                      <Text style={styles.stepperBtnText}>+</Text>
                    </TouchableOpacity>
                    <Text style={styles.stepperMax}>/ {maxForPrize(item.id)} available</Text>
                  </View>
                  {dirty && (
                    <TouchableOpacity
                      style={[styles.saveBtn, saving[item.id] && styles.saveBtnDisabled]}
                      onPress={() => save(item.id)}
                      disabled={saving[item.id]}
                    >
                      <Text style={styles.saveBtnText}>
                        {saving[item.id] ? 'Saving...' : `Assign ${pendingValue} ticket${pendingValue === 1 ? '' : 's'}`}
                      </Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
            </View>
          );
        }}
      />
    </>
  );
}

function getStyles(colors: ColorScheme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    list: { padding: 16, paddingBottom: 32 },
    empty: { textAlign: 'center', marginTop: 40, color: colors.textFaint },
    summaryCard: {
      backgroundColor: colors.primaryTint,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.primaryTintBorder,
      padding: 18,
      marginBottom: 16,
    },
    summaryRow: { flexDirection: 'row', alignItems: 'center' },
    summaryStat: { flex: 1, alignItems: 'center' },
    summaryNumber: { fontSize: 26, fontWeight: '700', color: colors.text },
    summaryNumberAvailable: { color: colors.primary },
    summaryLabel: { fontSize: 11, color: colors.textFaint, marginTop: 2 },
    nextTicketHint: { textAlign: 'center', color: colors.primary, fontSize: 12, fontWeight: '600', marginTop: 14 },
    curveHint: { textAlign: 'center', color: colors.textFaint, fontSize: 11, marginTop: 6, lineHeight: 15 },
    completedButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 4,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 10,
      backgroundColor: colors.panelDark,
    },
    completedButtonText: { color: colors.textOnDark, fontWeight: '600', fontSize: 15 },
    completedButtonArrow: { fontSize: 20, color: colors.textOnDark },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      padding: 14,
      marginBottom: 12,
    },
    photo: { width: '100%', height: 140, borderRadius: 10, marginBottom: 10, backgroundColor: colors.borderLight },
    // Plain bold sans, not fonts.title (PlayfairDisplay italic) — more
    // readable for a prize name people are scanning while assigning tickets.
    title: { fontSize: 18, fontWeight: '700', color: colors.text },
    description: { fontSize: 13, color: colors.textMuted, marginTop: 4, lineHeight: 18 },
    poolHint: { fontSize: 11, color: colors.textFaint, marginTop: 8 },
    closesHint: { fontSize: 11, color: colors.textFaint, marginTop: 4, fontStyle: 'italic' },
    stepperRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 12 },
    stepperBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepperBtnText: { color: '#fff', fontSize: 20, fontWeight: '700', lineHeight: 22 },
    stepperValue: { fontSize: 18, fontWeight: '700', color: colors.text, minWidth: 24, textAlign: 'center' },
    stepperMax: { fontSize: 11, color: colors.textFaint, marginLeft: 4 },
    saveBtn: { marginTop: 10, backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
    saveBtnDisabled: { opacity: 0.6 },
    saveBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
    drawnBox: { marginTop: 12, backgroundColor: colors.borderLight, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12 },
    drawnBoxWon: { backgroundColor: colors.highlightTint },
    drawnText: { color: colors.textMuted, fontSize: 13, fontWeight: '600', textAlign: 'center' },
    drawnTextWon: { color: colors.highlightText },
  });
}
