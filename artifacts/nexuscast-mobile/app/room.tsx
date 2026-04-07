import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import React, { useRef, useState } from "react";
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
import { WebView } from "react-native-webview";

import { useColors } from "@/hooks/useColors";

const WEB_DOMAIN =
  process.env.EXPO_PUBLIC_DOMAIN ||
  "338c8362-a7fc-4455-98a7-c787fa2b5b01-00-2oxkdmdk4dj2m.sisko.replit.dev";

export default function RoomScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { code, isHost } = useLocalSearchParams<{ code: string; isHost: string }>();
  const webViewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const roomUrl = `https://${WEB_DOMAIN}/?room=${code}`;

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  function handleBack() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  }

  if (Platform.OS === "web") {
    return (
      <View style={[styles.container, { paddingTop: topPad }]}>
        <StatusBar barStyle="light-content" />
        <View style={styles.webHeader}>
          <TouchableOpacity onPress={handleBack} style={styles.backButton}>
            <Feather name="arrow-left" size={22} color={colors.primary} />
          </TouchableOpacity>
          <Text style={[styles.roomCode, { color: colors.primary }]}>{code}</Text>
          <View style={styles.liveTag}>
            <View style={[styles.liveDot, { backgroundColor: colors.live }]} />
            <Text style={[styles.liveText, { color: colors.live }]}>LIVE</Text>
          </View>
        </View>
        <View style={styles.webFallback}>
          <Feather name="monitor" size={48} color={colors.mutedForeground} />
          <Text style={[styles.webFallbackTitle, { color: colors.foreground }]}>
            Open in Browser
          </Text>
          <Text style={[styles.webFallbackSub, { color: colors.mutedForeground }]}>
            Room: {code}
          </Text>
          <Text style={[styles.webUrl, { color: colors.primary }]}>{roomUrl}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#050915" />

      {/* FLOATING HEADER */}
      <View style={[styles.floatingHeader, { top: topPad + 8 }]}>
        <TouchableOpacity
          style={[styles.headerButton, { backgroundColor: "rgba(5,9,21,0.8)", borderColor: colors.border }]}
          onPress={handleBack}
          activeOpacity={0.8}
        >
          <Feather name="arrow-left" size={18} color={colors.primary} />
        </TouchableOpacity>

        <View style={[styles.roomCodePill, { backgroundColor: "rgba(5,9,21,0.85)", borderColor: colors.border }]}>
          <Text style={[styles.roomCodeText, { color: colors.primary }]}>{code}</Text>
          {isHost === "true" && (
            <View style={[styles.hostBadge, { backgroundColor: colors.hostBadge + "22", borderColor: colors.hostBadge }]}>
              <Text style={[styles.hostBadgeText, { color: colors.hostBadge }]}>HOST</Text>
            </View>
          )}
        </View>

        <TouchableOpacity
          style={[styles.headerButton, { backgroundColor: "rgba(255,0,0,0.2)", borderColor: "#ff4444" }]}
          onPress={handleBack}
          activeOpacity={0.8}
        >
          <Feather name="x" size={18} color="#ff6666" />
        </TouchableOpacity>
      </View>

      {/* WEBVIEW */}
      {!error ? (
        <WebView
          ref={webViewRef}
          source={{ uri: roomUrl }}
          style={styles.webview}
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback
          javaScriptEnabled
          domStorageEnabled
          startInLoadingState
          allowsFullscreenVideo
          mixedContentMode="always"
          originWhitelist={["*"]}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          onError={() => { setError(true); setLoading(false); }}
          userAgent="Mozilla/5.0 (Linux; Android 10; NexusCast) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
        />
      ) : (
        <View style={styles.errorContainer}>
          <Feather name="wifi-off" size={48} color={colors.mutedForeground} />
          <Text style={[styles.errorTitle, { color: colors.foreground }]}>
            Connection Failed
          </Text>
          <Text style={[styles.errorSub, { color: colors.mutedForeground }]}>
            Could not reach the streaming server. Check your connection.
          </Text>
          <TouchableOpacity
            style={[styles.retryButton, { backgroundColor: colors.primary }]}
            onPress={() => { setError(false); setLoading(true); }}
            activeOpacity={0.85}
          >
            <Text style={[styles.retryText, { color: "#050915" }]}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* LOADING OVERLAY */}
      {loading && !error && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
            Joining room {code}...
          </Text>
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
  floatingHeader: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    zIndex: 100,
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  roomCodePill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  roomCodeText: {
    fontSize: 16,
    fontWeight: "700" as const,
    letterSpacing: 3,
    fontFamily: "Inter_700Bold",
  },
  hostBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  hostBadgeText: {
    fontSize: 9,
    fontWeight: "700" as const,
    letterSpacing: 1,
    fontFamily: "Inter_700Bold",
  },
  liveTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  liveText: {
    fontSize: 10,
    fontWeight: "700" as const,
    letterSpacing: 1,
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
    gap: 16,
  },
  loadingText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
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
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 8,
  },
  retryText: {
    fontSize: 16,
    fontWeight: "700" as const,
    fontFamily: "Inter_700Bold",
  },
  webHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  backButton: {
    padding: 8,
  },
  roomCode: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700" as const,
    letterSpacing: 3,
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
  },
  webFallbackSub: {
    fontSize: 14,
    letterSpacing: 2,
  },
  webUrl: {
    fontSize: 11,
    textAlign: "center",
  },
});
