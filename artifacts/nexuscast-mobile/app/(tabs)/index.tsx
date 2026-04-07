import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useStream } from "@/context/StreamContext";
import { useColors } from "@/hooks/useColors";

function generateRoomCode() {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
}

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { username, avatar, recentRooms, addRecentRoom, clearRecentRooms } =
    useStream();
  const [joinCode, setJoinCode] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const topPad =
    Platform.OS === "web" ? 67 : insets.top;
  const bottomPad =
    Platform.OS === "web" ? 34 + 50 : insets.bottom + 50;

  function handleCreateRoom() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsCreating(true);
    const code = generateRoomCode();
    addRecentRoom(code);
    setTimeout(() => {
      setIsCreating(false);
      router.push({ pathname: "/room", params: { code, isHost: "true" } });
    }, 300);
  }

  function handleJoinRoom(code?: string) {
    const roomCode = (code ?? joinCode).trim().toUpperCase();
    if (roomCode.length < 4) {
      Alert.alert("Invalid Code", "Please enter a valid room code (4+ characters).");
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    addRecentRoom(roomCode);
    setJoinCode("");
    router.push({ pathname: "/room", params: { code: roomCode, isHost: "false" } });
  }

  const styles = makeStyles(colors);

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: topPad }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <StatusBar barStyle="light-content" backgroundColor="#050915" />

      {/* HEADER */}
      <View style={styles.header}>
        <View>
          <Text style={styles.logoText}>⚡ NEXUSCAST</Text>
          <Text style={styles.tagline}>Live Screen Sharing</Text>
        </View>
        <View style={styles.avatarBadge}>
          <Text style={styles.avatarEmoji}>{avatar}</Text>
        </View>
      </View>

      {/* STATUS BAR */}
      <View style={styles.statusBar}>
        <View style={[styles.statusDot, { backgroundColor: colors.success }]} />
        <Text style={styles.statusText}>Ready to stream</Text>
        <Text style={styles.usernameText}>{username}</Text>
      </View>

      {/* CREATE ROOM */}
      <TouchableOpacity
        style={styles.createButton}
        onPress={handleCreateRoom}
        activeOpacity={0.85}
        disabled={isCreating}
      >
        {isCreating ? (
          <ActivityIndicator color="#050915" />
        ) : (
          <>
            <Feather name="video" size={24} color="#050915" />
            <Text style={styles.createButtonText}>Go Live</Text>
            <Text style={styles.createButtonSub}>Create a new room</Text>
          </>
        )}
      </TouchableOpacity>

      {/* JOIN ROOM */}
      <View style={styles.joinSection}>
        <Text style={styles.sectionLabel}>JOIN A ROOM</Text>
        <View style={styles.joinRow}>
          <TextInput
            style={styles.codeInput}
            value={joinCode}
            onChangeText={(t) => setJoinCode(t.toUpperCase())}
            placeholder="ENTER CODE"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="characters"
            maxLength={8}
            returnKeyType="join"
            onSubmitEditing={() => handleJoinRoom()}
          />
          <TouchableOpacity
            style={styles.joinButton}
            onPress={() => handleJoinRoom()}
            activeOpacity={0.8}
          >
            <Feather name="arrow-right" size={20} color="#050915" />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.scanButton}
          onPress={() => router.push("/(tabs)/scan")}
          activeOpacity={0.8}
        >
          <Feather name="camera" size={16} color={colors.primary} />
          <Text style={styles.scanButtonText}>Scan QR Code</Text>
        </TouchableOpacity>
      </View>

      {/* RECENT ROOMS */}
      {recentRooms.length > 0 && (
        <View style={styles.recentSection}>
          <View style={styles.recentHeader}>
            <Text style={styles.sectionLabel}>RECENT ROOMS</Text>
            <TouchableOpacity onPress={clearRecentRooms}>
              <Text style={styles.clearText}>Clear</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={recentRooms}
            keyExtractor={(item) => item.code}
            scrollEnabled={false}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.recentItem}
                onPress={() => handleJoinRoom(item.code)}
                activeOpacity={0.75}
              >
                <View style={styles.recentIcon}>
                  <Feather name="clock" size={14} color={colors.mutedForeground} />
                </View>
                <Text style={styles.recentCode}>{item.code}</Text>
                <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
              </TouchableOpacity>
            )}
          />
        </View>
      )}

      <View style={{ height: bottomPad }} />
    </KeyboardAvoidingView>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: "#050915",
      paddingHorizontal: 20,
    },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      paddingVertical: 16,
    },
    logoText: {
      fontSize: 22,
      fontWeight: "900" as const,
      color: colors.primary,
      letterSpacing: 3,
      fontFamily: "Inter_700Bold",
    },
    tagline: {
      fontSize: 11,
      color: colors.mutedForeground,
      letterSpacing: 1,
      marginTop: 2,
      fontFamily: "Inter_400Regular",
    },
    avatarBadge: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: "#0a1030",
      borderWidth: 2,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarEmoji: {
      fontSize: 22,
    },
    statusBar: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: "#0a1030",
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 10,
      marginBottom: 24,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 8,
    },
    statusDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    statusText: {
      flex: 1,
      fontSize: 12,
      color: colors.mutedForeground,
      fontFamily: "Inter_400Regular",
    },
    usernameText: {
      fontSize: 12,
      color: colors.primary,
      fontFamily: "Inter_600SemiBold",
    },
    createButton: {
      backgroundColor: colors.primary,
      borderRadius: 16,
      paddingVertical: 24,
      alignItems: "center",
      marginBottom: 24,
      gap: 6,
      shadowColor: colors.primary,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.4,
      shadowRadius: 12,
      elevation: 8,
    },
    createButtonText: {
      fontSize: 20,
      fontWeight: "900" as const,
      color: "#050915",
      fontFamily: "Inter_700Bold",
      letterSpacing: 1,
    },
    createButtonSub: {
      fontSize: 12,
      color: "rgba(5,9,21,0.7)",
      fontFamily: "Inter_400Regular",
    },
    joinSection: {
      marginBottom: 24,
    },
    sectionLabel: {
      fontSize: 10,
      fontWeight: "700" as const,
      color: colors.mutedForeground,
      letterSpacing: 2,
      marginBottom: 12,
      fontFamily: "Inter_700Bold",
    },
    joinRow: {
      flexDirection: "row",
      gap: 10,
      marginBottom: 12,
    },
    codeInput: {
      flex: 1,
      backgroundColor: "#0a1030",
      borderWidth: 1.5,
      borderColor: colors.border,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
      fontSize: 18,
      color: colors.primary,
      fontFamily: "Inter_700Bold",
      letterSpacing: 4,
      textAlign: "center",
    },
    joinButton: {
      backgroundColor: colors.accent,
      borderRadius: 12,
      width: 52,
      alignItems: "center",
      justifyContent: "center",
    },
    scanButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      paddingVertical: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: "#0a1030",
    },
    scanButtonText: {
      fontSize: 14,
      color: colors.primary,
      fontFamily: "Inter_600SemiBold",
    },
    recentSection: {
      flex: 1,
    },
    recentHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 10,
    },
    clearText: {
      fontSize: 12,
      color: colors.destructive,
      fontFamily: "Inter_500Medium",
    },
    recentItem: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: "#0a1030",
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginBottom: 8,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 10,
    },
    recentIcon: {
      width: 28,
      height: 28,
      borderRadius: 8,
      backgroundColor: "#0d1a3a",
      alignItems: "center",
      justifyContent: "center",
    },
    recentCode: {
      flex: 1,
      fontSize: 15,
      color: colors.foreground,
      fontFamily: "Inter_600SemiBold",
      letterSpacing: 2,
    },
  });
}
