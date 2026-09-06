import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import type { ColorScheme } from '../theme';

function timeAgo(savedAt: number): string {
  const mins = Math.floor((Date.now() - savedAt) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// Shown only while a screen is displaying a cached snapshot because its
// live fetch failed (see src/lib/offlineCache.ts) — not shown once a fresh
// fetch succeeds, so it never looks like "current data" is actually old.
type Props = {
  savedAt: number | null;
  // Full-width list screens (Contacts, Announcements, Schedule) work fine
  // with the default edge margins; HomeScreen's centered-column layout
  // needs its own spacing instead, hence the override.
  style?: StyleProp<ViewStyle>;
};

export function CachedDataBanner({ savedAt, style }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  // Re-render periodically so "5m ago" keeps advancing while the banner
  // stays on screen, instead of freezing at whatever it said on first paint.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (savedAt == null) return;
    const id = setInterval(() => forceTick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, [savedAt]);

  if (savedAt == null) return null;

  return (
    <View style={[styles.banner, style]}>
      <Text style={styles.text}>Showing saved data from {timeAgo(savedAt)} — couldn't reach the server</Text>
    </View>
  );
}

function getStyles(colors: ColorScheme) {
  return StyleSheet.create({
    banner: {
      backgroundColor: colors.highlightTint,
      borderWidth: 1,
      borderColor: colors.highlightBorder,
      borderRadius: 10,
      paddingVertical: 8,
      paddingHorizontal: 12,
      marginHorizontal: 16,
      marginBottom: 10,
    },
    text: { color: colors.highlightText, fontSize: 12, fontWeight: '600', textAlign: 'center' },
  });
}
