import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useCameraPermissions } from "expo-camera";
import { Audio } from "expo-av";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView, WebViewMessageEvent } from "react-native-webview";

import { useStream } from "@/context/StreamContext";
import { useColors } from "@/hooks/useColors";

const WEB_DOMAIN =
  process.env.EXPO_PUBLIC_DOMAIN ||
  "338c8362-a7fc-4455-98a7-c787fa2b5b01-00-2oxkdmdk4dj2m.sisko.replit.dev";

// Injected into every page load — sets up mobile CSS and the native message bridge
const INJECTED_JS = `
(function() {
  if (window.__ncMobileInjected) return;
  window.__ncMobileInjected = true;

  // Smooth scrollbars + tap highlights off
  var s = document.createElement('style');
  s.textContent = [
    '::-webkit-scrollbar { display: none !important }',
    '* { -webkit-tap-highlight-color: transparent !important; box-sizing: border-box }',
    'body { overflow-x: hidden !important }',
    'video { background: #000 !important }',
  ].join(' ');
  document.head && document.head.appendChild(s);

  // Patch history.back so it triggers native navigation
  var _origBack = window.history.back.bind(window.history);
  window.history.back = function() {
    try { window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'back' })); }
    catch(e) { _origBack(); }
  };

  // Expose a helper the web app can call: window.nativeBridge.send({ type, ... })
  window.nativeBridge = {
    send: function(data) {
      try { window.ReactNativeWebView.postMessage(JSON.stringify(data)); } catch(e) {}
    }
  };

  true;
})();
`;

