import { Feather, MaterialIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRoom } from "@/context/RoomContext";
import { useColors } from "@/hooks/useColors";

function generateCode() {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
}

export default function LobbyScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isConnected, userId, setUserId, joinRoom } = useRoom();
  const [roomCode, setRoomCode] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(userId);
  const [joining, setJoining] = useState(false);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const botPad = Platform.OS === "web" ? 34 : insets.bottom;

  function handleJoin() {
    const code = roomCode.trim().toUpperCase();
    if (!code) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setJoining(true);
    joinRoom(code);
    setTimeout(() => {
      setJoining(false);
      router.push("/room");
    }, 500);
  }

  function handleCreate() {
    const code = generateCode();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setRoomCode(code);
    joinRoom(code);
    setTimeout(() => {
      router.push("/room");
    }, 500);
  }

  function saveName() {
    const n = nameInput.trim();
    if (n) setUserId(n);
    setEditingName(false);
  }

  const s = styles(colors);

  return (
    <View style={[s.root, { paddingTop: topPad, paddingBottom: botPad }]}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.logoRow}>
          <MaterialIcons name="cast" size={28} color={colors.primary} />
          <Text style={s.logoText}>NEXUS</Text>
          <Text style={[s.logoText, { color: colors.primary }]}>CAST</Text>
        </View>
        <View style={[s.dot, { backgroundColor: isConnected ? colors.success : colors.destructive }]} />
      </View>

      {/* User identity */}
      <View style={s.identityCard}>
        <Feather name="user" size={18} color={colors.mutedForeground} />
        {editingName ? (
          <TextInput
            style={s.nameInput}
            value={nameInput}
            onChangeText={setNameInput}
            onSubmitEditing={saveName}
            onBlur={saveName}
            autoFocus
            placeholderTextColor={colors.mutedForeground}
            returnKeyType="done"
          />
        ) : (
          <Pressable onPress={() => { setEditingName(true); setNameInput(userId); }} style={s.nameRow}>
            <Text style={s.nameText}>{userId}</Text>
            <Feather name="edit-2" size={13} color={colors.mutedForeground} />
          </Pressable>
        )}
      </View>

      {/* Main card */}
      <View style={s.card}>
        <Text style={s.label}>JOIN A ROOM</Text>
        <View style={s.inputRow}>
          <TextInput
            style={s.codeInput}
            placeholder="Room code (e.g. A1B2C3)"
            placeholderTextColor={colors.mutedForeground}
            value={roomCode}
            onChangeText={(t) => setRoomCode(t.toUpperCase())}
            autoCapitalize="characters"
            maxLength={8}
            returnKeyType="join"
            onSubmitEditing={handleJoin}
          />
        </View>
        <Pressable
          style={({ pressed }) => [s.joinBtn, pressed && s.pressed, !roomCode.trim() && s.disabled]}
          onPress={handleJoin}
          disabled={!roomCode.trim() || joining}
        >
          {joining ? (
            <ActivityIndicator size="small" color={colors.primaryForeground} />
          ) : (
            <>
              <Feather name="log-in" size={18} color={colors.primaryForeground} />
              <Text style={s.joinBtnText}>Join Room</Text>
            </>
          )}
        </Pressable>

        <View style={s.divider}>
          <View style={s.dividerLine} />
          <Text style={s.dividerText}>OR</Text>
          <View style={s.dividerLine} />
        </View>

        <Pressable
          style={({ pressed }) => [s.createBtn, pressed && s.pressed]}
          onPress={handleCreate}
        >
          <Feather name="plus-circle" size={18} color={colors.primary} />
          <Text style={s.createBtnText}>Create New Room</Text>
        </Pressable>
      </View>

      {/* Info */}
      <View style={s.infoRow}>
        <Feather name="info" size={14} color={colors.mutedForeground} />
        <Text style={s.infoText}>
          Full screen sharing requires a native build via Expo Launch
        </Text>
      </View>
    </View>
  );
}

const styles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
      paddingHorizontal: 24,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 16,
      marginBottom: 32,
    },
    logoRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    logoText: {
      fontSize: 22,
      fontWeight: "900" as const,
      color: colors.foreground,
      letterSpacing: 2,
      fontFamily: "Inter_700Bold",
    },
    dot: {
      width: 10,
      height: 10,
      borderRadius: 5,
    },
    identityCard: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      paddingHorizontal: 16,
      paddingVertical: 12,
      marginBottom: 24,
      gap: 10,
      borderWidth: 1,
      borderColor: colors.border,
    },
    nameRow: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    nameText: {
      flex: 1,
      color: colors.foreground,
      fontFamily: "Inter_500Medium",
      fontSize: 15,
    },
    nameInput: {
      flex: 1,
      color: colors.foreground,
      fontFamily: "Inter_500Medium",
      fontSize: 15,
      padding: 0,
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      padding: 24,
      borderWidth: 1,
      borderColor: colors.border,
    },
    label: {
      color: colors.mutedForeground,
      fontSize: 11,
      fontFamily: "Inter_600SemiBold",
      letterSpacing: 1.5,
      marginBottom: 14,
    },
    inputRow: {
      marginBottom: 14,
    },
    codeInput: {
      backgroundColor: colors.input,
      borderRadius: colors.radius - 2,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 16,
      paddingVertical: 14,
      color: colors.foreground,
      fontFamily: "Inter_600SemiBold",
      fontSize: 18,
      letterSpacing: 3,
      textAlign: "center",
    },
    joinBtn: {
      backgroundColor: colors.primary,
      borderRadius: colors.radius - 2,
      paddingVertical: 15,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    joinBtnText: {
      color: colors.primaryForeground,
      fontFamily: "Inter_700Bold",
      fontSize: 16,
    },
    disabled: {
      opacity: 0.4,
    },
    pressed: {
      opacity: 0.75,
      transform: [{ scale: 0.98 }],
    },
    divider: {
      flexDirection: "row",
      alignItems: "center",
      marginVertical: 20,
      gap: 12,
    },
    dividerLine: {
      flex: 1,
      height: 1,
      backgroundColor: colors.border,
    },
    dividerText: {
      color: colors.mutedForeground,
      fontFamily: "Inter_500Medium",
      fontSize: 12,
    },
    createBtn: {
      borderWidth: 1.5,
      borderColor: colors.primary,
      borderRadius: colors.radius - 2,
      paddingVertical: 14,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    createBtnText: {
      color: colors.primary,
      fontFamily: "Inter_700Bold",
      fontSize: 16,
    },
    infoRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
      marginTop: 24,
      paddingHorizontal: 4,
    },
    infoText: {
      flex: 1,
      color: colors.mutedForeground,
      fontFamily: "Inter_400Regular",
      fontSize: 12,
      lineHeight: 18,
    },
  });
