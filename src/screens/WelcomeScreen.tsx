import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { fonts, type ColorScheme } from '../theme';

type Props = {
  onContinue: () => void;
};

export function WelcomeScreen({ onContinue }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome!</Text>
      <Text style={styles.subtitle}>
        You're in. Let's get your profile set up so you can start connecting.
      </Text>
      <TouchableOpacity style={styles.button} onPress={onContinue}>
        <Text style={styles.buttonText}>Set up profile</Text>
      </TouchableOpacity>
    </View>
  );
}

function getStyles(colors: ColorScheme) {
  return StyleSheet.create({
    container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: colors.background },
    title: { fontSize: 36, fontFamily: fonts.title, color: colors.text, textAlign: 'center', marginBottom: 8 },
    subtitle: { fontSize: 16, color: colors.textMuted, textAlign: 'center', marginBottom: 32 },
    button: {
      backgroundColor: colors.primary,
      padding: 14,
      borderRadius: 10,
      alignItems: 'center',
    },
    buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  });
}
