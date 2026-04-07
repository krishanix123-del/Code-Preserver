import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

export interface RecentRoom {
  code: string;
  lastUsed: number;
}

interface StreamContextValue {
  username: string;
  setUsername: (name: string) => void;
  avatar: string;
  setAvatar: (av: string) => void;
  recentRooms: RecentRoom[];
  addRecentRoom: (code: string) => void;
  clearRecentRooms: () => void;
}

const StreamContext = createContext<StreamContextValue | null>(null);

const AVATARS = ["🎮", "👑", "⚡", "🔥", "💎", "🚀", "🎯", "👾"];

export function StreamProvider({ children }: { children: React.ReactNode }) {
  const [username, setUsernameState] = useState(
    "USER_" + Math.random().toString(36).substr(2, 4).toUpperCase()
  );
  const [avatar, setAvatarState] = useState(AVATARS[0]);
  const [recentRooms, setRecentRooms] = useState<RecentRoom[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem("@nexuscast_profile");
        if (stored) {
          const { username: u, avatar: a, recentRooms: r } = JSON.parse(stored);
          if (u) setUsernameState(u);
          if (a) setAvatarState(a);
          if (r) setRecentRooms(r);
        }
      } catch {}
    })();
  }, []);

  const persist = useCallback(
    async (u: string, a: string, r: RecentRoom[]) => {
      try {
        await AsyncStorage.setItem(
          "@nexuscast_profile",
          JSON.stringify({ username: u, avatar: a, recentRooms: r })
        );
      } catch {}
    },
    []
  );

  const setUsername = useCallback(
    (name: string) => {
      setUsernameState(name);
      persist(name, avatar, recentRooms);
    },
    [avatar, recentRooms, persist]
  );

  const setAvatar = useCallback(
    (av: string) => {
      setAvatarState(av);
      persist(username, av, recentRooms);
    },
    [username, recentRooms, persist]
  );

  const addRecentRoom = useCallback(
    (code: string) => {
      setRecentRooms((prev) => {
        const filtered = prev.filter((r) => r.code !== code);
        const updated = [{ code, lastUsed: Date.now() }, ...filtered].slice(0, 5);
        persist(username, avatar, updated);
        return updated;
      });
    },
    [username, avatar, persist]
  );

  const clearRecentRooms = useCallback(() => {
    setRecentRooms([]);
    persist(username, avatar, []);
  }, [username, avatar, persist]);

  return (
    <StreamContext.Provider
      value={{
        username,
        setUsername,
        avatar,
        setAvatar,
        recentRooms,
        addRecentRoom,
        clearRecentRooms,
      }}
    >
      {children}
    </StreamContext.Provider>
  );
}

export function useStream() {
  const ctx = useContext(StreamContext);
  if (!ctx) throw new Error("useStream must be inside StreamProvider");
  return ctx;
}

export const AVATARS_LIST = AVATARS;
