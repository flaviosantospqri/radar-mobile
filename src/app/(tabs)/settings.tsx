import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";
import { Button, Card, Field, PageTitle, Pill, Screen } from "../../components/ui";
import { parseMoneyToCents, theme } from "../../constants/theme";
import { useAuth } from "../../features/auth/AuthProvider";
import { fetchSettings, saveSettings } from "../../services/api/client";

export default function SettingsScreen() {
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const [minimumProfit, setMinimumProfit] = useState("0");
  const [minimumRoi, setMinimumRoi] = useState("20");
  const [sellingFee, setSellingFee] = useState("0");
  const [transport, setTransport] = useState("0");
  const [extraName, setExtraName] = useState("");
  const [extraAmount, setExtraAmount] = useState("0");
  const [scenario, setScenario] = useState<"conservador" | "provavel" | "otimista">("provavel");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const data = settingsQuery.data?.data;
    if (!data) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Hydrate the form after settings load.
    setMinimumProfit((data.minimumProfitCents / 100).toFixed(2).replace(".", ","));
    setMinimumRoi((data.minimumRoiBps / 100).toString());
    setSellingFee((data.defaultSellingFeeBps / 100).toString());
    setTransport((data.defaultTransportCostCents / 100).toFixed(2).replace(".", ","));
    setScenario(data.preferredScenario);
    setExtraName(data.additionalCosts[0]?.name ?? "");
    setExtraAmount(((data.additionalCosts[0]?.amountCents ?? 0) / 100).toFixed(2).replace(".", ","));
  }, [settingsQuery.data]);

  const save = async () => {
    setSaving(true);
    try {
      await saveSettings({
        minimumProfitCents: parseMoneyToCents(minimumProfit),
        minimumRoiBps: Math.round(Number(minimumRoi.replace(",", ".")) * 100),
        defaultSellingFeeBps: Math.round(Number(sellingFee.replace(",", ".")) * 100),
        defaultTransportCostCents: parseMoneyToCents(transport),
        additionalCosts: extraName.trim() ? [{ name: extraName.trim(), amountCents: parseMoneyToCents(extraAmount) }] : [],
        preferredScenario: scenario,
      });
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      Alert.alert("Configurações salvas", "Os próximos cálculos usarão estes parâmetros.");
    } catch (error: any) { Alert.alert("Não foi possível salvar", error?.message ?? "Confira os valores."); }
    finally { setSaving(false); }
  };

  return <Screen contentStyle={{ gap: 16 }}>
    <PageTitle eyebrow="PERSONALIZE SUA RÉGUA" title="Configurações" subtitle="Defina os critérios que o RADAR usará para avaliar cada oportunidade." />
    {settingsQuery.isLoading ? <Text style={{ color: theme.colors.muted }}>Carregando configurações…</Text> : null}
    {settingsQuery.isError ? <Card><Text style={{ color: theme.colors.text, fontWeight: "800" }}>Configurações indisponíveis</Text><Text style={{ color: theme.colors.muted }}>{(settingsQuery.error as Error).message}</Text></Card> : null}
    <Card>
      <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: "800" }}>Parâmetros financeiros</Text>
      <Field label="LUCRO MÍNIMO DESEJADO (R$)" keyboardType="decimal-pad" value={minimumProfit} onChangeText={setMinimumProfit} />
      <Field label="ROI MÍNIMO (%)" keyboardType="decimal-pad" value={minimumRoi} onChangeText={setMinimumRoi} />
      <Field label="TAXA PADRÃO DE VENDA (%)" keyboardType="decimal-pad" value={sellingFee} onChangeText={setSellingFee} />
      <Field label="TRANSPORTE PADRÃO (R$)" keyboardType="decimal-pad" value={transport} onChangeText={setTransport} />
      <View style={{ flexDirection: "row", gap: 10 }}><View style={{ flex: 1 }}><Field label="CUSTO EXTRA PADRÃO" value={extraName} onChangeText={setExtraName} placeholder="Ex.: limpeza" /></View><View style={{ flex: 1 }}><Field label="VALOR (R$)" keyboardType="decimal-pad" value={extraAmount} onChangeText={setExtraAmount} /></View></View>
    </Card>
    <Card>
      <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: "800" }}>Cenário preferido</Text>
      <Text style={{ color: theme.colors.muted, fontSize: 13, lineHeight: 20 }}>Os cenários usam percentis dos anúncios ativos compatíveis. Não são valores garantidos de venda.</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>{(["conservador", "provavel", "otimista"] as const).map((value) => <View key={value} style={{ flex: 1 }}><Button title={value[0].toUpperCase() + value.slice(1)} variant={scenario === value ? "primary" : "quiet"} onPress={() => setScenario(value)} /></View>)}</View>
    </Card>
    <Button title="Salvar configurações" onPress={() => void save()} loading={saving} />
    <Card style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
      <View><Text style={{ color: theme.colors.text, fontWeight: "800" }}>{user?.name ?? "Conta RADAR"}</Text><Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>{user?.email}</Text></View>
      <Pill label="CONTA PESSOAL" tone="blue" />
    </Card>
    <Button title="Sair da conta" variant="danger" onPress={() => Alert.alert("Sair da conta?", "Você poderá entrar novamente com seu e-mail e senha.", [{ text: "Cancelar", style: "cancel" }, { text: "Sair", style: "destructive", onPress: () => void logout() }])} />
    <Text style={{ color: theme.colors.faint, fontSize: 11, textAlign: "center" }}>Radar • Brasil • valores em BRL • imagens não são salvas no histórico</Text>
  </Screen>;
}

