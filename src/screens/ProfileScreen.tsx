import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Image, ImageBackground, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { OfflineBanner } from '../components/OfflineBanner';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import type { SocialPlatform } from '../types/database';
import { type ColorScheme } from '../theme';

const SKYLINE = require('../../assets/nyc-skyline.jpg');

type Props = {
  onViewContacts: () => void;
};

const SOCIAL_ICONS: Record<SocialPlatform, keyof typeof Ionicons.glyphMap> = {
  instagram: 'logo-instagram',
  facebook: 'logo-facebook',
  twitter: 'logo-twitter',
  tiktok: 'logo-tiktok',
};

function chunkPairs<T>(items: T[]): T[][] {
  const pairs: T[][] = [];
  for (let i = 0; i < items.length; i += 2) pairs.push(items.slice(i, i + 2));
  return pairs;
}

export function ProfileScreen({ onViewContacts }: Props) {
  const { profile, refreshProfile } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const [photoEnlarged, setPhotoEnlarged] = useState(false);

  // Picks up changes made directly in the database (e.g. an admin flag
  // flipped by hand in Supabase) without requiring a force-quit — this
  // screen has no scrollable container to hang a pull-to-refresh off of,
  // so refresh-on-focus is the natural fit instead.
  useFocusEffect(
    useCallback(() => {
      refreshProfile();
    }, [refreshProfile])
  );

  if (!profile) return <ActivityIndicator style={{ flex: 1 }} />;

  const socials = profile.profile_socials;

  return (
    <ImageBackground source={SKYLINE} style={styles.bg} resizeMode="cover">
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom', 'left', 'right']}>
        <OfflineBanner />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
          <Text style={styles.logoHeadline}>{'Anchored\nin ✶ Christ'}</Text>
          <Text style={styles.logoSub}>– Cities of Light –</Text>

          <View style={styles.stack}>
            {profile.photo_url ? (
              <TouchableOpacity style={styles.photoTouchable} activeOpacity={0.85} onPress={() => setPhotoEnlarged(true)}>
                <Image source={{ uri: profile.photo_url }} style={styles.photo} />
              </TouchableOpacity>
            ) : (
              <View style={styles.photoPlaceholder}>
                <Text style={styles.photoPlaceholderInitial}>
                  {profile.first_name.trim() ? profile.first_name.trim()[0].toUpperCase() : '?'}
                </Text>
              </View>
            )}

            <View style={styles.infoBox}>
              <Text style={styles.name}>{profile.first_name}</Text>

              {socials.length > 0 ? (
                <View style={styles.socialsBox}>
                  {chunkPairs(socials).map((pair, i) => (
                    <View key={i} style={styles.socialGridRow}>
                      {pair.map((s) => (
                        <View key={s.id} style={styles.socialCell}>
                          <Ionicons name={SOCIAL_ICONS[s.platform]} size={18} color="#fff" />
                          <Text style={styles.socialHandle}>{s.handle}</Text>
                        </View>
                      ))}
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.hint}>No social handles added yet.</Text>
              )}
            </View>

            <TouchableOpacity style={styles.contactsButton} onPress={onViewContacts}>
              <Text style={styles.contactsButtonText}>My Contacts</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>

        <Modal visible={photoEnlarged} transparent animationType="fade" onRequestClose={() => setPhotoEnlarged(false)}>
          <TouchableOpacity style={styles.enlargeBackdrop} activeOpacity={1} onPress={() => setPhotoEnlarged(false)}>
            {profile.photo_url && <Image source={{ uri: profile.photo_url }} style={styles.enlargedPhoto} />}
          </TouchableOpacity>
        </Modal>
      </SafeAreaView>
    </ImageBackground>
  );
}

function getStyles(colors: ColorScheme) {
  return StyleSheet.create({
    bg: { flex: 1 },
    safeArea: { flex: 1 },
    // Without this, the ScrollView's own frame isn't bounded to fill its
    // parent — it was only given a contentContainerStyle, not a style —
    // so on a viewport proportioned differently than a typical iPhone it
    // doesn't actually clip/scroll, and bottom content (the My Contacts
    // button, on an iPad) stays unreachable. This was the real remaining
    // half of the Guideline 4 fix.
    scroll: { flex: 1 },
    // flexGrow, not flex — this is a ScrollView's contentContainerStyle now
    // (Apple review Guideline 4 fix: this screen had no way to scroll if
    // its content ever overflowed the viewport, e.g. on an iPad running it
    // in compatibility mode — same gap flagged and fixed on the QR
    // Meetup/Home screen). flexGrow keeps content centered/filling on a
    // normal-height screen while still allowing it to grow and scroll.
    container: { flexGrow: 1, alignItems: 'center', paddingHorizontal: 24, paddingBottom: 24, paddingTop: 8 },
    // Matches "Cities of Light Font Example.png": a big bold-condensed
    // headline ("ANCHORED IN CHRIST") with a smaller letter-spaced subhead
    // ("CITIES OF LIGHT") beneath it — the poster's actual hierarchy, now
    // that the bottom tab-bar banner carrying this line has been removed.
    logoHeadline: {
      textAlign: 'center',
      textTransform: 'uppercase',
      fontWeight: '900',
      letterSpacing: 1,
      fontSize: 38,
      lineHeight: 42,
      color: '#fff',
      textShadowColor: 'rgba(0,0,0,0.7)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 5,
    },
    logoSub: {
      textAlign: 'center',
      textTransform: 'uppercase',
      fontWeight: '600',
      letterSpacing: 4,
      fontSize: 14,
      marginTop: 8,
      color: '#fff',
      textShadowColor: 'rgba(0,0,0,0.7)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 4,
    },
    stack: {
      marginTop: 24,
      alignSelf: 'stretch',
      alignItems: 'center',
      paddingHorizontal: 24,
      paddingBottom: 24,
    },
    photoTouchable: { alignSelf: 'center', width: '85%' },
    photo: {
      width: '100%',
      aspectRatio: 1,
      borderRadius: 9999,
      borderWidth: 1.5,
      borderColor: 'rgba(255,255,255,0.6)',
    },
    photoPlaceholder: {
      alignSelf: 'center',
      width: '85%',
      aspectRatio: 1,
      borderRadius: 9999,
      backgroundColor: colors.primaryTint,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1.5,
      borderColor: 'rgba(255,255,255,0.6)',
    },
    photoPlaceholderInitial: { color: colors.primary, fontSize: 96, fontWeight: '700' },
    infoBox: {
      marginTop: 24,
      // Fixed, not content-driven — sized for the worst case (name + two
      // rows of social handles) so the box, and therefore the "My
      // Contacts" button right after it, sit in the same place whether
      // this user has 0 or 4 handles.
      minHeight: 150,
      justifyContent: 'center',
      alignItems: 'center',
      alignSelf: 'stretch',
      paddingVertical: 16,
      paddingHorizontal: 20,
      borderRadius: 16,
      borderWidth: 1.5,
      borderColor: 'rgba(255,255,255,0.6)',
      backgroundColor: 'rgba(0,0,0,0.8)',
    },
    // Plain bold sans, not fonts.title (PlayfairDisplay italic) — that
    // serif italic reads fine as a section heading but is noticeably
    // harder to read at a glance for someone's own name.
    name: {
      fontSize: 26,
      fontWeight: '700',
      color: '#fff',
      textShadowColor: 'rgba(0,0,0,0.7)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 5,
    },
    hint: {
      color: '#fff',
      marginTop: 16,
      fontSize: 13,
      textShadowColor: 'rgba(0,0,0,0.7)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 4,
    },
    // A real 2-column grid (paired rows of equal-width cells), not a
    // centered wrap — so column edges line up across rows instead of each
    // line re-centering itself independently. With at most 4 possible
    // platforms (see SOCIAL_ICONS), this is one row for 1-2 handles and
    // two rows for 3-4, without any per-count branching.
    socialsBox: {
      marginTop: 16,
      alignSelf: 'stretch',
      gap: 10,
    },
    socialGridRow: {
      flexDirection: 'row',
      gap: 22,
    },
    // flex: 1, not shrink-wrap — both cells in a row take equal width, so
    // column 2 always starts at the same x regardless of how long either
    // handle is, with content left-aligned inside each cell.
    socialCell: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    socialHandle: {
      color: '#fff',
      fontSize: 14,
      fontWeight: '600',
      textShadowColor: 'rgba(0,0,0,0.7)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 4,
    },
    contactsButton: {
      marginTop: 24,
      alignSelf: 'stretch',
      paddingVertical: 13,
      borderRadius: 10,
      alignItems: 'center',
      // Same tint as infoBox, not colors.panelDark — this button sits
      // directly on the skyline background like the info box does, so it
      // gets the same translucent-black treatment instead of a solid fill.
      backgroundColor: 'rgba(0,0,0,0.8)',
      borderWidth: 1.5,
      borderColor: 'rgba(255,255,255,0.6)',
    },
    contactsButtonText: { color: colors.textOnDark, fontWeight: '600', fontSize: 15 },
    enlargeBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', alignItems: 'center', padding: 24 },
    enlargedPhoto: { width: '100%', aspectRatio: 1, borderRadius: 20 },
  });
}
