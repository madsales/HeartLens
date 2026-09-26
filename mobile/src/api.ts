import Constants from "expo-constants";
import { Platform } from "react-native";

export type Confidence = "low" | "medium" | "high";
export type EngagementLevel = "cold" | "lukewarm" | "warm" | "hot" | "unclear";

// Shape of lib/analyze.js's AnalysisSchema on the server.
export interface Analysis {
  summary: string;
  interests: { label: string; evidence: string; confidence: Confidence }[];
  communication_style: { description: string; traits: string[]; match_tips: string[] };
  engagement: { level: EngagementLevel; signals: string[] };
  opener_angles: { angle: string; why_it_fits: string; example: string }[];
  avoid: string[];
  caution: string[];
  confidence_note: string;
}

export interface AnalyzeInput {
  profile: string;
  conversation: string;
  about: string;
}

export interface AnalyzeResponse {
  result: Analysis;
  model: string;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Where the HeartLens server lives when the user hasn't set one.
 * In development, Expo tells us the dev machine's host, and the Node server
 * usually runs there on port 3000. Production builds set EXPO_PUBLIC_API_URL.
 */
export function defaultServerUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    const host = hostUri.split(":")[0];
    return `http://${host}:3000`;
  }
  // Android emulators reach the host machine at 10.0.2.2.
  return Platform.OS === "android" ? "http://10.0.2.2:3000" : "http://localhost:3000";
}

export async function analyze(serverUrl: string, input: AnalyzeInput): Promise<AnalyzeResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  let res: Response;
  try {
    res = await fetch(`${serverUrl.replace(/\/+$/, "")}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new ApiError("The analysis took too long. Try with less text.", 0);
    }
    throw new ApiError("Couldn't reach the HeartLens server. Check the server URL in Settings.", 0);
  } finally {
    clearTimeout(timer);
  }

  let data: { ok?: boolean; error?: string; result?: Analysis; model?: string } = {};
  try {
    data = await res.json();
  } catch {
    throw new ApiError(`The server sent an unexpected response (${res.status}).`, res.status);
  }
  if (!res.ok || !data.ok || !data.result) {
    throw new ApiError(data.error || `Request failed (${res.status}).`, res.status);
  }
  return { result: data.result, model: data.model ?? "unknown" };
}
