import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import type { AnalysisResult, Settings } from "../../types/api";

const configuredBase = process.env.EXPO_PUBLIC_API_URL ?? Constants.expoConfig?.extra?.apiUrl;
export const API_BASE_URL = (configuredBase || "https://radar-backend-utwm.onrender.com/api/v1").replace(/\/$/, "");
const TOKEN_KEY = "radar.accessToken";

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

export async function saveToken(token: string) { await SecureStore.setItemAsync(TOKEN_KEY, token); }
export async function readToken() { return SecureStore.getItemAsync(TOKEN_KEY); }
export async function clearToken() { await SecureStore.deleteItemAsync(TOKEN_KEY); }

export async function apiRequest<T>(path: string, options: RequestInit = {}, authenticated = true): Promise<T> {
  const token = authenticated ? await readToken() : null;
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  let response: Response;
  try { response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers }); }
  catch { throw new ApiError("Não foi possível conectar ao RADAR. Verifique sua internet.", 0, "NETWORK_ERROR"); }
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(payload?.error?.message ?? `Falha na solicitação (${response.status}).`, response.status, payload?.error?.code);
  return payload as T;
}

export async function login(email: string, password: string) {
  const result = await apiRequest<{ data: { token: string; user: User } }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }, false);
  await saveToken(result.data.token);
  return result.data.user;
}

export async function register(name: string, email: string, password: string) {
  const result = await apiRequest<{ data: { token: string; user: User } }>("/auth/register", { method: "POST", body: JSON.stringify({ name, email, password }) }, false);
  await saveToken(result.data.token);
  return result.data.user;
}

export type User = { id: string; name: string; email: string };

export async function uploadAnalysis(uri: string, clientRequestId: string, askingPriceCents?: number) {
  const form = new FormData();
  form.append("image", { uri, name: "radar-product.jpg", type: "image/jpeg" } as any);
  if (askingPriceCents !== undefined) form.append("askingPriceCents", String(askingPriceCents));
  return apiRequest<{ data: { analysis: AnalysisResult["analysis"]; product: AnalysisResult["product"] }; idempotentReplay?: boolean }>("/analyses", {
    method: "POST", body: form, headers: { "Idempotency-Key": clientRequestId },
  });
}

export const retryIdentification = (id: string, uri: string) => {
  const form = new FormData();
  form.append("image", { uri, name: "radar-product.jpg", type: "image/jpeg" } as any);
  return apiRequest<{ data: { analysis: AnalysisResult["analysis"]; product: AnalysisResult["product"] } }>(`/analyses/${id}/identify`, { method: "POST", body: form });
};
export const fetchAnalysis = (id: string) => apiRequest<{ data: AnalysisResult }>(`/analyses/${id}`);
export const confirmIdentification = (id: string, body: Record<string, unknown>) => apiRequest<{ data: unknown }>(`/analyses/${id}/confirm-identification`, { method: "POST", body: JSON.stringify(body) });
export const researchAnalysis = (id: string) => apiRequest<{ data: AnalysisResult; partial?: boolean }>(`/analyses/${id}/research`, { method: "POST", body: JSON.stringify({}) });
export const recalculateAnalysis = (id: string, body: Record<string, unknown>) => apiRequest<{ data: AnalysisResult }>(`/analyses/${id}/recalculate`, { method: "POST", body: JSON.stringify(body) });
export const deleteAnalysis = (id: string) => apiRequest<void>(`/analyses/${id}`, { method: "DELETE" });
export const fetchHistory = (page = 1) => apiRequest<{ data: any[]; pagination: { page: number; pages: number; total: number } }>(`/analyses?page=${page}&limit=20`);
export const fetchOpportunities = () => apiRequest<{ data: any[]; pagination: any }>("/opportunities?limit=50");
export const createOpportunity = (analysisId: string) => apiRequest<{ data: { id: string; status: string } }>(`/analyses/${analysisId}/opportunity`, { method: "POST", body: JSON.stringify({}) });
export const updateOpportunityStatus = (id: string, status: string) => apiRequest(`/opportunities/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
export const purchaseOpportunity = (id: string, body: Record<string, unknown>) => apiRequest(`/opportunities/${id}/purchase`, { method: "POST", body: JSON.stringify(body) });
export const sellOpportunity = (id: string, body: Record<string, unknown>) => apiRequest(`/opportunities/${id}/sale`, { method: "POST", body: JSON.stringify(body) });
export const fetchSettings = () => apiRequest<{ data: Settings }>("/settings");
export const saveSettings = (settings: Settings) => apiRequest<{ data: Settings }>("/settings", { method: "PUT", body: JSON.stringify(settings) });
export async function logoutRequest() { try { await apiRequest("/auth/logout", { method: "POST" }); } finally { await clearToken(); } }

