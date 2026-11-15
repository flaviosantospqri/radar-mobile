import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Network from "expo-network";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Alert } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest, clearToken, login as loginRequest, logoutRequest, readToken, register as registerRequest, type User } from "../../services/api/client";
import { cleanupExpiredRetryImages, syncPendingAnalyses } from "../offline/pending-queue";

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
    void cleanupExpiredRetryImages();
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

  useEffect(() => {
    if (!user) return;
    const synchronize = async () => {
      const result = await syncPendingAnalyses();
      if (result.synced > 0) {
        queryClient.invalidateQueries({ queryKey: ["history"] });
        Alert.alert("Sincronização concluída", `${result.synced} análise(s) enviada(s). Consulte o histórico para continuar.`);
      }
      if (result.expired > 0) Alert.alert("Fila expirada", `${result.expired} imagem(ns) local(is) com mais de 30 dias foram removidas.`);
    };
    void synchronize();
    const subscription = Network.addNetworkStateListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) void synchronize();
    });
    return () => subscription.remove();
  }, [user, queryClient]);

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

