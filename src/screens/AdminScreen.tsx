import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Avatar } from '../components/Avatar';
import { EventRow } from '../components/EventRow';
import { EventDetailModal } from '../components/EventDetailModal';
import type { Announcement, DoublePointsWindow, Event, Profile, RafflePrize, Report } from '../types/database';
import { fonts, type ColorScheme } from '../theme';

const OPACITY_STEPS = [0, 0.2, 0.4, 0.6, 0.8, 1];

type Section = 'events' | 'points' | 'raffle' | 'users' | 'feed' | 'reports';

const TAB_LABELS: Record<Section, string> = {
  events: 'Events',
  points: '2x Pts',
  raffle: 'Raffle',
  users: 'Users',
  feed: 'Feed',
  reports: 'Reports',
};

type ReportWithUsers = Report & {
  reporter: { first_name: string } | null;
  reported: { first_name: string } | null;
};

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
  const { top } = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: top + 10 }]}>
        <Text style={styles.headerTitle}>Admin</Text>
        <Text style={styles.headerQuote}>"Choose to be a peacemaker, now and always."</Text>
        <Text style={styles.headerCitation}>— President Russell M. Nelson</Text>
      </View>
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
      {section === 'points' && <DoublePointsSection />}
      {section === 'raffle' && <RaffleSection />}
      {section === 'users' && <UsersSection />}
      {section === 'feed' && <FeedSection />}
      {section === 'reports' && <ReportsSection />}
    </View>
  );
}

// ─── Events Section ──────────────────────────────────────────────────────────

