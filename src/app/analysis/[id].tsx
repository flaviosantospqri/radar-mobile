import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Image, Linking, Pressable, Text, View } from "react-native";
import { Button, Card, Divider, Field, PageTitle, Pill, Screen } from "../../components/ui";
import { money, parseMoneyToCents, percent, theme } from "../../constants/theme";
import type { AnalysisResult } from "../../types/api";
import { createOpportunity, confirmIdentification, fetchAnalysis, recalculateAnalysis, researchAnalysis, retryIdentification } from "../../services/api/client";
import { discardLocalImage } from "../../features/offline/pending-queue";

const scenarios = ["conservador", "provavel", "otimista"] as const;
type Scenario = typeof scenarios[number];

export default function AnalysisDetailScreen() {
  const params = useLocalSearchParams<{ id: string; retryImageUri?: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const retryImageUri = Array.isArray(params.retryImageUri) ? params.retryImageUri[0] : params.retryImageUri;
  const queryClient = useQueryClient();
  const analysisQuery = useQuery({
    queryKey: ["analysis", id], queryFn: async () => (await fetchAnalysis(id)).data, enabled: Boolean(id),
    refetchInterval: (query) => ["identifying", "researching", "calculating"].includes(query.state.data?.analysis.status ?? "") ? 2500 : false,
  });
  const result = analysisQuery.data as AnalysisResult | undefined;
  const product = result?.product;
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [category, setCategory] = useState("");
  const [visibleCondition, setVisibleCondition] = useState("");
  const [functionalCondition, setFunctionalCondition] = useState("nao_testado");
  const [askingPrice, setAskingPrice] = useState("");
  const [transport, setTransport] = useState("0");
  const [maintenance, setMaintenance] = useState("0");
  const [preparation, setPreparation] = useState("0");
  const [additional, setAdditional] = useState("0");
  const [fee, setFee] = useState("0");
  const [scenario, setScenario] = useState<Scenario>("provavel");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!product) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Hydrate editable identification fields from the API.
    setName(product.name ?? ""); setBrand(product.brand ?? ""); setModel(product.model ?? "");
    setCategory(product.category ?? ""); setVisibleCondition(product.visibleCondition ?? "");
  }, [product]);
  useEffect(() => {
    const finance = result?.profitability;
    if (!finance) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Hydrate the calculator from stored values.
    setAskingPrice(finance.purchasePriceCents === null ? "" : (finance.purchasePriceCents / 100).toFixed(2).replace(".", ","));
    setTransport((finance.transportCostCents / 100).toFixed(2).replace(".", ","));
    setMaintenance((finance.maintenanceCostCents / 100).toFixed(2).replace(".", ","));
    setPreparation((finance.preparationCostCents / 100).toFixed(2).replace(".", ","));
    setAdditional((finance.additionalCostCents / 100).toFixed(2).replace(".", ","));
    setFee((finance.sellingFeeBps / 100).toString());
  }, [result?.profitability]);

  const refresh = async () => queryClient.invalidateQueries({ queryKey: ["analysis", id] });
  const comparableRefs = useMemo(() => result?.references.filter((reference) => reference.matchType === "EXATA" || reference.matchType === "ALTA") ?? [], [result?.references]);
  const partialRefs = useMemo(() => result?.references.filter((reference) => reference.matchType === "PARCIAL") ?? [], [result?.references]);

  const identifyAgain = async () => {
    if (!retryImageUri) return;
    setBusy(true);
    try {
      await retryIdentification(id, retryImageUri);
      await discardLocalImage(retryImageUri);
      await refresh();
    } catch (error: any) { Alert.alert("Identificação não concluída", error?.message ?? "Tente novamente."); }
    finally { setBusy(false); }
  };

  const confirmAndResearch = async () => {
    setBusy(true);
    try {
      await confirmIdentification(id, { name: name.trim(), brand: brand.trim() || null, model: model.trim() || null, category: category.trim() || null, visibleCondition: visibleCondition.trim() || null, functionalCondition });
      await researchAnalysis(id);
      await refresh();
    } catch (error: any) {
      Alert.alert("A etapa não foi concluída", error?.message ?? "A confirmação foi salva, mas a pesquisa pode ser repetida.");
      await refresh();
    } finally { setBusy(false); }
  };

  const runResearch = async () => {
    setBusy(true);
    try { await researchAnalysis(id); await refresh(); }
    catch (error: any) { Alert.alert("Pesquisa indisponível", error?.message ?? "A identificação continua salva."); }
    finally { setBusy(false); }
  };

  const recalculate = async () => {
    setBusy(true);
    try {
      await recalculateAnalysis(id, {
        askingPriceCents: parseMoneyToCents(askingPrice), transportCostCents: parseMoneyToCents(transport),
        maintenanceCostCents: parseMoneyToCents(maintenance), preparationCostCents: parseMoneyToCents(preparation),
        additionalCostCents: parseMoneyToCents(additional), sellingFeeBps: Math.round(Number(fee.replace(",", ".")) * 100), scenario,
      });
      await refresh();
    } catch (error: any) { Alert.alert("Confira os valores", error?.message ?? "Não foi possível recalcular."); }
    finally { setBusy(false); }
  };

  const saveOpportunity = async () => {
    setBusy(true);
    try { await createOpportunity(id); await queryClient.invalidateQueries({ queryKey: ["opportunities"] }); Alert.alert("Oportunidade salva", "Você pode acompanhar compra e venda na aba Oportunidades."); }
    catch (error: any) { Alert.alert("Não foi possível salvar", error?.message ?? "Tente novamente."); }
    finally { setBusy(false); }
  };

  if (analysisQuery.isLoading) return <Screen><View style={{ padding: 42 }}><ActivityIndicator color={theme.colors.green} /><Text style={{ color: theme.colors.muted, textAlign: "center", marginTop: 12 }}>Abrindo análise…</Text></View></Screen>;
  if (analysisQuery.isError || !result) return <Screen><PageTitle title="Análise indisponível" subtitle={(analysisQuery.error as Error)?.message ?? "Não foi possível abrir esta análise."} /><Button title="Voltar" variant="secondary" onPress={() => router.back()} /><Button title="Tentar novamente" onPress={() => void analysisQuery.refetch()} /></Screen>;

  const recommendation = result.analysis.recommendation;
  const recTone = recommendation === "COMPRAR" ? "green" : recommendation === "NEGOCIAR" ? "amber" : recommendation === "EVITAR" ? "red" : "muted";
  return <Screen contentStyle={{ gap: 16 }}>
    <PageTitle eyebrow="ANÁLISE RADAR" title={product?.name ?? "Identificando produto"} subtitle={[product?.brand, product?.model, product?.version].filter(Boolean).join(" · ") || "Produto ainda não confirmado"} right={<Pill label={result.analysis.status.toUpperCase().replaceAll("_", " ")} tone={result.analysis.status === "completed" ? "green" : result.analysis.status === "failed" ? "red" : "amber"} />} />

    {retryImageUri && result.analysis.status === "failed" && !product ? <Card>
      <Text style={{ color: theme.colors.text, fontSize: 17, fontWeight: "800" }}>A identificação falhou</Text>
      <Text style={{ color: theme.colors.muted, lineHeight: 21 }}>A foto só fica no dispositivo enquanto você tenta novamente. O backend já descartou o temporário anterior.</Text>
      <Image source={{ uri: retryImageUri }} style={{ height: 190, borderRadius: 14 }} resizeMode="cover" />
      <Button title="Tentar identificar novamente" onPress={() => void identifyAgain()} loading={busy} />
    </Card> : null}

    {product ? <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}><Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: "800" }}>Identificação visual</Text><Pill label={`CONFIANÇA ${percent(product.confidenceBps)}`} tone="blue" /></View>
      <Text style={{ color: theme.colors.muted, fontSize: 13 }}>{[product.category, product.subcategory].filter(Boolean).join(" · ")}</Text>
      {product.visibleCondition ? <Text style={{ color: theme.colors.text, lineHeight: 20 }}>Condição visual: {product.visibleCondition}</Text> : null}
      {product.visibleDefects.length ? <Text style={{ color: theme.colors.amber, lineHeight: 20 }}>Defeitos aparentes: {product.visibleDefects.join("; ")}</Text> : null}
      {product.uncertainInformation.length ? <Text style={{ color: theme.colors.amber, lineHeight: 20 }}>Não confirmado: {product.uncertainInformation.join("; ")}</Text> : null}
      {product.warnings.length ? <Text style={{ color: theme.colors.amber, lineHeight: 20 }}>{product.warnings.join("; ")}</Text> : null}
    </Card> : null}

    {product && !product.confirmedByUser ? <Card>
      <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: "800" }}>Confirme antes da pesquisa</Text>
      <Text style={{ color: theme.colors.muted, fontSize: 13, lineHeight: 20 }}>Corrija nome, marca ou modelo. A pesquisa só começa depois da confirmação.</Text>
      <Field label="NOME DO PRODUTO" value={name} onChangeText={setName} />
      <View style={{ flexDirection: "row", gap: 10 }}><View style={{ flex: 1 }}><Field label="MARCA" value={brand} onChangeText={setBrand} /></View><View style={{ flex: 1 }}><Field label="MODELO" value={model} onChangeText={setModel} /></View></View>
      <Field label="CATEGORIA" value={category} onChangeText={setCategory} />
      <Field label="CONDIÇÃO VISUAL" value={visibleCondition} onChangeText={setVisibleCondition} />
      <Text style={{ color: theme.colors.muted, fontSize: 12, fontWeight: "700" }}>FUNCIONAMENTO</Text>
      <View style={{ flexDirection: "row", gap: 7, flexWrap: "wrap" }}>{[["funcionando", "Funciona"], ["com_defeito", "Com defeito"], ["nao_testado", "Não testado"], ["nao_aplicavel", "Não se aplica"]].map(([value, label]) => <Pressable key={value} onPress={() => setFunctionalCondition(value)}><Pill label={label.toUpperCase()} tone={functionalCondition === value ? "green" : "muted"} /></Pressable>)}</View>
      {product.verificationQuestions.length ? <Text style={{ color: theme.colors.amber, fontSize: 12, lineHeight: 19 }}>Verifique: {product.verificationQuestions.join(" · ")}</Text> : null}
      <Button title="Confirmar e pesquisar mercado" onPress={() => void confirmAndResearch()} loading={busy} disabled={!name.trim()} />
    </Card> : null}

    {product?.confirmedByUser && result.lastResearch?.status === "failed" ? <Card><Text style={{ color: theme.colors.amber, fontWeight: "800" }}>Pesquisa parcial</Text><Text style={{ color: theme.colors.muted, lineHeight: 20 }}>A identificação foi preservada. Tente a pesquisa novamente quando a fonte estiver disponível.</Text><Button title="Tentar pesquisa de novo" variant="secondary" onPress={() => void runResearch()} loading={busy} /></Card> : null}

    {product?.confirmedByUser ? <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}><Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: "800" }}>Referências de mercado</Text><Pill label={`${result.market.comparableCount} COMPATÍVEIS`} tone={result.market.comparableCount >= 3 ? "green" : "amber"} /></View>
      {result.market.comparableCount ? <>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}><PriceMetric label="MENOR" value={money(result.market.lowestPriceCents)} /><PriceMetric label="MEDIANA" value={money(result.market.medianPriceCents)} accent /><PriceMetric label="MAIOR" value={money(result.market.highestPriceCents)} /></View>
        <Text style={{ color: theme.colors.muted, fontSize: 11, lineHeight: 17 }}>Consulta em {result.market.collectedAt ? new Date(result.market.collectedAt).toLocaleString("pt-BR") : "—"} · {result.market.sourceNames.join(", ")}. São anúncios ativos; não comprovam vendas realizadas.</Text>
      </> : <Text style={{ color: theme.colors.muted, lineHeight: 20 }}>Ainda não há referências compatíveis. Sem dados suficientes, o RADAR não emite recomendação positiva definitiva.</Text>}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}><Text style={{ color: theme.colors.muted, fontSize: 12 }}>Liquidez aparente</Text><Pill label={result.market.liquidity} tone={result.market.liquidity === "ALTA" ? "green" : result.market.liquidity === "INSUFICIENTE" ? "muted" : "amber"} /></View>
      <Text style={{ color: theme.colors.faint, fontSize: 11, lineHeight: 17 }}>A quantidade de anúncios não mede compradores nem velocidade de venda. Nível: {percent(result.market.researchConfidenceBps)} de cobertura das referências.</Text>
      {partialRefs.length ? <>
        <Divider /><Text style={{ color: theme.colors.amber, fontSize: 13, fontWeight: "800" }}>Correspondência parcial · {partialRefs.length}</Text>
        {partialRefs.slice(0, 5).map((reference) => <MarketRow key={reference.id} reference={reference} partial />)}
      </> : null}
      {comparableRefs.slice(0, 8).map((reference) => <MarketRow key={reference.id} reference={reference} />)}
    </Card> : null}

    {product?.confirmedByUser ? <Card>
      <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: "800" }}>Calculadora de compra</Text>
      <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 18 }}>Alterar valores recalcula apenas as finanças. Não chama Gemini nem pesquisa de novo.</Text>
      <Field label="PREÇO PEDIDO (R$)" keyboardType="decimal-pad" value={askingPrice} onChangeText={setAskingPrice} placeholder="0,00" />
      <View style={{ flexDirection: "row", gap: 10 }}><View style={{ flex: 1 }}><Field label="TRANSPORTE" keyboardType="decimal-pad" value={transport} onChangeText={setTransport} /></View><View style={{ flex: 1 }}><Field label="MANUTENÇÃO" keyboardType="decimal-pad" value={maintenance} onChangeText={setMaintenance} /></View></View>
      <View style={{ flexDirection: "row", gap: 10 }}><View style={{ flex: 1 }}><Field label="PREPARAÇÃO" keyboardType="decimal-pad" value={preparation} onChangeText={setPreparation} /></View><View style={{ flex: 1 }}><Field label="OUTROS CUSTOS" keyboardType="decimal-pad" value={additional} onChangeText={setAdditional} /></View></View>
      <Field label="TAXA DE VENDA (%)" keyboardType="decimal-pad" value={fee} onChangeText={setFee} />
      <Text style={{ color: theme.colors.muted, fontSize: 12, fontWeight: "700" }}>CENÁRIO</Text>
      <View style={{ flexDirection: "row", gap: 7 }}>{scenarios.map((value) => <View style={{ flex: 1 }} key={value}><Button title={value[0].toUpperCase() + value.slice(1)} variant={scenario === value ? "primary" : "quiet"} onPress={() => setScenario(value)} /></View>)}</View>
      <Button title="Calcular lucro e preço máximo" onPress={() => void recalculate()} loading={busy} disabled={!askingPrice.trim()} />
    </Card> : null}

    {result.profitability ? <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}><Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: "800" }}>Resultado financeiro</Text>{recommendation ? <Pill label={recommendation} tone={recTone} /> : null}</View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: 14 }}>
        <PriceMetric label="REVENDA EST." value={money(result.profitability.resalePriceCents)} accent />
        <PriceMetric label="LUCRO LÍQUIDO" value={money(result.profitability.estimatedProfitCents)} accent />
        <PriceMetric label="ROI" value={percent(result.profitability.roiBps)} />
        <PriceMetric label="MARGEM" value={percent(result.profitability.marginBps)} />
      </View>
      <View style={{ backgroundColor: theme.colors.elevated, borderRadius: 14, padding: 14, gap: 5 }}><Text style={{ color: theme.colors.muted, fontSize: 11, fontWeight: "800" }}>PREÇO MÁXIMO RECOMENDADO</Text><Text style={{ color: theme.colors.green, fontSize: 23, fontWeight: "900" }}>{money(result.profitability.maximumPurchasePriceCents)}</Text></View>
      <Text style={{ color: theme.colors.faint, fontSize: 11 }}>Cenários usam percentis 25, 50 e 75 das referências compatíveis. Valores são anúncios e custos estimados.</Text>
      {recommendation && result.analysis.recommendationReasons?.length ? result.analysis.recommendationReasons.map((reason, index) => <Text key={index} style={{ color: theme.colors.muted, fontSize: 13, lineHeight: 19 }}>• {reason}</Text>) : null}
      <Button title="Salvar oportunidade" onPress={() => void saveOpportunity()} loading={busy} />
    </Card> : null}

    {result.lastResearch?.status === "success" && result.references.length === 0 ? <Card><Text style={{ color: theme.colors.amber, fontWeight: "800" }}>Nenhum anúncio retornado</Text><Text style={{ color: theme.colors.muted, lineHeight: 20 }}>A identificação está salva. Tente refinar marca, modelo ou categoria e pesquisar novamente.</Text><Button title="Pesquisar novamente" variant="secondary" onPress={() => void runResearch()} loading={busy} /></Card> : null}
    <Button title="Voltar" variant="quiet" onPress={() => router.back()} />
  </Screen>;
}

