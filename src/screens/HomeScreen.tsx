import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { readCache, writeCache } from '../lib/offlineCache';
import { CachedDataBanner } from '../components/CachedDataBanner';
import { fonts, type ColorScheme } from '../theme';

type HomeCounts = { scanCount: number; checkinCount: number; points: number };

function formatClockTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function HomeScreen() {
  const { profile } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const navigation = useNavigation<any>();
  const [scanCount, setScanCount] = useState<number | null>(null);
  const [checkinCount, setCheckinCount] = useState<number | null>(null);
  const [points, setPoints] = useState<number | null>(null);
  // Timestamp of the cached snapshot currently on screen, or null when
  // showing a fresh live fetch — drives the "showing saved data" banner.
  // Deliberately NOT applied to doublePointsEndsAt below: a stale "double
  // points active" banner would actively mislead someone about whether
  // their scan is about to be worth extra, which is worse than just
  // hiding it until a fresh check succeeds.
  const [cacheSavedAt, setCacheSavedAt] = useState<number | null>(null);
  const [doublePointsEndsAt, setDoublePointsEndsAt] = useState<string | null>(null);
  // Guards against the cache-read (AsyncStorage) losing a race with the
  // live fetch (network) — set the moment a live fetch actually succeeds,
  // checked before the cache-read result is ever applied, so a slow cache
  // read can't clobber fresher data that already landed.
  const freshCountsRef = useRef(false);

  // Points math (10/scan, +20 during a double-points window, 50/event) lives
  // in one place — the leaderboard view — instead of being duplicated here.
  // It was duplicated here before and drifted out of sync with a real point
  // value change once already; querying the view directly can't drift.
  const loadCounts = useCallback(async () => {
    if (!profile) return;
    const { data, error } = await supabase
      .from('leaderboard')
      .select('scan_count, event_count, points')
      .eq('id', profile.id)
      .maybeSingle();
    // On failure, leave whatever's currently shown (fresh or cached) alone
    // rather than blanking it to 0 — that was the actual bug this cache
    // layer exists to fix, not just a missing nicety.
    if (error || !data) return;
    freshCountsRef.current = true;
    setCacheSavedAt(null);
    setScanCount(data.scan_count);
    setCheckinCount(data.event_count);
    setPoints(data.points);
    writeCache<HomeCounts>('home-counts', profile.id, {
      scanCount: data.scan_count,
      checkinCount: data.event_count,
      points: data.points,
    });
  }, [profile]);

  // Whether a double-points window is active depends on wall-clock time, not
  // just on database writes — a window that was scheduled yesterday can
  // start or end right now with no row change to trigger a realtime event.
  // So this also gets a plain interval, on top of the realtime subscription
  // below (which still handles an admin adding/removing a window live).
  const loadDoublePoints = useCallback(async () => {
    const nowIso = new Date().toISOString();
    const { data } = await supabase
      .from('double_points_windows')
      .select('end_time')
      .lte('start_time', nowIso)
      .gte('end_time', nowIso)
      .order('end_time', { ascending: true })
      .limit(1)
      .maybeSingle();
    setDoublePointsEndsAt(data?.end_time ?? null);
  }, []);

  useEffect(() => {
    loadDoublePoints();
    const interval = setInterval(loadDoublePoints, 60000);

    // Same fast-remount race as the home-counts channel below: if a
    // previous mount's channel of this topic hasn't finished tearing down
    // yet, supabase-js hands back that still-subscribed channel instead of
    // a fresh one, and calling .on() on it throws "cannot add
    // postgres_changes callbacks after subscribe()". Confirmed happening
    // in practice via QRHome -> push Contacts -> switch tabs -> back to
    // QRMeetup (the tab's tabPress listener re-navigates to QRHome, which
    // can remount this effect before the old channel's removal completes).
    supabase
      .getChannels()
      .filter((c) => c.topic === 'realtime:double-points-windows')
      .forEach((c) => supabase.removeChannel(c));

    const channel = supabase
      .channel('double-points-windows')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'double_points_windows' }, loadDoublePoints)
      .subscribe();
    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [loadDoublePoints]);

  useEffect(() => {
    if (!profile) return;
    freshCountsRef.current = false;
    let cancelled = false;
    readCache<HomeCounts>('home-counts', profile.id).then((cached) => {
      if (cancelled || !cached || freshCountsRef.current) return;
      setScanCount(cached.data.scanCount);
      setCheckinCount(cached.data.checkinCount);
      setPoints(cached.data.points);
      setCacheSavedAt(cached.savedAt);
    });

    loadCounts();
    // Filtered server-side to this user's own rows — without this, every
    // attendee's scan/check-in gets broadcast to every other connected
    // client's Home screen, not just the two people it's actually relevant
    // to. At event scale that's a large multiple of unnecessary Realtime
    // messages and redundant re-fetches. See docs/production-launch-plan.md §4.
    // Defensive: if a previous mount's channel of this same name hasn't
    // finished tearing down yet (e.g. a fast unmount/remount from rapid
    // tab navigation), supabase-js matches by topic and hands back that
    // still-subscribed channel object instead of a fresh one — calling
    // .on() on it then throws "cannot add postgres_changes callbacks
    // after subscribe()". Clearing any stale match first guarantees a
    // clean channel every time.
    supabase
      .getChannels()
      .filter((c) => c.topic === 'realtime:home-counts')
      .forEach((c) => supabase.removeChannel(c));

    const channel = supabase
      .channel('home-counts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scans', filter: `scanner_id=eq.${profile.id}` }, loadCounts)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_checkins', filter: `user_id=eq.${profile.id}` }, loadCounts)
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [profile, loadCounts]);

  if (!profile) return <ActivityIndicator style={{ flex: 1 }} />;

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.greeting}>Hi, {profile.first_name}</Text>

      <CachedDataBanner savedAt={cacheSavedAt} style={styles.cacheBanner} />

      {doublePointsEndsAt && (
        <View style={styles.doubleBanner}>
          <Text style={styles.doubleBannerText}>
            🔥 Double points active — scans are worth 20 until {formatClockTime(doublePointsEndsAt)}!
          </Text>
        </View>
      )}

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
      <TouchableOpacity style={styles.leaderboardButton} onPress={() => navigation.navigate('Raffle')}>
        <Text style={styles.leaderboardButtonText}>🎟️ Raffle</Text>
        <Text style={styles.leaderboardArrow}>›</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

