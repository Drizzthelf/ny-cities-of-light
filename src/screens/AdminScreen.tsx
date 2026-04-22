import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import QRCode from 'react-native-qrcode-svg';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { Announcement, Event, Profile, ServiceRequest } from '../types/database';

type Section = 'events' | 'users' | 'messages' | 'feed';

const TAB_LABELS: Record<Section, string> = {
  events: 'Events',
  users: 'Users',
  messages: 'Msgs',
  feed: 'Feed',
};

type RequestWithUser = ServiceRequest & { user: { full_name: string } | null };

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function fmtDate(d: Date) {
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function fmtTime(d: Date) {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ─── Main Screen ────────────────────────────────────────────────────────────

export function AdminScreen() {
  const [section, setSection] = useState<Section>('events');

  return (
    <View style={styles.container}>
      <View style={styles.tabBar}>
        {(Object.keys(TAB_LABELS) as Section[]).map((s) => (
          <TouchableOpacity
            key={s}
            style={[styles.tab, section === s && styles.tabActive]}
            onPress={() => setSection(s)}
          >
            <Text style={[styles.tabText, section === s && styles.tabTextActive]}>
              {TAB_LABELS[s]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {section === 'events' && <EventsSection />}
      {section === 'users' && <UsersSection />}
      {section === 'messages' && <MessagesSection />}
      {section === 'feed' && <FeedSection />}
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

// ─── Event Form Modal (with DateTimePicker) ──────────────────────────────────

type PickerState = { show: boolean; target: 'start' | 'end'; mode: 'date' | 'time' };

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
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [locationName, setLocationName] = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState<PickerState>({ show: false, target: 'start', mode: 'date' });

  useEffect(() => {
    setTitle(existing?.title ?? '');
    setDescription(existing?.description ?? '');
    setStartDate(existing?.start_time ? new Date(existing.start_time) : new Date());
    setEndDate(existing?.end_time ? new Date(existing.end_time) : new Date());
    setLocationName(existing?.location_name ?? '');
    setAddress(existing?.address ?? '');
    setPicker({ show: false, target: 'start', mode: 'date' });
  }, [event]);

  function openPicker(target: 'start' | 'end', mode: 'date' | 'time') {
    setPicker({ show: true, target, mode });
  }

  function onPickerChange(_: any, date?: Date) {
    if (Platform.OS === 'android') setPicker((p) => ({ ...p, show: false }));
    if (!date) return;
    const apply = (prev: Date) => {
      const next = new Date(prev);
      if (picker.mode === 'date') {
        next.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
      } else {
        next.setHours(date.getHours(), date.getMinutes(), 0, 0);
      }
      return next;
    };
    if (picker.target === 'start') setStartDate(apply);
    else setEndDate(apply);
  }

  async function handleSave() {
    if (!title.trim() || !locationName.trim() || !address.trim()) {
      Alert.alert('Missing fields', 'Title, venue name, and address are required.');
      return;
    }
    setSaving(true);
    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      start_time: startDate.toISOString(),
      end_time: endDate.toISOString(),
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

  const pickerValue = picker.target === 'start' ? startDate : endDate;

  return (
    <Modal visible={!!event} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView style={styles.modalCard} keyboardShouldPersistTaps="handled">
          <Text style={styles.modalTitle}>{isNew ? 'Add event' : 'Edit event'}</Text>

          <Text style={styles.label}>Title *</Text>
          <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Opening keynote" placeholderTextColor="#bbb" />

          <Text style={styles.label}>Description</Text>
          <TextInput style={[styles.input, { height: 80 }]} value={description} onChangeText={setDescription} multiline placeholder="Optional details..." placeholderTextColor="#bbb" />

          <Text style={styles.label}>Start</Text>
          <View style={styles.dtRow}>
            <TouchableOpacity style={[styles.dtBtn, picker.show && picker.target === 'start' && picker.mode === 'date' && styles.dtBtnActive]} onPress={() => openPicker('start', 'date')}>
              <Text style={styles.dtBtnText}>{fmtDate(startDate)}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.dtBtn, picker.show && picker.target === 'start' && picker.mode === 'time' && styles.dtBtnActive]} onPress={() => openPicker('start', 'time')}>
              <Text style={styles.dtBtnText}>{fmtTime(startDate)}</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>End</Text>
          <View style={styles.dtRow}>
            <TouchableOpacity style={[styles.dtBtn, picker.show && picker.target === 'end' && picker.mode === 'date' && styles.dtBtnActive]} onPress={() => openPicker('end', 'date')}>
              <Text style={styles.dtBtnText}>{fmtDate(endDate)}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.dtBtn, picker.show && picker.target === 'end' && picker.mode === 'time' && styles.dtBtnActive]} onPress={() => openPicker('end', 'time')}>
              <Text style={styles.dtBtnText}>{fmtTime(endDate)}</Text>
            </TouchableOpacity>
          </View>

          {picker.show && Platform.OS === 'ios' && (
            <View style={styles.pickerContainer}>
              <TouchableOpacity style={styles.pickerDoneBtn} onPress={() => setPicker((p) => ({ ...p, show: false }))}>
                <Text style={styles.pickerDoneText}>Done</Text>
              </TouchableOpacity>
              <DateTimePicker
                value={pickerValue}
                mode={picker.mode}
                display="spinner"
                onChange={onPickerChange}
              />
            </View>
          )}
          {picker.show && Platform.OS === 'android' && (
            <DateTimePicker
              value={pickerValue}
              mode={picker.mode}
              display="default"
              onChange={onPickerChange}
            />
          )}

          <Text style={styles.label}>Venue name *</Text>
          <TextInput style={styles.input} value={locationName} onChangeText={setLocationName} placeholder="Main Hall" placeholderTextColor="#bbb" />

          <Text style={styles.label}>Address *</Text>
          <TextInput style={styles.input} value={address} onChangeText={setAddress} placeholder="123 W 57th St, New York, NY" placeholderTextColor="#bbb" />

          <TouchableOpacity style={[styles.saveButton, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
            <Text style={styles.saveButtonText}>{saving ? 'Saving...' : 'Save event'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelLink} onPress={onClose}>
            <Text style={styles.cancelLinkText}>Cancel</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
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
    Alert.alert('Reset all scans?', 'Wipes every scan record. Profiles are kept.', [
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
    ]);
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
              <Text style={styles.rowTitle}>{item.full_name}{item.is_admin ? '  ★' : ''}</Text>
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

      <EditUserModal profile={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
    </View>
  );
}

function EditUserModal({
  profile, onClose, onSaved,
}: { profile: Profile | null; onClose: () => void; onSaved: () => void }) {
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
    const { error } = await supabase.from('profiles').update({
      full_name: fullName.trim(),
      background: background.trim() || null,
      hometown: hometown.trim() || null,
      is_admin: isAdmin,
    }).eq('id', profile.id);
    setSaving(false);
    if (error) Alert.alert('Error', error.message);
    else onSaved();
  }

  return (
    <Modal visible={!!profile} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
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
      </KeyboardAvoidingView>
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
    const { error } = await supabase.from('service_requests').update({
      admin_reply: replyText.trim() || null,
      replied_at: replyText.trim() ? new Date().toISOString() : null,
      replied_by: replyText.trim() ? session.user.id : null,
    }).eq('id', replying.id);
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

      {/* KeyboardAvoidingView wrapping the backdrop fixes keyboard covering the reply box */}
      <Modal visible={!!replying} transparent animationType="slide" onRequestClose={() => setReplying(null)}>
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
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
              autoFocus
            />
            <TouchableOpacity style={[styles.saveButton, saving && { opacity: 0.6 }]} onPress={handleReply} disabled={saving}>
              <Text style={styles.saveButtonText}>{saving ? 'Saving...' : 'Send reply'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelLink} onPress={() => setReplying(null)}>
              <Text style={styles.cancelLinkText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ─── Feed Section (Announcements) ────────────────────────────────────────────

function FeedSection() {
  const { session } = useAuth();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [composing, setComposing] = useState(false);
  const [postTitle, setPostTitle] = useState('');
  const [postBody, setPostBody] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('announcements')
      .select('*')
      .order('created_at', { ascending: false });
    setAnnouncements((data ?? []) as Announcement[]);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function handlePost() {
    if (!postTitle.trim() || !postBody.trim() || !session?.user) return;
    setSaving(true);
    const { error } = await supabase.from('announcements').insert({
      admin_id: session.user.id,
      title: postTitle.trim(),
      body: postBody.trim(),
    });
    setSaving(false);
    if (error) { Alert.alert('Error', error.message); return; }
    setPostTitle('');
    setPostBody('');
    setComposing(false);
    load();
  }

  function confirmDelete(a: Announcement) {
    Alert.alert('Delete announcement?', `Remove "${a.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('announcements').delete().eq('id', a.id);
          if (error) Alert.alert('Error', error.message);
          else load();
        },
      },
    ]);
  }

  return (
    <View style={styles.sectionContainer}>
      <TouchableOpacity style={styles.addButton} onPress={() => setComposing(true)}>
        <Text style={styles.addButtonText}>+ Post announcement</Text>
      </TouchableOpacity>

      <FlatList
        contentContainerStyle={styles.list}
        data={announcements}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={<Text style={styles.empty}>No announcements posted yet.</Text>}
        renderItem={({ item }) => (
          <View style={styles.announceCard}>
            <View style={styles.announceHeader}>
              <Text style={styles.announceTitle}>{item.title}</Text>
              <TouchableOpacity onPress={() => confirmDelete(item)}>
                <Text style={styles.announceDelete}>Delete</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.announceBody}>{item.body}</Text>
            <Text style={styles.announceDate}>{formatDateTime(item.created_at)}</Text>
          </View>
        )}
      />

      <Modal visible={composing} transparent animationType="slide" onRequestClose={() => setComposing(false)}>
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView style={styles.modalCard} keyboardShouldPersistTaps="handled">
            <Text style={styles.modalTitle}>New announcement</Text>
            <Text style={styles.label}>Title *</Text>
            <TextInput
              style={styles.input}
              value={postTitle}
              onChangeText={setPostTitle}
              placeholder="Important update"
              placeholderTextColor="#bbb"
            />
            <Text style={styles.label}>Message *</Text>
            <TextInput
              style={[styles.input, { height: 120 }]}
              value={postBody}
              onChangeText={setPostBody}
              multiline
              placeholder="Write your announcement here..."
              placeholderTextColor="#bbb"
            />
            <TouchableOpacity
              style={[styles.saveButton, (!postTitle.trim() || !postBody.trim() || saving) && { opacity: 0.5 }]}
              onPress={handlePost}
              disabled={!postTitle.trim() || !postBody.trim() || saving}
            >
              <Text style={styles.saveButtonText}>{saving ? 'Posting...' : 'Post to all attendees'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelLink} onPress={() => setComposing(false)}>
              <Text style={styles.cancelLinkText}>Cancel</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
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
  tabText: { fontSize: 13, color: '#94a3b8', fontWeight: '600' },
  tabTextActive: { color: '#2563eb' },
  sectionContainer: { flex: 1 },
  addButton: { margin: 14, padding: 12, borderRadius: 10, backgroundColor: '#2563eb', alignItems: 'center' },
  dangerButton: { backgroundColor: '#b91c1c' },
  addButtonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  list: { paddingHorizontal: 14, paddingBottom: 32 },
  empty: { textAlign: 'center', marginTop: 40, color: '#94a3b8' },
  row: { flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor: '#f8f8f8', borderRadius: 12, marginBottom: 10 },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarPlaceholder: { backgroundColor: '#ddd' },
  rowText: { flex: 1, marginLeft: 10 },
  rowTitle: { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  rowMeta: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  rowActions: { gap: 6 },
  actionBtn: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 7, backgroundColor: '#2563eb' },
  deleteBtn: { backgroundColor: '#fde2e2' },
  actionBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  deleteBtnText: { color: '#b91c1c' },
  dtRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  dtBtn: { flex: 1, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#d1d5db', backgroundColor: '#f8faff', alignItems: 'center' },
  dtBtnActive: { borderColor: '#2563eb', backgroundColor: '#eff6ff' },
  dtBtnText: { fontSize: 13, color: '#1e293b', fontWeight: '500' },
  pickerContainer: { marginTop: 8, borderRadius: 12, overflow: 'hidden', backgroundColor: '#f8faff', borderWidth: 1, borderColor: '#e2e8f0' },
  pickerDoneBtn: { alignItems: 'flex-end', paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  pickerDoneText: { color: '#2563eb', fontWeight: '700', fontSize: 15 },
  msgCard: { backgroundColor: '#f8f8f8', borderRadius: 12, padding: 14, marginBottom: 10 },
  msgHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  msgUser: { fontSize: 13, fontWeight: '700', color: '#1e293b' },
  msgDate: { fontSize: 11, color: '#94a3b8' },
  msgText: { fontSize: 14, color: '#334155', lineHeight: 20 },
  msgReplied: { fontSize: 12, color: '#15803d', marginTop: 6, fontWeight: '600' },
  msgPending: { fontSize: 12, color: '#94a3b8', marginTop: 6, fontStyle: 'italic' },
  announceCard: { backgroundColor: '#f0f6ff', borderRadius: 12, padding: 14, marginBottom: 10, borderLeftWidth: 4, borderLeftColor: '#2563eb' },
  announceHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  announceTitle: { fontSize: 14, fontWeight: '700', color: '#1e293b', flex: 1, marginRight: 8 },
  announceDelete: { fontSize: 12, color: '#b91c1c', fontWeight: '600' },
  announceBody: { fontSize: 13, color: '#334155', lineHeight: 19 },
  announceDate: { fontSize: 11, color: '#94a3b8', marginTop: 8 },
  qrBackdrop: { flex: 1, backgroundColor: '#00000099', justifyContent: 'center', alignItems: 'center' },
  qrCard: { backgroundColor: '#fff', borderRadius: 20, padding: 28, alignItems: 'center', margin: 24 },
  qrTitle: { fontSize: 18, fontWeight: '700', color: '#1e293b', marginBottom: 4, textAlign: 'center' },
  qrSub: { fontSize: 13, color: '#64748b', marginBottom: 16 },
  qrHint: { fontSize: 12, color: '#94a3b8', marginTop: 16, textAlign: 'center' },
  qrClose: { marginTop: 16, paddingVertical: 10, paddingHorizontal: 32, backgroundColor: '#2563eb', borderRadius: 10 },
  qrCloseText: { color: '#fff', fontWeight: '600' },
  modalBackdrop: { flex: 1, backgroundColor: '#00000099', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#fff', padding: 22, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '90%' },
  modalTitle: { fontSize: 20, fontWeight: '700', marginBottom: 12, color: '#1e293b' },
  label: { fontSize: 12, color: '#64748b', marginTop: 12, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, padding: 10, fontSize: 15, color: '#1e293b' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
  checkbox: { width: 22, height: 22, borderRadius: 4, borderWidth: 2, borderColor: '#2563eb', marginRight: 10 },
  checkboxOn: { backgroundColor: '#2563eb' },
  toggleLabel: { fontSize: 15, color: '#1e293b' },
  saveButton: { backgroundColor: '#2563eb', padding: 13, borderRadius: 10, alignItems: 'center', marginTop: 20 },
  saveButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  cancelLink: { marginTop: 12, alignItems: 'center', marginBottom: 8 },
  cancelLinkText: { color: '#94a3b8', fontSize: 14 },
});
