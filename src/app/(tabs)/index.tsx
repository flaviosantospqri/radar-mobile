import { router } from "expo-router";
import { useCameraPermissions } from "expo-camera";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, Image, Linking, Platform, Text, View } from "react-native";
import { Button, Card, PageTitle, Pill, Screen } from "../../components/ui";
import { theme } from "../../constants/theme";
import { ApiError, uploadAnalysis } from "../../services/api/client";
import { discardLocalImage } from "../../features/images/temp-files";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

async function compressImage(uri: string, assetWidth?: number, assetHeight?: number) {
  let width = assetWidth;
  let height = assetHeight;
  if (!width || !height) {
    try {
      const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) =>
        Image.getSize(uri, (imageWidth, imageHeight) => resolve({ width: imageWidth, height: imageHeight }), reject)
      );
      width = dimensions.width;
      height = dimensions.height;
    } catch {
      // Keep the original dimensions if Android returns a content URI Image.getSize cannot resolve.
    }
  }

  const resize = width && height
    ? (width >= height ? { width: 1600 } : { height: 1600 })
    : undefined;
  const result = await ImageManipulator.manipulateAsync(
    uri,
    resize ? [{ resize }] : [],
    { format: ImageManipulator.SaveFormat.JPEG, compress: 0.82 }
  );
  const info = await FileSystem.getInfoAsync(result.uri);
  if (!info.exists || (info.size !== undefined && info.size > MAX_IMAGE_BYTES)) {
    await discardLocalImage(result.uri);
    throw new Error("A foto precisa ficar abaixo de 8 MB. Tente uma imagem menor.");
  }
  return result.uri;
}

