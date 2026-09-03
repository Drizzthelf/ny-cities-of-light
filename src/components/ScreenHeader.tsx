import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { fonts, type ColorScheme } from '../theme';
import { useTheme } from '../context/ThemeContext';

type Props = {
  title: string;
  backLabel?: string;
  // 'plain' (default) is the original white/bordered bar. 'banner' is the
  // black/cream treatment shared with the Updates and Schedule banners —
  // opt-in per screen rather than a blanket change to every ScreenHeader
  // consumer (e.g. the edit-profile form keeps 'plain').
  variant?: 'plain' | 'banner';
};

// Renders its own back button instead of relying on native-stack's built-in
// header. Several screens in this app sit in a bottom-tab screen with
// headerShown: false wrapping a nested stack navigator — a topology with
// confirmed upstream bugs under React Native's New Architecture (enabled in
// this project's app.json) where the native header's back button silently
// stops responding (react-native-screens#1460, expo/expo#30141). This
// sidesteps the whole bug class rather than chasing it per-screen.
export function ScreenHeader({ title, backLabel = 'Back', variant = 'plain' }: Props) {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const banner = variant === 'banner';
  return (
    <SafeAreaView style={[styles.container, banner && styles.containerBanner]} edges={['top']}>
      <View style={styles.row}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={[styles.backButtonText, banner && styles.backButtonTextBanner]} numberOfLines={1}>
            ‹ {backLabel}
          </Text>
        </TouchableOpacity>
        <Text style={[styles.title, banner && styles.titleBanner]} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.backButton} />
      </View>
    </SafeAreaView>
  );
}

function getStyles(colors: ColorScheme) {
  return StyleSheet.create({
    container: { backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
    // panelDark, not colors.text — this banner is deliberately black in
    // both light and dark mode, not "page text color" that happens to be
    // black in light mode.
    containerBanner: { backgroundColor: colors.panelDark, borderBottomWidth: 0 },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8 },
    backButton: { paddingVertical: 12, paddingHorizontal: 12, minWidth: 64 },
    backButtonText: { color: colors.primary, fontSize: 16, fontWeight: '600' },
    backButtonTextBanner: { color: colors.textOnDark },
    title: { fontSize: 19, fontFamily: fonts.title, color: colors.text },
    titleBanner: { fontSize: 21, color: colors.textOnDark },
  });
}
