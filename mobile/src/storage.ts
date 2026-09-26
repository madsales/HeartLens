import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Analysis, AnalyzeInput } from "./api";

const KEYS = {
  serverUrl: "heartlens.serverUrl",
  draft: "heartlens.draft",
  history: "heartlens.history",
};

export interface HistoryEntry {
  id: string;
  createdAt: number;
  model: string;
  input: AnalyzeInput;
  result: Analysis;
}

const HISTORY_LIMIT = 30;

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

async function writeJson(key: string, value: unknown) {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage is a convenience; never let it break the flow.
  }
}

export const getServerUrl = () => AsyncStorage.getItem(KEYS.serverUrl).catch(() => null);
export const setServerUrl = (url: string) =>
  url ? AsyncStorage.setItem(KEYS.serverUrl, url) : AsyncStorage.removeItem(KEYS.serverUrl);

export const getDraft = () => readJson<AnalyzeInput>(KEYS.draft);
export const setDraft = (draft: AnalyzeInput) => writeJson(KEYS.draft, draft);
export const clearDraft = () => AsyncStorage.removeItem(KEYS.draft).catch(() => {});

export const getHistory = async () => (await readJson<HistoryEntry[]>(KEYS.history)) ?? [];

export async function addToHistory(entry: Omit<HistoryEntry, "id" | "createdAt">): Promise<HistoryEntry> {
  const full: HistoryEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    ...entry,
  };
  const history = await getHistory();
  await writeJson(KEYS.history, [full, ...history].slice(0, HISTORY_LIMIT));
  return full;
}

export async function getHistoryEntry(id: string) {
  return (await getHistory()).find((e) => e.id === id) ?? null;
}

export async function removeHistoryEntry(id: string) {
  const history = await getHistory();
  await writeJson(KEYS.history, history.filter((e) => e.id !== id));
}

export const clearHistory = () => AsyncStorage.removeItem(KEYS.history).catch(() => {});
