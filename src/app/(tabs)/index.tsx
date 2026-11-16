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
import { connectGeminiLive, type GeminiLiveConnection } from "../../features/scanner/gemini-live";

const MAX_SCAN_FRAMES = 4;
const MIN_IDENTIFICATION_CONFIDENCE = 0.35;

function parseIdentification(raw: string): LiveIdentification {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("O Gemini não retornou uma identificação válida.");
  const value = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  if (typeof value.name !== "string" || !value.name.trim()) throw new Error("O Gemini não conseguiu nomear o produto.");
  if (typeof value.confidence !== "number" || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) {
    throw new Error("A confiança da identificação veio em formato inválido.");
  }
  const textOrNull = (item: unknown, max: number) => typeof item === "string" ? item.slice(0, max) : null;
  const stringList = (item: unknown, count: number, max: number) => Array.isArray(item)
    ? item.filter((entry): entry is string => typeof entry === "string").slice(0, count).map((entry) => entry.slice(0, max))
    : [];
  return {
    name: value.name.trim().slice(0, 240),
    category: textOrNull(value.category, 120),
    subcategory: textOrNull(value.subcategory, 120),
    brand: textOrNull(value.brand, 160),
    model: textOrNull(value.model, 160),
    version: textOrNull(value.version, 160),
    description: textOrNull(value.description, 1000),
    attributes: value.attributes && typeof value.attributes === "object" && !Array.isArray(value.attributes)
      ? value.attributes as Record<string, unknown> : {},
    visibleCondition: textOrNull(value.visibleCondition, 500),
    visibleDefects: stringList(value.visibleDefects, 30, 300),
    confidence: value.confidence,
    identifiedInformation: stringList(value.identifiedInformation, 30, 300),
    uncertainInformation: stringList(value.uncertainInformation, 30, 300),
    verificationQuestions: stringList(value.verificationQuestions, 20, 300),
    searchQueries: stringList(value.searchQueries, 5, 240),
    warnings: stringList(value.warnings, 30, 300),
  };
}

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

function isUnknownProduct(result: LiveIdentification) {
  return result.confidence < MIN_IDENTIFICATION_CONFIDENCE || /produto não identificado|item não identificado/i.test(result.name);
}

export default function ScannerScreen() {
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraGeneration, setCameraGeneration] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [working, setWorking] = useState(false);
  const [statusText, setStatusText] = useState("");
  const cameraRef = useRef<CameraView>(null);
  const runIdRef = useRef(0);
  const scanningRef = useRef(false);
  const connectionRef = useRef<GeminiLiveConnection | null>(null);
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
    const idempotencyKey = `live-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const response = await recordLiveIdentification(identification, idempotencyKey);
    if (runIdRef.current !== runId) return;
    connectionRef.current?.close();
    connectionRef.current = null;
    scanningRef.current = false;
    setScanning(false);
    router.push({ pathname: "/analysis/[id]", params: { id: response.data.analysis.id } });
  }, []);

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
    setScanning(true);
    setStatusText("Abrindo sessão segura com o Gemini...");
    let connection: GeminiLiveConnection | null = null;
    try {
      for (let frameNumber = 1; frameNumber <= MAX_SCAN_FRAMES; frameNumber += 1) {
        if (runIdRef.current !== runId) return;
        setStatusText(`Lendo a câmera ao vivo · quadro ${frameNumber} de ${MAX_SCAN_FRAMES}`);
        const camera = cameraRef.current;
        if (!camera) throw new Error("A câmera foi fechada durante a leitura.");
        const capture = await camera.takePictureAsync({ quality: 0.55, exif: false });
        let frameUri: string | null = null;
        try {
          const frame = await compressFrame(capture.uri);
          frameUri = frame.uri;
          setStatusText(`Conectando ao Gemini · quadro ${frameNumber} de ${MAX_SCAN_FRAMES}`);
          const session = await createGeminiLiveSession();
          if (runIdRef.current !== runId) return;
          const frameConnection = await connectGeminiLive(session.data);
          connection = frameConnection;
          connectionRef.current = frameConnection;
          if (runIdRef.current !== runId) {
            frameConnection.close();
            return;
          }
          let text: string;
          try {
            text = await frameConnection.sendFrame(frame.base64!);
          } finally {
            frameConnection.close();
            if (connectionRef.current === frameConnection) connectionRef.current = null;
            connection = null;
          }
          if (runIdRef.current !== runId) return;
          const identification = parseIdentification(text);
          if (!isUnknownProduct(identification)) {
            await saveAndOpenResult(identification, runId);
            return;
          }
          setStatusText("Ainda não reconheci o item. Aproxime ou mostre a marca e o modelo...");
        } finally {
          await discardLocalImage(frameUri);
          await discardLocalImage(capture.uri);
        }
      }
      throw new Error("Não consegui identificar o produto com segurança. Aproxime a câmera e tente novamente.");
    } catch (error) {
      if (runIdRef.current === runId) Alert.alert("Leitura não concluída", error instanceof Error ? error.message : "Confira a internet e tente novamente.");
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
    try {
      const selection = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: false, quality: 1, exif: false });
      if (selection.canceled) return;
      const asset = selection.assets?.[0];
      if (!asset?.uri) throw new Error("O Android não retornou a imagem escolhida.");
      const frame = await compressFrame(asset.uri, asset.width, asset.height);
      frameUri = frame.uri;
      setStatusText("Identificando diretamente com o Gemini...");
      const session = await createGeminiLiveSession();
      connection = await connectGeminiLive(session.data);
      const identification = parseIdentification(await connection.sendFrame(frame.base64!));
      if (isUnknownProduct(identification)) throw new Error("Não identifiquei o produto com segurança. Escolha uma foto mais nítida.");
      const response = await recordLiveIdentification(identification, `gallery-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      router.push({ pathname: "/analysis/[id]", params: { id: response.data.analysis.id } });
    } catch (error) {
      Alert.alert("Identificação não concluída", error instanceof Error ? error.message : "Confira a conexão e tente novamente.");
    } finally {
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
      subtitle="A câmera fica aberta e o Gemini identifica o item enquanto você o enquadra."
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