function PriceMetric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return <View style={{ gap: 5 }}><Text style={{ color: theme.colors.faint, fontSize: 9, fontWeight: "800", letterSpacing: 0.7 }}>{label}</Text><Text style={{ color: accent ? theme.colors.green : theme.colors.text, fontSize: 15, fontWeight: "900" }}>{value}</Text></View>;
}

function MarketRow({ reference, partial = false }: { reference: AnalysisResult["references"][number]; partial?: boolean }) {
  return <Pressable onPress={() => void Linking.openURL(reference.url)} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.border, flexDirection: "row", gap: 12, alignItems: "center" }}>
    <View style={{ flex: 1, gap: 4 }}><Text numberOfLines={2} style={{ color: theme.colors.text, fontSize: 12, fontWeight: "700" }}>{reference.title}</Text><Text style={{ color: theme.colors.faint, fontSize: 10 }}>{reference.source.replaceAll("_", " ")} · {reference.condition ?? "condição não informada"} · {new Date(reference.collectedAt).toLocaleDateString("pt-BR")}</Text></View>
    <View style={{ alignItems: "flex-end", gap: 5 }}><Text style={{ color: partial ? theme.colors.amber : theme.colors.green, fontWeight: "900", fontSize: 13 }}>{money(reference.priceCents)}</Text><Text style={{ color: theme.colors.faint, fontSize: 9 }}>{partial ? "PARCIAL" : reference.matchType}</Text></View>
  </Pressable>;
}

