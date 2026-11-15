import { zodResolver } from "@hookform/resolvers/zod";
import { Link, Redirect } from "expo-router";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Alert, KeyboardAvoidingView, Platform, Pressable, Text, View } from "react-native";
import { z } from "zod";
import { Button, Card, Field, PageTitle, Screen, styles } from "../components/ui";
import { theme } from "../constants/theme";
import { useAuth } from "../features/auth/AuthProvider";

const schema = z.object({ email: z.string().email("Digite um e-mail válido."), password: z.string().min(8, "Use ao menos 8 caracteres.") });
type Form = z.infer<typeof schema>;

export default function LoginScreen() {
  const { user, ready, login } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const { control, handleSubmit, formState: { errors } } = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { email: "", password: "" } });
  if (ready && user) return <Redirect href="/(tabs)" />;
  const submit = handleSubmit(async (data) => {
    setSubmitting(true);
    try { await login(data.email.trim(), data.password); }
    catch (error: any) { Alert.alert("Não foi possível entrar", error?.message ?? "Tente novamente."); }
    finally { setSubmitting(false); }
  });
  return <Screen contentStyle={{ flexGrow: 1, justifyContent: "center" }}>
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ gap: 22 }}>
      <View style={{ alignItems: "center", gap: 10, marginBottom: 8 }}>
        <View style={{ width: 78, height: 78, borderRadius: 24, borderWidth: 1, borderColor: `${theme.colors.green}70`, alignItems: "center", justifyContent: "center", backgroundColor: "#102018" }}>
          <Text style={{ color: theme.colors.green, fontSize: 38, fontWeight: "300" }}>⌖</Text>
        </View>
        <Text style={{ color: theme.colors.text, fontSize: 28, fontWeight: "900", letterSpacing: 6 }}>RADAR</Text>
        <Text style={{ color: theme.colors.muted, fontSize: 13 }}>Encontre valor onde ninguém está olhando.</Text>
      </View>
      <Card>
        <PageTitle title="Acesse sua conta" subtitle="Suas análises e oportunidades ficam sincronizadas com segurança." />
        <Controller control={control} name="email" render={({ field: { onChange, onBlur, value } }) => <Field label="E-MAIL" autoCapitalize="none" keyboardType="email-address" value={value} onBlur={onBlur} onChangeText={onChange} error={errors.email?.message} />} />
        <Controller control={control} name="password" render={({ field: { onChange, onBlur, value } }) => <Field label="SENHA" secureTextEntry value={value} onBlur={onBlur} onChangeText={onChange} error={errors.password?.message} />} />
        <Button title="Entrar" onPress={() => void submit()} loading={submitting} />
      </Card>
      <View style={{ flexDirection: "row", justifyContent: "center", gap: 5 }}>
        <Text style={styles.subtitle}>Ainda não tem conta?</Text>
        <Link href="/register" asChild><Pressable><Text style={{ color: theme.colors.green, fontSize: 14, fontWeight: "800", marginTop: 6 }}>Criar conta</Text></Pressable></Link>
      </View>
    </KeyboardAvoidingView>
  </Screen>;
}