export default function ScannerScreen() {
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [working, setWorking] = useState(false);
  const [permissionWorking, setPermissionWorking] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const pendingResultChecked = useRef(false);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void getPermission();
    });
    return () => subscription.remove();
  }, [getPermission]);

  const setImage = useCallback(async (uri: string, width?: number, height?: number) => {
    setWorking(true);
    try {
      const nextUri = await compressImage(uri, width, height);
      if (previewUri && previewUri !== uri) await discardLocalImage(previewUri);
      setPreviewUri(nextUri);
    } catch (error: any) {
      Alert.alert("Não foi possível abrir esta foto", error?.message ?? "Escolha outra imagem e tente novamente.");
    } finally {
      setWorking(false);
    }
  }, [previewUri]);

  const acceptPickerResult = useCallback(async (result: ImagePicker.ImagePickerResult) => {
    if (result.canceled) return;
    const asset = result.assets?.[0];
    if (!asset?.uri) {
      Alert.alert("Foto indisponível", "O Android não retornou a imagem. Tente selecionar outra.");
      return;
    }
    await setImage(asset.uri, asset.width, asset.height);
  }, [setImage]);

  useEffect(() => {
    if (Platform.OS !== "android" || pendingResultChecked.current) return;
    pendingResultChecked.current = true;
    let mounted = true;
    void ImagePicker.getPendingResultAsync().then(async (result) => {
      if (!mounted || !result) return;
      if ("code" in result) {
        Alert.alert("Não foi possível recuperar a seleção", result.message || "Abra a galeria e escolha a foto novamente.");
        return;
      }
      await acceptPickerResult(result);
    }).catch((error: any) => {
      if (mounted) Alert.alert("Galeria indisponível", error?.message ?? "Tente selecionar a imagem novamente.");
    });
    return () => { mounted = false; };
  }, [acceptPickerResult]);

  const choosePhoto = async () => {
    if (working || permissionWorking) return;
    setWorking(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: false, quality: 1 });
      await acceptPickerResult(result);
    } catch (error: any) {
      Alert.alert("Galeria indisponível", error?.message ?? "Tente selecionar a imagem novamente.");
    } finally {
      setWorking(false);
    }
  };

  const openSettings = async () => {
    try { await Linking.openSettings(); }
    catch { Alert.alert("Configurações indisponíveis", "Abra as configurações do Android e permita o acesso à câmera para o RADAR."); }
  };

  const openCamera = async () => {
    if (!permission || working || permissionWorking) return;
    setPermissionWorking(true);
    try {
      let access = permission;
      if (!access.granted && !access.canAskAgain) {
        await openSettings();
        return;
      }
      if (!access.granted) access = await requestPermission();
      if (!access.granted) {
        Alert.alert("Permissão necessária", access.canAskAgain
          ? "Permita o acesso à câmera para fotografar o produto. A galeria continua disponível."
          : "Abra as configurações do RADAR e permita o acesso à câmera.", access.canAskAgain ? undefined : [
            { text: "Agora não", style: "cancel" },
            { text: "Abrir configurações", onPress: () => { void openSettings(); } },
          ]);
        return;
      }

      setWorking(true);
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], allowsEditing: false, quality: 1, exif: false });
      await acceptPickerResult(result);
    } catch (error: any) {
      Alert.alert("Câmera indisponível", error?.message ?? "Não foi possível abrir a câmera deste aparelho.");
    } finally {
      setPermissionWorking(false);
      setWorking(false);
    }
  };

  const analyzePhoto = async () => {
    if (!previewUri || working) return;
    const idempotencyKey = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setWorking(true);
    try {
      const response = await uploadAnalysis(previewUri, idempotencyKey);
      const analysis = response.data.analysis;
      if (analysis.status === "failed") {
        router.push({ pathname: "/analysis/[id]", params: { id: analysis.id, retryImageUri: previewUri } });
        setPreviewUri(null);
        return;
      }
      await discardLocalImage(previewUri);
      setPreviewUri(null);
      router.push({ pathname: "/analysis/[id]", params: { id: analysis.id } });
    } catch (error: any) {
      if (error instanceof ApiError && error.code === "NETWORK_ERROR") {
        Alert.alert("Sem conexão com o backend", "Conecte-se à internet e toque em “Analisar produto” novamente. A foto continua apenas nesta prévia temporária.");
      } else {
        Alert.alert("A análise não foi enviada", error?.message ?? "Confira sua conexão e tente novamente.");
      }
    } finally {
      setWorking(false);
    }
  };

  const cameraTitle = !permission
    ? "Verificando câmera…"
    : permission.granted
      ? "Fotografar produto"
      : permission.canAskAgain
        ? "Permitir e fotografar"
        : "Abrir configurações";

  return <Screen contentStyle={{ gap: 16 }}>
    <PageTitle
      eyebrow="GARIMPO INTELIGENTE"
      title={previewUri ? "Confira a foto" : "Fotografe ou selecione"}
      subtitle={previewUri
        ? "A imagem será enviada ao backend para identificar o produto."
        : "Use a câmera do celular ou escolha uma foto para descobrir se o produto vale a revenda."}
    />

    <View style={{ height: 300, borderRadius: 24, overflow: "hidden", borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, alignItems: "center", justifyContent: "center" }}>
      {previewUri ? <>
        <Image source={{ uri: previewUri }} resizeMode="cover" style={{ width: "100%", height: "100%" }} />
        <View style={{ position: "absolute", left: 12, top: 12 }}><Pill label="PRÉVIA TEMPORÁRIA" /></View>
      </> : <View style={{ alignItems: "center", gap: 12, padding: 24 }}>
        <Text style={{ color: theme.colors.green, fontSize: 64 }}>⌖</Text>
        <Text style={{ color: theme.colors.text, fontSize: 17, fontWeight: "800", textAlign: "center" }}>Sua próxima oportunidade começa com uma foto</Text>
        <Text style={{ color: theme.colors.muted, lineHeight: 21, textAlign: "center" }}>As imagens são usadas somente durante a análise e não ficam no histórico.</Text>
      </View>}
    </View>

    {!previewUri ? <>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <Button title="▧  Galeria" variant="secondary" onPress={() => void choosePhoto()} loading={working} style={{ flex: 1 }} />
        <Button title={`◉  ${cameraTitle}`} onPress={() => void openCamera()} loading={permissionWorking || working} disabled={!permission} style={{ flex: 1.35 }} />
      </View>
      {!permission?.granted ? <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 18, textAlign: "center" }}>
        {permission?.canAskAgain === false
          ? "A câmera está bloqueada nas permissões do Android. Você ainda pode escolher uma foto da galeria."
          : "Ao tocar em “Permitir e fotografar”, o RADAR solicita a permissão e abre a câmera do aparelho."}
      </Text> : null}
    </> : <View style={{ flexDirection: "row", gap: 12 }}>
      <Button title="Escolher outra foto" variant="secondary" onPress={() => { void discardLocalImage(previewUri); setPreviewUri(null); }} style={{ flex: 1 }} />
      <Button title="Analisar produto" onPress={() => void analyzePhoto()} loading={working} style={{ flex: 1.25 }} />
    </View>}

    <Card style={{ gap: 9 }}>
      <Text style={{ color: theme.colors.text, fontWeight: "800", fontSize: 14 }}>O que acontece depois</Text>
      <Text style={{ color: theme.colors.muted, fontSize: 13, lineHeight: 20 }}>O backend identifica o produto com IA e consulta referências de mercado. Você confirma a identificação antes de ver estimativa de revenda, lucro e recomendação.</Text>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}><Pill label="ATÉ 8 MB" tone="muted" /><Pill label="JPEG · PNG · WEBP" tone="muted" /><Pill label="SEM FOTO NO HISTÓRICO" /></View>
    </Card>
  </Screen>;
}
