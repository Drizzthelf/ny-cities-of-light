import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import * as Updates from 'expo-updates';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { fonts, type ColorScheme } from '../theme';

export function SettingsScreen() {
  const { signOut, deleteAccount, profile } = useAuth();
  const { colors, mode, toggleMode } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const { top } = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const [deleting, setDeleting] = useState(false);

  function confirmSignOut() {
    Alert.alert('Sign out?', 'You can sign back in anytime with your email.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: signOut },
    ]);
  }

  function confirmDeleteAccount() {
    Alert.alert(
      'Delete your account?',
      'This permanently removes your profile, contacts, event check-ins, and messages. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            const { error } = await deleteAccount();
            setDeleting(false);
            if (error) {
              Alert.alert('Could not delete account', error);
            }
            // On success, AuthContext's session goes null and RootNavigator
            // returns to AuthFlow on its own — nothing else to do here.
          },
        },
      ]
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: top + 10 }]}>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
        <TouchableOpacity
          style={styles.row}
          // EditProfile lives inside the Profile tab's own stack, not
          // Settings' — cross-tab navigation, same pattern already used
          // for Profile's "My Contacts" button.
          onPress={() => navigation.navigate('Profile', { screen: 'EditProfile' })}
        >
          <Text style={styles.rowText}>Edit profile</Text>
        </TouchableOpacity>

        <View style={styles.row}>
          <Text style={styles.rowText}>Night mode</Text>
          <Switch
            value={mode === 'dark'}
            onValueChange={toggleMode}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor={colors.surface}
          />
        </View>

        <TouchableOpacity style={styles.row} onPress={confirmSignOut}>
          <Text style={styles.rowText}>Sign out</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.row, styles.dangerRow]} onPress={confirmDeleteAccount} disabled={deleting}>
          <Text style={styles.dangerRowText}>{deleting ? 'Deleting...' : 'Delete account'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.row} onPress={() => navigation.navigate('PrivacyPolicy')}>
          <Text style={styles.rowText}>Privacy policy</Text>
        </TouchableOpacity>

        {/* Admin-only — the point is diagnosing "is a given OTA update
            actually running on this device", not something an attendee
            needs to see. isEmbeddedLaunch=true means no OTA update has
            ever been successfully applied; this build's native code is
            all that's running. */}
        {profile?.is_admin && (
          <View style={styles.buildInfoBox}>
            <Text style={styles.buildInfoTitle}>Build info (admin only)</Text>
            <Text style={styles.buildInfoLine}>
              Update: {Updates.isEmbeddedLaunch ? 'embedded (no OTA update applied)' : (Updates.updateId?.slice(0, 8) ?? 'unknown')}
            </Text>
            {!!Updates.createdAt && (
              <Text style={styles.buildInfoLine}>Published: {Updates.createdAt.toLocaleString()}</Text>
            )}
            <Text style={styles.buildInfoLine}>Channel: {Updates.channel || 'none'}</Text>
            <Text style={styles.buildInfoLine}>Runtime version: {Updates.runtimeVersion || 'unknown'}</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function getStyles(colors: ColorScheme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      backgroundColor: colors.panelDark,
      paddingHorizontal: 20,
      paddingBottom: 14,
    },
    headerTitle: { fontSize: 30, fontFamily: fonts.title, color: colors.textOnDark },
    // Without this, the ScrollView's own frame isn't bounded to fill its
    // parent — it was only given a contentContainerStyle, not a style —
    // so on a viewport proportioned differently than a typical iPhone it
    // doesn't actually clip/scroll. This was the real remaining half of
    // the Guideline 4 fix.
    scroll: { flex: 1 },
    // flexGrow, not a plain object with no flex — this is now a
    // ScrollView's contentContainerStyle (Apple review Guideline 4 fix:
    // avoid the same "no way to scroll if content overflows" gap flagged
    // on the QR Meetup/Home screen).
    body: { flexGrow: 1, padding: 24, paddingBottom: 40, gap: 12 },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      alignSelf: 'stretch',
      paddingVertical: 14,
      paddingHorizontal: 16,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.borderStrong,
    },
    rowText: { color: colors.text, fontSize: 15, fontWeight: '600' },
    dangerRow: { borderColor: colors.dangerBorder },
    dangerRowText: { color: colors.danger, fontSize: 15, fontWeight: '600' },
    buildInfoBox: {
      alignSelf: 'stretch',
      marginTop: 8,
      padding: 14,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.borderLight,
      gap: 3,
    },
    buildInfoTitle: {
      color: colors.textFaint,
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 4,
    },
    buildInfoLine: { color: colors.textMuted, fontSize: 12 },
  });
}
