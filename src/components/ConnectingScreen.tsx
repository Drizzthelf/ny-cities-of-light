import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useIsOffline } from '../lib/useIsOffline';
import { fonts, type ColorScheme } from '../theme';

type Props = {
  onRetry: () => void;
};

// Shown instead of a bare spinner-on-blank-screen once startup (getSession
// + loadProfile, see AuthContext.tsx) has been stuck loading for more than
// STARTUP_TIMEOUT_MS (RootNavigator.tsx) — a silent white/blank screen for
// several seconds reads as broken, this reads as "still working on it."
export function ConnectingScreen({ onRetry }: Props) {
  const { colors } = useTheme();
  const isOffline = useIsOffline();
  const styles = useMemo(() => getStyles(colors), [colors]);

  return (
    <View style={styles.container}>
      <View style={styles.spinnerBadge}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
      <Text style={styles.title}>Attempting to connect…</Text>
      <Text style={styles.sub}>
        {isOffline
          ? "You're offline — reconnect to wifi or cell data and try again."
          : "This is taking longer than usual. Check your connection and try again."}
      </Text>
      <TouchableOpacity style={styles.button} onPress={onRetry}>
        <Text style={styles.buttonText}>Retry</Text>
      </TouchableOpacity>
    </View>
  );
}

function getStyles(colors: ColorScheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 32,
      backgroundColor: colors.background,
    },
    // Same amber "offline" tint as OfflineBanner/CachedDataBanner — this
    // isn't an error state in this app, just a heads-up.
    spinnerBadge: {
      width: 88,
      height: 88,
      borderRadius: 44,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.highlightTint,
      borderWidth: 1,
      borderColor: colors.highlightBorder,
    },
    title: { fontSize: 21, fontFamily: fonts.title, color: colors.text, marginTop: 22, textAlign: 'center' },
    sub: { fontSize: 14, color: colors.textFaint, marginTop: 8, textAlign: 'center', lineHeight: 20 },
    button: {
      marginTop: 26,
      backgroundColor: colors.primary,
      borderRadius: 10,
      paddingVertical: 13,
      paddingHorizontal: 36,
    },
    buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  });
}
