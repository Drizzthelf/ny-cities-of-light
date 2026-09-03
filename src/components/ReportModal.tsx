import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { type ColorScheme } from '../theme';

type Props = {
  visible: boolean;
  reportedId: string | null;
  reportedName?: string;
  onClose: () => void;
  // 'modal' (default) wraps itself in its own <Modal> — used from
  // ScannerScreen's scan-result modal. 'overlay' renders the same content
  // as a plain absolutely-positioned layer with no <Modal> of its own, so
  // a caller that's already inside its own open <Modal> (ContactsScreen's
  // enlarged-profile view) can render this as a sibling and have it paint
  // on top, staying on the same underlying view instead of stacking two
  // separate native modals.
  variant?: 'modal' | 'overlay';
};

// Report button required on every profile view per
// docs/production-launch-plan.md §3.6 — used from both ScannerScreen's
// scanned-profile modal and ContactsScreen's contact rows.
export function ReportModal({ visible, reportedId, reportedName, onClose, variant = 'modal' }: Props) {
  const { session } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [rescinding, setRescinding] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  // The id of an open (not-yet-rescinded) report this user already filed
  // against reportedId, if any — null once checked-and-none-found, and
  // also null while the check is still in flight (see `checking` below).
  const [existingReportId, setExistingReportId] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!visible || !reportedId || !session?.user) {
      setExistingReportId(null);
      setSubmitted(false);
      return;
    }
    let cancelled = false;
    setChecking(true);
    supabase
      .from('reports')
      .select('id')
      .eq('reporter_id', session.user.id)
      .eq('reported_id', reportedId)
      .is('rescinded_at', null)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setExistingReportId(data?.id ?? null);
        setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, reportedId, session?.user]);

  function handleClose() {
    setReason('');
    setSubmitted(false);
    onClose();
  }

  async function handleSubmit() {
    const trimmed = reason.trim();
    if (!trimmed || !reportedId || !session?.user) return;
    setSubmitting(true);
    const { error } = await supabase.from('reports').insert({
      reporter_id: session.user.id,
      reported_id: reportedId,
      reason: trimmed,
    });
    setSubmitting(false);
    if (error) {
      // 23505: the partial unique index caught a race — same friendly
      // message as the pre-check above, not the raw constraint error.
      if (error.code === '23505') {
        Alert.alert('Already reported', "You've already reported this person.");
      } else {
        Alert.alert('Could not submit report', error.message);
      }
      return;
    }
    // Swaps the form for an in-place confirmation instead of a native
    // alert + auto-close, so the caller (e.g. the enlarged-profile view)
    // stays open behind it until the user dismisses it themselves.
    setSubmitted(true);
  }

  async function handleRescind() {
    if (!existingReportId) return;
    setRescinding(true);
    const { error } = await supabase.rpc('rescind_report', { p_report_id: existingReportId });
    setRescinding(false);
    if (error) {
      Alert.alert('Could not withdraw report', error.message);
      return;
    }
    setExistingReportId(null);
    handleClose();
  }

  const content = (
    <View style={styles.card}>
      {submitted ? (
        <>
          <Text style={styles.title}>Report sent</Text>
          <Text style={styles.sub}>Thanks — an organizer will review this.</Text>
          <TouchableOpacity style={styles.submitButton} onPress={handleClose}>
            <Text style={styles.submitText}>Close</Text>
          </TouchableOpacity>
        </>
      ) : existingReportId ? (
        <>
          <Text style={styles.title}>Already reported</Text>
          <Text style={styles.sub}>
            You've already reported {reportedName ?? 'this person'} — an organizer is reviewing it.
          </Text>
          <TouchableOpacity
            style={[styles.submitButton, rescinding && styles.disabled]}
            onPress={handleRescind}
            disabled={rescinding}
          >
            <Text style={styles.submitText}>{rescinding ? 'Withdrawing...' : 'Withdraw report'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelLink} onPress={handleClose} disabled={rescinding}>
            <Text style={styles.cancelText}>Close</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={styles.title}>Report {reportedName ?? 'this person'}</Text>
          <Text style={styles.sub}>Tell us what happened. Only admins can see this.</Text>
          <TextInput
            style={styles.input}
            value={reason}
            onChangeText={setReason}
            placeholder="What happened?"
            placeholderTextColor={colors.textFaint}
            multiline
            numberOfLines={4}
            editable={!submitting}
          />
          <TouchableOpacity
            style={[styles.submitButton, (!reason.trim() || submitting || checking) && styles.disabled]}
            onPress={handleSubmit}
            disabled={!reason.trim() || submitting || checking}
          >
            <Text style={styles.submitText}>{submitting ? 'Submitting...' : 'Submit report'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelLink} onPress={handleClose} disabled={submitting}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );

  if (variant === 'overlay') {
    if (!visible) return null;
    return (
      <KeyboardAvoidingView
        style={[styles.backdrop, StyleSheet.absoluteFillObject]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {content}
      </KeyboardAvoidingView>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {content}
      </KeyboardAvoidingView>
    </Modal>
  );
}

function getStyles(colors: ColorScheme) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
    card: { backgroundColor: colors.surface, padding: 22, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
    title: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 4 },
    sub: { fontSize: 13, color: colors.textMuted, marginBottom: 14 },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      padding: 12,
      fontSize: 15,
      minHeight: 90,
      textAlignVertical: 'top',
      color: colors.text,
    },
    submitButton: { backgroundColor: colors.danger, borderRadius: 10, padding: 13, alignItems: 'center', marginTop: 16 },
    disabled: { opacity: 0.4 },
    submitText: { color: '#fff', fontWeight: '600', fontSize: 15 },
    cancelLink: { marginTop: 12, alignItems: 'center' },
    cancelText: { color: colors.textFaint, fontSize: 14 },
  });
}
