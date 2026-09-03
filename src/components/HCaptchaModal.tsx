import React, { useMemo } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { type ColorScheme } from '../theme';
import { useTheme } from '../context/ThemeContext';

const SITE_KEY = process.env.EXPO_PUBLIC_HCAPTCHA_SITE_KEY;

// WebView's `source={{ html }}` with no baseUrl loads with Origin: "null"
// (Android's loadDataWithBaseURL(null, ...) behavior), which hCaptcha's
// backend rejects as invalid-data — unrelated to its (opt-in, off by
// default) domain allowlist. A real-looking https URL fixes it, and using
// the actual registered domain keeps this consistent if allowlisting is
// ever turned on.
const CAPTCHA_BASE_URL = 'https://ysaconstellations.org';

// False until EXPO_PUBLIC_HCAPTCHA_SITE_KEY is set (see .env.example) — lets
// callers skip the captcha step entirely until it's actually configured,
// which must happen before the Supabase dashboard's "Enable CAPTCHA
// protection" toggle is flipped (see docs/production-launch-plan.md §8).
export const HCAPTCHA_ENABLED = !!SITE_KEY;

type Props = {
  visible: boolean;
  onToken: (token: string) => void;
  onClose: () => void;
};

// hCaptcha has no React Native SDK — @hcaptcha/react-hcaptcha is web-only.
// This loads their JS checkbox widget in a WebView and relays the resulting
// token back to RN via postMessage, per docs/production-launch-plan.md §8.
function buildHtml(siteKey: string) {
  return `<!DOCTYPE html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <script src="https://js.hcaptcha.com/1/api.js" async defer></script>
    <style>
      html, body {
        margin: 0; padding: 0; height: 100%;
        display: flex; align-items: center; justify-content: center;
        background: #fff;
      }
    </style>
  </head>
  <body>
    <div
      class="h-captcha"
      data-sitekey="${siteKey}"
      data-callback="onSuccess"
      data-expired-callback="onExpire"
      data-error-callback="onError"
    ></div>
    <script>
      function post(payload) { window.ReactNativeWebView.postMessage(JSON.stringify(payload)); }
      function onSuccess(token) { post({ type: 'success', token: token }); }
      function onExpire() { post({ type: 'expired' }); }
      function onError(err) { post({ type: 'error', error: String(err) }); }
    </script>
  </body>
</html>`;
}

export function HCaptchaModal({ visible, onToken, onClose }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);

  function handleMessage(event: WebViewMessageEvent) {
    let payload: { type: string; token?: string };
    try {
      payload = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (payload.type === 'success' && payload.token) {
      onToken(payload.token);
    }
    // 'expired' / 'error': the widget shows its own retry state, nothing to do here.
  }

  if (!SITE_KEY) {
    return null;
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.headerText}>Quick check</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
          <WebView
            originWhitelist={['*']}
            source={{ html: buildHtml(SITE_KEY), baseUrl: CAPTCHA_BASE_URL }}
            onMessage={handleMessage}
            style={styles.webview}
          />
        </View>
      </View>
    </Modal>
  );
}

function getStyles(colors: ColorScheme) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', alignItems: 'center' },
    card: {
      width: '90%',
      height: 420,
      backgroundColor: colors.surface,
      borderRadius: 16,
      overflow: 'hidden',
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerText: { fontSize: 14, fontWeight: '700', color: colors.text },
    cancelText: { color: colors.primary, fontWeight: '600', fontSize: 13 },
    webview: { flex: 1, backgroundColor: 'transparent' },
  });
}
