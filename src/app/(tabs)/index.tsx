import { router, useIsFocused } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, Image, Linking, Text, View } from "react-native";
import { Button, Card, PageTitle, Pill, Screen } from "../../components/ui";
import { theme } from "../../constants/theme";
import { createGeminiLiveSession, recordLiveIdentification, type LiveIdentification } from "../../services/api/client";
import { discardLocalImage } from "../../features/images/temp-files";
import { connectGeminiLive, type GeminiLiveConnection, type GeminiLiveConnectionStage } from "../../features/scanner/gemini-live";
import { identificationScore, isUsefulIdentification, mergeIdentifications, parseIdentification } from "../../features/scanner/identification";

const MAX_SCAN_DURATION_MS = 30_000;
const FRAME_INTERVAL_MS = 1_000;
const IDENTIFICATION_PROMPT_INTERVAL_FRAMES = 3;
const CANDIDATE_REFINEMENT_MS = 7_000;

async function compressFrame(uri: string, width?: number, height?: number) {
  let imageWidth = width;
  let imageHeight = height;
  if (!imageWidth || !imageHeight) {
    try {
      const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) =>
        // Image.getSize is unavailable for some Android content URIs; the manipulator can still read those.
        Image.getSize(uri, (w, h) => resolve({ width: w, height: h }), reject)
      );
      imageWidth = dimensions.width;
      imageHeight = dimensions.height;
    } catch { /* Keep the source ratio when Android does not expose dimensions. */ }
  }
  const resize = imageWidth && imageHeight
    ? imageWidth >= imageHeight ? { width: 768 } : { height: 768 }
    : { width: 768 };
  const frame = await ImageManipulator.manipulateAsync(uri, [{ resize }], {
    format: ImageManipulator.SaveFormat.JPEG,
    compress: 0.48,
    base64: true,
  });
  if (!frame.base64) {
    await discardLocalImage(frame.uri);
    throw new Error("Não foi possível preparar o quadro da câmera.");
  }
  return frame;
}

