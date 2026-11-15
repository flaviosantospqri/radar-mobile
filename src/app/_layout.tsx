import "react-native-reanimated";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AuthProvider } from "../features/auth/AuthProvider";
import { theme } from "../constants/theme";

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 }, mutations: { retry: 0 } } });

export default function RootLayout() {
  return <QueryClientProvider client={queryClient}><AuthProvider>
    <StatusBar style="light" />
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.background }, animation: "fade_from_bottom" }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="analysis/[id]" options={{ presentation: "card" }} />
    </Stack>
  </AuthProvider></QueryClientProvider>;
}

