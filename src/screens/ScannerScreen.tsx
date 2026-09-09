import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { withRetry, isTransient } from '../lib/withRetry';
import { enqueueRequest, isQueued } from '../lib/offlineQueue';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Avatar } from '../components/Avatar';
import { ReportModal } from '../components/ReportModal';
import type { Event, Profile } from '../types/database';
import { type ColorScheme } from '../theme';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// How long to keep the live "waiting for them to accept" spinner up before
// giving up on an instant answer and switching to the calm "sent — they'll
// see it in their Requests tab" message. This is no longer a server TTL —
// requests now stay acceptable for a day either way (see
// supabase/migrations/20260906000000_async_connection_requests.sql) — just
// a local UX choice not to make someone stand there watching a spinner once
// it's clear the other person isn't tapping Accept right this second.
const LIVE_WAIT_MS = 15 * 1000;

// How long to wait for request_connection to actually respond before
// treating the device as offline/unreachable and queueing the request for
// later instead (see src/lib/offlineQueue.ts, src/components/OutboxFlusher.tsx).
const SEND_TIMEOUT_MS = 5 * 1000;

type RequestState =
  | 'idle'
  | 'sending'
  | 'waiting'
  | 'accepted'
  | 'declined'
  | 'expired'
  // Gave up waiting live for an instant accept — the request itself is
  // still genuinely pending server-side, just no longer being watched here.
  | 'sentAsync'
  // Couldn't reach the server within SEND_TIMEOUT_MS — queued locally,
  // will be sent by OutboxFlusher once the device is back online.
  | 'queued';

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Tries the new {id, n} JSON payload first (see HomeScreen.tsx's QRCode),
// falling back to treating the whole scanned string as a bare UUID — the
// shape shown by an app version from before this change, or if JSON.parse
// fails for any other reason. Never throws.
function parseQrPayload(raw: string): { id: string; name?: string } | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.id === 'string' && UUID_RE.test(parsed.id)) {
      return { id: parsed.id, name: typeof parsed.n === 'string' ? parsed.n : undefined };
    }
  } catch {
    // Not JSON — fall through to the bare-UUID check below.
  }
  return UUID_RE.test(raw) ? { id: raw } : null;
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

// Matches the server-side gates in
// supabase/migrations/20260905000000_pre_conference_scan_lockout.sql and
// 20260905000100_pre_conference_double_points_fix.sql. Two different dates
// on purpose: the conference starts Sept 18, so double-points windows work
// normally that day — flat-10 pricing only applies strictly before it. The
// "no repeat scans" gate is one day later: a pair's 2nd/3rd scan is still
// blocked through Sept 18, with Sept 19 being the earliest a repeat can happen.
const PRICING_CUTOFF = '2026-09-17';
const REPEAT_CUTOFF = '2026-09-18';

