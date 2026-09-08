import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useIsOffline } from '../lib/useIsOffline';
import { useTheme } from '../context/ThemeContext';
import type { ColorScheme } from '../theme';

// A persistent strip shown right under a screen's header whenever the
// device has no network connection — distinct from CachedDataBanner
// (which only shows once a specific fetch has already failed and there's
// a stale snapshot to label). This reflects live OS connectivity directly,
// so it's accurate even on a screen that hasn't tried to load anything yet.
// Same highlight/amber treatment as CachedDataBanner, not colors.danger —
// being offline isn't an error state in this app (most of it still works),
// just a heads-up.
type Props = {
  style?: StyleProp<ViewStyle>;
};

export function OfflineBanner({ style }: Props) {
  const isOffline = useIsOffline();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);

  if (!isOffline) return null;

  return (
    <View style={[styles.banner, style]}>
      <Text style={styles.text}>Offline Mode</Text>
    </View>
  );
}

function getStyles(colors: ColorScheme) {
  return StyleSheet.create({
    banner: {
      backgroundColor: colors.highlightTint,
      borderBottomWidth: 1,
      borderBottomColor: colors.highlightBorder,
      paddingVertical: 5,
      alignItems: 'center',
    },
    text: { color: colors.highlightText, fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },
  });
}
