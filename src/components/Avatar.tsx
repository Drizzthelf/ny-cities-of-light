import React, { useMemo } from 'react';
import { Image, StyleSheet, Text, View, type ImageStyle, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import type { ColorScheme } from '../theme';

type Props = {
  photoUrl?: string | null;
  name?: string | null;
  size?: number;
  style?: StyleProp<ViewStyle | ImageStyle>;
  textStyle?: StyleProp<TextStyle>;
};

// Shared "no photo" fallback — a circle filled with the first letter of the
// person's name — used everywhere a profile photo can be missing (contacts,
// leaderboard, admin lists, scan results, connection requests) instead of
// each screen inventing its own blank placeholder.
export function Avatar({ photoUrl, name, size = 56, style, textStyle }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const dims = { width: size, height: size, borderRadius: size / 2 };

  if (photoUrl) {
    return <Image source={{ uri: photoUrl }} style={[dims, style as StyleProp<ImageStyle>]} />;
  }

  const initial = name?.trim().charAt(0).toUpperCase() || '?';
  return (
    <View style={[styles.placeholder, dims, style as StyleProp<ViewStyle>]}>
      <Text style={[styles.initial, { fontSize: size * 0.42 }, textStyle]}>{initial}</Text>
    </View>
  );
}

function getStyles(colors: ColorScheme) {
  return StyleSheet.create({
    placeholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryTint },
    initial: { color: colors.primary, fontWeight: '700' },
  });
}
