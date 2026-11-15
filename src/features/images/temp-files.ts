import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";

const LEGACY_QUEUE_KEY = "radar.pendingAnalyses";

export async function discardLocalImage(uri?: string | null) {
  const roots = [FileSystem.documentDirectory, FileSystem.cacheDirectory].filter((root): root is string => Boolean(root));
  if (uri && roots.some((root) => uri.startsWith(root))) {
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
  }
}

/** Remove image files and queue metadata created by older builds that retained photos offline. */
export async function cleanupLegacyImageQueue() {
  const directories = [
    FileSystem.documentDirectory ? `${FileSystem.documentDirectory}pending/` : null,
    FileSystem.cacheDirectory ? `${FileSystem.cacheDirectory}radar-retry/` : null,
  ].filter((directory): directory is string => Boolean(directory));
  await Promise.all(directories.map((directory) => FileSystem.deleteAsync(directory, { idempotent: true }).catch(() => undefined)));
  await AsyncStorage.removeItem(LEGACY_QUEUE_KEY).catch(() => undefined);
}
