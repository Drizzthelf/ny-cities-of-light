import React, { useMemo } from 'react';
import { ImageBackground, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { type ColorScheme } from '../theme';
import { useTheme } from '../context/ThemeContext';

// Shared by ScheduleScreen (the real thing) and AdminScreen's event form
// (the live preview) so the preview is pixel-identical to what attendees
// actually see, not a lookalike mockup that can drift out of sync.
export type EventRowData = {
  title: string;
  start_time: string;
  end_time: string;
  location_name: string;
  description?: string | null;
  image_url?: string | null;
  image_opacity?: number | null;
};

type Props = {
  event: EventRowData;
  onOpenMaps?: () => void;
  onPress?: () => void;
};

function formatTime(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '--:--';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function EventRow({ event, onOpenMaps, onPress }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const hasImage = !!event.image_url;
  const overlayOpacity = event.image_opacity ?? 0.4;

  const inner = (
    <View style={styles.inner}>
      <View style={styles.timeCol}>
        <Text style={[styles.timeStart, hasImage && styles.textLight]} numberOfLines={1}>
          {formatTime(event.start_time)}
        </Text>
        <Text style={[styles.timeEnd, hasImage && styles.textMuted]} numberOfLines={1}>
          {formatTime(event.end_time)}
        </Text>
      </View>
      <View style={styles.body}>
        <Text style={[styles.title, hasImage && styles.textLight]}>{event.title || 'Untitled event'}</Text>
        <Text style={[styles.location, hasImage && styles.textAccent]}>{event.location_name}</Text>
        {event.description ? (
          <Text style={[styles.desc, hasImage && styles.textMuted]} numberOfLines={3}>
            {event.description}
          </Text>
        ) : null}
        {onOpenMaps && (
          <TouchableOpacity onPress={onOpenMaps}>
            <Text style={[styles.mapsLink, hasImage && styles.textAccent]}>Open in Maps</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  const card = hasImage ? (
    <ImageBackground source={{ uri: event.image_url! }} style={styles.card} imageStyle={styles.image}>
      <View style={[styles.overlay, { backgroundColor: `rgba(0,0,0,${overlayOpacity})` }]} />
      {inner}
    </ImageBackground>
  ) : (
    <View style={styles.card}>{inner}</View>
  );

  if (!onPress) return card;

  return (
    <TouchableOpacity activeOpacity={0.8} onPress={onPress}>
      {card}
    </TouchableOpacity>
  );
}

function getStyles(colors: ColorScheme) {
  return StyleSheet.create({
    card: {
      borderRadius: 14,
      overflow: 'hidden',
      marginHorizontal: 16,
      marginBottom: 10,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    image: { borderRadius: 14 },
    overlay: { ...StyleSheet.absoluteFillObject },
    inner: { flexDirection: 'row', padding: 14 },
    timeCol: { width: 76, marginRight: 12, alignItems: 'flex-end', flexShrink: 0 },
    timeStart: { fontSize: 13, fontWeight: '700', color: colors.text },
    timeEnd: { fontSize: 11, color: colors.textFaint, marginTop: 2 },
    body: { flex: 1 },
    // Plain bold sans, not fonts.title (PlayfairDisplay italic) — more
    // readable for a schedule you're scanning quickly at a glance.
    title: { fontSize: 16, fontWeight: '700', color: colors.text },
    location: { fontSize: 12, color: colors.primary, marginTop: 3 },
    desc: { fontSize: 13, color: colors.textMuted, marginTop: 5, lineHeight: 18 },
    mapsLink: { fontSize: 12, color: colors.primary, marginTop: 6, fontWeight: '600' },
    // Hardcoded, not colors.X — these sit on a photo behind a dark overlay
    // (see `overlay` above), which looks the same regardless of night mode,
    // so tying them to theme tokens meant they went unreadably dark in dark
    // mode (colors.border and colors.primaryTintBorder are both near-black
    // there). Same reasoning as ScannerScreen's camera-overlay chrome.
    textLight: { color: '#fff' },
    textMuted: { color: 'rgba(255,255,255,0.78)' },
    textAccent: { color: '#8ecdf0' },
  });
}
