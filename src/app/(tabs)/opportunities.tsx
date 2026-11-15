import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, Text, View } from "react-native";
import { Button, Card, Field, PageTitle, Pill, Screen } from "../../components/ui";
import { money, parseMoneyToCents, theme } from "../../constants/theme";
import { fetchOpportunities, purchaseOpportunity, sellOpportunity, updateOpportunityStatus } from "../../services/api/client";

type ModalState = { id: string; kind: "purchase" | "sale"; } | null;
type PurchaseForm = { price: string; transport: string; maintenance: string; preparation: string; additional: string };
type SaleForm = { price: string; fees: string; additional: string };

export default function OpportunitiesScreen() {
  const queryClient = useQueryClient();
  const opportunities = useQuery({ queryKey: ["opportunities"], queryFn: fetchOpportunities });
  const [modal, setModal] = useState<ModalState>(null);
  const [purchaseForm, setPurchaseForm] = useState<PurchaseForm>({ price: "", transport: "", maintenance: "", preparation: "", additional: "" });
  const [saleForm, setSaleForm] = useState<SaleForm>({ price: "", fees: "", additional: "" });
  const invalidate = async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["opportunities"] }), queryClient.invalidateQueries({ queryKey: ["history"] })]); };
  const statusMutation = useMutation({ mutationFn: ({ id, status }: { id: string; status: string }) => updateOpportunityStatus(id, status), onSuccess: invalidate });
  const purchaseMutation = useMutation({ mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => purchaseOpportunity(id, body), onSuccess: async () => { setModal(null); await invalidate(); } });
  const saleMutation = useMutation({ mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => sellOpportunity(id, body), onSuccess: async (result: any) => {
    setModal(null); await invalidate();
    const realized = result?.data?.realizedProfitCents;
    Alert.alert("Venda registrada", `Lucro realizado: ${money(realized)}`);
  } });
  const submitPurchase = () => {
    try {
      if (!modal) return;
      purchaseMutation.mutate({ id: modal.id, body: {
        actualPurchasePriceCents: parseMoneyToCents(purchaseForm.price), actualTransportCostCents: parseMoneyToCents(purchaseForm.transport),
        actualMaintenanceCostCents: parseMoneyToCents(purchaseForm.maintenance), actualPreparationCostCents: parseMoneyToCents(purchaseForm.preparation),
        actualAdditionalCostsCents: parseMoneyToCents(purchaseForm.additional),
      } });
    } catch (error: any) { Alert.alert("Confira os valores", error.message); }
  };
  const submitSale = () => {
    try {
      if (!modal) return;
      saleMutation.mutate({ id: modal.id, body: {
        actualSalePriceCents: parseMoneyToCents(saleForm.price), actualSellingFeesCents: parseMoneyToCents(saleForm.fees),
        actualAdditionalCostsCents: parseMoneyToCents(saleForm.additional),
      } });
    } catch (error: any) { Alert.alert("Confira os valores", error.message); }
  };

  return <Screen contentStyle={{ gap: 16 }}>
    <PageTitle eyebrow="DECISÕES REGISTRADAS" title="Oportunidades" subtitle="Acompanhe compras, vendas e a diferença entre o previsto e o realizado." />
    {opportunities.isLoading ? <ActivityIndicator color={theme.colors.green} /> : null}
    {opportunities.isError ? <Card><Text style={{ color: theme.colors.text, fontWeight: "800" }}>Não foi possível carregar</Text><Text style={{ color: theme.colors.muted }}>{(opportunities.error as Error).message}</Text><Button title="Tentar novamente" onPress={() => void opportunities.refetch()} /></Card> : null}
    {opportunities.data?.data.length === 0 ? <Card>
      <Text style={{ color: theme.colors.green, fontSize: 30 }}>◇</Text>
      <Text style={{ color: theme.colors.text, fontSize: 17, fontWeight: "800" }}>Ainda sem oportunidades salvas</Text>
      <Text style={{ color: theme.colors.muted, lineHeight: 21 }}>Abra uma análise e salve produtos que você quer acompanhar.</Text>
      <Button title="Ver histórico" variant="secondary" onPress={() => router.navigate("/(tabs)/history")} />
    </Card> : null}
    {(opportunities.data?.data ?? []).map((row: any) => {
      const opportunity = row.opportunity;
      const product = row.product;
      const finance = row.profitability;
      const status = opportunity.status as string;
      return <Card key={opportunity.id}>
        <Pressable onPress={() => router.push({ pathname: "/analysis/[id]", params: { id: row.analysis.id } })}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
            <View style={{ flex: 1 }}><Text style={{ color: theme.colors.text, fontWeight: "800", fontSize: 16 }}>{product?.name ?? "Produto"}</Text><Text style={{ color: theme.colors.muted, marginTop: 4, fontSize: 12 }}>{[product?.brand, product?.model].filter(Boolean).join(" · ")}</Text></View>
            <Pill label={status} tone={status === "VENDIDO" ? "blue" : status === "COMPRADO" ? "amber" : status === "FAVORITO" ? "green" : "muted"} />
          </View>
        </Pressable>
        <View style={{ flexDirection: "row", gap: 16, flexWrap: "wrap" }}>
          <Metric label="PEDIDO" value={money(finance?.purchasePriceCents)} />
          <Metric label="LUCRO PREVISTO" value={money(finance?.estimatedProfitCents)} accent />
          {opportunity.realizedProfitCents !== null ? <Metric label="LUCRO REALIZADO" value={money(opportunity.realizedProfitCents)} accent /> : null}
        </View>
        {status === "ANALISADO" ? <View style={{ flexDirection: "row", gap: 8 }}>
          <Button title="Favoritar" variant="secondary" onPress={() => statusMutation.mutate({ id: opportunity.id, status: "FAVORITO" })} style={{ flex: 1 }} />
          <Button title="Descartar" variant="quiet" onPress={() => statusMutation.mutate({ id: opportunity.id, status: "DESCARTADO" })} style={{ flex: 1 }} />
        </View> : null}
        {["ANALISADO", "FAVORITO"].includes(status) ? <Button title="Registrar compra" onPress={() => { setPurchaseForm({ price: "", transport: "", maintenance: "", preparation: "", additional: "" }); setModal({ id: opportunity.id, kind: "purchase" }); }} /> : null}
        {status === "COMPRADO" ? <Button title="Registrar venda" onPress={() => { setSaleForm({ price: "", fees: "", additional: "" }); setModal({ id: opportunity.id, kind: "sale" }); }} /> : null}
        {status === "VENDIDO" ? <Text style={{ color: theme.colors.muted, fontSize: 12 }}>Compra: {opportunity.purchasedAt ? new Date(opportunity.purchasedAt).toLocaleDateString("pt-BR") : "—"} · Venda: {opportunity.soldAt ? new Date(opportunity.soldAt).toLocaleDateString("pt-BR") : "—"}</Text> : null}
      </Card>;
    })}
    <Modal visible={Boolean(modal)} transparent animationType="slide" onRequestClose={() => setModal(null)}>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "#000A" }}>
        <View style={{ padding: 20, paddingBottom: 30, backgroundColor: theme.colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, gap: 14 }}>
          <PageTitle title={modal?.kind === "purchase" ? "Registrar compra" : "Registrar venda"} subtitle={modal?.kind === "purchase" ? "Inclua os custos reais pagos." : "Registre o valor recebido e as taxas."} />
          {modal?.kind === "purchase" ? <>
            <Field label="PREÇO DE COMPRA (R$)" keyboardType="decimal-pad" value={purchaseForm.price} onChangeText={(price) => setPurchaseForm((v) => ({ ...v, price }))} />
            <View style={{ flexDirection: "row", gap: 10 }}><View style={{ flex: 1 }}><Field label="TRANSPORTE" keyboardType="decimal-pad" value={purchaseForm.transport} onChangeText={(transport) => setPurchaseForm((v) => ({ ...v, transport }))} /></View><View style={{ flex: 1 }}><Field label="MANUTENÇÃO" keyboardType="decimal-pad" value={purchaseForm.maintenance} onChangeText={(maintenance) => setPurchaseForm((v) => ({ ...v, maintenance }))} /></View></View>
            <View style={{ flexDirection: "row", gap: 10 }}><View style={{ flex: 1 }}><Field label="PREPARAÇÃO" keyboardType="decimal-pad" value={purchaseForm.preparation} onChangeText={(preparation) => setPurchaseForm((v) => ({ ...v, preparation }))} /></View><View style={{ flex: 1 }}><Field label="OUTROS CUSTOS" keyboardType="decimal-pad" value={purchaseForm.additional} onChangeText={(additional) => setPurchaseForm((v) => ({ ...v, additional }))} /></View></View>
            <Button title="Salvar compra" onPress={submitPurchase} loading={purchaseMutation.isPending} />
          </> : <>
            <Field label="PREÇO REAL DE VENDA (R$)" keyboardType="decimal-pad" value={saleForm.price} onChangeText={(price) => setSaleForm((v) => ({ ...v, price }))} />
            <View style={{ flexDirection: "row", gap: 10 }}><View style={{ flex: 1 }}><Field label="TAXAS DE VENDA" keyboardType="decimal-pad" value={saleForm.fees} onChangeText={(fees) => setSaleForm((v) => ({ ...v, fees }))} /></View><View style={{ flex: 1 }}><Field label="OUTROS CUSTOS" keyboardType="decimal-pad" value={saleForm.additional} onChangeText={(additional) => setSaleForm((v) => ({ ...v, additional }))} /></View></View>
            <Button title="Salvar venda" onPress={submitSale} loading={saleMutation.isPending} />
          </>}
          <Button title="Cancelar" variant="quiet" onPress={() => setModal(null)} />
        </View>
      </View>
    </Modal>
  </Screen>;
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return <View style={{ gap: 4 }}><Text style={{ color: theme.colors.faint, fontSize: 9, fontWeight: "800" }}>{label}</Text><Text style={{ color: accent ? theme.colors.green : theme.colors.text, fontSize: 13, fontWeight: "800" }}>{value}</Text></View>;
}

