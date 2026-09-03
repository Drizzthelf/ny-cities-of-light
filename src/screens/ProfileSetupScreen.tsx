import React, { useMemo, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { ScreenHeader } from '../components/ScreenHeader';
import type { SocialPlatform } from '../types/database';
import { fonts, type ColorScheme } from '../theme';

type Props = {
  mode?: 'create' | 'edit';
  // Only meaningful for mode="edit" — mode="create" renders directly under
  // RootNavigator with no navigator/back target to return to (see the
  // safe-area comment below), so it's a plain callback rather than this
  // component reaching for `useNavigation()` itself, which would throw
  // there.
  onSaved?: () => void;
};

const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  twitter: 'Twitter',
  tiktok: 'TikTok',
};
const ALL_PLATFORMS: SocialPlatform[] = ['instagram', 'facebook', 'twitter', 'tiktok'];

type SocialEntry = { platform: SocialPlatform; handle: string };

export function ProfileSetupScreen({ mode = 'create', onSaved }: Props) {
  const { session, profile, refreshProfile, signOut, pendingRegistrationCode, setPendingRegistrationCode } =
    useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  // Normally arrives pre-verified from the registration-code screen at the
  // start of AuthFlow. Only null here if the user had a session but no
  // profile yet with nothing pending (e.g. they verified OTP, then
  // force-quit before finishing their profile) — in that case we fall back
  // to asking for the code again below, same as before this screen existed.
  const [code, setCode] = useState(pendingRegistrationCode ?? '');
  const needsCodeInput = mode === 'create' && !pendingRegistrationCode;
  const [fullName, setFullName] = useState(profile?.first_name ?? '');
  const [socials, setSocials] = useState<SocialEntry[]>(
    profile?.profile_socials.map((s) => ({ platform: s.platform, handle: s.handle })) ?? []
  );
  const [pickerForIndex, setPickerForIndex] = useState<number | null>(null);
  const [localPhotoUri, setLocalPhotoUri] = useState<string | null>(null);
  const [savedPhotoUrl, setSavedPhotoUrl] = useState<string | null>(profile?.photo_url ?? null);
  const [saving, setSaving] = useState(false);

  function addSocial() {
    const used = new Set(socials.map((s) => s.platform));
    const next = ALL_PLATFORMS.find((p) => !used.has(p));
    if (!next) return;
    setSocials([...socials, { platform: next, handle: '' }]);
  }

  function removeSocial(index: number) {
    setSocials(socials.filter((_, i) => i !== index));
  }

  function updateHandle(index: number, handle: string) {
    setSocials(socials.map((s, i) => (i === index ? { ...s, handle } : s)));
  }

  function updatePlatform(index: number, platform: SocialPlatform) {
    setSocials(socials.map((s, i) => (i === index ? { ...s, platform } : s)));
    setPickerForIndex(null);
  }

  async function pickPhoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Please allow photo library access.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) {
      setLocalPhotoUri(result.assets[0].uri);
    }
  }

  async function uploadPhoto(uri: string, userId: string): Promise<string> {
    const ext = (uri.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `${userId}/avatar-${Date.now()}.${ext}`;
    const contentType = ext === 'png' ? 'image/png' : 'image/jpeg';
    const response = await fetch(uri);
    const arrayBuffer = await response.arrayBuffer();
    const { error } = await supabase.storage
      .from('profile-photos')
      .upload(path, arrayBuffer, { contentType, upsert: true });
    if (error) throw error;
    const { data } = supabase.storage.from('profile-photos').getPublicUrl(path);
    return data.publicUrl;
  }

  async function handleSave() {
    if (!session?.user) return;
    if (!fullName.trim()) {
      Alert.alert('Missing name', 'Please enter your first name.');
      return;
    }
    if (needsCodeInput && !code.trim()) {
      Alert.alert('Missing code', 'Enter the registration code from conference staff.');
      return;
    }
    setSaving(true);
    try {
      let photoUrl = savedPhotoUrl;
      if (localPhotoUri) {
        photoUrl = await uploadPhoto(localPhotoUri, session.user.id);
      }

      // Creating a new profile is gated behind the registration code —
      // enforced server-side in create_profile_with_code, not just here.
      // Editing an existing profile is a plain UPDATE and needs no code.
      if (mode === 'create') {
        const { error } = await supabase.rpc('create_profile_with_code', {
          p_code: code.trim(),
          p_first_name: fullName.trim(),
          p_photo_url: photoUrl,
        });
        if (error) throw error;
        setPendingRegistrationCode(null);
      } else {
        const { error } = await supabase
          .from('profiles')
          .update({ first_name: fullName.trim(), photo_url: photoUrl })
          .eq('id', session.user.id);
        if (error) throw error;
      }

      const { error: deleteError } = await supabase
        .from('profile_socials')
        .delete()
        .eq('profile_id', session.user.id);
      if (deleteError) throw deleteError;

      const socialRows = socials
        .filter((s) => s.handle.trim())
        .map((s) => ({ profile_id: session.user.id, platform: s.platform, handle: s.handle.trim() }));
      if (socialRows.length) {
        const { error: insertError } = await supabase.from('profile_socials').insert(socialRows);
        if (insertError) throw insertError;
      }

      await refreshProfile();
      if (mode === 'edit') onSaved?.();
    } catch (err: any) {
      if (err.code === '23503') {
        Alert.alert(
          'Session out of date',
          "Your sign-in no longer matches an account on the server. Sign out and sign back in to fix this.",
          [
            { text: 'Sign out', onPress: signOut },
            { text: 'Cancel', style: 'cancel' },
          ]
        );
      } else {
        if (mode === 'create' && pendingRegistrationCode) {
          // The pre-verified code was rejected here too (e.g. rotated in
          // between) — clear it so the field reappears for a manual retry
          // instead of silently resubmitting the same stale code forever.
          setPendingRegistrationCode(null);
        }
        Alert.alert('Could not save profile', err.message ?? String(err));
      }
    } finally {
      setSaving(false);
    }
  }

  const displayPhoto = localPhotoUri ?? savedPhotoUrl;
  const usedPlatforms = new Set(socials.map((s) => s.platform));
  const canAddMore = usedPlatforms.size < ALL_PLATFORMS.length;

  return (
    // mode === 'create' renders directly under RootNavigator with no
    // header/navigator around it (see RootNavigator.tsx) — unlike 'edit',
    // which gets top-inset padding for free from ScreenHeader, so this
    // needs its own top safe-area edge or the title collides with the
    // status bar / Dynamic Island on iPhone.
    <SafeAreaView style={styles.container} edges={mode === 'edit' ? [] : ['top']}>
    <KeyboardAvoidingView
      style={styles.flexOne}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {mode === 'edit' && <ScreenHeader title="Edit profile" />}
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {mode === 'create' && <Text style={styles.title}>Create your profile</Text>}

        {needsCodeInput && (
          <>
            <Text style={styles.label}>Registration code *</Text>
            <TextInput
              style={styles.input}
              value={code}
              onChangeText={setCode}
              placeholder="Given to you by conference staff"
              placeholderTextColor={colors.textFaint}
              autoCapitalize="characters"
              autoCorrect={false}
            />
          </>
        )}

        <View style={styles.photoSection}>
          <TouchableOpacity style={styles.photoPicker} onPress={pickPhoto}>
            {displayPhoto ? (
              <Image source={{ uri: displayPhoto }} style={styles.photo} />
            ) : (
              <View style={styles.photoPlaceholder}>
                <Text style={styles.photoPlaceholderInitial}>
                  {fullName.trim() ? fullName.trim()[0].toUpperCase() : '?'}
                </Text>
              </View>
            )}
          </TouchableOpacity>
          {displayPhoto && (
            <TouchableOpacity
              style={styles.removePhotoLink}
              onPress={() => {
                setLocalPhotoUri(null);
                setSavedPhotoUrl(null);
              }}
            >
              <Text style={styles.removePhotoLinkText}>Remove photo</Text>
            </TouchableOpacity>
          )}
        </View>

        <Text style={styles.label}>First name *</Text>
        <TextInput
          style={styles.input}
          value={fullName}
          onChangeText={setFullName}
          placeholder="Jane"
          placeholderTextColor={colors.textFaint}
        />

        <Text style={styles.label}>Social handles</Text>
        {socials.map((social, index) => (
          <View key={index} style={styles.socialRow}>
            <TouchableOpacity style={styles.platformSelect} onPress={() => setPickerForIndex(index)}>
              <Text style={styles.platformSelectText}>{PLATFORM_LABELS[social.platform]}</Text>
              <Text style={styles.chevron}>▾</Text>
            </TouchableOpacity>
            <TextInput
              style={[styles.input, styles.socialInput]}
              value={social.handle}
              onChangeText={(v) => updateHandle(index, v)}
              placeholder="@yourhandle"
              placeholderTextColor={colors.textFaint}
              autoCapitalize="none"
              maxLength={30}
            />
            <TouchableOpacity style={styles.removeButton} onPress={() => removeSocial(index)}>
              <Text style={styles.removeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>
        ))}

        {canAddMore && (
          <TouchableOpacity style={styles.addButton} onPress={addSocial}>
            <Text style={styles.addButtonText}>+ Add social handle</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.button, saving && styles.buttonDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          <Text style={styles.buttonText}>
            {saving ? 'Saving...' : mode === 'edit' ? 'Save changes' : 'Save and continue'}
          </Text>
        </TouchableOpacity>

        {mode === 'create' && (
          <TouchableOpacity style={styles.linkButton} onPress={signOut}>
            <Text style={styles.linkText}>Sign out</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <Modal
        visible={pickerForIndex !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerForIndex(null)}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setPickerForIndex(null)}
        >
          <View style={styles.modalCard}>
            {ALL_PLATFORMS.filter(
              (p) => pickerForIndex !== null && (socials[pickerForIndex].platform === p || !usedPlatforms.has(p))
            ).map((p) => (
              <TouchableOpacity
                key={p}
                style={styles.modalOption}
                onPress={() => updatePlatform(pickerForIndex!, p)}
              >
                <Text style={styles.modalOptionText}>{PLATFORM_LABELS[p]}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function getStyles(colors: ColorScheme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    flexOne: { flex: 1 },
    scroll: { padding: 24, paddingBottom: 40 },
    title: { fontSize: 28, fontFamily: fonts.title, color: colors.text, textAlign: 'center', marginBottom: 24 },
    photoSection: { alignItems: 'center', marginTop: 20, marginBottom: 24 },
    photoPicker: { alignItems: 'center' },
    photo: { width: 140, height: 140, borderRadius: 70 },
    photoPlaceholder: {
      width: 140,
      height: 140,
      borderRadius: 70,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    photoPlaceholderInitial: { color: '#fff', fontSize: 56, fontWeight: '600' },
    removePhotoLink: { alignItems: 'center', marginTop: 10 },
    removePhotoLinkText: { color: colors.danger, fontSize: 13, fontWeight: '600' },
    label: { fontSize: 13, color: colors.textMuted, marginBottom: 6, marginTop: 10 },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      padding: 12,
      fontSize: 16,
      color: colors.text,
      backgroundColor: colors.surface,
    },
    socialRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 8 },
    platformSelect: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingVertical: 12,
      paddingHorizontal: 10,
      gap: 4,
    },
    platformSelectText: { fontSize: 14, color: colors.textSecondary },
    chevron: { fontSize: 12, color: colors.textFaint },
    socialInput: { flex: 1 },
    removeButton: { padding: 8 },
    removeButtonText: { fontSize: 16, color: colors.textFaint },
    addButton: { alignSelf: 'flex-start', marginTop: 4, marginBottom: 10 },
    addButtonText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
    button: {
      backgroundColor: colors.primary,
      padding: 14,
      borderRadius: 10,
      alignItems: 'center',
      marginTop: 24,
    },
    buttonDisabled: { opacity: 0.6 },
    buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
    linkButton: { alignItems: 'center', marginTop: 16 },
    linkText: { color: colors.textFaint, fontSize: 13 },
    modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', padding: 32 },
    modalCard: { backgroundColor: colors.surface, borderRadius: 14, paddingVertical: 8 },
    modalOption: { paddingVertical: 14, paddingHorizontal: 20 },
    modalOptionText: { fontSize: 16, color: colors.text },
  });
}
