import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import {
  Alert,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AVATARS_LIST, useStream } from "@/context/StreamContext";
import { useColors } from "@/hooks/useColors";

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { username, setUsername, avatar, setAvatar, recentRooms, clearRecentRooms } =
    useStream();
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(username);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 + 50 : insets.bottom + 50;

  function saveName() {
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    setUsername(trimmed);
    setEditingName(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  return (
    <ScrollView
      style={[styles.container, { paddingTop: topPad }]}
      contentContainerStyle={{ paddingBottom: bottomPad }}
      showsVerticalScrollIndicator={false}
    >
      <StatusBar barStyle="light-content" backgroundColor="#050915" />

      <Text style={[styles.heading, { color: colors.primary }]}>Profile</Text>

      {/* AVATAR */}
      <View style={[styles.section, { borderColor: colors.border }]}>
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
          AVATAR
        </Text>
        <View style={styles.avatarGrid}>
          {AVATARS_LIST.map((av) => (
            <TouchableOpacity
              key={av}
              style={[
                styles.avatarOption,
                {
                  backgroundColor:
                    av === avatar ? colors.primary + "33" : "#0a1030",
                  borderColor: av === avatar ? colors.primary : colors.border,
                },
              ]}
              onPress={() => {
                setAvatar(av);
                Haptics.selectionAsync();
              }}
              activeOpacity={0.75}
            >
              <Text style={styles.avatarEmoji}>{av}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* USERNAME */}
      <View style={[styles.section, { borderColor: colors.border }]}>
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
          USERNAME
        </Text>
        {editingName ? (
          <View style={styles.editRow}>
            <TextInput
              style={[
                styles.nameInput,
                { color: colors.primary, borderColor: colors.primary, backgroundColor: "#0a1030" },
              ]}
              value={nameInput}
              onChangeText={setNameInput}
              autoFocus
              maxLength={20}
              returnKeyType="done"
              onSubmitEditing={saveName}
            />
            <TouchableOpacity
              style={[styles.saveButton, { backgroundColor: colors.primary }]}
              onPress={saveName}
              activeOpacity={0.85}
            >
              <Feather name="check" size={18} color="#050915" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.cancelButton, { borderColor: colors.border }]}
              onPress={() => { setEditingName(false); setNameInput(username); }}
              activeOpacity={0.8}
            >
              <Feather name="x" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.nameRow, { backgroundColor: "#0a1030", borderColor: colors.border }]}
            onPress={() => { setEditingName(true); setNameInput(username); }}
            activeOpacity={0.75}
          >
            <Text style={[styles.nameText, { color: colors.foreground }]}>{username}</Text>
            <Feather name="edit-2" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        )}
      </View>

      {/* RECENT ROOMS */}
      <View style={[styles.section, { borderColor: colors.border }]}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
            RECENT ROOMS ({recentRooms.length})
          </Text>
          {recentRooms.length > 0 && (
            <TouchableOpacity
              onPress={() =>
                Alert.alert("Clear History", "Remove all recent rooms?", [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Clear",
                    style: "destructive",
                    onPress: clearRecentRooms,
                  },
                ])
              }
            >
              <Text style={[styles.clearText, { color: colors.destructive }]}>
                Clear
              </Text>
            </TouchableOpacity>
          )}
        </View>
        {recentRooms.length === 0 ? (
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            No recent rooms yet
          </Text>
        ) : (
          recentRooms.map((r) => (
            <View
              key={r.code}
              style={[styles.recentItem, { backgroundColor: "#0a1030", borderColor: colors.border }]}
            >
              <Feather name="clock" size={14} color={colors.mutedForeground} />
              <Text style={[styles.recentCode, { color: colors.foreground }]}>
                {r.code}
              </Text>
            </View>
          ))
        )}
      </View>

      {/* APP INFO */}
      <View style={[styles.section, { borderColor: colors.border }]}>
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
          ABOUT
        </Text>
        <View style={[styles.infoItem, { backgroundColor: "#0a1030", borderColor: colors.border }]}>
          <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>App</Text>
          <Text style={[styles.infoValue, { color: colors.foreground }]}>NexusCast Mobile</Text>
        </View>
        <View style={[styles.infoItem, { backgroundColor: "#0a1030", borderColor: colors.border }]}>
          <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Version</Text>
          <Text style={[styles.infoValue, { color: colors.foreground }]}>1.0.0</Text>
        </View>
        <View style={[styles.infoItem, { backgroundColor: "#0a1030", borderColor: colors.border, borderBottomWidth: 0 }]}>
          <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Protocol</Text>
          <Text style={[styles.infoValue, { color: colors.primary }]}>WebRTC + Socket.IO</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#050915",
    paddingHorizontal: 20,
  },
  heading: {
    fontSize: 28,
    fontWeight: "900" as const,
    marginBottom: 24,
    marginTop: 8,
    fontFamily: "Inter_700Bold",
    letterSpacing: 1,
  },
  section: {
    marginBottom: 20,
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: "700" as const,
    letterSpacing: 2,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    fontFamily: "Inter_700Bold",
  },
  avatarGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    padding: 16,
    paddingTop: 0,
  },
  avatarOption: {
    width: 52,
    height: 52,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarEmoji: {
    fontSize: 26,
  },
  editRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 0,
  },
  nameInput: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1,
  },
  saveButton: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelButton: {
    width: 44,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0a1030",
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: 16,
    marginBottom: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  nameText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  emptyText: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  recentItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  recentCode: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 2,
  },
  clearText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  infoItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: 1,
  },
  infoLabel: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  infoValue: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
});
