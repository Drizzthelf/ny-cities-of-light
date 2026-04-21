import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { Event, Profile, ServiceRequest } from '../types/database';

type Section = 'events' | 'users' | 'messages';

type RequestWithUser = ServiceRequest & { user: { full_name: string } | null };

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// ─── Main Screen ────────────────────────────────────────────────────────────

export function AdminScreen() {
  const [section, setSection] = useState<Section>('events');

  return (
    <View style={styles.container}>
      <View style={styles.tabBar}>
        {(['events', 'users', 'messages'] as Section[]).map((s) => (
          <TouchableOpacity
            key={s}
            style={[styles.tab, section === s && styles.tabActive]}
            onPress={() => setSection(s)}
          >
            <Text style={[styles.tabText, section === s && styles.tabTextActive]}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {section === 'events' && <EventsSection />}
      {section === 'users' && <UsersSection />}
      {section === 'messages' && <MessagesSection />}
    </View>
  );
}

// ─── Events Section ──────────────────────────────────────────────────────────

function EventsSection() {
  const [events, setEvents] = useState<Event[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<Event | null | 'new'>(null);
  const [qrEvent, setQrEvent] = useState<Event | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('events')
      .select('*')
      .order('start_time', { ascending: true });
    setEvents((data ?? []) as Event[]);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function confirmDelete(e: Event) {
    Alert.alert('Delete event?', `Remove "${e.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('events').delete().eq('id', e.id);
          if (error) Alert.alert('Error', error.message);
          else load();
        },
      },
    ]);
  }

  return (
    <View style={styles.sectionContainer}>
      <TouchableOpacity style={styles.addButton} onPress={() => setEditing('new')}>
        <Text style={styles.addButtonText}>+ Add event</Text>
      </TouchableOpacity>

      <FlatList
        contentContainerStyle={styles.list}
        data={events}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={<Text style={styles.empty}>No events yet. Add one above.</Text>}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{item.title}</Text>
              <Text style={styles.rowMeta}>{formatDateTime(item.start_time)}</Text>
              <Text style={styles.rowMeta}>{item.location_name}</Text>
            </View>
            <View style={styles.rowActions}>
              <TouchableOpacity style={styles.actionBtn} onPress={() => setQrEvent(item)}>
                <Text style={styles.actionBtnText}>QR</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionBtn} onPress={() => setEditing(item)}>
                <Text style={styles.actionBtnText}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, styles.deleteBtn]} onPress={() => confirmDelete(item)}>
                <Text style={[styles.actionBtnText, styles.deleteBtnText]}>Del</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      />

      <EventFormModal
        event={editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); load(); }}
      />

      <Modal visible={!!qrEvent} transparent animationType="fade" onRequestClose={() => setQrEvent(null)}>
        <View style={styles.qrBackdrop}>
          <View style={styles.qrCard}>
            <Text style={styles.qrTitle}>{qrEvent?.title}</Text>
            <Text style={styles.qrSub}>{qrEvent?.location_name}</Text>
            {qrEvent && <QRCode value={`event:${qrEvent.id}`} size={220} />}
            <Text style={styles.qrHint}>Display this at the event for attendees to scan</Text>
            <TouchableOpacity style={styles.qrClose} onPress={() => setQrEvent(null)}>
              <Text style={styles.qrCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function EventFormModal({
  event,
  onClose,
  onSaved,
}: {
  event: Event | 'new' | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = event === 'new';
  const existing = isNew ? null : (event as Event | null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [locationName, setLocationName] = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTitle(existing?.title ?? '');
    setDescription(existing?.description ?? '');
    setStartTime(existing?.start_time ? existing.start_time.slice(0, 16) : '');
    setEndTime(existing?.end_time ? existing.end_time.slice(0, 16) : '');
    setLocationName(existing?.location_name ?? '');
    setAddress(existing?.address ?? '');
  }, [event]);

  async function handleSave() {
    if (!title.trim() || !startTime || !endTime || !locationName.trim() || !address.trim()) {
      Alert.alert('Missing fields', 'Title, times, venue name, and address are required.');
      return;
    }
    setSaving(true);
    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      start_time: new Date(startTime).toISOString(),
      end_time: new Date(endTime).toISOString(),
      location_name: locationName.trim(),
      address: address.trim(),
    };
    const { error } = isNew
      ? await supabase.from('events').insert(payload)
      : await supabase.from('events').update(payload).eq('id', existing!.id);
    setSaving(false);
    if (error) Alert.alert('Error', error.message);
    else onSaved();
  }

  return (
    <Modal visible={!!event} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <ScrollView style={styles.modalCard} keyboardShouldPersistTaps="handled">
          <Text style={styles.modalTitle}>{isNew ? 'Add event' : 'Edit event'}</Text>

          <Text style={styles.label}>Title *</Text>
          <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Opening keynote" placeholderTextColor="#bbb" />

          <Text style={styles.label}>Description</Text>
          <TextInput style={[styles.input, { height: 80 }]} value={description} onChangeText={setDescription} multiline placeholder="Optional details..." placeholderTextColor="#bbb" />

          <Text style={styles.label}>Start time * (YYYY-MM-DDTHH:MM)</Text>
          <TextInput style={styles.input} value={startTime} onChangeText={setStartTime} placeholder="2026-04-28T09:00" placeholderTextColor="#bbb" autoCapitalize="none" />

          <Text style={styles.label}>End time * (YYYY-MM-DDTHH:MM)</Text>
          <TextInput style={styles.input} value={endTime} onChangeText={setEndTime} placeholder="2026-04-28T10:00" placeholderTextColor="#bbb" autoCapitalize="none" />

          <Text style={styles.label}>Venue name *</Text>
          <TextInput style={styles.input} value={locationName} onChangeText={setLocationName} placeholder="Main Hall" placeholderTextColor="#bbb" />

          <Text style={styles.label}>Address *</Text>
          <TextInput style={styles.input} value={address} onChangeText={setAddress} placeholder="123 W 57th St, New York, NY" placeholderTextColor="#bbb" />

          <TouchableOpacity
            style={[styles.saveButton, saving && { opacity: 0.6 }]}
            onPress={handleSave}
            disabled={saving}
          >
            <Text style={styles.saveButtonText}>{saving ? 'Saving...' : 'Save event'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelLink} onPress={onClose}>
            <Text style={styles.cancelLinkText}>Cancel</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Users Section ───────────────────────────────────────────────────────────

function UsersSection() {
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

  useEffect(() => { load(); }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function confirmDeleteUser(p: Profile) {
    Alert.alert('Delete user?', `Remove ${p.full_name}? This also removes their scans.`, [
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
    ]);
  }

  function confirmResetScans() {
    Alert.alert(
      'Reset all scans?',
      'Wipes every scan record. Profiles are kept.',
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
    <View style={styles.sectionContainer}>
      <TouchableOpacity style={[styles.addButton, styles.dangerButton]} onPress={confirmResetScans}>
        <Text style={styles.addButtonText}>Reset all scans</Text>
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
              <Text style={styles.rowTitle}>
                {item.full_name}{item.is_admin ? '  ★' : ''}
              </Text>
              {item.phone ? <Text style={styles.rowMeta}>{item.phone}</Text> : null}
            </View>
            <View style={styles.rowActions}>
              <TouchableOpacity style={styles.actionBtn} onPress={() => setEditing(item)}>
                <Text style={styles.actionBtnText}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, styles.deleteBtn]} onPress={() => confirmDeleteUser(item)}>
                <Text style={[styles.actionBtnText, styles.deleteBtnText]}>Del</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      />

      <EditUserModal
        profile={editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); load(); }}
      />
    </View>
  );
}

function EditUserModal({
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
          <Text style={styles.modalTitle}>Edit user</Text>

          <Text style={styles.label}>Full name</Text>
          <TextInput style={styles.input} value={fullName} onChangeText={setFullName} />

          <Text style={styles.label}>Background</Text>
          <TextInput style={[styles.input, { height: 80 }]} value={background} onChangeText={setBackground} multiline />

          <Text style={styles.label}>Hometown</Text>
          <TextInput style={styles.input} value={hometown} onChangeText={setHometown} />

          <TouchableOpacity style={styles.toggleRow} onPress={() => setIsAdmin((v) => !v)}>
            <View style={[styles.checkbox, isAdmin && styles.checkboxOn]} />
            <Text style={styles.toggleLabel}>Admin</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.saveButton, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
            <Text style={styles.saveButtonText}>{saving ? 'Saving...' : 'Save'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelLink} onPress={onClose}>
            <Text style={styles.cancelLinkText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Messages Section ────────────────────────────────────────────────────────

function MessagesSection() {
  const { session } = useAuth();
  const [requests, setRequests] = useState<RequestWithUser[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [replying, setReplying] = useState<RequestWithUser | null>(null);
  const [replyText, setReplyText] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('service_requests')
      .select('*, user:profiles!service_requests_user_id_fkey(full_name)')
      .order('created_at', { ascending: false });
    setRequests((data ?? []) as RequestWithUser[]);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function openReply(req: RequestWithUser) {
    setReplyText(req.admin_reply ?? '');
    setReplying(req);
  }

  async function handleReply() {
    if (!replying || !session?.user) return;
    setSaving(true);
    const { error } = await supabase
      .from('service_requests')
      .update({
        admin_reply: replyText.trim() || null,
        replied_at: replyText.trim() ? new Date().toISOString() : null,
        replied_by: replyText.trim() ? session.user.id : null,
      })
      .eq('id', replying.id);
    setSaving(false);
    if (error) Alert.alert('Error', error.message);
    else { setReplying(null); load(); }
  }

  return (
    <View style={styles.sectionContainer}>
      <FlatList
        contentContainerStyle={styles.list}
        data={requests}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={<Text style={styles.empty}>No messages yet.</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.msgCard} onPress={() => openReply(item)}>
            <View style={styles.msgHeader}>
              <Text style={styles.msgUser}>{item.user?.full_name ?? 'Unknown'}</Text>
              <Text style={styles.msgDate}>{formatDateTime(item.created_at)}</Text>
            </View>
            <Text style={styles.msgText}>{item.message}</Text>
            {item.admin_reply ? (
              <Text style={styles.msgReplied}>Replied</Text>
            ) : (
              <Text style={styles.msgPending}>Tap to reply</Text>
            )}
          </TouchableOpacity>
        )}
      />

      <Modal visible={!!replying} transparent animationType="slide" onRequestClose={() => setReplying(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Reply</Text>
            <Text style={styles.msgUser}>{replying?.user?.full_name}</Text>
            <Text style={[styles.msgText, { marginBottom: 12 }]}>{replying?.message}</Text>

            <Text style={styles.label}>Your reply</Text>
            <TextInput
              style={[styles.input, { height: 100 }]}
              value={replyText}
              onChangeText={setReplyText}
              multiline
              placeholder="Type a reply..."
              placeholderTextColor="#bbb"
            />

            <TouchableOpacity style={[styles.saveButton, saving && { opacity: 0.6 }]} onPress={handleReply} disabled={saving}>
              <Text style={styles.saveButtonText}>{saving ? 'Saving...' : 'Send reply'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelLink} onPress={() => setReplying(null)}>
              <Text style={styles.cancelLinkText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: '#2563eb' },
  tabText: { fontSize: 14, color: '#94a3b8', fontWeight: '600' },
  tabTextActive: { color: '#2563eb' },
  sectionContainer: { flex: 1 },
  addButton: {
    margin: 14,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#2563eb',
    alignItems: 'center',
  },
  dangerButton: { backgroundColor: '#b91c1c' },
  addButtonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  list: { paddingHorizontal: 14, paddingBottom: 32 },
  empty: { textAlign: 'center', marginTop: 40, color: '#94a3b8' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#f8f8f8',
    borderRadius: 12,
    marginBottom: 10,
  },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarPlaceholder: { backgroundColor: '#ddd' },
  rowText: { flex: 1, marginLeft: 10 },
  rowTitle: { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  rowMeta: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  rowActions: { gap: 6 },
  actionBtn: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 7,
    backgroundColor: '#2563eb',
  },
  deleteBtn: { backgroundColor: '#fde2e2' },
  actionBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  deleteBtnText: { color: '#b91c1c' },
  msgCard: {
    backgroundColor: '#f8f8f8',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  msgHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  msgUser: { fontSize: 13, fontWeight: '700', color: '#1e293b' },
  msgDate: { fontSize: 11, color: '#94a3b8' },
  msgText: { fontSize: 14, color: '#334155', lineHeight: 20 },
  msgReplied: { fontSize: 12, color: '#15803d', marginTop: 6, fontWeight: '600' },
  msgPending: { fontSize: 12, color: '#94a3b8', marginTop: 6, fontStyle: 'italic' },
  qrBackdrop: { flex: 1, backgroundColor: '#00000099', justifyContent: 'center', alignItems: 'center' },
  qrCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    margin: 24,
  },
  qrTitle: { fontSize: 18, fontWeight: '700', color: '#1e293b', marginBottom: 4, textAlign: 'center' },
  qrSub: { fontSize: 13, color: '#64748b', marginBottom: 16 },
  qrHint: { fontSize: 12, color: '#94a3b8', marginTop: 16, textAlign: 'center' },
  qrClose: { marginTop: 16, paddingVertical: 10, paddingHorizontal: 32, backgroundColor: '#2563eb', borderRadius: 10 },
  qrCloseText: { color: '#fff', fontWeight: '600' },
  modalBackdrop: { flex: 1, backgroundColor: '#00000099', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: '#fff',
    padding: 22,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
  },
  modalTitle: { fontSize: 20, fontWeight: '700', marginBottom: 12, color: '#1e293b' },
  label: { fontSize: 12, color: '#64748b', marginTop: 12, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 10,
    fontSize: 15,
    color: '#1e293b',
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
  checkbox: { width: 22, height: 22, borderRadius: 4, borderWidth: 2, borderColor: '#2563eb', marginRight: 10 },
  checkboxOn: { backgroundColor: '#2563eb' },
  toggleLabel: { fontSize: 15, color: '#1e293b' },
  saveButton: { backgroundColor: '#2563eb', padding: 13, borderRadius: 10, alignItems: 'center', marginTop: 20 },
  saveButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  cancelLink: { marginTop: 12, alignItems: 'center' },
  cancelLinkText: { color: '#94a3b8', fontSize: 14 },
});
