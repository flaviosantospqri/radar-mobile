import { Redirect, Tabs } from "expo-router";
import { Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../../features/auth/AuthProvider";
import { theme } from "../../constants/theme";

const tabGlyphs: Record<string, string> = { index: "⌖", history: "◷", opportunities: "◇", settings: "⚙" };

export default function TabLayout() {
  const { user, ready } = useAuth();
  const insets = useSafeAreaInsets();
  if (ready && !user) return <Redirect href="/login" />;
  return <Tabs screenOptions={({ route }) => ({
    headerShown: false,
    tabBarStyle: { backgroundColor: theme.colors.background, borderTopColor: theme.colors.border, height: 66 + insets.bottom, paddingTop: 7, paddingBottom: Math.max(8, insets.bottom) },
    tabBarActiveTintColor: theme.colors.green,
    tabBarInactiveTintColor: theme.colors.faint,
    tabBarLabelStyle: { fontSize: 10, fontWeight: "700" },
    tabBarIcon: ({ color }) => <Text style={{ fontSize: 21, color }}>{tabGlyphs[route.name] ?? "•"}</Text>,
  })}>
    <Tabs.Screen name="index" options={{ title: "Scanner" }} />
    <Tabs.Screen name="history" options={{ title: "Histórico" }} />
    <Tabs.Screen name="opportunities" options={{ title: "Oportunidades" }} />
    <Tabs.Screen name="settings" options={{ title: "Ajustes" }} />
  </Tabs>;
}

