import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import * as Network from "expo-network";
import { retryIdentification, uploadAnalysis } from "../../services/api/client";

const QUEUE_KEY = "radar.pendingAnalyses";
const MAX_QUEUE_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const RETRY_IMAGE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const retryDirectory = () => FileSystem.cacheDirectory ? `${FileSystem.cacheDirectory}radar-retry/` : null;
export type PendingAnalysis = { id: string; uri: string; createdAt: string };

async function readQueue(): Promise<PendingAnalysis[]> {
  try { return JSON.parse((await AsyncStorage.getItem(QUEUE_KEY)) ?? "[]") as PendingAnalysis[]; }
  catch { return []; }
}

async function pruneExpired(queue: PendingAnalysis[]) {
  const active: PendingAnalysis[] = [];
  let expired = 0;
  for (const item of queue) {
    if (!Number.isFinite(new Date(item.createdAt).getTime()) || Date.now() - new Date(item.createdAt).getTime() > MAX_QUEUE_AGE_MS) {
      await FileSystem.deleteAsync(item.uri, { idempotent: true }).catch(() => undefined);
      expired += 1;
    } else active.push(item);
  }
  if (expired) await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(active));
  return { queue: active, expired };
}

export async function listPendingAnalyses(): Promise<PendingAnalysis[]> {
  const { queue } = await pruneExpired(await readQueue());
  return queue;
}

export async function enqueueAnalysis(uri: string, id = `${Date.now()}-${Math.random().toString(36).slice(2)}`) {
  if (!FileSystem.documentDirectory) throw new Error("Armazenamento local indisponível.");
  const directory = `${FileSystem.documentDirectory}pending/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const safeId = id.replace(/[^a-zA-Z0-9-]/g, "");
  const safeUri = `${directory}${safeId}.jpg`;
  const current = await listPendingAnalyses();
  if (current.some((item) => item.id === id)) return id;
  await FileSystem.copyAsync({ from: uri, to: safeUri });
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify([...current, { id, uri: safeUri, createdAt: new Date().toISOString() }]));
  return id;
}

export async function persistRetryImage(uri: string, id: string) {
  const directory = retryDirectory();
  if (!directory) throw new Error("Armazenamento temporário local indisponível.");
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const path = `${directory}${id.replace(/[^a-zA-Z0-9-]/g, "")}.jpg`;
  await FileSystem.copyAsync({ from: uri, to: path }).catch(async () => {
    await FileSystem.deleteAsync(path, { idempotent: true });
    await FileSystem.copyAsync({ from: uri, to: path });
  });
  return path;
}

export async function cleanupExpiredRetryImages(now = Date.now()) {
  const directory = retryDirectory();
  if (!directory) return 0;
  let removed = 0;
  try {
    for (const name of await FileSystem.readDirectoryAsync(directory)) {
      const uri = `${directory}${name}`;
      const info = await FileSystem.getInfoAsync(uri);
      if (info.exists && info.modificationTime && now - info.modificationTime * 1000 > RETRY_IMAGE_MAX_AGE_MS) {
        await FileSystem.deleteAsync(uri, { idempotent: true });
        removed += 1;
      }
    }
  } catch { /* A missing or unavailable cache directory needs no cleanup. */ }
  return removed;
}

export async function discardLocalImage(uri?: string | null) {
  const roots = [FileSystem.documentDirectory, FileSystem.cacheDirectory].filter((root): root is string => Boolean(root));
  if (uri && roots.some((root) => uri.startsWith(root))) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
}

export async function removePendingAnalysis(id: string) {
  const queue = await listPendingAnalyses();
  const item = queue.find((entry) => entry.id === id);
  if (item) await FileSystem.deleteAsync(item.uri, { idempotent: true });
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue.filter((entry) => entry.id !== id)));
}

export async function syncPendingAnalyses() {
  const pruned = await pruneExpired(await readQueue());
  const state = await Network.getNetworkStateAsync();
  if (!state.isConnected || state.isInternetReachable === false) return { synced: 0, remaining: pruned.queue.length, expired: pruned.expired };
  const queue = pruned.queue;
  const remaining: PendingAnalysis[] = [];
  let synced = 0;
  let expired = pruned.expired;
  for (const item of queue) {
    if (Date.now() - new Date(item.createdAt).getTime() > MAX_QUEUE_AGE_MS) {
      await FileSystem.deleteAsync(item.uri, { idempotent: true }).catch(() => undefined);
      expired += 1;
      continue;
    }
    try {
      const info = await FileSystem.getInfoAsync(item.uri);
      if (!info.exists) { expired += 1; continue; }
      const uploaded = await uploadAnalysis(item.uri, item.id);
      if (uploaded.data.analysis.status === "failed") await retryIdentification(uploaded.data.analysis.id, item.uri);
      synced += 1;
      await FileSystem.deleteAsync(item.uri, { idempotent: true });
    } catch { remaining.push(item); }
  }
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
  return { synced, remaining: remaining.length, expired };
}