export default function RoomScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { code, isHost } = useLocalSearchParams<{ code: string; isHost: string }>();
  const { username, avatar, addRecentRoom } = useStream();
  const webViewRef = useRef<WebView>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [permissionsReady, setPermissionsReady] = useState(Platform.OS === "web");

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  // Build URL — pass identity + native flag so web app can personalise and skip desktop UI chrome
  const encodedAvatar = encodeURIComponent(avatar);
  const encodedUser = encodeURIComponent(username);
  const roomUrl = `https://${WEB_DOMAIN}/?room=${code}&uid=${encodedUser}&avatar=${encodedAvatar}&native=1`;

  // Request camera + mic before loading WebView so the browser inside can access them
  useEffect(() => {
    if (Platform.OS === "web") return;
    async function requestPerms() {
      try {
        if (!cameraPermission?.granted) await requestCameraPermission();
        await Audio.requestPermissionsAsync();
      } catch {}
      setPermissionsReady(true);
    }
    requestPerms();
  }, []);

  function handleBack() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  }

  // Handle messages posted from the web app (window.ReactNativeWebView.postMessage)
  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === "back" || data.type === "leave_room") {
        handleBack();
      } else if (data.type === "room_created" && data.code) {
        addRecentRoom(String(data.code));
      }
    } catch {}
  }, []);

  // Grant ALL media permission requests from the WebView (camera, mic) — Android
  const handlePermissionRequest = useCallback((request: { grant: () => void }) => {
    request.grant();
  }, []);

  // Web-platform fallback (Expo web) — open in browser
  if (Platform.OS === "web") {
    const webUrl = roomUrl;
    return (
      <View style={[styles.container, { paddingTop: topPad }]}>
        <StatusBar barStyle="light-content" />
        <View style={styles.webHeader}>
          <TouchableOpacity onPress={handleBack} style={styles.backButton}>
            <Feather name="arrow-left" size={22} color={colors.primary} />
          </TouchableOpacity>
          <Text style={[styles.roomCodeLarge, { color: colors.primary }]}>{code}</Text>
        </View>
        <View style={styles.webFallback}>
          <Feather name="monitor" size={48} color={colors.mutedForeground} />
          <Text style={[styles.webFallbackTitle, { color: colors.foreground }]}>
            Open in Browser
          </Text>
          <Text style={[styles.webFallbackSub, { color: colors.mutedForeground }]}>
            {webUrl}
          </Text>
        </View>
      </View>
    );
  }

  // Waiting for permission request to complete
  if (!permissionsReady) {
    return (
      <View style={styles.permWait}>
        <StatusBar barStyle="light-content" backgroundColor="#050915" />
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.permWaitText, { color: colors.mutedForeground }]}>
          Setting up camera & microphone…
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#050915" />

      {/* MINIMAL STATUS BAR — sits in safe area, doesn't cover WebView content */}
      <View
        style={[
          styles.statusBar,
          { height: topPad + 44, paddingTop: topPad, paddingHorizontal: 12 },
        ]}
      >
        <TouchableOpacity style={styles.backBtn} onPress={handleBack} activeOpacity={0.7}>
          <Feather name="arrow-left" size={19} color={colors.primary} />
        </TouchableOpacity>

        <View style={styles.codePill}>
          <View style={[styles.liveDot, { backgroundColor: colors.live }]} />
          <Text style={[styles.codeText, { color: colors.primary }]}>{code}</Text>
          {isHost === "true" && (
            <Text style={[styles.hostTag, { color: colors.hostBadge }]}>HOST</Text>
          )}
        </View>

        <TouchableOpacity
          style={[styles.leaveBtn, { borderColor: "#ff4444" }]}
          onPress={handleBack}
          activeOpacity={0.7}
        >
          <Feather name="log-out" size={16} color="#ff5555" />
        </TouchableOpacity>
      </View>

      {/* FULL-SCREEN WEBVIEW */}
      {!error ? (
        <WebView
          ref={webViewRef}
          source={{ uri: roomUrl }}
          style={styles.webview}
          // Media
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback
          allowsFullscreenVideo
          allowsAirPlayForMediaPlayback
          // JavaScript
          javaScriptEnabled
          javaScriptCanOpenWindowsAutomatically
          domStorageEnabled
          injectedJavaScript={INJECTED_JS}
          // Permissions
          mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
          onPermissionRequest={handlePermissionRequest}
          // Security / content
          mixedContentMode="always"
          originWhitelist={["*"]}
          // User agent — modern Android Chrome so sites don't block WebRTC
          userAgent="Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
          // Callbacks
          onLoadStart={() => { setLoading(true); setError(false); }}
          onLoadEnd={() => setLoading(false)}
          onError={() => { setError(true); setLoading(false); }}
          onMessage={handleMessage}
        />
      ) : (
        <View style={styles.errorContainer}>
          <Feather name="wifi-off" size={52} color={colors.mutedForeground} />
          <Text style={[styles.errorTitle, { color: colors.foreground }]}>Connection Failed</Text>
          <Text style={[styles.errorSub, { color: colors.mutedForeground }]}>
            Could not reach the streaming server. Check your connection and try again.
          </Text>
          <TouchableOpacity
            style={[styles.retryButton, { backgroundColor: colors.primary }]}
            onPress={() => { setError(false); setLoading(true); }}
            activeOpacity={0.85}
          >
            <Feather name="refresh-cw" size={16} color="#050915" />
            <Text style={[styles.retryText, { color: "#050915" }]}>Retry</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleBack} style={styles.goBackLink}>
            <Text style={[styles.goBackText, { color: colors.mutedForeground }]}>← Go Back</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* LOADING OVERLAY */}
      {loading && !error && (
        <View style={styles.loadingOverlay}>
          <View style={[styles.loadingCard, { backgroundColor: "#0a1030", borderColor: colors.border }]}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.loadingTitle, { color: colors.foreground }]}>
              Joining Room
            </Text>
            <Text style={[styles.loadingCode, { color: colors.primary }]}>{code}</Text>
            <Text style={[styles.loadingHint, { color: colors.mutedForeground }]}>
              Connecting to stream server…
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#050915",
  },
  statusBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingBottom: 8,
    backgroundColor: "#050915",
    borderBottomWidth: 1,
    borderBottomColor: "#1a2444",
    gap: 10,
    zIndex: 10,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#0a1030",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#1a2444",
  },
  codePill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0a1030",
    borderRadius: 10,
    height: 36,
    borderWidth: 1,
    borderColor: "#1a2444",
    gap: 7,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  codeText: {
    fontSize: 15,
    fontWeight: "700" as const,
    letterSpacing: 3,
    fontFamily: "Inter_700Bold",
  },
  hostTag: {
    fontSize: 9,
    fontWeight: "700" as const,
    letterSpacing: 1.5,
    fontFamily: "Inter_700Bold",
    backgroundColor: "rgba(255,170,0,0.15)",
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  leaveBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "rgba(255,68,68,0.1)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  webview: {
    flex: 1,
    backgroundColor: "#050915",
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#050915",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 50,
  },
  loadingCard: {
    alignItems: "center",
    padding: 32,
    borderRadius: 20,
    borderWidth: 1,
    gap: 12,
    width: 240,
  },
  loadingTitle: {
    fontSize: 18,
    fontWeight: "700" as const,
    fontFamily: "Inter_700Bold",
  },
  loadingCode: {
    fontSize: 22,
    fontWeight: "900" as const,
    letterSpacing: 4,
    fontFamily: "Inter_700Bold",
  },
  loadingHint: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  errorContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 16,
  },
  errorTitle: {
    fontSize: 22,
    fontWeight: "700" as const,
    fontFamily: "Inter_700Bold",
  },
  errorSub: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 22,
    fontFamily: "Inter_400Regular",
  },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 4,
  },
  retryText: {
    fontSize: 16,
    fontWeight: "700" as const,
    fontFamily: "Inter_700Bold",
  },
  goBackLink: {
    paddingVertical: 8,
  },
  goBackText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  permWait: {
    flex: 1,
    backgroundColor: "#050915",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  permWaitText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  // Web fallback
  webHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1a2444",
  },
  backButton: {
    padding: 8,
  },
  roomCodeLarge: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700" as const,
    letterSpacing: 4,
    fontFamily: "Inter_700Bold",
  },
  webFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 32,
  },
  webFallbackTitle: {
    fontSize: 22,
    fontWeight: "700" as const,
    fontFamily: "Inter_700Bold",
  },
  webFallbackSub: {
    fontSize: 11,
    textAlign: "center",
    lineHeight: 18,
    fontFamily: "Inter_400Regular",
  },
});