// Points for the Nth scan of the same person: 1st is 10 (20 during a
// double-points window), 2nd and 3rd are flat regardless of double points —
// except strictly before the conference starts, where every scan is flat
// 10 (see PRICING_CUTOFF above).
function pointsForScanNumber(n: number, doublePointsActive: boolean, todayEt: string): number {
  if (todayEt <= PRICING_CUTOFF) return 10;
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
  // True only once the best-effort profile fetch below has come back and
  // confirmed there's really no such profile (not just "hasn't answered
  // yet" or "failed/offline") — see handleBarCode.
  const [profileMissing, setProfileMissing] = useState(false);
  const [scannedEvent, setScannedEvent] = useState<Event | null>(null);
  const [alreadyCheckedIn, setAlreadyCheckedIn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [requestState, setRequestState] = useState<RequestState>('idle');
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const [doublePointsActive, setDoublePointsActive] = useState(false);
  const lockRef = useRef(false);
  // Prevents two overlapping send attempts to the same person — e.g.
  // scanning them again while the first attempt is still racing against
  // SEND_TIMEOUT_MS and hasn't been queued yet (the persisted outbox check
  // in handleSendRequest only catches an attempt that already finished
  // queueing, not one still in flight).
  const inFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  // iOS-only workaround for a known expo-camera black-screen bug: when
  // permission is already granted at mount (every launch after the
  // first-ever grant -- CameraView renders immediately instead of a beat
  // after the permission prompt), the native AVCaptureSession can come up
  // without ever starting to stream frames. A full remount "fixed" this
  // once before by making the camera unusable outright (reverted -- see
  // git history), because it refired on every foreground transition and
  // fought the hardware. This instead toggles the `active` prop, which
  // pauses/resumes the existing session without tearing down the native
  // view, and only runs once per mount right as the camera becomes
  // available -- not on every app-foreground -- so it can't repeat that
  // regression.
  const [cameraActive, setCameraActive] = useState(true);
  useEffect(() => {
    if (Platform.OS !== 'ios' || !permission?.granted) return;
    const offTimer = setTimeout(() => setCameraActive(false), 400);
    const onTimer = setTimeout(() => setCameraActive(true), 600);
    return () => {
      clearTimeout(offTimer);
      clearTimeout(onTimer);
    };
  }, [permission?.granted]);

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

    // Not a server timeout anymore (see LIVE_WAIT_MS above) — just stop
    // showing a live spinner once it's clear this isn't an instant accept.
    // The request itself stays valid server-side regardless.
    const timeout = setTimeout(() => {
      setRequestState((s) => (s === 'waiting' ? 'sentAsync' : s));
    }, LIVE_WAIT_MS);

    return () => {
      supabase.removeChannel(channel);
      clearTimeout(timeout);
    };
  }, [pendingRequestId]);

  async function handleBarCode({ data }: { data: string }) {
    if (lockRef.current) return;
    const raw = data.trim();

    if (raw.startsWith('event:')) {
      const eventId = raw.slice(6);
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

    const parsed = parseQrPayload(raw);
    if (!parsed) return;
    const { id: code, name: qrName } = parsed;

    if (!session?.user || code === session.user.id) {
      lockRef.current = true;
      Alert.alert("That's you", "You can't scan your own code.", [
        { text: 'OK', onPress: () => (lockRef.current = false) },
      ]);
      return;
    }
    lockRef.current = true;

    // Opens immediately from what the QR itself told us — zero network
    // calls, so this works even fully offline. Photo, socials, and the
    // scan-history/double-points hints below fill in afterward,
    // independently and best-effort; none of them gate reaching "Send
    // request", since request_connection re-validates everything
    // (including the max-3/once-per-day rules) server-side regardless of
    // what these hints say.
    setProfileMissing(false);
    setPriorScanCount(0);
    setScannedTodayAlready(false);
    setDoublePointsActive(false);
    setRequestState('idle');
    setPendingRequestId(null);
    setScannedProfile({
      id: code,
      first_name: qrName ?? 'this person',
      photo_url: null,
      is_admin: false,
      created_at: '',
      profile_socials: [],
    });

    withRetry(() => supabase.from('profiles').select('*, profile_socials(*)').eq('id', code).maybeSingle()).then(
      ({ data: profile, error }) => {
        if (profile) setScannedProfile(profile as Profile);
        // Only treat it as genuinely missing once we have a confirmed,
        // error-free "no such row" answer — a failed/offline attempt says
        // nothing about whether the profile actually exists.
        else if (!error) setProfileMissing(true);
      }
    );

    withRetry(() =>
      supabase.from('scans').select('scan_date').eq('scanner_id', session.user!.id).eq('scanned_id', code)
    ).then(({ data: existingScans }) => {
      if (!existingScans) return;
      const todayEt = easternDateString();
      setPriorScanCount(existingScans.length);
      setScannedTodayAlready(existingScans.some((s) => s.scan_date === todayEt));
    });

    // Best-effort hint, checked fresh per scan — the server
    // (request_connection / record_mutual_scan) is the actual source of
    // truth for what's allowed and what gets awarded.
    const nowIso = new Date().toISOString();
    withRetry(() =>
      supabase
        .from('double_points_windows')
        .select('id')
        .lte('start_time', nowIso)
        .gte('end_time', nowIso)
        .limit(1)
        .maybeSingle()
    ).then(({ data: doubleWindow }) => {
      setDoublePointsActive(!!doubleWindow);
    });
  }

  async function handleSendRequest() {
    if (!scannedProfile || !session?.user) return;
    const targetId = scannedProfile.id;
    const targetName = scannedProfile.first_name;

    // Already sitting in the outbox from an earlier scan of the same
    // person this session (e.g. scanned twice while offline) — don't fire
    // a second attempt or create a second queue entry.
    if (await isQueued(session.user.id, targetId)) {
      setRequestState('queued');
      return;
    }
    if (inFlightRef.current.has(targetId)) return;
    inFlightRef.current.add(targetId);

    setRequestState('sending');
    // Sends a live request rather than instantly crediting both people —
    // see supabase/migrations/20260823000000_connection_requests.sql —
    // and now stays acceptable for a day rather than requiring an instant
    // live accept (see supabase/migrations/20260906000000_async_connection_requests.sql
    // and the Requests tab on ContactsScreen.tsx). If the server doesn't
    // answer within SEND_TIMEOUT_MS, assume the device is offline and
    // queue it locally instead of leaving the user staring at a spinner —
    // see src/lib/offlineQueue.ts / OutboxFlusher.tsx.
    const attempt = withRetry(() => supabase.rpc('request_connection', { p_target_id: targetId }));
    const timedOut = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), SEND_TIMEOUT_MS));
    const result = await Promise.race([attempt, timedOut]);
    inFlightRef.current.delete(targetId);

    // A fully offline device doesn't make request_connection hang until
    // SEND_TIMEOUT_MS — fetch fails immediately, withRetry's 3 quick
    // attempts burn through in ~1-2s, and the race above resolves to
    // `attempt`'s result long before the timeout branch would ever fire.
    // So "no network" has to be detected here too, not just via the
    // timeout — anything withRetry gave up on because it was transient
    // (network/fetch/timeout — see isTransient) gets queued exactly like a
    // real timeout would.
    if (result === 'timeout' || isTransient(result.error)) {
      // The original call isn't cancelled — if it does land late and
      // actually succeeds, the queued retry below just hits
      // request_connection's own "already have a pending request" check
      // and no-ops there (see OutboxFlusher.tsx), so no duplicate is created.
      await enqueueRequest(session.user.id, targetId, targetName);
      setRequestState('queued');
      return;
    }

    const { data, error } = result;
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
    setProfileMissing(false);
    setScannedEvent(null);
    setAlreadyCheckedIn(false);
    setRequestState('idle');
    setPendingRequestId(null);
    setTimeout(() => { lockRef.current = false; }, 1500);
  }

  const todayEt = easternDateString();
  const maxedOut = priorScanCount >= 3;
  const tooEarlyForRepeat = priorScanCount >= 1 && todayEt <= REPEAT_CUTOFF;
  const scanBlocked = maxedOut || scannedTodayAlready || tooEarlyForRepeat;
  const nextScanPoints = pointsForScanNumber(priorScanCount + 1, doublePointsActive, todayEt);

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
        active={cameraActive}
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
        <View style={styles.topBarRow}>
          <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
            <Text style={styles.backButtonText}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={styles.topBarTitle}>Scan QR</Text>
          <View style={styles.backButton} />
        </View>
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
                {profileMissing && (
                  <Text style={styles.alreadyText}>This code doesn't match a real profile.</Text>
                )}
                {!scanBlocked && !profileMissing && (
                  <Text style={styles.pointsHint}>
                    {priorScanCount === 0 && doublePointsActive && todayEt > PRICING_CUTOFF
                      ? '🔥 +20 pts for both of you (2x active!)'
                      : `+${nextScanPoints} pts for both of you`}
                  </Text>
                )}

                {maxedOut ? (
                  <Text style={styles.alreadyText}>You've scanned each other the max 3 times 🎉</Text>
                ) : tooEarlyForRepeat ? (
                  <Text style={styles.alreadyText}>You can scan them again starting September 19</Text>
                ) : (
                  scannedTodayAlready && (
                    <Text style={styles.alreadyText}>Already scanned today — try again tomorrow</Text>
                  )
                )}
                {requestState === 'waiting' && (
                  <View style={styles.waitingBox}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={styles.waitingText}>
                      Waiting to see if {scannedProfile.first_name} accepts right now...
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
                {requestState === 'sentAsync' && (
                  <Text style={styles.asyncText}>
                    Request sent — {scannedProfile.first_name} will see it in their Requests tab, and
                    you'll get a notification if they respond.
                  </Text>
                )}
                {requestState === 'queued' && (
                  <Text style={styles.alreadyText}>
                    You're offline — this will send once you're back online. {scannedProfile.first_name}{' '}
                    will see it in their Requests tab.
                  </Text>
                )}

                {!scanBlocked && !profileMissing && (requestState === 'idle' || requestState === 'sending') && (
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
                    <Text style={styles.buttonText}>
                      {maxedOut ? 'Max scans reached' : tooEarlyForRepeat ? 'Not yet' : 'Come back tomorrow'}
                    </Text>
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
    },
    topBarRow: {
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
    asyncText: { color: colors.primary, fontWeight: '600', marginTop: 8, fontSize: 13, textAlign: 'center' },
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
