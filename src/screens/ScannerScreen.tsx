import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { withRetry } from '../lib/withRetry';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Avatar } from '../components/Avatar';
import { ReportModal } from '../components/ReportModal';
import type { Event, Profile } from '../types/database';
import { type ColorScheme } from '../theme';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Matches the server-side expiry in
// supabase/migrations/20260823000000_connection_requests.sql.
const REQUEST_TIMEOUT_MS = 2 * 60 * 1000;

type RequestState = 'idle' | 'sending' | 'waiting' | 'accepted' | 'declined' | 'expired';

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// "Different day" resets at midnight Eastern specifically (the conference's
// own clock), not the scanning device's local timezone — must match the
// server's `(now() at time zone 'America/New_York')::date` exactly, and
// Postgres `date` columns come back over the wire as plain 'YYYY-MM-DD'
// strings, so this needs to produce that same format.
function easternDateString(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// Points for the Nth scan of the same person: 1st is 10 (20 during a
// double-points window), 2nd and 3rd are flat regardless of double points.
function pointsForScanNumber(n: number, doublePointsActive: boolean): number {
  if (n === 1) return doublePointsActive ? 20 : 10;
  if (n === 2) return 15;
  return 20;
}

export function ScannerScreen() {
  const { session } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const navigation = useNavigation();
  const [permission, requestPermission] = useCameraPermissions();
  const [scannedProfile, setScannedProfile] = useState<Profile | null>(null);
  // How many times I've already scanned this person (0-3), and whether one
  // of those was today — drives whether a new scan can be sent, and what
  // it'll be worth. Best-effort, same as doublePointsActive below: the
  // server (request_connection / record_mutual_scan) is the actual source
  // of truth and re-checks both at request time and at accept time.
  const [priorScanCount, setPriorScanCount] = useState(0);
  const [scannedTodayAlready, setScannedTodayAlready] = useState(false);
  const [scannedEvent, setScannedEvent] = useState<Event | null>(null);
  const [alreadyCheckedIn, setAlreadyCheckedIn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [requestState, setRequestState] = useState<RequestState>('idle');
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const [doublePointsActive, setDoublePointsActive] = useState(false);
  const lockRef = useRef(false);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  // Live-updates the "waiting..." state once the target accepts/declines.
  // Scoped to this one request's own row (id=eq.<id>), not a broadcast to
  // everyone — same reasoning as the per-user filters added to
  // HomeScreen.tsx earlier.
  useEffect(() => {
    if (!pendingRequestId) return;
    const channel = supabase
      .channel(`connection-request-${pendingRequestId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'connection_requests', filter: `id=eq.${pendingRequestId}` },
        (payload) => {
          const status = (payload.new as { status: string }).status;
          if (status === 'accepted') setRequestState('accepted');
          else if (status === 'declined') setRequestState('declined');
          else if (status === 'expired') setRequestState('expired');
        }
      )
      .subscribe();

    // Local mirror of the server's TTL, in case the realtime UPDATE never
    // arrives — the server is still the source of truth for whether the
    // request can actually still be accepted.
    const timeout = setTimeout(() => {
      setRequestState((s) => (s === 'waiting' ? 'expired' : s));
    }, REQUEST_TIMEOUT_MS);

    return () => {
      supabase.removeChannel(channel);
      clearTimeout(timeout);
    };
  }, [pendingRequestId]);

  async function handleBarCode({ data }: { data: string }) {
    if (lockRef.current) return;
    const code = data.trim();

    if (code.startsWith('event:')) {
      const eventId = code.slice(6);
      if (!UUID_RE.test(eventId)) return;
      lockRef.current = true;
      setLoading(true);
      try {
        const { data: event, error } = await withRetry(() =>
          supabase.from('events').select('*').eq('id', eventId).maybeSingle()
        );
        if (error) throw error;
        if (!event) {
          Alert.alert('Not found', 'No event for that code.', [
            { text: 'OK', onPress: () => (lockRef.current = false) },
          ]);
          return;
        }
        const { data: existing } = await supabase
          .from('event_checkins')
          .select('id')
          .eq('user_id', session!.user.id)
          .eq('event_id', eventId)
          .maybeSingle();
        setAlreadyCheckedIn(!!existing);
        setScannedEvent(event as Event);
      } catch (err: any) {
        Alert.alert('Error', err.message ?? String(err), [
          { text: 'OK', onPress: () => (lockRef.current = false) },
        ]);
      } finally {
        setLoading(false);
      }
      return;
    }

    if (!UUID_RE.test(code)) return;
    if (!session?.user || code === session.user.id) {
      lockRef.current = true;
      Alert.alert("That's you", "You can't scan your own code.", [
        { text: 'OK', onPress: () => (lockRef.current = false) },
      ]);
      return;
    }
    lockRef.current = true;
    setLoading(true);
    try {
      const { data: profile, error } = await withRetry(() =>
        supabase.from('profiles').select('*, profile_socials(*)').eq('id', code).maybeSingle()
      );
      if (error) throw error;
      if (!profile) {
        Alert.alert('Not found', 'No profile for that code.', [
          { text: 'OK', onPress: () => (lockRef.current = false) },
        ]);
        return;
      }
      const { data: existingScans } = await supabase
        .from('scans')
        .select('scan_date')
        .eq('scanner_id', session.user.id)
        .eq('scanned_id', code);
      // Best-effort hint, checked fresh per scan — the server (request_connection /
      // record_mutual_scan) is the actual source of truth for what's allowed and
      // what gets awarded, which can be up to ~2 minutes after this check.
      const nowIso = new Date().toISOString();
      const { data: doubleWindow } = await supabase
        .from('double_points_windows')
        .select('id')
        .lte('start_time', nowIso)
        .gte('end_time', nowIso)
        .limit(1)
        .maybeSingle();
      const todayEt = easternDateString();
      setDoublePointsActive(!!doubleWindow);
      setPriorScanCount(existingScans?.length ?? 0);
      setScannedTodayAlready((existingScans ?? []).some((s) => s.scan_date === todayEt));
      setRequestState('idle');
      setPendingRequestId(null);
      setScannedProfile(profile as Profile);
    } catch (err: any) {
      Alert.alert('Error', err.message ?? String(err), [
        { text: 'OK', onPress: () => (lockRef.current = false) },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function handleSendRequest() {
    if (!scannedProfile || !session?.user) return;
    setRequestState('sending');
    // Sends a live request rather than instantly crediting both people —
    // see supabase/migrations/20260823000000_connection_requests.sql. The
    // other person must accept while they're actively in the app right
    // now (no push notifications, by design — this requires both people
    // to genuinely be together in the moment, and defeats printed-poster
    // farming since nobody's there to keep a request alive).
    const { data, error } = await withRetry(() =>
      supabase.rpc('request_connection', { p_target_id: scannedProfile.id })
    );
    if (error) {
      setRequestState('idle');
      Alert.alert('Could not send request', error.message);
      return;
    }
    setPendingRequestId(data as string);
    setRequestState('waiting');
  }

  async function handleEventCheckin() {
    if (!scannedEvent || !session?.user) return;
    setAdding(true);
    const { error } = await withRetry(() =>
      supabase.from('event_checkins').insert({
        user_id: session.user.id,
        event_id: scannedEvent.id,
      })
    );
    setAdding(false);
    if (error && !error.message?.includes('duplicate')) {
      Alert.alert('Could not check in', error.message);
      return;
    }
    closeModal();
  }

  function closeModal() {
    setScannedProfile(null);
    setPriorScanCount(0);
    setScannedTodayAlready(false);
    setScannedEvent(null);
    setAlreadyCheckedIn(false);
    setRequestState('idle');
    setPendingRequestId(null);
    setTimeout(() => { lockRef.current = false; }, 1500);
  }

  const maxedOut = priorScanCount >= 3;
  const scanBlocked = maxedOut || scannedTodayAlready;
  const nextScanPoints = pointsForScanNumber(priorScanCount + 1, doublePointsActive);

  if (!permission) return <ActivityIndicator style={{ flex: 1 }} />;
  if (!permission.granted) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionText}>Camera access is needed to scan QR codes.</Text>
        <TouchableOpacity style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Grant camera access</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        autofocus="on"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        // handleBarCode itself checks lockRef.current and bails — gating
        // this prop on the same ref was redundant and actually the bug:
        // mutating a ref doesn't trigger a re-render, so once lockRef was
        // set true here, this prop stayed frozen at `undefined` forever
        // after closeModal() flipped the ref back to false off-render
        // (its setTimeout), leaving the scanner dead until a full
        // unmount/remount (navigating away and back).
        onBarcodeScanned={handleBarCode}
      />
      {/* Rendered as a plain RN View sibling *after* CameraView (not inside
          the native header) so it reliably wins touch priority — on Android,
          CameraView's native preview surface can otherwise sit above and
          swallow taps meant for sibling native UI like a stack header. */}
      <SafeAreaView style={styles.topBar} edges={['top']}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backButtonText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>Scan QR</Text>
        <View style={styles.backButton} />
      </SafeAreaView>
      <View style={styles.overlay}>
        <View style={styles.reticle} />
        <Text style={styles.overlayText}>Point at a QR code</Text>
      </View>

      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#fff" />
        </View>
      )}

      {/* Person scan modal */}
      <Modal
        visible={!!scannedProfile}
        transparent
        animationType="slide"
        onRequestClose={closeModal}
      >
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={closeModal}>
          <TouchableOpacity style={styles.modalCard} activeOpacity={1} onPress={() => {}}>
            {scannedProfile && (
              <>
                <Avatar photoUrl={scannedProfile.photo_url} name={scannedProfile.first_name} size={110} style={styles.modalPhoto} />
                <Text style={styles.modalName}>{scannedProfile.first_name}</Text>
                {scannedProfile.profile_socials.length > 0 ? (
                  <Text style={styles.modalMeta}>
                    {scannedProfile.profile_socials.map((s) => s.handle).join(' · ')}
                  </Text>
                ) : null}
                {!scanBlocked && (
                  <Text style={styles.pointsHint}>
                    {priorScanCount === 0 && doublePointsActive
                      ? '🔥 +20 pts for both of you (2x active!)'
                      : `+${nextScanPoints} pts for both of you`}
                  </Text>
                )}

                {maxedOut ? (
                  <Text style={styles.alreadyText}>You've scanned each other the max 3 times 🎉</Text>
                ) : (
                  scannedTodayAlready && (
                    <Text style={styles.alreadyText}>Already scanned today — try again tomorrow</Text>
                  )
                )}
                {requestState === 'waiting' && (
                  <View style={styles.waitingBox}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={styles.waitingText}>
                      Waiting for {scannedProfile.first_name} to accept — they need to have the
                      app open right now.
                    </Text>
                  </View>
                )}
                {requestState === 'accepted' && (
                  <Text style={styles.successText}>You're connected! 🎉</Text>
                )}
                {requestState === 'declined' && (
                  <Text style={styles.alreadyText}>They declined.</Text>
                )}
                {requestState === 'expired' && (
                  <Text style={styles.alreadyText}>Request expired — ask them to scan again.</Text>
                )}

                {!scanBlocked && (requestState === 'idle' || requestState === 'sending') && (
                  <TouchableOpacity
                    style={[styles.button, requestState === 'sending' && styles.buttonDisabled]}
                    onPress={handleSendRequest}
                    disabled={requestState === 'sending'}
                  >
                    <Text style={styles.buttonText}>
                      {requestState === 'sending' ? 'Sending...' : 'Send request'}
                    </Text>
                  </TouchableOpacity>
                )}
                {scanBlocked && (
                  <TouchableOpacity style={[styles.button, styles.buttonDisabled]} disabled>
                    <Text style={styles.buttonText}>{maxedOut ? 'Max scans reached' : 'Come back tomorrow'}</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity style={styles.reportLink} onPress={() => setReporting(true)}>
                  <Text style={styles.reportLinkText}>Report</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.linkButton} onPress={closeModal}>
                  <Text style={styles.linkText}>
                    {requestState === 'idle' || requestState === 'sending' ? 'Cancel' : 'Close'}
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <ReportModal
        visible={reporting}
        reportedId={scannedProfile?.id ?? null}
        reportedName={scannedProfile?.first_name}
        onClose={() => setReporting(false)}
      />

      {/* Event check-in modal */}
      <Modal
        visible={!!scannedEvent}
        transparent
        animationType="slide"
        onRequestClose={closeModal}
      >
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={closeModal}>
          <TouchableOpacity style={styles.modalCard} activeOpacity={1} onPress={() => {}}>
            {scannedEvent && (
              <>
                <View style={styles.eventBadge}>
                  <Text style={styles.eventBadgeText}>Event</Text>
                </View>
                <Text style={styles.modalName}>{scannedEvent.title}</Text>
                <Text style={styles.modalMeta}>
                  {formatTime(scannedEvent.start_time)} – {formatTime(scannedEvent.end_time)}
                </Text>
                <Text style={styles.modalMeta}>{scannedEvent.location_name}</Text>
                {scannedEvent.description ? (
                  <Text style={styles.modalBackground}>{scannedEvent.description}</Text>
                ) : null}
                <Text style={styles.pointsHint}>+50 pts for checking in</Text>
                {alreadyCheckedIn && (
                  <Text style={styles.alreadyText}>Already checked in</Text>
                )}
                <TouchableOpacity
                  style={[styles.button, (adding || alreadyCheckedIn) && styles.buttonDisabled]}
                  onPress={handleEventCheckin}
                  disabled={adding || alreadyCheckedIn}
                >
                  <Text style={styles.buttonText}>
                    {alreadyCheckedIn ? 'Already checked in' : adding ? 'Checking in...' : 'Check in (+50 pts)'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.linkButton} onPress={closeModal}>
                  <Text style={styles.linkText}>Cancel</Text>
                </TouchableOpacity>
              </>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

function getStyles(colors: ColorScheme) {
  return StyleSheet.create({
    // These camera-overlay styles are deliberately hardcoded, not
    // colors.X — this is chrome drawn over a live camera feed, meant to
    // stay fixed regardless of app theme (dark or light).
    container: { flex: 1, backgroundColor: '#000' },
    permissionContainer: {
      flex: 1,
      padding: 24,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.background,
    },
    permissionText: { fontSize: 15, color: colors.textSecondary, textAlign: 'center', marginBottom: 16 },
    topBar: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 8,
    },
    backButton: { paddingVertical: 12, paddingHorizontal: 12, minWidth: 64 },
    backButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
    topBarTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
    overlay: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: 'center',
      alignItems: 'center',
    },
    reticle: {
      width: 240,
      height: 240,
      borderWidth: 3,
      borderColor: '#ffffffcc',
      borderRadius: 20,
    },
    overlayText: { color: '#fff', marginTop: 16, fontSize: 15 },
    loadingOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: '#00000088',
      justifyContent: 'center',
      alignItems: 'center',
    },
    modalBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
    modalCard: {
      backgroundColor: colors.surface,
      padding: 24,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      alignItems: 'center',
    },
    modalPhoto: { marginBottom: 12 },
    // Plain bold sans, not fonts.title (PlayfairDisplay italic) — matches
    // the name treatment on the Profile screen.
    modalName: { fontSize: 24, fontWeight: '700', color: colors.text, textAlign: 'center' },
    modalMeta: { color: colors.textMuted, marginTop: 4, fontSize: 14 },
    modalBackground: {
      color: colors.textSecondary,
      marginTop: 10,
      textAlign: 'center',
      fontSize: 15,
      lineHeight: 20,
    },
    pointsHint: { color: colors.primary, fontWeight: '600', fontSize: 13, marginTop: 10 },
    alreadyText: { color: colors.highlightText, marginTop: 8, fontSize: 13 },
    successText: { color: colors.success, fontWeight: '700', marginTop: 8, fontSize: 14 },
    waitingBox: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, paddingHorizontal: 8 },
    waitingText: { flex: 1, color: colors.primary, fontSize: 12, lineHeight: 16 },
    eventBadge: {
      backgroundColor: colors.primaryTintBorder,
      borderRadius: 20,
      paddingHorizontal: 14,
      paddingVertical: 4,
      marginBottom: 10,
    },
    eventBadgeText: { color: colors.primaryDark, fontWeight: '700', fontSize: 13 },
    button: {
      backgroundColor: colors.primary,
      padding: 14,
      borderRadius: 10,
      alignItems: 'center',
      alignSelf: 'stretch',
      marginTop: 18,
    },
    buttonDisabled: { opacity: 0.5 },
    buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
    linkButton: { marginTop: 12 },
    linkText: { color: colors.textFaint, fontSize: 14 },
    reportLink: { marginTop: 14 },
    reportLinkText: { color: colors.danger, fontSize: 13 },
  });
}
