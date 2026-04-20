import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { Profile } from '../types/database';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ScannerScreen() {
  const { session } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const [scannedProfile, setScannedProfile] = useState<Profile | null>(null);
  const [alreadyConnected, setAlreadyConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const lockRef = useRef(false);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  async function handleBarCode({ data }: { data: string }) {
    if (lockRef.current) return;
    const code = data.trim();
    if (!UUID_RE.test(code)) return;
    if (!session?.user || code === session.user.id) {
      lockRef.current = true;
      Alert.alert("That's you", "You can't scan your own code.", [
        { text: 'OK', onPress: () => (lockRef.current = false) },
      ]);
      return;
    }
    lockRef.current = true;
    setLoading(true);
    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', code)
        .maybeSingle();
      if (error) throw error;
      if (!profile) {
        Alert.alert('Not found', 'No profile for that code.', [
          { text: 'OK', onPress: () => (lockRef.current = false) },
        ]);
        return;
      }
      const { data: existing } = await supabase
        .from('scans')
        .select('id')
        .eq('scanner_id', session.user.id)
        .eq('scanned_id', code)
        .maybeSingle();
      setAlreadyConnected(!!existing);
      setScannedProfile(profile as Profile);
    } catch (err: any) {
      Alert.alert('Error', err.message ?? String(err), [
        { text: 'OK', onPress: () => (lockRef.current = false) },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function handleAdd() {
    if (!scannedProfile || !session?.user) return;
    setAdding(true);
    const { error } = await supabase.from('scans').insert({
      scanner_id: session.user.id,
      scanned_id: scannedProfile.id,
    });
    setAdding(false);
    if (error && !error.message.includes('duplicate')) {
      Alert.alert('Could not add', error.message);
      return;
    }
    closeModal();
  }

  function closeModal() {
    setScannedProfile(null);
    setAlreadyConnected(false);
    setTimeout(() => {
      lockRef.current = false;
    }, 500);
  }

  if (!permission) return <ActivityIndicator style={{ flex: 1 }} />;
  if (!permission.granted) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionText}>Camera access is needed to scan QR codes.</Text>
        <TouchableOpacity style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Grant camera access</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={lockRef.current ? undefined : handleBarCode}
      />
      <View style={styles.overlay}>
        <View style={styles.reticle} />
        <Text style={styles.overlayText}>Point at a QR code</Text>
      </View>

      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#fff" />
        </View>
      )}

      <Modal
        visible={!!scannedProfile}
        transparent
        animationType="slide"
        onRequestClose={closeModal}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            {scannedProfile && (
              <>
                {scannedProfile.photo_url ? (
                  <Image source={{ uri: scannedProfile.photo_url }} style={styles.modalPhoto} />
                ) : (
                  <View style={[styles.modalPhoto, styles.modalPhotoPlaceholder]}>
                    <Text style={{ color: '#888' }}>no photo</Text>
                  </View>
                )}
                <Text style={styles.modalName}>{scannedProfile.full_name}</Text>
                {scannedProfile.hometown ? (
                  <Text style={styles.modalMeta}>from {scannedProfile.hometown}</Text>
                ) : null}
                {scannedProfile.background ? (
                  <Text style={styles.modalBackground}>{scannedProfile.background}</Text>
                ) : null}
                {alreadyConnected && (
                  <Text style={styles.alreadyText}>Already in your contacts</Text>
                )}
                <TouchableOpacity
                  style={[styles.button, adding && styles.buttonDisabled]}
                  onPress={handleAdd}
                  disabled={adding || alreadyConnected}
                >
                  <Text style={styles.buttonText}>
                    {alreadyConnected ? 'Already added' : adding ? 'Adding...' : 'Add to contacts'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.linkButton} onPress={closeModal}>
                  <Text style={styles.linkText}>Cancel</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  permissionContainer: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  permissionText: { fontSize: 15, color: '#333', textAlign: 'center', marginBottom: 16 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  reticle: {
    width: 240,
    height: 240,
    borderWidth: 3,
    borderColor: '#ffffffcc',
    borderRadius: 20,
  },
  overlayText: { color: '#fff', marginTop: 16, fontSize: 15 },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#00000088',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: '#00000099',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#fff',
    padding: 24,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    alignItems: 'center',
  },
  modalPhoto: { width: 110, height: 110, borderRadius: 55, marginBottom: 12 },
  modalPhotoPlaceholder: {
    backgroundColor: '#f1f1f1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalName: { fontSize: 22, fontWeight: '700' },
  modalMeta: { color: '#666', marginTop: 4 },
  modalBackground: {
    color: '#333',
    marginTop: 10,
    textAlign: 'center',
    fontSize: 15,
    lineHeight: 20,
  },
  alreadyText: { color: '#b45309', marginTop: 12, fontSize: 13 },
  button: {
    backgroundColor: '#2563eb',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    alignSelf: 'stretch',
    marginTop: 18,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  linkButton: { marginTop: 12 },
  linkText: { color: '#888', fontSize: 14 },
});
