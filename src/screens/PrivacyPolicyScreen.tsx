import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ScreenHeader } from '../components/ScreenHeader';
import { PRIVACY_POLICY_TEXT, PRIVACY_POLICY_UPDATED } from '../content/privacyPolicy';
import { useTheme } from '../context/ThemeContext';
import { type ColorScheme } from '../theme';

// Split on blank lines rather than rendering one giant Text — gives each
// paragraph/heading its own natural wrap and a little breathing room,
// closer to how the source document reads.
const PARAGRAPHS = PRIVACY_POLICY_TEXT.split(/\n\n+/);

export function PrivacyPolicyScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);

  return (
    <View style={styles.container}>
      <ScreenHeader title="Privacy Policy" backLabel="Settings" />
      <ScrollView style={styles.scrollFlex} contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>PRIVACY POLICY</Text>
        <Text style={styles.updated}>{PRIVACY_POLICY_UPDATED}</Text>
        {PARAGRAPHS.map((p, i) => (
          <Text key={i} style={styles.paragraph}>
            {p}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}

function getStyles(colors: ColorScheme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    // Without this, the ScrollView's own frame isn't bounded to fill its
    // parent — it was only given a contentContainerStyle, not a style — so
    // this entire (long) legal document didn't actually scroll. Same root
    // cause as the Guideline 4 fix on Home/Profile/Settings.
    scrollFlex: { flex: 1 },
    scroll: { padding: 20, paddingBottom: 48 },
    title: { fontSize: 13, fontWeight: '800', letterSpacing: 1, color: colors.text, marginBottom: 4 },
    updated: { fontSize: 12, color: colors.textFaint, marginBottom: 16 },
    paragraph: { fontSize: 14, lineHeight: 21, color: colors.textSecondary, marginBottom: 16 },
  });
}