function getStyles(colors: ColorScheme) {
  return StyleSheet.create({
    container: { flex: 1, alignItems: 'center', padding: 24, backgroundColor: colors.background },
    greeting: { fontSize: 26, fontFamily: fonts.title, color: colors.text, marginTop: 8, marginBottom: 20 },
    qrBox: {
      padding: 18,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      backgroundColor: colors.surface,
    },
    hint: { color: colors.textFaint, marginTop: 12, fontSize: 13 },
    cacheBanner: { alignSelf: 'stretch', marginHorizontal: 0, marginBottom: 12 },
    doubleBanner: {
      alignSelf: 'stretch',
      backgroundColor: colors.highlightTint,
      borderWidth: 1,
      borderColor: colors.highlightBorder,
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 14,
      marginBottom: 16,
    },
    doubleBannerText: { color: colors.highlightText, fontSize: 13, fontWeight: '600', textAlign: 'center' },
    statsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 24,
      backgroundColor: colors.primaryTint,
      borderRadius: 14,
      paddingVertical: 14,
      paddingHorizontal: 20,
      alignSelf: 'stretch',
    },
    stat: { flex: 1, alignItems: 'center' },
    statDivider: { width: 1, height: 30, backgroundColor: colors.border },
    statNumber: { fontSize: 28, fontWeight: '700', color: colors.text },
    pointsNumber: { color: colors.primary },
    statLabel: { fontSize: 11, color: colors.textFaint, marginTop: 2 },
    actions: { flexDirection: 'row', gap: 10, marginTop: 20, alignSelf: 'stretch' },
    // Solid black/cream — matches the nav-button treatment used elsewhere
    // (Profile's QR Meetup/My Contacts, Schedule's View all venues,
    // Raffle's View completed raffles) instead of the older brand-blue
    // buttons this screen still had.
    actionButton: {
      flex: 1,
      backgroundColor: colors.panelDark,
      padding: 13,
      borderRadius: 10,
      alignItems: 'center',
    },
    actionButtonSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong },
    actionButtonText: { color: colors.textOnDark, fontWeight: '600', fontSize: 15 },
    actionButtonTextSecondary: { color: colors.text },
    leaderboardButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      alignSelf: 'stretch',
      marginTop: 10,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 10,
      backgroundColor: colors.panelDark,
    },
    leaderboardButtonText: { color: colors.textOnDark, fontWeight: '600', fontSize: 15 },
    leaderboardArrow: { fontSize: 20, color: colors.textOnDark },
  });
}
