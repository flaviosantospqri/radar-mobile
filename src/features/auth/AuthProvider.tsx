import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest, clearToken, login as loginRequest, logoutRequest, readToken, register as registerRequest, type User } from "../../services/api/client";
import { cleanupLegacyImageQueue } from "../images/temp-files";

const USER_CACHE_KEY = "radar.cachedUser";
type AuthContextValue = {
  user: User | null; ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    let active = true;
    void cleanupLegacyImageQueue();
    const restore = async () => {
      const token = await readToken();
      if (!token) { if (active) setReady(true); return; }
      try {
        const response = await apiRequest<{ data: User }>("/auth/me");
        await AsyncStorage.setItem(USER_CACHE_KEY, JSON.stringify(response.data));
        if (active) setUser(response.data);
      } catch (error: any) {
        if (error?.status === 401) {
          await clearToken();
          await AsyncStorage.removeItem(USER_CACHE_KEY);
        } else {
          const cached = await AsyncStorage.getItem(USER_CACHE_KEY);
          if (cached && active) setUser(JSON.parse(cached) as User);
        }
      } finally { if (active) setReady(true); }
    };
    void restore();
    return () => { active = false; };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user, ready,
    async login(email, password) {
      const next = await loginRequest(email, password);
      setUser(next);
      await AsyncStorage.setItem(USER_CACHE_KEY, JSON.stringify(next));
    },
    async register(name, email, password) {
      const next = await registerRequest(name, email, password);
      setUser(next);
      await AsyncStorage.setItem(USER_CACHE_KEY, JSON.stringify(next));
    },
    async logout() {
      try { await logoutRequest(); } finally {
        setUser(null);
        await AsyncStorage.removeItem(USER_CACHE_KEY);
        queryClient.clear();
      }
    },
  }), [user, ready, queryClient]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth deve ser usado dentro de AuthProvider.");
  return context;
}

