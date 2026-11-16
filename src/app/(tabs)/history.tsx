import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import { Button, Card, Divider, PageTitle, Pill, Screen } from "../../components/ui";
import { money, theme } from "../../constants/theme";
import { deleteAnalysis, fetchHistory } from "../../services/api/client";

function statusLabel(status?: string) {
  const values: Record<string, string> = { awaiting_confirmation: "PRONTO PARA PESQUISA", identifying: "IDENTIFICANDO", researching: "PESQUISANDO", completed: "CONCLUÍDA", partial: "PARCIAL", failed: "FALHOU", pending: "PENDENTE" };
  return values[status ?? ""] ?? status?.toUpperCase() ?? "ANÁLISE";
}

export default function HistoryScreen() {
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();
  const history = useQuery({ queryKey: ["history", page], queryFn: () => fetchHistory(page) });
  const rows = history.data?.data ?? [];
  const remove = (id: string) => Alert.alert("Excluir análise?", "Os dados e referências desta análise serão removidos.", [
    { text: "Cancelar", style: "cancel" },
    { text: "Excluir", style: "destructive", onPress: async () => {
      try { await deleteAnalysis(id); await queryClient.invalidateQueries({ queryKey: ["history"] }); }
      catch (error: any) { Alert.alert("Não foi possível excluir", error?.message ?? "Tente novamente."); }
    } },
  ]);

  return <Screen contentStyle={{ gap: 16 }}>
    <PageTitle eyebrow="SUAS INVESTIGAÇÕES" title="Histórico" subtitle={history.data ? `${history.data.pagination.total} análises salvas` : "Acompanhe cada produto que você investigou."} />
    {history.isLoading ? <View style={{ padding: 42 }}><ActivityIndicator color={theme.colors.green} /></View> : null}
    {history.isError ? <Card><Text style={{ color: theme.colors.text, fontWeight: "800" }}>Não foi possível carregar o histórico</Text><Text style={{ color: theme.colors.muted }}>{(history.error as Error).message}</Text><Button title="Tentar novamente" variant="secondary" onPress={() => void history.refetch()} /></Card> : null}
    {!history.isLoading && rows.length === 0 && !history.isError ? <Card>
      <Text style={{ color: theme.colors.green, fontSize: 32 }}>⌖</Text>
      <Text style={{ color: theme.colors.text, fontSize: 17, fontWeight: "800" }}>Seu histórico começa aqui</Text>
      <Text style={{ color: theme.colors.muted, lineHeight: 21 }}>Fotografe um produto para criar sua primeira análise. As fotos não ficam no histórico; os dados e as referências de mercado, sim.</Text>
      <Button title="Abrir scanner" onPress={() => router.navigate("/(tabs)")} />
    </Card> : null}
    {rows.map((row: any) => {
      const analysis = row.analysis;
      const product = row.product;
      const financial = row.profitability;
      const rec = analysis.askingPriceCents === null ? null : analysis.recommendation;
      const tone = rec === "COMPRAR" ? "green" : rec === "EVITAR" ? "red" : rec === "NEGOCIAR" ? "amber" : "muted";
      return <Pressable key={analysis.id} onPress={() => router.push({ pathname: "/analysis/[id]", params: { id: analysis.id } })}>
        <Card>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: "800" }} numberOfLines={2}>{product?.name ?? "Produto não identificado"}</Text>
              <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 5 }}>{[product?.brand, product?.model].filter(Boolean).join(" · ") || new Date(analysis.createdAt).toLocaleDateString("pt-BR")}</Text>
            </View>
            <Pill label={rec ?? statusLabel(analysis.status)} tone={tone} />
          </View>
          <Divider />
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Metric label="PEDIDO" value={money(analysis.askingPriceCents)} />
            <Metric label="LUCRO EST." value={money(financial?.estimatedProfitCents)} accent />
            <Metric label="ROI" value={financial?.roiBps === null || financial?.roiBps === undefined ? "—" : `${(financial.roiBps / 100).toFixed(1)}%`} />
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ color: theme.colors.faint, fontSize: 11 }}>{new Date(analysis.createdAt).toLocaleString("pt-BR")}</Text>
            <Pressable onPress={(event) => { event.stopPropagation(); remove(analysis.id); }}><Text style={{ color: theme.colors.red, fontSize: 12, fontWeight: "700" }}>Excluir</Text></Pressable>
          </View>
        </Card>
      </Pressable>;
    })}
    {history.data && history.data.pagination.pages > 1 ? <View style={{ flexDirection: "row", gap: 10 }}>
      <Button title="Anterior" disabled={page <= 1} variant="quiet" onPress={() => setPage((current) => Math.max(1, current - 1))} style={{ flex: 1 }} />
      <Text style={{ color: theme.colors.muted, alignSelf: "center" }}>{page} / {history.data.pagination.pages}</Text>
      <Button title="Próxima" disabled={page >= history.data.pagination.pages} variant="quiet" onPress={() => setPage((current) => current + 1)} style={{ flex: 1 }} />
    </View> : null}
    <View><Button title="Atualizar" variant="quiet" onPress={() => void history.refetch()} /></View>
  </Screen>;
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return <View style={{ gap: 5 }}><Text style={{ color: theme.colors.faint, fontSize: 9, fontWeight: "800", letterSpacing: 0.8 }}>{label}</Text><Text style={{ color: accent ? theme.colors.green : theme.colors.text, fontSize: 13, fontWeight: "800" }}>{value}</Text></View>;
}

