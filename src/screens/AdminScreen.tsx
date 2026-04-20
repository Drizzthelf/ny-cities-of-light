import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  Modal,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { supabase } from '../lib/supabase';
import type { Profile } from '../types/database';

export function AdminScreen() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });
    setProfiles((data ?? []) as Profile[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function confirmDeleteUser(p: Profile) {
    Alert.alert(
      'Delete user?',
      `Remove ${p.full_name}? This also removes their scans.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase.from('profiles').delete().eq('id', p.id);
            if (error) Alert.alert('Error', error.message);
            else load();
          },
        },
      ]
    );
  }

  function confirmResetScans() {
    Alert.alert(
      'Reset all scans?',
      'Wipes every scan record (leaderboard and contacts). Profiles are kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase.rpc('admin_reset_scans');
            if (error) Alert.alert('Error', error.message);
            else Alert.alert('Done', 'All scans have been reset.');
          },
        },
      ]
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.resetButton} onPress={confirmResetScans}>
        <Text style={styles.resetButtonText}>Reset all scans</Text>
      </TouchableOpacity>

      <FlatList
        contentContainerStyle={styles.list}
        data={profiles}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        renderItem={({ item }) => (
          <View style={styles.row}>
            {item.photo_url ? (
              <Image source={{ uri: item.photo_url }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder]} />
            )}
            <View style={styles.rowText}>
              <Text style={styles.name}>
                {item.full_name}
                {item.is_admin ? '  ★' : ''}
              </Text>
              {item.phone ? <Text style={styles.meta}>{item.phone}</Text> : null}
              {item.background ? (
                <Text style={styles.meta} numberOfLines={1}>
                  {item.background}
                </Text>
              ) : null}
            </View>
            <View>
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => setEditing(item)}
              >
                <Text style={styles.actionText}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionButton, styles.deleteButton]}
                onPress={() => confirmDeleteUser(item)}
              >
                <Text style={[styles.actionText, styles.deleteText]}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      />

      <EditModal
        profile={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          load();
        }}
      />
    </View>
  );
}

function EditModal({
  profile,
  onClose,
  onSaved,
}: {
  profile: Profile | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [fullName, setFullName] = useState('');
  const [background, setBackground] = useState('');
  const [hometown, setHometown] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setFullName(profile?.full_name ?? '');
    setBackground(profile?.background ?? '');
    setHometown(profile?.hometown ?? '');
    setIsAdmin(profile?.is_admin ?? false);
  }, [profile]);

  async function handleSave() {
    if (!profile) return;
    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: fullName.trim(),
        background: background.trim() || null,
        hometown: hometown.trim() || null,
        is_admin: isAdmin,
      })
      .eq('id', profile.id);
    setSaving(false);
    if (error) Alert.alert('Error', error.message);
    else onSaved();
  }

  return (
    <Modal visible={!!profile} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Edit profile</Text>

          <Text style={styles.label}>Full name</Text>
          <TextInput style={styles.input} value={fullName} onChangeText={setFullName} />

          <Text style={styles.label}>Background</Text>
          <TextInput
            style={[styles.input, { height: 80 }]}
            value={background}
            onChangeText={setBackground}
            multiline
          />

          <Text style={styles.label}>Hometown</Text>
          <TextInput style={styles.input} value={hometown} onChangeText={setHometown} />

          <TouchableOpacity
            style={styles.toggleRow}
            onPress={() => setIsAdmin((v) => !v)}
          >
            <View style={[styles.checkbox, isAdmin && styles.checkboxOn]} />
            <Text style={styles.toggleLabel}>Admin</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.saveButton, saving && { opacity: 0.6 }]}
            onPress={handleSave}
            disabled={saving}
          >
            <Text style={styles.saveButtonText}>{saving ? 'Saving...' : 'Save'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={{ marginTop: 10 }} onPress={onClose}>
            <Text style={{ color: '#888', textAlign: 'center' }}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  resetButton: {
    margin: 16,
    padding: 14,
    borderRadius: 10,
    backgroundColor: '#b91c1c',
    alignItems: 'center',
  },
  resetButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#f8f8f8',
    borderRadius: 12,
    marginBottom: 10,
  },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  avatarPlaceholder: { backgroundColor: '#ddd' },
  rowText: { flex: 1, marginLeft: 12 },
  name: { fontSize: 15, fontWeight: '600' },
  meta: { color: '#666', fontSize: 12, marginTop: 2 },
  actionButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#2563eb',
    marginBottom: 6,
  },
  deleteButton: { backgroundColor: '#fde2e2' },
  actionText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  deleteText: { color: '#b91c1c' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: '#00000099',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#fff',
    padding: 22,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  modalTitle: { fontSize: 20, fontWeight: '700', marginBottom: 12 },
  label: { fontSize: 12, color: '#666', marginTop: 10, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
    fontSize: 15,
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#2563eb',
    marginRight: 10,
  },
  checkboxOn: { backgroundColor: '#2563eb' },
  toggleLabel: { fontSize: 15 },
  saveButton: {
    backgroundColor: '#2563eb',
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 20,
  },
  saveButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
