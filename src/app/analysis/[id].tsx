import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, Text, View } from "react-native";
import { Button, Card, Divider, Field, PageTitle, Pill, Screen } from "../../components/ui";
import { money, parseMoneyToCents, percent, theme } from "../../constants/theme";
import type { AnalysisResult } from "../../types/api";
import { createOpportunity, confirmIdentification, fetchAnalysis, recalculateAnalysis, researchAnalysis } from "../../services/api/client";
import { getIdentificationSuggestions, type IdentificationSuggestion } from "../../features/scanner/identification";

const scenarios = ["conservador", "provavel", "otimista"] as const;
type Scenario = typeof scenarios[number];

export default function AnalysisDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
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
  const [subcategory, setSubcategory] = useState("");
  const [version, setVersion] = useState("");
  const [visibleCondition, setVisibleCondition] = useState("");
  const [functionalCondition, setFunctionalCondition] = useState("nao_testado");
  const [askingPrice, setAskingPrice] = useState("");
  const [transport, setTransport] = useState("0");
  const [maintenance, setMaintenance] = useState("0");
  const [preparation, setPreparation] = useState("0");
  const [additional, setAdditional] = useState("0");
  const [fee, setFee] = useState("0");
  const [scenario, setScenario] = useState<Scenario>("provavel");
  const [refineMode, setRefineMode] = useState(false);
  const [showAdvancedCosts, setShowAdvancedCosts] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!product) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Hydrate editable identification fields from the API.
    setName(product.name ?? ""); setBrand(product.brand ?? ""); setModel(product.model ?? "");
    setCategory(product.category ?? ""); setSubcategory(product.subcategory ?? ""); setVersion(product.version ?? "");
    setVisibleCondition(product.visibleCondition ?? "");
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
  const suggestions = useMemo(() => getIdentificationSuggestions(product?.attributes), [product?.attributes]);
  const applySuggestion = (suggestion: IdentificationSuggestion) => {
    if (suggestion.field === "category") setCategory(suggestion.value);
    else if (suggestion.field === "subcategory") setSubcategory(suggestion.value);
    else if (suggestion.field === "brand") setBrand(suggestion.value);
    else if (suggestion.field === "model") setModel(suggestion.value);
    else if (suggestion.field === "version") setVersion(suggestion.value);
  };

  const confirmAndResearch = async () => {
    setBusy(true);
    try {
      await confirmIdentification(id, {
        name: name.trim(), brand: brand.trim() || null, model: model.trim() || null,
        category: category.trim() || null, subcategory: subcategory.trim() || null,
        version: version.trim() || null, visibleCondition: visibleCondition.trim() || null, functionalCondition,
      });
      await researchAnalysis(id, true);
      setRefineMode(false);
      await refresh();
    } catch (error: any) {
      Alert.alert("A etapa não foi concluída", error?.message ?? "A confirmação foi salva, mas a pesquisa pode ser repetida.");
      await refresh();
    } finally { setBusy(false); }
  };

  const runResearch = async (force = Boolean(result?.lastResearch)) => {
    setBusy(true);
    try { await researchAnalysis(id, force); await refresh(); }
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

  const hasResearch = Boolean(result.lastResearch);
  const hasPurchasePrice = result.profitability?.purchasePriceCents !== null && result.profitability?.purchasePriceCents !== undefined;
  const recommendation = hasPurchasePrice ? result.analysis.recommendation : null;
  const recTone = recommendation === "COMPRAR" ? "green" : recommendation === "NEGOCIAR" ? "amber" : recommendation === "EVITAR" ? "red" : "muted";
  const analysisStatusLabel = result.analysis.status === "awaiting_confirmation"
    ? "PRONTO PARA PESQUISA" : result.analysis.status.toUpperCase().replaceAll("_", " ");
  const analysisStatusTone = result.analysis.status === "completed" || result.analysis.status === "awaiting_confirmation" ? "green" : result.analysis.status === "failed" ? "red" : "amber";
  return <Screen contentStyle={{ gap: 16 }}>
    <PageTitle eyebrow="ANÁLISE RADAR" title={product?.name ?? "Identificando produto"} subtitle={[product?.brand, product?.model, product?.version].filter(Boolean).join(" · ") || (product?.confirmedByUser ? "Identificação confirmada" : "Identificação pronta; refine se quiser")} right={<Pill label={analysisStatusLabel} tone={analysisStatusTone} />} />

    {product ? <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}><Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: "800" }}>Identificação visual</Text><Pill label={`CONFIANÇA ${percent(product.confidenceBps)}`} tone="blue" /></View>
      <Text style={{ color: theme.colors.muted, fontSize: 13 }}>{[product.category, product.subcategory].filter(Boolean).join(" · ")}</Text>
      {product.visibleCondition ? <Text style={{ color: theme.colors.text, lineHeight: 20 }}>Condição visual: {product.visibleCondition}</Text> : null}
      {product.visibleDefects.length ? <Text style={{ color: theme.colors.amber, lineHeight: 20 }}>Defeitos aparentes: {product.visibleDefects.join("; ")}</Text> : null}
      {product.confidenceBps !== null && product.confidenceBps < 3500 ? <Text style={{ color: theme.colors.amber, lineHeight: 20 }}>Identificação parcial: confira as hipóteses e ajuste os campos antes da pesquisa.</Text> : null}
      {product.uncertainInformation.length ? <Text style={{ color: theme.colors.amber, lineHeight: 20 }}>Não confirmado: {product.uncertainInformation.join("; ")}</Text> : null}
      {product.warnings.length ? <Text style={{ color: theme.colors.amber, lineHeight: 20 }}>{product.warnings.join("; ")}</Text> : null}
      {product.confirmedByUser && hasResearch && !refineMode ? <Button title="Refinar identificação" variant="quiet" onPress={() => setRefineMode(true)} disabled={busy} /> : null}
    </Card> : null}

    {product && (!product.confirmedByUser || !hasResearch || result.lastResearch?.status === "failed" || refineMode) ? <Card>
      <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: "800" }}>{refineMode ? "Refinar a identificação" : "Pesquisar preço de mercado"}</Text>
      <Text style={{ color: theme.colors.muted, fontSize: 13, lineHeight: 20 }}>
        {refineMode
          ? "Ajuste só o que você souber. Depois, a pesquisa usa os dados refinados."
          : "Você pode pesquisar agora com o que o Gemini reconheceu. Marca, edição e condição incertas podem mudar os comparáveis; refinar é opcional."}
      </Text>
      {!refineMode ? <>
        {result.lastResearch?.status === "failed" ? <Text style={{ color: theme.colors.amber, lineHeight: 19 }}>A última consulta falhou. Tente novamente ou refine os dados do produto.</Text> : null}
        <Button title={hasResearch ? "Pesquisar mercado novamente" : "Pesquisar assim mesmo"} onPress={() => void runResearch()} loading={busy} />
        <Button title="Refinar identificação" variant="secondary" onPress={() => setRefineMode(true)} disabled={busy} />
      </> : <>
      {suggestions.length ? <View style={{ gap: 8 }}>
        <Text style={{ color: theme.colors.amber, fontSize: 12, fontWeight: "800" }}>HIPÓTESES DO GEMINI · TOQUE PARA USAR</Text>
        {suggestions.map((suggestion, index) => <Pressable
          key={`${suggestion.field}-${suggestion.value}-${index}`}
          onPress={() => applySuggestion(suggestion)}
          style={{ backgroundColor: theme.colors.elevated, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 12, padding: 11, gap: 5 }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
            <Text style={{ color: theme.colors.text, flex: 1, fontWeight: "800" }}>{suggestion.value} · {Math.round(suggestion.confidence * 100)}%</Text>
            <Text style={{ color: theme.colors.green, fontSize: 11, fontWeight: "800" }}>USAR</Text>
          </View>
          <Text style={{ color: theme.colors.faint, fontSize: 11 }}>{suggestion.field === "version" ? "EDIÇÃO / ANO" : suggestion.field.toUpperCase()}{suggestion.rationale ? ` · ${suggestion.rationale}` : ""}</Text>
        </Pressable>)}
      </View> : null}
      <Field label="NOME DO PRODUTO" value={name} onChangeText={setName} />
      <View style={{ flexDirection: "row", gap: 10 }}><View style={{ flex: 1 }}><Field label="MARCA" value={brand} onChangeText={setBrand} /></View><View style={{ flex: 1 }}><Field label="MODELO" value={model} onChangeText={setModel} /></View></View>
      <Field label="CATEGORIA" value={category} onChangeText={setCategory} />
      <View style={{ flexDirection: "row", gap: 10 }}><View style={{ flex: 1 }}><Field label="TIPO / SUBCATEGORIA" value={subcategory} onChangeText={setSubcategory} /></View><View style={{ flex: 1 }}><Field label="EDIÇÃO OU ANO" value={version} onChangeText={setVersion} /></View></View>
      <Field label="CONDIÇÃO VISUAL" value={visibleCondition} onChangeText={setVisibleCondition} />
      <Text style={{ color: theme.colors.muted, fontSize: 12, fontWeight: "700" }}>FUNCIONAMENTO</Text>
      <View style={{ flexDirection: "row", gap: 7, flexWrap: "wrap" }}>{[["funcionando", "Funciona"], ["com_defeito", "Com defeito"], ["nao_testado", "Não testado"], ["nao_aplicavel", "Não se aplica"]].map(([value, label]) => <Pressable key={value} onPress={() => setFunctionalCondition(value)}><Pill label={label.toUpperCase()} tone={functionalCondition === value ? "green" : "muted"} /></Pressable>)}</View>
      {product.verificationQuestions.length ? <Text style={{ color: theme.colors.amber, fontSize: 12, lineHeight: 19 }}>Verifique: {product.verificationQuestions.join(" · ")}</Text> : null}
      <Button title="Salvar ajustes e pesquisar" onPress={() => void confirmAndResearch()} loading={busy} disabled={!name.trim()} />
      <Button title="Cancelar refinamento" variant="quiet" onPress={() => setRefineMode(false)} disabled={busy} />
      </>}
    </Card> : null}

    {hasResearch ? <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}><Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: "800" }}>Preço no mercado</Text><Pill label={`${result.market.comparableCount} COMPATÍVEIS`} tone={result.market.comparableCount >= 3 ? "green" : "amber"} /></View>
      {result.market.comparableCount ? <>
        <View style={{ flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: 14 }}>
          <PriceMetric label="MÉDIA ANUNCIADA" value={money(result.market.averagePriceCents)} accent />
          <PriceMetric label="MEDIANA" value={money(result.market.medianPriceCents)} />
          <PriceMetric label="FAIXA OBSERVADA" value={`${money(result.market.lowestPriceCents)} – ${money(result.market.highestPriceCents)}`} />
        </View>
        <Text style={{ color: theme.colors.muted, fontSize: 11, lineHeight: 17 }}>Consulta em {result.market.collectedAt ? new Date(result.market.collectedAt).toLocaleString("pt-BR") : "—"} · {result.market.sourceNames.join(", ")}. São preços anunciados, não vendas confirmadas; marca, edição e conservação podem alterar o valor.</Text>
      </> : <Text style={{ color: result.lastResearch?.status === "failed" ? theme.colors.amber : theme.colors.muted, lineHeight: 20 }}>{result.lastResearch?.status === "failed" ? "A consulta ao mercado não terminou. Tente novamente ou refine a identificação." : "Não encontramos anúncios compatíveis com essa identificação. Refine marca, modelo ou categoria e pesquise novamente."}</Text>}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}><Text style={{ color: theme.colors.muted, fontSize: 12 }}>Liquidez aparente</Text><Pill label={result.market.liquidity} tone={result.market.liquidity === "ALTA" ? "green" : result.market.liquidity === "INSUFICIENTE" ? "muted" : "amber"} /></View>
      <Text style={{ color: theme.colors.faint, fontSize: 11, lineHeight: 17 }}>A quantidade de anúncios não mede compradores nem velocidade de venda. Nível: {percent(result.market.researchConfidenceBps)} de cobertura das referências.</Text>
      {partialRefs.length ? <>
        <Divider /><Text style={{ color: theme.colors.amber, fontSize: 13, fontWeight: "800" }}>Correspondência parcial · {partialRefs.length}</Text>
        {partialRefs.slice(0, 5).map((reference) => <MarketRow key={reference.id} reference={reference} partial />)}
      </> : null}
      {comparableRefs.slice(0, 8).map((reference) => <MarketRow key={reference.id} reference={reference} />)}
    </Card> : null}

    {hasResearch && result.market.comparableCount > 0 ? <Card>
      <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: "800" }}>{hasPurchasePrice ? "Resultado financeiro" : "Quanto vale a pena pagar?"}</Text>
      {hasPurchasePrice ? <>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>{recommendation ? <Pill label={recommendation} tone={recTone} /> : null}<Text style={{ color: theme.colors.faint, fontSize: 11 }}>Cenário {scenario}</Text></View>
        <View style={{ flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: 14 }}>
          <PriceMetric label="REVENDA EST." value={money(result.profitability?.resalePriceCents ?? null)} accent />
          <PriceMetric label="LUCRO LÍQUIDO" value={money(result.profitability?.estimatedProfitCents ?? null)} accent />
          <PriceMetric label="ROI" value={percent(result.profitability?.roiBps ?? null)} />
          <PriceMetric label="MARGEM" value={percent(result.profitability?.marginBps ?? null)} />
        </View>
        {recommendation && result.analysis.recommendationReasons?.length ? result.analysis.recommendationReasons.map((reason, index) => <Text key={index} style={{ color: theme.colors.muted, fontSize: 13, lineHeight: 19 }}>• {reason}</Text>) : null}
      </> : <>
        <View style={{ flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: 14 }}>
          <PriceMetric label="MÉDIA DO MERCADO" value={money(result.market.averagePriceCents)} accent />
          <PriceMetric label="TETO DE COMPRA RECOMENDADO" value={money(result.profitability?.maximumPurchasePriceCents ?? null)} />
        </View>
        <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 18 }}>Sem o preço pedido, não dá para calcular seu lucro líquido. Esse teto mostra quanto pagar no máximo, considerando taxas, custos e metas configurados. O preço pedido é opcional.</Text>
      </>}
      <Text style={{ color: theme.colors.faint, fontSize: 11 }}>A estimativa usa anúncios ativos semelhantes e pode variar conforme a identificação e a condição real do item.</Text>
    </Card> : null}

    {hasResearch && result.market.comparableCount > 0 ? <Card>
      <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: "800" }}>Quer calcular seu lucro?</Text>
      <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 18 }}>Opcional. Informe o valor que o vendedor pediu para comparar com o mercado.</Text>
      <Field label="PREÇO PEDIDO (OPCIONAL)" keyboardType="decimal-pad" value={askingPrice} onChangeText={setAskingPrice} placeholder="Ex.: 50,00" />
      <Button title="Calcular lucro neste preço" onPress={() => void recalculate()} loading={busy} disabled={!askingPrice.trim()} />
      <Pressable onPress={() => setShowAdvancedCosts((value) => !value)} disabled={busy}>
        <Text style={{ color: theme.colors.green, fontSize: 12, fontWeight: "800" }}>{showAdvancedCosts ? "OCULTAR CUSTOS E CENÁRIOS" : "AJUSTAR CUSTOS E CENÁRIOS (OPCIONAL)"}</Text>
      </Pressable>
      {showAdvancedCosts ? <>
        <View style={{ flexDirection: "row", gap: 10 }}><View style={{ flex: 1 }}><Field label="TRANSPORTE" keyboardType="decimal-pad" value={transport} onChangeText={setTransport} /></View><View style={{ flex: 1 }}><Field label="MANUTENÇÃO" keyboardType="decimal-pad" value={maintenance} onChangeText={setMaintenance} /></View></View>
        <View style={{ flexDirection: "row", gap: 10 }}><View style={{ flex: 1 }}><Field label="PREPARAÇÃO" keyboardType="decimal-pad" value={preparation} onChangeText={setPreparation} /></View><View style={{ flex: 1 }}><Field label="OUTROS CUSTOS" keyboardType="decimal-pad" value={additional} onChangeText={setAdditional} /></View></View>
        <Field label="TAXA DE VENDA (%)" keyboardType="decimal-pad" value={fee} onChangeText={setFee} />
        <Text style={{ color: theme.colors.muted, fontSize: 12, fontWeight: "700" }}>CENÁRIO DE REVENDA</Text>
        <View style={{ flexDirection: "row", gap: 7 }}>{scenarios.map((value) => <View style={{ flex: 1 }} key={value}><Button title={value[0].toUpperCase() + value.slice(1)} variant={scenario === value ? "primary" : "quiet"} onPress={() => setScenario(value)} /></View>)}</View>
      </> : null}
    </Card> : null}

    {hasPurchasePrice ? <Card>
      <Button title="Salvar oportunidade" onPress={() => void saveOpportunity()} loading={busy} />
    </Card> : null}

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

