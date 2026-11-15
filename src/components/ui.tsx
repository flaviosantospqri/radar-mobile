import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { theme } from "../constants/theme";

export function Screen({ children, scroll = true, contentStyle }: { children: ReactNode; scroll?: boolean; contentStyle?: ViewStyle }) {
  return <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
    {scroll ? <ScrollView contentContainerStyle={[styles.content, contentStyle]} keyboardShouldPersistTaps="handled">{children}</ScrollView> : <View style={[styles.content, { flex: 1 }, contentStyle]}>{children}</View>}
  </SafeAreaView>;
}

export function PageTitle({ eyebrow, title, subtitle, right }: { eyebrow?: string; title: string; subtitle?: string; right?: ReactNode }) {
  return <View style={styles.titleRow}><View style={{ flex: 1 }}>
    {eyebrow ? <Text style={styles.eyebrow}>{eyebrow.toUpperCase()}</Text> : null}
    <Text style={styles.title}>{title}</Text>{subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
  </View>{right}</View>;
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) { return <View style={[styles.card, style]}>{children}</View>; }

export function Button({ title, onPress, variant = "primary", loading, disabled, style }: {
  title: string; onPress: () => void; variant?: "primary" | "secondary" | "quiet" | "danger"; loading?: boolean; disabled?: boolean; style?: ViewStyle;
}) {
  return <Pressable onPress={onPress} disabled={disabled || loading} style={({ pressed }) => [styles.button, styles[`button_${variant}`], (disabled || loading) && styles.buttonDisabled, pressed && !disabled && { opacity: 0.78 }, style]}>
    {loading ? <ActivityIndicator color={variant === "primary" ? theme.colors.black : theme.colors.green} /> : <Text style={[styles.buttonText, variant === "primary" && { color: theme.colors.black }]}>{title}</Text>}
  </Pressable>;
}

export function Field({ label, error, ...props }: TextInputProps & { label: string; error?: string }) {
  return <View style={{ gap: 7 }}><Text style={styles.fieldLabel}>{label}</Text>
    <TextInput {...props} placeholderTextColor={theme.colors.faint} style={[styles.input, props.multiline && { minHeight: 86, textAlignVertical: "top" }, error && { borderColor: theme.colors.red }]} />
    {error ? <Text style={styles.errorText}>{error}</Text> : null}
  </View>;
}

export function Pill({ label, tone = "green" }: { label: string; tone?: "green" | "amber" | "red" | "blue" | "muted" }) {
  const color = { green: theme.colors.green, amber: theme.colors.amber, red: theme.colors.red, blue: theme.colors.blue, muted: theme.colors.muted }[tone];
  return <View style={[styles.pill, { borderColor: `${color}55`, backgroundColor: `${color}18` }]}><Text style={[styles.pillText, { color }]}>{label}</Text></View>;
}

export function Divider() { return <View style={styles.divider} />; }

export function LoadingState({ label = "Carregando…" }: { label?: string }) {
  return <View style={styles.loading}><ActivityIndicator color={theme.colors.green} /><Text style={styles.subtitle}>{label}</Text></View>;
}

export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 34, gap: 18 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 4 },
  eyebrow: { color: theme.colors.green, fontSize: 11, letterSpacing: 2, fontWeight: "800", marginBottom: 7 },
  title: { color: theme.colors.text, fontSize: 28, lineHeight: 33, fontWeight: "800", letterSpacing: -0.6 },
  subtitle: { color: theme.colors.muted, fontSize: 14, lineHeight: 21, marginTop: 6 },
  card: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: 1, borderRadius: theme.radius.md, padding: 16, gap: 12 },
  button: { minHeight: 50, paddingHorizontal: 18, borderRadius: 14, alignItems: "center", justifyContent: "center", flexDirection: "row" },
  button_primary: { backgroundColor: theme.colors.green }, button_secondary: { backgroundColor: theme.colors.elevated, borderWidth: 1, borderColor: theme.colors.border },
  button_quiet: { backgroundColor: "transparent", borderWidth: 1, borderColor: theme.colors.border }, button_danger: { backgroundColor: "#3A211F", borderWidth: 1, borderColor: "#6C3530" },
  buttonDisabled: { opacity: 0.45 }, buttonText: { color: theme.colors.text, fontSize: 15, fontWeight: "800" },
  fieldLabel: { color: theme.colors.muted, fontSize: 12, fontWeight: "700" },
  input: { backgroundColor: theme.colors.background, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 12, color: theme.colors.text, minHeight: 50, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  errorText: { color: theme.colors.red, fontSize: 12 },
  pill: { alignSelf: "flex-start", borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 99 },
  pillText: { fontSize: 10, fontWeight: "900", letterSpacing: 0.6 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border, marginVertical: 3 },
  loading: { flex: 1, minHeight: 140, justifyContent: "center", alignItems: "center", gap: 12 },
});

