import { zodResolver } from "@hookform/resolvers/zod";
import { Link, Redirect, router } from "expo-router";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Alert, KeyboardAvoidingView, Platform, Pressable, Text, View } from "react-native";
import { z } from "zod";
import { Button, Card, Field, PageTitle, Screen, styles } from "../components/ui";
import { theme } from "../constants/theme";
import { useAuth } from "../features/auth/AuthProvider";

const schema = z.object({ name: z.string().trim().min(1, "Informe seu nome."), email: z.string().email("Digite um e-mail válido."), password: z.string().min(8, "Use ao menos 8 caracteres.") });
type Form = z.infer<typeof schema>;

export default function RegisterScreen() {
  const { user, ready, register } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const { control, handleSubmit, formState: { errors } } = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { name: "", email: "", password: "" } });
  if (ready && user) return <Redirect href="/(tabs)" />;
  const submit = handleSubmit(async (data) => {
    setSubmitting(true);
    try { await register(data.name.trim(), data.email.trim(), data.password); router.replace("/(tabs)"); }
    catch (error: any) { Alert.alert("Não foi possível criar a conta", error?.message ?? "Tente novamente."); }
    finally { setSubmitting(false); }
  });
  return <Screen contentStyle={{ flexGrow: 1, justifyContent: "center" }}>
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ gap: 20 }}>
      <PageTitle eyebrow="RADAR" title="Comece a investigar" subtitle="Crie sua conta para guardar análises e acompanhar resultados." />
      <Card>
        <Controller control={control} name="name" render={({ field: { onChange, onBlur, value } }) => <Field label="NOME" value={value} onBlur={onBlur} onChangeText={onChange} error={errors.name?.message} />} />
        <Controller control={control} name="email" render={({ field: { onChange, onBlur, value } }) => <Field label="E-MAIL" autoCapitalize="none" keyboardType="email-address" value={value} onBlur={onBlur} onChangeText={onChange} error={errors.email?.message} />} />
        <Controller control={control} name="password" render={({ field: { onChange, onBlur, value } }) => <Field label="SENHA" secureTextEntry value={value} onBlur={onBlur} onChangeText={onChange} error={errors.password?.message} />} />
        <Button title="Criar conta" onPress={() => void submit()} loading={submitting} />
      </Card>
      <View style={{ flexDirection: "row", justifyContent: "center", gap: 5 }}>
        <Text style={styles.subtitle}>Já tem conta?</Text>
        <Link href="/login" asChild><Pressable><Text style={{ color: theme.colors.green, fontSize: 14, fontWeight: "800", marginTop: 6 }}>Entrar</Text></Pressable></Link>
      </View>
    </KeyboardAvoidingView>
  </Screen>;
}

