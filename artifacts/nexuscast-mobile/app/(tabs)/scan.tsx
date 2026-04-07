import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { CameraView, useCameraPermissions } from "expo-camera";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useStream } from "@/context/StreamContext";
import { useColors } from "@/hooks/useColors";

export default function ScanScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const { addRecentRoom } = useStream();

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  useEffect(() => {
    if (!permission?.granted) {
      requestPermission();
    }
  }, []);

  function handleBarcodeScan({ data }: { data: string }) {
    if (scanned) return;
    setScanned(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    let roomCode = data.trim().toUpperCase();

    try {
      const url = new URL(data);
      const param = url.searchParams.get("room");
      if (param) roomCode = param.toUpperCase();
    } catch {}

    if (roomCode.length >= 4) {
      addRecentRoom(roomCode);
      setTimeout(() => {
        router.push({ pathname: "/room", params: { code: roomCode, isHost: "false" } });
        setScanned(false);
      }, 500);
    } else {
      setTimeout(() => setScanned(false), 2000);
    }
  }

  if (Platform.OS === "web") {
    return (
      <View style={[styles.container, { paddingTop: topPad }]}>
        <StatusBar barStyle="light-content" />
        <View style={styles.webFallback}>
          <Feather name="camera" size={48} color={colors.mutedForeground} />
          <Text style={[styles.webFallbackTitle, { color: colors.foreground }]}>
            QR Scanner
          </Text>
          <Text style={[styles.webFallbackSub, { color: colors.mutedForeground }]}>
            Use the mobile app to scan QR codes. On web, enter the room code manually on the home screen.
          </Text>
        </View>
      </View>
    );
  }

  if (!permission) {
    return (
      <View style={[styles.container, { paddingTop: topPad }]}>
        <Text style={[styles.permText, { color: colors.mutedForeground }]}>
          Requesting camera permission...
        </Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={[styles.container, { paddingTop: topPad }]}>
        <StatusBar barStyle="light-content" />
        <View style={styles.permContainer}>
          <Feather name="camera-off" size={48} color={colors.mutedForeground} />
          <Text style={[styles.permTitle, { color: colors.foreground }]}>
            Camera Access Needed
          </Text>
          <Text style={[styles.permSub, { color: colors.mutedForeground }]}>
            We need camera access to scan QR codes and join rooms instantly.
          </Text>
          <TouchableOpacity
            style={[styles.permButton, { backgroundColor: colors.primary }]}
            onPress={requestPermission}
            activeOpacity={0.85}
          >
            <Text style={[styles.permButtonText, { color: "#050915" }]}>
              Allow Camera
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={scanned ? undefined : handleBarcodeScan}
      />

      <View style={[styles.overlay, { paddingTop: topPad }]}>
        <Text style={styles.scanTitle}>Scan Room QR Code</Text>
        <Text style={styles.scanSub}>Point at the QR code shown on the host's screen</Text>

        <View style={styles.viewfinderContainer}>
          <View style={styles.viewfinder}>
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />
            {scanned && (
              <View style={styles.successOverlay}>
                <Feather name="check-circle" size={48} color="#00ff44" />
              </View>
            )}
          </View>
        </View>

        <Text style={styles.orText}>— or enter code manually on Home —</Text>
      </View>
    </View>
  );
}

const CORNER_SIZE = 28;
const CORNER_THICKNESS = 3;
const VF_SIZE = 220;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#050915",
  },
  webFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    paddingHorizontal: 32,
  },
  webFallbackTitle: {
    fontSize: 22,
    fontWeight: "700" as const,
    textAlign: "center",
  },
  webFallbackSub: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 22,
  },
  permText: {
    textAlign: "center",
    marginTop: 40,
    fontSize: 14,
  },
  permContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 16,
  },
  permTitle: {
    fontSize: 22,
    fontWeight: "700" as const,
    textAlign: "center",
  },
  permSub: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 22,
  },
  permButton: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 8,
  },
  permButtonText: {
    fontSize: 16,
    fontWeight: "700" as const,
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(5,9,21,0.6)",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  scanTitle: {
    fontSize: 20,
    fontWeight: "700" as const,
    color: "#e8f0ff",
    marginTop: 24,
    fontFamily: "Inter_700Bold",
  },
  scanSub: {
    fontSize: 13,
    color: "#a0b0d0",
    textAlign: "center",
    marginTop: 8,
    marginBottom: 40,
    fontFamily: "Inter_400Regular",
  },
  viewfinderContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
  viewfinder: {
    width: VF_SIZE,
    height: VF_SIZE,
    position: "relative",
  },
  corner: {
    position: "absolute",
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderColor: "#00d4ff",
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: CORNER_THICKNESS,
    borderLeftWidth: CORNER_THICKNESS,
    borderTopLeftRadius: 4,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: CORNER_THICKNESS,
    borderRightWidth: CORNER_THICKNESS,
    borderTopRightRadius: 4,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: CORNER_THICKNESS,
    borderLeftWidth: CORNER_THICKNESS,
    borderBottomLeftRadius: 4,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: CORNER_THICKNESS,
    borderRightWidth: CORNER_THICKNESS,
    borderBottomRightRadius: 4,
  },
  successOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,255,68,0.1)",
    borderRadius: 4,
  },
  orText: {
    fontSize: 12,
    color: "#a0b0d0",
    marginTop: 48,
    fontFamily: "Inter_400Regular",
  },
});
