import React, { useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

type Props = {
  mode?: 'create' | 'edit';
};

export function ProfileSetupScreen({ mode = 'create' }: Props) {
  const { session, profile, refreshProfile } = useAuth();
  const [fullName, setFullName] = useState(profile?.full_name ?? '');
  const [background, setBackground] = useState(profile?.background ?? '');
  const [hometown, setHometown] = useState(profile?.hometown ?? '');
  const [localPhotoUri, setLocalPhotoUri] = useState<string | null>(null);
  const [savedPhotoUrl, setSavedPhotoUrl] = useState<string | null>(profile?.photo_url ?? null);
  const [saving, setSaving] = useState(false);

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
      Alert.alert('Missing name', 'Please enter your full name.');
      return;
    }
    setSaving(true);
    try {
      let photoUrl = savedPhotoUrl;
      if (localPhotoUri) {
        photoUrl = await uploadPhoto(localPhotoUri, session.user.id);
      }
      const row = {
        id: session.user.id,
        full_name: fullName.trim(),
        background: background.trim() || null,
        hometown: hometown.trim() || null,
        photo_url: photoUrl,
        phone: session.user.phone ?? null,
      };
      const { error } = await supabase.from('profiles').upsert(row);
      if (error) throw error;
      await refreshProfile();
    } catch (err: any) {
      Alert.alert('Could not save profile', err.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  const displayPhoto = localPhotoUri ?? savedPhotoUrl;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>
          {mode === 'edit' ? 'Edit your profile' : 'Create your profile'}
        </Text>

        <TouchableOpacity style={styles.photoPicker} onPress={pickPhoto}>
          {displayPhoto ? (
            <Image source={{ uri: displayPhoto }} style={styles.photo} />
          ) : (
            <View style={styles.photoPlaceholder}>
              <Text style={styles.photoPlaceholderText}>Tap to add photo</Text>
            </View>
          )}
        </TouchableOpacity>

        <Text style={styles.label}>Full name *</Text>
        <TextInput
          style={styles.input}
          value={fullName}
          onChangeText={setFullName}
          placeholder="Jane Smith"
          placeholderTextColor="#999"
        />

        <Text style={styles.label}>Background</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={background}
          onChangeText={setBackground}
          placeholder="Software engineer at Acme, climbing, coffee"
          placeholderTextColor="#999"
          multiline
          numberOfLines={3}
        />

        <Text style={styles.label}>Where you're from</Text>
        <TextInput
          style={styles.input}
          value={hometown}
          onChangeText={setHometown}
          placeholder="Seattle, WA"
          placeholderTextColor="#999"
        />

        <TouchableOpacity
          style={[styles.button, saving && styles.buttonDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          <Text style={styles.buttonText}>
            {saving ? 'Saving...' : mode === 'edit' ? 'Save changes' : 'Save and continue'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  scroll: { padding: 24, paddingBottom: 40 },
  title: { fontSize: 26, fontWeight: '700', textAlign: 'center', marginBottom: 24 },
  photoPicker: { alignItems: 'center', marginBottom: 24 },
  photo: { width: 140, height: 140, borderRadius: 70 },
  photoPlaceholder: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: '#f1f1f1',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#ddd',
    borderStyle: 'dashed',
  },
  photoPlaceholderText: { color: '#777', fontSize: 13 },
  label: { fontSize: 13, color: '#555', marginBottom: 6, marginTop: 10 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
  },
  multiline: { height: 90, textAlignVertical: 'top' },
  button: {
    backgroundColor: '#2563eb',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 24,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
