import { useFocusEffect, router } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Network from "expo-network";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Image, Pressable, Text, View } from "react-native";
import { Button, Card, PageTitle, Pill, Screen } from "../../components/ui";
import { theme } from "../../constants/theme";
import { ApiError, uploadAnalysis } from "../../services/api/client";
import { discardLocalImage, enqueueAnalysis, listPendingAnalyses, persistRetryImage } from "../../features/offline/pending-queue";

async function compressImage(uri: string) {
  const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => Image.getSize(uri, (width, height) => resolve({ width, height }), reject));
  const resize = dimensions.width >= dimensions.height ? { width: 1600 } : { height: 1600 };
  const result = await ImageManipulator.manipulateAsync(uri, [{ resize }], { format: ImageManipulator.SaveFormat.JPEG, compress: 0.8 });
  const info = await FileSystem.getInfoAsync(result.uri);
  if (!info.exists || (info.size ?? 0) > 8 * 1024 * 1024) throw new Error("A foto ficou acima de 8 MB. Tente outra imagem.");
  return result.uri;
}

export default function ScannerScreen() {
  const camera = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraActive, setCameraActive] = useState(true);
  const [torch, setTorch] = useState(false);
  const [working, setWorking] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  useFocusEffect(useCallback(() => {
    setCameraActive(true);
    return () => setCameraActive(false);
  }, []));

  const refreshQueue = useCallback(async () => setPendingCount((await listPendingAnalyses()).length), []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- Queue state loads from AsyncStorage after mount.
  useEffect(() => { void refreshQueue(); }, [refreshQueue]);

  const setImage = async (uri: string) => {
    setWorking(true);
    try {
      const nextUri = await compressImage(uri);
      if (previewUri) await discardLocalImage(previewUri);
      setPreviewUri(nextUri);
    }
    catch (error: any) { Alert.alert("Não foi possível usar esta foto", error?.message ?? "Tente outra imagem."); }
    finally { setWorking(false); }
  };

  const takePicture = async () => {
    if (!camera.current || !cameraReady) return;
    setWorking(true);
    try {
      const photo = await camera.current.takePictureAsync({ quality: 0.92, exif: false });
      await setImage(photo.uri);
      await discardLocalImage(photo.uri);
    } catch (error: any) { Alert.alert("Câmera indisponível", error?.message ?? "Tente novamente."); }
    finally { setWorking(false); }
  };

  const choosePhoto = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: false, quality: 1 });
      if (!result.canceled && result.assets[0]?.uri) await setImage(result.assets[0].uri);
    } catch (error: any) { Alert.alert("Galeria indisponível", error?.message ?? "Verifique a permissão para suas fotos."); }
  };

  const analyzePhoto = async () => {
    if (!previewUri) return;
    const idempotencyKey = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setWorking(true);
    try {
      const network = await Network.getNetworkStateAsync();
      if (!network.isConnected || network.isInternetReachable === false) {
        await enqueueAnalysis(previewUri, idempotencyKey);
        await discardLocalImage(previewUri);
        setPreviewUri(null);
        await refreshQueue();
        Alert.alert("Foto salva no dispositivo", "O RADAR enviará a análise quando a conexão voltar.");
        return;
      }
      const response = await uploadAnalysis(previewUri, idempotencyKey);
      const analysis = response.data.analysis;
      let retryImageUri: string | undefined;
      if (analysis.status === "failed") retryImageUri = await persistRetryImage(previewUri, `retry-${analysis.id}`);
      await discardLocalImage(previewUri);
      setPreviewUri(null);
      router.push({ pathname: "/analysis/[id]", params: { id: analysis.id, retryImageUri } });
    } catch (error: any) {
      if (error instanceof ApiError && error.code === "NETWORK_ERROR") {
        await enqueueAnalysis(previewUri, idempotencyKey);
        await discardLocalImage(previewUri);
        setPreviewUri(null);
        await refreshQueue();
        Alert.alert("Sem conexão com o backend", "A fotografia ficou na fila local e será enviada quando a conexão voltar.");
      } else Alert.alert("A análise não foi enviada", error?.message ?? "Tente novamente.");
    } finally { setWorking(false); }
  };

  if (!permission) return <Screen><PageTitle title="Scanner" subtitle="Verificando permissão para acessar a câmera…" /></Screen>;
  if (!permission.granted) return <Screen>
    <PageTitle eyebrow="RADAR SCANNER" title="A câmera começa a busca" subtitle="Dê permissão para fotografar. Você também pode escolher uma imagem da galeria." />
    <Card><Text style={{ color: theme.colors.muted, lineHeight: 21 }}>O RADAR envia a foto ao backend para identificação. O backend mantém somente os dados da análise e descarta a foto temporária.</Text>
      <Button title="Permitir câmera" onPress={() => void requestPermission()} />
      <Button title="Escolher da galeria" variant="secondary" onPress={() => void choosePhoto()} />
    </Card>
  </Screen>;

  return <Screen contentStyle={{ gap: 16 }}>
    <PageTitle eyebrow="GARIMPO INTELIGENTE" title="Aponte. Investigue." subtitle="Fotografe o produto para descobrir se vale a revenda. A câmera só inicia nesta tela." right={pendingCount > 0 ? <Pill label={`${pendingCount} PENDENTE${pendingCount === 1 ? "" : "S"}`} tone="amber" /> : undefined} />

    <View style={{ height: 390, borderRadius: 24, overflow: "hidden", borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, position: "relative" }}>
      {previewUri ? <Image source={{ uri: previewUri }} resizeMode="cover" style={{ width: "100%", height: "100%" }} /> : <CameraView ref={camera} active={cameraActive} facing="back" enableTorch={torch} onCameraReady={() => setCameraReady(true)} style={{ flex: 1 }} />}
      {!previewUri ? <>
        <View pointerEvents="none" style={{ position: "absolute", top: "18%", bottom: "18%", left: "13%", right: "13%", borderColor: `${theme.colors.green}C0`, borderWidth: 1, borderRadius: 18 }} />
        <View pointerEvents="none" style={{ position: "absolute", top: 17, left: 16, backgroundColor: "#061008B8", borderRadius: 99, paddingHorizontal: 12, paddingVertical: 7 }}><Text style={{ color: theme.colors.text, fontSize: 11, fontWeight: "700" }}>ENQUADRE O PRODUTO</Text></View>
        <Pressable onPress={() => setTorch((value) => !value)} style={{ position: "absolute", top: 15, right: 15, backgroundColor: "#061008B8", padding: 11, borderRadius: 99 }}><Text style={{ color: torch ? theme.colors.green : theme.colors.text, fontSize: 16 }}>ϟ</Text></Pressable>
      </> : <View style={{ position: "absolute", left: 12, top: 12 }}><Pill label="PRÉVIA" /></View>}
    </View>

    {!previewUri ? <View style={{ flexDirection: "row", gap: 12 }}>
      <Button title="▧  Galeria" variant="secondary" onPress={() => void choosePhoto()} style={{ flex: 1 }} />
      <Button title="◉  Fotografar" onPress={() => void takePicture()} loading={working} disabled={!cameraReady} style={{ flex: 1.2 }} />
    </View> : <View style={{ flexDirection: "row", gap: 12 }}>
      <Button title="Refazer" variant="secondary" onPress={() => { void discardLocalImage(previewUri); setPreviewUri(null); }} style={{ flex: 1 }} />
      <Button title="Analisar produto" onPress={() => void analyzePhoto()} loading={working} style={{ flex: 1.5 }} />
    </View>}

    <Card style={{ gap: 9 }}>
      <Text style={{ color: theme.colors.text, fontWeight: "800", fontSize: 14 }}>Dicas para uma boa identificação</Text>
      <Text style={{ color: theme.colors.muted, fontSize: 13, lineHeight: 20 }}>Mostre o produto inteiro, aproxime a marca e a etiqueta. Fotografe defeitos visíveis. O funcionamento precisa ser confirmado por você.</Text>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}><Pill label="UMA FOTO" /><Pill label="ATÉ 8 MB" tone="muted" /><Pill label="JPEG · PNG · WEBP" tone="muted" /></View>
    </Card>
  </Screen>;
}