export default function ScannerScreen() {
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraGeneration, setCameraGeneration] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [working, setWorking] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [liveIdentification, setLiveIdentification] = useState<LiveIdentification | null>(null);
  const cameraRef = useRef<CameraView>(null);
  const runIdRef = useRef(0);
  const scanningRef = useRef(false);
  const connectionRef = useRef<GeminiLiveConnection | null>(null);
  const bestIdentificationRef = useRef<LiveIdentification | null>(null);
  const firstUsefulCandidateAtRef = useRef<number | null>(null);
  const connectionErrorRef = useRef<Error | null>(null);
  const isFocused = useIsFocused();

  const stopLiveScan = useCallback(() => {
    runIdRef.current += 1;
    scanningRef.current = false;
    connectionRef.current?.close();
    connectionRef.current = null;
    setScanning(false);
    setStatusText("");
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active" && scanningRef.current) stopLiveScan();
      if (state === "active") void getPermission();
    });
    return () => subscription.remove();
  }, [getPermission, stopLiveScan]);

  useEffect(() => {
    if (!isFocused) {
      if (scanningRef.current) stopLiveScan();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Reset camera readiness after leaving the scanner tab.
      setCameraReady(false);
    }
  }, [isFocused, stopLiveScan]);

  useEffect(() => () => {
    runIdRef.current += 1;
    scanningRef.current = false;
    connectionRef.current?.close();
  }, []);

  const saveAndOpenResult = useCallback(async (identification: LiveIdentification, runId: number) => {
    setStatusText("Identificação pronta. Salvando os dados...");
    connectionRef.current?.close();
    connectionRef.current = null;
    scanningRef.current = false;
    setScanning(false);
    const idempotencyKey = `live-${runId}-${Date.now()}`;
    const response = await recordLiveIdentification(identification, idempotencyKey);
    if (runIdRef.current !== runId) return;
    router.push({ pathname: "/analysis/[id]", params: { id: response.data.analysis.id } });
  }, []);

  const openLiveConnection = async (runId: number, onIdentification: (raw: string) => void) => {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      if (runIdRef.current !== runId) throw new Error("A leitura foi encerrada.");
      try {
        setStatusText(attempt === 1 ? "Preparando conexão segura com o Gemini..." : "Renovando conexão com o Gemini...");
        console.info("[RADAR][Gemini Live] session_token_request", { attempt });
        const session = await createGeminiLiveSession();
        if (runIdRef.current !== runId) throw new Error("A leitura foi encerrada.");
        console.info("[RADAR][Gemini Live] session_token_received", { attempt });
        setStatusText("Sessão segura pronta. Conectando a câmera diretamente ao Gemini...");
        const liveConnection = await connectGeminiLive(
          session.data,
          onIdentification,
          (error) => {
            connectionErrorRef.current = error;
            setStatusText("A conexão com o Gemini foi encerrada. Preparando o melhor resultado disponível...");
          },
          (stage: GeminiLiveConnectionStage) => {
            if (runIdRef.current !== runId) return;
            const progress = {
              websocket_open: "WebSocket aberto. Enviando a configuração ao Gemini...",
              setup_sent: "Configuração enviada. Aguardando confirmação do Gemini...",
              setup_complete: "Gemini conectado. Iniciando leitura da câmera...",
            }[stage];
            setStatusText(progress);
          },
        );
        console.info("[RADAR][Gemini Live] session_ready", { attempt });
        return liveConnection;
      } catch (error) {
        if (runIdRef.current !== runId) throw error;
        lastError = error instanceof Error ? error : new Error("Não foi possível iniciar a conexão Gemini.");
        if (attempt === 1) console.warn("[RADAR][Gemini Live] initial_connection_retry", { reason: "fresh_session" });
      }
    }
    throw lastError ?? new Error("Não foi possível conectar ao Gemini.");
  };

  const startLiveScan = async () => {
    if (cameraError && permission?.granted) {
      setCameraReady(false);
      setCameraError(null);
      setCameraGeneration((current) => current + 1);
      return;
    }
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        if (!result.canAskAgain) Alert.alert("Permissão necessária", "Abra as configurações do Android e permita o acesso à câmera para o RADAR.", [
          { text: "Agora não", style: "cancel" },
          { text: "Abrir configurações", onPress: () => { void Linking.openSettings(); } },
        ]);
        else Alert.alert("Permissão necessária", "Permita o acesso à câmera para iniciar a leitura ao vivo.");
      }
      return;
    }
    if (!cameraReady || !cameraRef.current || scanning) return;

    const runId = ++runIdRef.current;
    scanningRef.current = true;
    bestIdentificationRef.current = null;
    firstUsefulCandidateAtRef.current = null;
    setLiveIdentification(null);
    connectionErrorRef.current = null;
    setScanning(true);
    setStatusText("Preparando a leitura ao vivo...");
    let connection: GeminiLiveConnection | null = null;
    let resultSaveAttempted = false;
    try {
      const acceptIdentification = (raw: string) => {
        if (runIdRef.current !== runId) return;
        try {
          const candidate = parseIdentification(raw);
          if (!isUsefulIdentification(candidate)) {
            console.info("[RADAR][Gemini Live] non_useful_candidate");
            setStatusText("Ainda não consegui reconhecer o tipo do item. Aponte para ele por alguns instantes...");
            return;
          }
          const previous = bestIdentificationRef.current;
          const merged = mergeIdentifications(previous, candidate);
          if (!isUsefulIdentification(merged)) return;
          if (!previous) firstUsefulCandidateAtRef.current = Date.now();
          if (previous && identificationScore(merged) < identificationScore(previous)) return;
          bestIdentificationRef.current = merged;
          setLiveIdentification(merged);
          console.info("[RADAR][Gemini Live] structured_json_updated", {
            confidence: merged.confidence,
            identifiedFields: [merged.category, merged.subcategory, merged.brand, merged.model, merged.version].filter(Boolean).length,
          });
          setStatusText(`JSON atualizado · ${merged.name} · ${Math.round(merged.confidence * 100)}% de confiança`);
        } catch {
          console.warn("[RADAR][Gemini Live] candidate_rejected", { reason: "invalid_structured_result" });
        }
      };

      setStatusText("Conectando ao Gemini para iniciar a leitura ao vivo...");
      connection = await openLiveConnection(runId, acceptIdentification);
      connectionRef.current = connection;
      if (runIdRef.current !== runId) return;

      const scanStartedAt = Date.now();
      let frameNumber = 0;
      while (Date.now() - scanStartedAt < MAX_SCAN_DURATION_MS && runIdRef.current === runId) {
        if (connectionErrorRef.current) break;
        const frameStartedAt = Date.now();
        const camera = cameraRef.current;
        if (!camera) throw new Error("A câmera foi fechada durante a leitura.");
        if (runIdRef.current !== runId) return;
        const capture = await camera.takePictureAsync({ quality: 0.55, exif: false });
        let frameUri: string | null = null;
        try {
          const frame = await compressFrame(capture.uri);
          frameUri = frame.uri;
          if (runIdRef.current !== runId || connectionErrorRef.current) continue;
          const nextFrameNumber = frameNumber + 1;
          const requestIdentification = nextFrameNumber === 1 || (nextFrameNumber - 1) % IDENTIFICATION_PROMPT_INTERVAL_FRAMES === 0;
          connection?.sendFrame(frame.base64!, requestIdentification);
          frameNumber = nextFrameNumber;
          setStatusText((current) => current.includes("Hipótese inicial") || current.includes("Produto reconhecido")
            ? current
            : requestIdentification
              ? `Gemini analisando o produto · ${frameNumber} quadros enviados`
              : `Leitura ao vivo ativa · ${frameNumber} quadros enviados`);
        } finally {
          await discardLocalImage(frameUri);
          await discardLocalImage(capture.uri);
        }
        const best = bestIdentificationRef.current as LiveIdentification | null;
        const refinementWindowElapsed = Boolean(best && firstUsefulCandidateAtRef.current
          && Date.now() - firstUsefulCandidateAtRef.current >= CANDIDATE_REFINEMENT_MS);
        if (best && refinementWindowElapsed) {
          resultSaveAttempted = true;
          await saveAndOpenResult(best, runId);
          return;
        }
        const waitMs = Math.min(FRAME_INTERVAL_MS - (Date.now() - frameStartedAt), MAX_SCAN_DURATION_MS - (Date.now() - scanStartedAt));
        if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
      const best = bestIdentificationRef.current as LiveIdentification | null;
      if (best) {
        resultSaveAttempted = true;
        await saveAndOpenResult(best, runId);
        return;
      }
      if (connectionErrorRef.current) throw connectionErrorRef.current;
      throw new Error("Não consegui reconhecer o produto nesta imagem. Aproxime a câmera, retire o que estiver cobrindo o item e tente novamente.");
    } catch (error) {
      if (runIdRef.current === runId) {
        const message = error instanceof Error ? error.message : "Confira a internet e tente novamente.";
        const best = bestIdentificationRef.current as LiveIdentification | null;
        if (!resultSaveAttempted && best) {
          resultSaveAttempted = true;
          try {
            await saveAndOpenResult(best, runId);
            return;
          } catch (saveError) {
            Alert.alert("Não foi possível salvar a identificação", saveError instanceof Error ? saveError.message : "Confira a conexão e tente novamente.");
            return;
          }
        }
        Alert.alert("Leitura não concluída", message);
      }
    } finally {
      connection?.close();
      if (connectionRef.current === connection) connectionRef.current = null;
      if (runIdRef.current === runId) {
        scanningRef.current = false;
        setScanning(false);
        setStatusText("");
      }
    }
  };

  const choosePhoto = async () => {
    if (working || scanning) return;
    setWorking(true);
    setStatusText("Abrindo a imagem para identificação...");
    let frameUri: string | null = null;
    let connection: GeminiLiveConnection | null = null;
    let identificationTimeout: ReturnType<typeof setTimeout> | null = null;
    try {
      const selection = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: false, quality: 1, exif: false });
      if (selection.canceled) return;
      const asset = selection.assets?.[0];
      if (!asset?.uri) throw new Error("O Android não retornou a imagem escolhida.");
      const frame = await compressFrame(asset.uri, asset.width, asset.height);
      frameUri = frame.uri;
      setStatusText("Identificando diretamente com o Gemini...");
      const session = await createGeminiLiveSession();
      let resolveIdentification!: (raw: string) => void;
      let rejectIdentification!: (error: Error) => void;
      const identificationResponse = new Promise<string>((resolve, reject) => {
        resolveIdentification = resolve;
        rejectIdentification = reject;
      });
      connection = await connectGeminiLive(session.data, resolveIdentification, rejectIdentification);
      connection.sendFrame(frame.base64!, true);
      const timeout = new Promise<never>((_, reject) => {
        identificationTimeout = setTimeout(() => reject(new Error("O Gemini não concluiu a leitura da foto a tempo. Escolha uma imagem mais nítida e tente novamente.")), MAX_SCAN_DURATION_MS);
      });
      const identification = parseIdentification(await Promise.race([identificationResponse, timeout]));
      if (!isUsefulIdentification(identification)) throw new Error("Não consegui reconhecer o produto nesta foto. Escolha uma imagem mais nítida e tente novamente.");
      const response = await recordLiveIdentification(identification, `gallery-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      router.push({ pathname: "/analysis/[id]", params: { id: response.data.analysis.id } });
    } catch (error) {
      Alert.alert("Identificação não concluída", error instanceof Error ? error.message : "Confira a conexão e tente novamente.");
    } finally {
      if (identificationTimeout) clearTimeout(identificationTimeout);
      connection?.close();
      await discardLocalImage(frameUri);
      setWorking(false);
      setStatusText("");
    }
  };

  const cameraButtonTitle = !permission
    ? "Verificando câmera..."
    : !permission.granted
      ? "Permitir câmera"
      : scanning
        ? "Encerrar leitura"
        : cameraError ? "Tentar abrir câmera" : cameraReady ? "Iniciar leitura ao vivo" : "Abrindo câmera...";

  return <Screen contentStyle={{ gap: 16 }}>
    <PageTitle
      eyebrow="LEITURA VISUAL AO VIVO"
      title="Aponte para o produto"
      subtitle="O Gemini preenche a identificação enquanto você enquadra. O JSON vai ao RADAR para pesquisar o mercado."
    />

    <View style={{ height: 360, borderRadius: 24, overflow: "hidden", borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface }}>
      {permission?.granted && isFocused ? <CameraView
        key={cameraGeneration}
        ref={cameraRef}
        style={{ width: "100%", height: "100%" }}
        facing="back"
        mode="picture"
        mute
        onCameraReady={() => { setCameraReady(true); setCameraError(null); }}
        onMountError={(event) => { setCameraError(event.message); setCameraReady(false); }}
      /> : <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 10 }}>
        <Text style={{ color: theme.colors.green, fontSize: 58 }}>⌖</Text>
        <Text style={{ color: theme.colors.text, fontSize: 17, fontWeight: "800", textAlign: "center" }}>A câmera do aparelho aparece aqui</Text>
        <Text style={{ color: theme.colors.muted, lineHeight: 20, textAlign: "center" }}>Toque em “Permitir câmera” para abrir a prévia real do celular.</Text>
      </View>}
      {permission?.granted && scanning ? <View style={{ position: "absolute", left: 12, right: 12, top: 12 }}><Pill label="LEITURA AO VIVO ATIVA" /></View> : null}
    </View>

    {cameraError ? <Text style={{ color: theme.colors.red, fontSize: 13, lineHeight: 20 }}>A câmera deste aparelho não abriu: {cameraError}</Text> : null}
    {statusText ? <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.green, fontSize: 13, fontWeight: "700", textAlign: "center" }}>{statusText}</Text> : null}

    <View style={{ flexDirection: "row", gap: 12 }}>
      <Button title="▧  Galeria" variant="secondary" onPress={() => void choosePhoto()} loading={working} disabled={scanning} style={{ flex: 0.85 }} />
      <Button
        title={cameraButtonTitle}
        onPress={() => scanning ? stopLiveScan() : void startLiveScan()}
        loading={!permission}
        disabled={working || Boolean(permission?.granted && !cameraReady && !cameraError)}
        style={{ flex: 1.5 }}
      />
    </View>

    {scanning ? <Card style={{ gap: 8 }}>
      <Text style={{ color: theme.colors.text, fontWeight: "800", fontSize: 14 }}>JSON do produto ao vivo</Text>
      <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 18 }}>
        {liveIdentification ? "Os campos são atualizados conforme o Gemini reconhece novos detalhes." : "A câmera está enviando quadros diretamente ao Gemini; o primeiro JSON estruturado aparecerá aqui."}
      </Text>
      <View style={{ backgroundColor: theme.colors.background, borderRadius: 12, padding: 12 }}>
        <Text selectable style={{ color: liveIdentification ? theme.colors.green : theme.colors.faint, fontSize: 11, lineHeight: 17, fontFamily: "monospace" }}>
          {JSON.stringify(liveIdentification ? {
            name: liveIdentification.name,
            category: liveIdentification.category,
            subcategory: liveIdentification.subcategory,
            brand: liveIdentification.brand,
            model: liveIdentification.model,
            version: liveIdentification.version,
            confidence: liveIdentification.confidence,
            suggestions: liveIdentification.attributes.suggestions ?? [],
          } : { status: "observando", name: null, category: null, brand: null, model: null, version: null }, null, 2)}
        </Text>
      </View>
    </Card> : null}

    <Card style={{ gap: 9 }}>
      <Text style={{ color: theme.colors.text, fontWeight: "800", fontSize: 14 }}>Sem envio de foto ao backend</Text>
      <Text style={{ color: theme.colors.muted, fontSize: 13, lineHeight: 20 }}>Os quadros temporários vão do celular diretamente ao Gemini pela internet. O backend recebe apenas a identificação em texto para guardar o histórico e pesquisar o mercado. Nenhuma imagem fica no RADAR.</Text>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}><Pill label="CÂMERA AO VIVO" /><Pill label="IMAGEM NÃO VAI AO RENDER" tone="muted" /><Pill label="SEM FOTO NO HISTÓRICO" tone="muted" /></View>
    </Card>

    <Card style={{ gap: 8 }}>
      <Text style={{ color: theme.colors.text, fontWeight: "800", fontSize: 14 }}>Depois da identificação</Text>
      <Text style={{ color: theme.colors.muted, fontSize: 13, lineHeight: 20 }}>Você confirma o nome e o modelo. O RADAR consulta anúncios de mercado, calcula margem e lucro e guarda somente os dados da análise.</Text>
    </Card>
  </Screen>;
}