function EventsSection() {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
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

  return (
    <View style={styles.sectionContainer}>
      <TouchableOpacity style={styles.addButton} onPress={() => setEditing('new')}>
        <Text style={styles.addButtonText}>+ Add event</Text>
      </TouchableOpacity>

      <FlatList
        style={styles.listFlex}
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
        <TouchableOpacity style={styles.qrBackdrop} activeOpacity={1} onPress={() => setQrEvent(null)}>
          <TouchableOpacity style={styles.qrCard} activeOpacity={1} onPress={() => {}}>
            <Text style={styles.qrTitle}>{qrEvent?.title}</Text>
            <Text style={styles.qrSub}>{qrEvent?.location_name}</Text>
            {qrEvent && <QRCode value={`event:${qrEvent.id}`} size={220} />}
            <Text style={styles.qrHint}>Display this at the event for attendees to scan</Text>
            <TouchableOpacity style={styles.qrClose} onPress={() => setQrEvent(null)}>
              <Text style={styles.qrCloseText}>Close</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
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
  const { colors, mode } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const isNew = event === 'new';
  const existing = isNew ? null : (event as Event | null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [locationName, setLocationName] = useState('');
  const [address, setAddress] = useState('');
  const [localImageUri, setLocalImageUri] = useState<string | null>(null);
  const [savedImageUrl, setSavedImageUrl] = useState<string | null>(null);
  const [imageOpacity, setImageOpacity] = useState(0.4);
  const [saving, setSaving] = useState(false);
  const [previewDetailOpen, setPreviewDetailOpen] = useState(false);
  const [picker, setPicker] = useState<PickerState>({ show: false, target: 'start', mode: 'date' });

  useEffect(() => {
    setTitle(existing?.title ?? '');
    setDescription(existing?.description ?? '');
    setStartDate(existing?.start_time ? new Date(existing.start_time) : new Date());
    setEndDate(existing?.end_time ? new Date(existing.end_time) : new Date());
    setLocationName(existing?.location_name ?? '');
    setAddress(existing?.address ?? '');
    setLocalImageUri(null);
    setSavedImageUrl(existing?.image_url ?? null);
    setImageOpacity(existing?.image_opacity ?? 0.4);
    setPicker({ show: false, target: 'start', mode: 'date' });
  }, [event]);

  async function pickImage() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Please allow photo library access.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) {
      setLocalImageUri(result.assets[0].uri);
    }
  }

  async function uploadImage(uri: string): Promise<string> {
    const ext = (uri.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `event-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const contentType = ext === 'png' ? 'image/png' : 'image/jpeg';
    const response = await fetch(uri);
    const arrayBuffer = await response.arrayBuffer();
    const { error } = await supabase.storage
      .from('event-photos')
      .upload(path, arrayBuffer, { contentType, upsert: true });
    if (error) throw error;
    const { data } = supabase.storage.from('event-photos').getPublicUrl(path);
    return data.publicUrl;
  }

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
    try {
      let imageUrl = savedImageUrl;
      if (localImageUri) {
        imageUrl = await uploadImage(localImageUri);
      }
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        start_time: startDate.toISOString(),
        end_time: endDate.toISOString(),
        location_name: locationName.trim(),
        address: address.trim(),
        image_url: imageUrl,
        image_opacity: imageOpacity,
      };
      const { error } = isNew
        ? await supabase.from('events').insert(payload)
        : await supabase.from('events').update(payload).eq('id', existing!.id);
      if (error) throw error;
      onSaved();
    } catch (err: any) {
      Alert.alert('Error', err.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  const pickerValue = picker.target === 'start' ? startDate : endDate;
  const displayImage = localImageUri ?? savedImageUrl;
  const previewEvent = {
    title,
    start_time: startDate.toISOString(),
    end_time: endDate.toISOString(),
    location_name: locationName || 'Venue name',
    description: description || null,
    image_url: displayImage,
    image_opacity: imageOpacity,
  };

  return (
    <Modal visible={!!event} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          style={styles.modalCard}
          contentContainerStyle={styles.eventFormScrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.modalTitle}>{isNew ? 'Add event' : 'Edit event'}</Text>

          <Text style={styles.label}>Title *</Text>
          <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Opening keynote" placeholderTextColor={colors.textFaint} />

          <Text style={styles.label}>Description</Text>
          <TextInput style={[styles.input, { height: 80 }]} value={description} onChangeText={setDescription} multiline placeholder="Optional details..." placeholderTextColor={colors.textFaint} />

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
                themeVariant={mode === 'dark' ? 'dark' : 'light'}
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
          <TextInput style={styles.input} value={locationName} onChangeText={setLocationName} placeholder="Main Hall" placeholderTextColor={colors.textFaint} />

          <Text style={styles.label}>Address *</Text>
          <TextInput style={styles.input} value={address} onChangeText={setAddress} placeholder="123 W 57th St, New York, NY" placeholderTextColor={colors.textFaint} />

          <Text style={styles.label}>Background photo</Text>
          {displayImage ? (
            <View>
              <Image source={{ uri: displayImage }} style={styles.eventPhotoPreview} />
              <TouchableOpacity style={styles.removePhotoLink} onPress={() => { setLocalImageUri(null); setSavedImageUrl(null); }}>
                <Text style={styles.removePhotoLinkText}>Remove photo</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.photoPickerBtn} onPress={pickImage}>
              <Text style={styles.photoPickerBtnText}>Choose photo</Text>
            </TouchableOpacity>
          )}
          {displayImage && (
            <TouchableOpacity style={styles.photoPickerBtn} onPress={pickImage}>
              <Text style={styles.photoPickerBtnText}>Replace photo</Text>
            </TouchableOpacity>
          )}

          {displayImage && (
            <>
              <Text style={styles.label}>Overlay opacity</Text>
              <Text style={styles.opacityHint}>
                Darkens the photo so the title and time stay readable. Higher = darker photo.
              </Text>
              <View style={styles.opacityRow}>
                {OPACITY_STEPS.map((step) => (
                  <TouchableOpacity
                    key={step}
                    style={[styles.opacityStep, imageOpacity === step && styles.opacityStepActive]}
                    onPress={() => setImageOpacity(step)}
                  >
                    <Text style={[styles.opacityStepText, imageOpacity === step && styles.opacityStepTextActive]}>
                      {Math.round(step * 100)}%
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          <Text style={styles.label}>Preview</Text>
          <Text style={styles.previewHint}>Tap the preview to see the full detail view attendees get.</Text>
          <View style={styles.previewWrap}>
            <EventRow event={previewEvent} onPress={() => setPreviewDetailOpen(true)} />
          </View>
          <EventDetailModal
            event={previewDetailOpen ? previewEvent : null}
            onClose={() => setPreviewDetailOpen(false)}
          />

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

// ─── Double Points Section ───────────────────────────────────────────────────
// Scoped to person-to-person scans only (record_mutual_scan checks this
// table at accept time) — event check-ins stay a flat 50 regardless.

function windowStatus(w: DoublePointsWindow): 'active' | 'upcoming' | 'past' {
  const now = Date.now();
  const start = new Date(w.start_time).getTime();
  const end = new Date(w.end_time).getTime();
  if (now >= start && now <= end) return 'active';
  if (now < start) return 'upcoming';
  return 'past';
}

function DoublePointsSection() {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const [windows, setWindows] = useState<DoublePointsWindow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('double_points_windows')
      .select('*')
      .order('start_time', { ascending: false });
    setWindows((data ?? []) as DoublePointsWindow[]);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function confirmDelete(w: DoublePointsWindow) {
    Alert.alert('Remove this window?', 'Scans already awarded during it keep their points.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('double_points_windows').delete().eq('id', w.id);
          if (error) Alert.alert('Error', error.message);
          else load();
        },
      },
    ]);
  }

  return (
    <View style={styles.sectionContainer}>
      <TouchableOpacity style={styles.addButton} onPress={() => setAdding(true)}>
        <Text style={styles.addButtonText}>+ Add double-points window</Text>
      </TouchableOpacity>

      <FlatList
        style={styles.listFlex}
        contentContainerStyle={styles.list}
        data={windows}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={<Text style={styles.empty}>No double-points windows scheduled.</Text>}
        renderItem={({ item }) => {
          const status = windowStatus(item);
          return (
            <View style={styles.row}>
              <View style={styles.rowText}>
                <View style={styles.pointsStatusRow}>
                  {status === 'active' && (
                    <View style={styles.activeBadge}>
                      <Text style={styles.activeBadgeText}>ACTIVE NOW</Text>
                    </View>
                  )}
                  <Text style={styles.rowTitle}>{formatDateTime(item.start_time)}</Text>
                </View>
                <Text style={styles.rowMeta}>through {formatDateTime(item.end_time)}</Text>
              </View>
              <TouchableOpacity style={[styles.actionBtn, styles.deleteBtn]} onPress={() => confirmDelete(item)}>
                <Text style={[styles.actionBtnText, styles.deleteBtnText]}>Del</Text>
              </TouchableOpacity>
            </View>
          );
        }}
      />

      <DoublePointsFormModal visible={adding} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />
    </View>
  );
}

function DoublePointsFormModal({
  visible,
  onClose,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { colors, mode } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date(Date.now() + 60 * 60 * 1000));
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState<PickerState>({ show: false, target: 'start', mode: 'date' });

  useEffect(() => {
    if (visible) {
      const now = new Date();
      setStartDate(now);
      setEndDate(new Date(now.getTime() + 60 * 60 * 1000));
      setPicker({ show: false, target: 'start', mode: 'date' });
    }
  }, [visible]);

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
    if (endDate <= startDate) {
      Alert.alert('Invalid window', 'End time must be after start time.');
      return;
    }
    const now = new Date();
    if (startDate < now || endDate < now) {
      Alert.alert('Invalid window', 'Start and end time must both be in the future.');
      return;
    }
    setSaving(true);
    // Friendly pre-check — the exclusion constraint on the table is the
    // real, race-safe guarantee (see 20260825000005_double_points_no_overlap.sql);
    // this just avoids surfacing its raw Postgres error message for the
    // common case.
    const { data: overlapping } = await supabase
      .from('double_points_windows')
      .select('id')
      .lt('start_time', endDate.toISOString())
      .gt('end_time', startDate.toISOString())
      .limit(1);
    if (overlapping && overlapping.length > 0) {
      setSaving(false);
      Alert.alert('Overlapping window', 'This overlaps an already-scheduled double-points window.');
      return;
    }
    const { error } = await supabase.from('double_points_windows').insert({
      start_time: startDate.toISOString(),
      end_time: endDate.toISOString(),
    });
    setSaving(false);
    if (error) {
      if (error.code === '23P01') {
        Alert.alert('Overlapping window', 'This overlaps an already-scheduled double-points window.');
      } else {
        Alert.alert('Error', error.message);
      }
    } else {
      onSaved();
    }
  }

  const pickerValue = picker.target === 'start' ? startDate : endDate;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Add double-points window</Text>
          <Text style={styles.previewHint}>
            Person-to-person scans accepted during this window award 20 points instead of 10 for both people.
            Event check-ins are unaffected.
          </Text>

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
                themeVariant={mode === 'dark' ? 'dark' : 'light'}
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

          <TouchableOpacity style={[styles.saveButton, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
            <Text style={styles.saveButtonText}>{saving ? 'Saving...' : 'Save window'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelLink} onPress={onClose}>
            <Text style={styles.cancelLinkText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Raffle Section ──────────────────────────────────────────────────────────

function RaffleSection() {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const [prizes, setPrizes] = useState<RafflePrize[]>([]);
  const [ticketTotals, setTicketTotals] = useState<Record<string, number>>({});
  const [winnerNames, setWinnerNames] = useState<Record<string, string>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<RafflePrize | null | 'new'>(null);
  const [drawing, setDrawing] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: prizeData }, { data: statsData }] = await Promise.all([
      supabase.from('raffle_prizes').select('*').order('created_at', { ascending: false }),
      supabase.from('raffle_prize_stats').select('*'),
    ]);
    const prizeList = (prizeData ?? []) as RafflePrize[];
    setPrizes(prizeList);

    const totals: Record<string, number> = {};
    for (const s of statsData ?? []) totals[s.prize_id] = s.total_tickets;
    setTicketTotals(totals);

    const winnerIds = [...new Set(prizeList.map((p) => p.winner_id).filter(Boolean))] as string[];
    if (winnerIds.length) {
      const { data: winners } = await supabase.from('profiles').select('id, first_name').in('id', winnerIds);
      const names: Record<string, string> = {};
      for (const w of winners ?? []) names[w.id] = w.first_name;
      setWinnerNames(names);
    } else {
      setWinnerNames({});
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function confirmDraw(prize: RafflePrize) {
    const total = ticketTotals[prize.id] ?? 0;
    if (total === 0) {
      Alert.alert('No entries yet', 'No one has assigned tickets to this prize yet.');
      return;
    }
    Alert.alert(
      'Draw a winner?',
      `${total} ticket${total === 1 ? '' : 's'} are in the pool for "${prize.title}". This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Draw winner',
          onPress: async () => {
            setDrawing(prize.id);
            const { error } = await supabase.rpc('draw_raffle_winner', { p_prize_id: prize.id });
            setDrawing(null);
            if (error) Alert.alert('Error', error.message);
            else load();
          },
        },
      ]
    );
  }

  function confirmDelete(prize: RafflePrize) {
    Alert.alert('Delete prize?', `Remove "${prize.title}" and all its ticket entries?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('raffle_prizes').delete().eq('id', prize.id);
          if (error) Alert.alert('Error', error.message);
          else load();
        },
      },
    ]);
  }

  return (
    <View style={styles.sectionContainer}>
      <TouchableOpacity style={styles.addButton} onPress={() => setEditing('new')}>
        <Text style={styles.addButtonText}>+ Add prize</Text>
      </TouchableOpacity>
      <Text style={styles.sectionNote}>
        Deleting a prize refunds its tickets back to whoever had assigned them. A prize with no
        "Draw" button next to its name has already been drawn — leave it there as the record of
        who won it, rather than deleting it.
      </Text>

      <FlatList
        style={styles.listFlex}
        contentContainerStyle={styles.list}
        data={prizes}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={<Text style={styles.empty}>No prizes yet. Add one above.</Text>}
        renderItem={({ item }) => (
          <View style={styles.row}>
            {item.image_url ? (
              <Image source={{ uri: item.image_url }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder]} />
            )}
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{item.title}</Text>
              <Text style={styles.rowMeta}>
                {item.drawn_at
                  ? `Winner: ${winnerNames[item.winner_id!] ?? 'Unknown'}`
                  : `${ticketTotals[item.id] ?? 0} tickets assigned`}
              </Text>
              {!item.drawn_at && item.closes_at && (
                <Text style={styles.rowMeta}>
                  {new Date(item.closes_at) <= new Date()
                    ? 'Entries closed'
                    : `Closes ${formatDateTime(item.closes_at)}`}
                </Text>
              )}
            </View>
            <View style={styles.rowActions}>
              {!item.drawn_at && (
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => confirmDraw(item)}
                  disabled={drawing === item.id}
                >
                  <Text style={styles.actionBtnText}>{drawing === item.id ? '...' : 'Draw'}</Text>
                </TouchableOpacity>
              )}
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

      <PrizeFormModal prize={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
    </View>
  );
}

function PrizeFormModal({
  prize,
  onClose,
  onSaved,
}: {
  prize: RafflePrize | 'new' | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { colors, mode } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const isNew = prize === 'new';
  const existing = isNew ? null : (prize as RafflePrize | null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [localImageUri, setLocalImageUri] = useState<string | null>(null);
  const [savedImageUrl, setSavedImageUrl] = useState<string | null>(null);
  const [closesAt, setClosesAt] = useState<Date | null>(null);
  const [picker, setPicker] = useState<{ show: boolean; mode: 'date' | 'time' }>({ show: false, mode: 'date' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTitle(existing?.title ?? '');
    setDescription(existing?.description ?? '');
    setLocalImageUri(null);
    setSavedImageUrl(existing?.image_url ?? null);
    setClosesAt(existing?.closes_at ? new Date(existing.closes_at) : null);
    setPicker({ show: false, mode: 'date' });
  }, [prize]);

  function openClosesAtPicker(mode: 'date' | 'time') {
    if (!closesAt) setClosesAt(new Date());
    setPicker({ show: true, mode });
  }

  function onClosesAtPickerChange(_: any, date?: Date) {
    if (Platform.OS === 'android') setPicker((p) => ({ ...p, show: false }));
    if (!date) return;
    setClosesAt((prev) => {
      const next = new Date(prev ?? new Date());
      if (picker.mode === 'date') next.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
      else next.setHours(date.getHours(), date.getMinutes(), 0, 0);
      return next;
    });
  }

  async function pickImage() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Please allow photo library access.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) {
      setLocalImageUri(result.assets[0].uri);
    }
  }

  async function uploadImage(uri: string): Promise<string> {
    const ext = (uri.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `prize-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const contentType = ext === 'png' ? 'image/png' : 'image/jpeg';
    const response = await fetch(uri);
    const arrayBuffer = await response.arrayBuffer();
    const { error } = await supabase.storage
      .from('raffle-prizes')
      .upload(path, arrayBuffer, { contentType, upsert: true });
    if (error) throw error;
    const { data } = supabase.storage.from('raffle-prizes').getPublicUrl(path);
    return data.publicUrl;
  }

  async function handleSave() {
    if (!title.trim()) {
      Alert.alert('Missing title', 'Give the prize a title.');
      return;
    }
    // Only checked when it's actually changing — editing an existing prize
    // whose close time already passed (e.g. just touching up the
    // description) shouldn't be blocked by this.
    if (closesAt && closesAt <= new Date() && closesAt.getTime() !== (existing?.closes_at ? new Date(existing.closes_at).getTime() : NaN)) {
      Alert.alert('Invalid close time', 'Close time must be in the future.');
      return;
    }
    setSaving(true);
    try {
      let imageUrl = savedImageUrl;
      if (localImageUri) {
        imageUrl = await uploadImage(localImageUri);
      }
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        image_url: imageUrl,
        closes_at: closesAt ? closesAt.toISOString() : null,
      };
      const { error } = isNew
        ? await supabase.from('raffle_prizes').insert(payload)
        : await supabase.from('raffle_prizes').update(payload).eq('id', existing!.id);
      if (error) throw error;
      onSaved();
    } catch (err: any) {
      Alert.alert('Error', err.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  const displayImage = localImageUri ?? savedImageUrl;

  return (
    <Modal visible={!!prize} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          style={styles.modalCard}
          contentContainerStyle={styles.eventFormScrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.modalTitle}>{isNew ? 'Add prize' : 'Edit prize'}</Text>

          <Text style={styles.label}>Title *</Text>
          <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Wireless earbuds" placeholderTextColor={colors.textFaint} />

          <Text style={styles.label}>Description</Text>
          <TextInput style={[styles.input, { height: 80 }]} value={description} onChangeText={setDescription} multiline placeholder="Optional details..." placeholderTextColor={colors.textFaint} />

          <Text style={styles.label}>Closes at</Text>
          <Text style={styles.previewHint}>
            After this time, no one can assign or remove tickets for this prize. Leave unset to keep it open until you draw a winner.
          </Text>
          <View style={styles.dtRow}>
            <TouchableOpacity
              style={[styles.dtBtn, picker.show && picker.mode === 'date' && styles.dtBtnActive]}
              onPress={() => openClosesAtPicker('date')}
            >
              <Text style={styles.dtBtnText}>{closesAt ? fmtDate(closesAt) : 'Not set'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.dtBtn, picker.show && picker.mode === 'time' && styles.dtBtnActive]}
              onPress={() => openClosesAtPicker('time')}
            >
              <Text style={styles.dtBtnText}>{closesAt ? fmtTime(closesAt) : '--:--'}</Text>
            </TouchableOpacity>
          </View>
          {closesAt && (
            <TouchableOpacity style={styles.removePhotoLink} onPress={() => { setClosesAt(null); setPicker({ show: false, mode: 'date' }); }}>
              <Text style={styles.removePhotoLinkText}>Clear close time</Text>
            </TouchableOpacity>
          )}

          {picker.show && closesAt && Platform.OS === 'ios' && (
            <View style={styles.pickerContainer}>
              <TouchableOpacity style={styles.pickerDoneBtn} onPress={() => setPicker((p) => ({ ...p, show: false }))}>
                <Text style={styles.pickerDoneText}>Done</Text>
              </TouchableOpacity>
              <DateTimePicker value={closesAt} mode={picker.mode} display="spinner" themeVariant={mode === 'dark' ? 'dark' : 'light'} onChange={onClosesAtPickerChange} />
            </View>
          )}
          {picker.show && closesAt && Platform.OS === 'android' && (
            <DateTimePicker value={closesAt} mode={picker.mode} display="default" onChange={onClosesAtPickerChange} />
          )}

          <Text style={styles.label}>Photo</Text>
          {displayImage ? (
            <View>
              <Image source={{ uri: displayImage }} style={styles.eventPhotoPreview} />
              <TouchableOpacity style={styles.removePhotoLink} onPress={() => { setLocalImageUri(null); setSavedImageUrl(null); }}>
                <Text style={styles.removePhotoLinkText}>Remove photo</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.photoPickerBtn} onPress={pickImage}>
              <Text style={styles.photoPickerBtnText}>Choose photo</Text>
            </TouchableOpacity>
          )}
          {displayImage && (
            <TouchableOpacity style={styles.photoPickerBtn} onPress={pickImage}>
              <Text style={styles.photoPickerBtnText}>Replace photo</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={[styles.saveButton, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
            <Text style={styles.saveButtonText}>{saving ? 'Saving...' : 'Save prize'}</Text>
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
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });
    setProfiles((data ?? []) as Profile[]);
  }, []);

  useEffect(() => { load(); }, [load]);

  const query = search.trim().toLowerCase();
  const visibleProfiles = query
    ? profiles.filter((p) => p.first_name.toLowerCase().includes(query))
    : profiles;

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function confirmDeleteUser(p: Profile) {
    Alert.alert('Delete user?', `Remove ${p.first_name}? This also removes their scans.`, [
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

  return (
    <View style={styles.sectionContainer}>
      <TextInput
        style={styles.searchInput}
        value={search}
        onChangeText={setSearch}
        placeholder="Search by name"
        placeholderTextColor={colors.textFaint}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <FlatList
        style={styles.listFlex}
        contentContainerStyle={styles.list}
        data={visibleProfiles}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={<Text style={styles.empty}>No users match "{search}".</Text>}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Avatar photoUrl={item.photo_url} name={item.first_name} size={44} />
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{item.first_name}{item.is_admin ? '  ★' : ''}</Text>
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
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const [firstName, setFirstName] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setFirstName(profile?.first_name ?? '');
    setIsAdmin(profile?.is_admin ?? false);
  }, [profile]);

  async function handleSave() {
    if (!profile) return;
    setSaving(true);
    const { error } = await supabase.from('profiles').update({
      first_name: firstName.trim(),
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
          <Text style={styles.label}>First name</Text>
          <TextInput style={styles.input} value={firstName} onChangeText={setFirstName} />
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

// ─── Feed Section (Announcements) ────────────────────────────────────────────

function FeedSection() {
  const { session } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
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
        style={styles.listFlex}
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
              placeholderTextColor={colors.textFaint}
            />
            <Text style={styles.label}>Message *</Text>
            <TextInput
              style={[styles.input, { height: 120 }]}
              value={postBody}
              onChangeText={setPostBody}
              multiline
              placeholder="Write your announcement here..."
              placeholderTextColor={colors.textFaint}
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

// ─── Reports Section (moderation queue, §3.6) ───────────────────────────────

function ReportsSection() {
  const { session } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const [reports, setReports] = useState<ReportWithUsers[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('reports')
      .select('*, reporter:profiles!reports_reporter_id_fkey(first_name), reported:profiles!reports_reported_id_fkey(first_name)')
      .is('resolved_at', null)
      .order('created_at', { ascending: false });
    setReports((data ?? []) as ReportWithUsers[]);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function markResolved(r: ReportWithUsers) {
    if (!session?.user) return;
    const { error } = await supabase.from('reports').update({
      resolved_at: new Date().toISOString(),
      resolved_by: session.user.id,
    }).eq('id', r.id);
    if (error) Alert.alert('Error', error.message);
    else load();
  }

  function confirmDeleteReportedUser(r: ReportWithUsers) {
    Alert.alert(
      'Delete reported user?',
      `Remove ${r.reported?.first_name ?? 'this user'}? This also removes their scans, contacts, and this report.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase.from('profiles').delete().eq('id', r.reported_id);
            if (error) Alert.alert('Error', error.message);
            else load();
          },
        },
      ]
    );
  }

  return (
    <View style={styles.sectionContainer}>
      <FlatList
        style={styles.listFlex}
        contentContainerStyle={styles.list}
        data={reports}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={<Text style={styles.empty}>No open reports.</Text>}
        renderItem={({ item }) => (
          <View style={styles.reportCard}>
            <View style={styles.msgHeader}>
              <Text style={styles.msgUser}>
                {item.reporter?.first_name ?? 'Unknown'} reported {item.reported?.first_name ?? 'Unknown'}
              </Text>
              <Text style={styles.msgDate}>{formatDateTime(item.created_at)}</Text>
            </View>
            {item.rescinded_at && (
              <View style={styles.rescindedBadge}>
                <Text style={styles.rescindedBadgeText}>Rescinded by reporter</Text>
              </View>
            )}
            <Text style={styles.msgText}>{item.reason}</Text>
            <View style={styles.reportActions}>
              <TouchableOpacity style={styles.actionBtn} onPress={() => markResolved(item)}>
                <Text style={styles.actionBtnText}>Mark resolved</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, styles.deleteBtn]}
                onPress={() => confirmDeleteReportedUser(item)}
              >
                <Text style={[styles.actionBtnText, styles.deleteBtnText]}>Delete user</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      />
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

function getStyles(colors: ColorScheme) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    // panelDark, not colors.text — this header is deliberately black in
    // both modes, not "page text color" that happens to be black in
    // light mode.
    backgroundColor: colors.panelDark,
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  headerTitle: { fontSize: 30, fontFamily: fonts.title, color: colors.textOnDark },
  headerQuote: { fontSize: 13, color: '#c7c2b4', marginTop: 6, fontStyle: 'italic', lineHeight: 18 },
  headerCitation: { fontSize: 12, color: '#9a9689', marginTop: 4 },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: colors.primary },
  tabText: { fontSize: 13, color: colors.textFaint, fontWeight: '600' },
  tabTextActive: { color: colors.primary },
  sectionContainer: { flex: 1 },
  // Every FlatList in this file was only ever given a contentContainerStyle,
  // never a style — without flex: 1 on the FlatList's own frame, it isn't
  // bounded to fill its parent, so it doesn't properly virtualize/scroll
  // once the list is longer than fits on screen (e.g. Users once
  // attendees start signing up, or Events once the full schedule is
  // entered). Same root cause as the Guideline 4 ScrollView fix.
  listFlex: { flex: 1 },
  addButton: { margin: 14, padding: 12, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center' },
  dangerButton: { backgroundColor: colors.danger },
  addButtonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  sectionNote: {
    marginHorizontal: 14,
    marginTop: -6,
    marginBottom: 10,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textFaint,
  },
  list: { paddingHorizontal: 14, paddingBottom: 32 },
  searchInput: {
    marginHorizontal: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  empty: { textAlign: 'center', marginTop: 40, color: colors.textFaint },
  row: { flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor: colors.surface, borderRadius: 12, marginBottom: 10 },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarPlaceholder: { backgroundColor: colors.border },
  rowText: { flex: 1, marginLeft: 10 },
  rowTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  rowMeta: { fontSize: 12, color: colors.textFaint, marginTop: 2 },
  rowActions: { gap: 6 },
  pointsStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  activeBadge: { backgroundColor: colors.highlightTint, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  activeBadgeText: { color: colors.highlightText, fontSize: 10, fontWeight: '700' },
  actionBtn: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 7, backgroundColor: colors.primary },
  deleteBtn: { backgroundColor: colors.dangerTint },
  actionBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  deleteBtnText: { color: colors.danger },
  dtRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  dtBtn: { flex: 1, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.primaryTint, alignItems: 'center' },
  dtBtnActive: { borderColor: colors.primary, backgroundColor: colors.primaryTintBorder },
  dtBtnText: { fontSize: 13, color: colors.text, fontWeight: '500' },
  pickerContainer: { marginTop: 8, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.pickerTint, borderWidth: 1, borderColor: colors.pickerTintBorder },
  pickerDoneBtn: { alignItems: 'flex-end', paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  pickerDoneText: { color: colors.primary, fontWeight: '700', fontSize: 15 },
  msgHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  msgUser: { fontSize: 13, fontWeight: '700', color: colors.text },
  msgDate: { fontSize: 11, color: colors.textFaint },
  msgText: { fontSize: 14, color: colors.textSecondary, lineHeight: 20 },
  reportCard: { backgroundColor: colors.dangerTint, borderRadius: 12, padding: 14, marginBottom: 10, borderLeftWidth: 4, borderLeftColor: colors.danger },
  reportActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  rescindedBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.borderLight,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginBottom: 6,
  },
  rescindedBadgeText: { color: colors.textMuted, fontSize: 10, fontWeight: '700' },
  announceCard: { backgroundColor: colors.primaryTint, borderRadius: 12, padding: 14, marginBottom: 10, borderLeftWidth: 4, borderLeftColor: colors.primary },
  announceHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  announceTitle: { fontSize: 14, fontWeight: '700', color: colors.text, flex: 1, marginRight: 8 },
  announceDelete: { fontSize: 12, color: colors.danger, fontWeight: '600' },
  announceBody: { fontSize: 13, color: colors.textSecondary, lineHeight: 19 },
  announceDate: { fontSize: 11, color: colors.textFaint, marginTop: 8 },
  qrBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', alignItems: 'center' },
  qrCard: { backgroundColor: colors.surface, borderRadius: 20, padding: 28, alignItems: 'center', margin: 24 },
  qrTitle: { fontSize: 20, fontFamily: fonts.title, color: colors.text, marginBottom: 4, textAlign: 'center' },
  qrSub: { fontSize: 13, color: colors.textMuted, marginBottom: 16 },
  qrHint: { fontSize: 12, color: colors.textFaint, marginTop: 16, textAlign: 'center' },
  qrClose: { marginTop: 16, paddingVertical: 10, paddingHorizontal: 32, backgroundColor: colors.primary, borderRadius: 10 },
  qrCloseText: { color: '#fff', fontWeight: '600' },
  modalBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  modalCard: { backgroundColor: colors.surface, padding: 22, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '90%' },
  eventFormScrollContent: { paddingBottom: 40 },
  modalTitle: { fontSize: 22, fontFamily: fonts.title, marginBottom: 12, color: colors.text },
  label: { fontSize: 12, color: colors.textMuted, marginTop: 12, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, fontSize: 15, color: colors.text, backgroundColor: colors.surface },
  toggleRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
  checkbox: { width: 22, height: 22, borderRadius: 4, borderWidth: 2, borderColor: colors.primary, marginRight: 10 },
  checkboxOn: { backgroundColor: colors.primary },
  toggleLabel: { fontSize: 15, color: colors.text },
  eventPhotoPreview: { width: '100%', height: 140, borderRadius: 10, backgroundColor: colors.borderLight },
  removePhotoLink: { marginTop: 8, alignSelf: 'flex-start' },
  removePhotoLinkText: { color: colors.danger, fontSize: 13, fontWeight: '600' },
  photoPickerBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 6,
  },
  photoPickerBtnText: { color: colors.primary, fontWeight: '600', fontSize: 14 },
  opacityHint: { fontSize: 12, color: colors.textFaint, marginTop: 2, marginBottom: 8 },
  opacityRow: { flexDirection: 'row', gap: 6 },
  opacityStep: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    backgroundColor: colors.primaryTint,
  },
  opacityStepActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  opacityStepText: { fontSize: 12, color: colors.text, fontWeight: '600' },
  opacityStepTextActive: { color: '#fff' },
  previewHint: { fontSize: 12, color: colors.textFaint, marginTop: 2, marginBottom: 8 },
  previewWrap: { marginTop: 8, marginHorizontal: -22 },
  saveButton: { backgroundColor: colors.primary, padding: 13, borderRadius: 10, alignItems: 'center', marginTop: 20 },
  saveButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  cancelLink: { marginTop: 12, alignItems: 'center', marginBottom: 8 },
  cancelLinkText: { color: colors.textFaint, fontSize: 14 },
  });
}
