import React, { useMemo } from 'react';
import { Image, Modal, ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native';
import type { EventRowData } from './EventRow';
import { type ColorScheme } from '../theme';
import { useTheme } from '../context/ThemeContext';

type Props = {
  event: EventRowData | null;
  onClose: () => void;
  onOpenMaps?: () => void;
};

function formatDateTime(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

function formatTime(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '--:--';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Full-detail view opened by tapping an EventRow — the row itself only has
// room for a truncated description, so this is where the rest lives (full
// description, full date, a bigger look at the photo). Shared by
// ScheduleScreen and AdminScreen's event form preview so what an admin
// checks in the preview is exactly what attendees will see.
export function EventDetailModal({ event, onClose, onOpenMaps }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  return (
    <Modal visible={!!event} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity style={styles.card} activeOpacity={1} onPress={() => {}}>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            {event?.image_url ? (
              <Image source={{ uri: event.image_url }} style={styles.photo} />
            ) : null}
            <Text style={styles.title}>{event?.title || 'Untitled event'}</Text>
            {event && (
              <Text style={styles.datetime}>
                {formatDateTime(event.start_time)} · {formatTime(event.start_time)} – {formatTime(event.end_time)}
              </Text>
            )}
            <Text style={styles.location}>{event?.location_name}</Text>

            {event?.description ? <Text style={styles.description}>{event.description}</Text> : null}

            {onOpenMaps && (
              <TouchableOpacity style={styles.mapsButton} onPress={onOpenMaps}>
                <Text style={styles.mapsButtonText}>Open in Maps</Text>
              </TouchableOpacity>
            )}
          </ScrollView>

          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeButtonText}>Close</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function getStyles(colors: ColorScheme) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
    card: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      maxHeight: '85%',
      paddingBottom: 20,
    },
    scroll: { padding: 24 },
    photo: { width: '100%', height: 180, borderRadius: 14, marginBottom: 16, backgroundColor: colors.borderLight },
    // Plain bold sans, not fonts.title (PlayfairDisplay italic) — matches
    // EventRow's list-view title treatment.
    title: { fontSize: 24, fontWeight: '700', color: colors.text },
    datetime: { fontSize: 14, color: colors.textSecondary, marginTop: 8, fontWeight: '500' },
    location: { fontSize: 14, color: colors.primary, marginTop: 4, fontWeight: '600' },
    description: { fontSize: 15, color: colors.textSecondary, marginTop: 16, lineHeight: 21 },
    mapsButton: {
      marginTop: 20,
      backgroundColor: colors.primary,
      borderRadius: 10,
      paddingVertical: 13,
      alignItems: 'center',
    },
    mapsButtonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
    closeButton: { alignItems: 'center', paddingVertical: 10 },
    closeButtonText: { color: colors.textFaint, fontSize: 14, fontWeight: '600' },
  });
}
