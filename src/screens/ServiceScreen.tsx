import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { ServiceRequest } from '../types/database';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ServiceScreen() {
  const { session } = useAuth();
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!session?.user) return;
    const { data } = await supabase
      .from('service_requests')
      .select('*')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false });
    setRequests((data ?? []) as ServiceRequest[]);
  }, [session?.user]);

  useEffect(() => { load(); }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function handleSubmit() {
    const trimmed = message.trim();
    if (!trimmed || !session?.user) return;
    setSending(true);
    const { error } = await supabase.from('service_requests').insert({
      user_id: session.user.id,
      message: trimmed,
    });
    setSending(false);
    if (error) {
      Alert.alert('Could not send', error.message);
      return;
    }
    setMessage('');
    load();
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <FlatList
        contentContainerStyle={styles.content}
        data={requests}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListHeaderComponent={
          <View style={styles.form}>
            <Text style={styles.formTitle}>Ask the organizers</Text>
            <Text style={styles.formSub}>
              Have a question about the conference? Send it here and the team will reply.
            </Text>
            <TextInput
              style={styles.input}
              value={message}
              onChangeText={setMessage}
              placeholder="Type your question..."
              placeholderTextColor="#aaa"
              multiline
              numberOfLines={4}
              editable={!sending}
            />
            <TouchableOpacity
              style={[styles.sendButton, (!message.trim() || sending) && styles.sendDisabled]}
              onPress={handleSubmit}
              disabled={!message.trim() || sending}
            >
              <Text style={styles.sendText}>{sending ? 'Sending...' : 'Send question'}</Text>
            </TouchableOpacity>
            {requests.length > 0 && (
              <Text style={styles.historyLabel}>Previous questions</Text>
            )}
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.empty}>Your questions will appear here.</Text>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.cardMessage}>{item.message}</Text>
            <Text style={styles.cardDate}>{formatDate(item.created_at)}</Text>
            {item.admin_reply ? (
              <View style={styles.replyBox}>
                <Text style={styles.replyLabel}>Team reply</Text>
                <Text style={styles.replyText}>{item.admin_reply}</Text>
              </View>
            ) : (
              <Text style={styles.pending}>Awaiting reply</Text>
            )}
          </View>
        )}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 16, paddingBottom: 40 },
  form: { marginBottom: 8 },
  formTitle: { fontSize: 20, fontWeight: '700', color: '#1e293b', marginBottom: 6 },
  formSub: { fontSize: 13, color: '#64748b', marginBottom: 14, lineHeight: 18 },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    minHeight: 100,
    textAlignVertical: 'top',
    marginBottom: 10,
    color: '#1e293b',
  },
  sendButton: {
    backgroundColor: '#2563eb',
    borderRadius: 10,
    padding: 13,
    alignItems: 'center',
  },
  sendDisabled: { opacity: 0.4 },
  sendText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  historyLabel: { fontSize: 13, fontWeight: '700', color: '#94a3b8', marginTop: 28, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  empty: { textAlign: 'center', color: '#aaa', marginTop: 16, fontSize: 14 },
  card: {
    backgroundColor: '#f8f8f8',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  cardMessage: { fontSize: 14, color: '#1e293b', lineHeight: 20 },
  cardDate: { fontSize: 11, color: '#94a3b8', marginTop: 6 },
  replyBox: {
    marginTop: 10,
    backgroundColor: '#dcfce7',
    borderRadius: 8,
    padding: 10,
  },
  replyLabel: { fontSize: 11, fontWeight: '700', color: '#15803d', marginBottom: 4 },
  replyText: { fontSize: 13, color: '#166534', lineHeight: 18 },
  pending: { fontSize: 12, color: '#94a3b8', marginTop: 8, fontStyle: 'italic' },
});
