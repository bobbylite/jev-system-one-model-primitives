import { getCsrf } from "./auth/csrf";

/** Wire types. These mirror the JSON the Worker returns. */

export interface Signal {
  id: string;
  instructions: string;
  true_criterion: string | null;
  false_criterion: string | null;
  probability: number;
}

export interface SandwichPolicy {
  structural_weight: number;
  name_weight: number;
  sandwich_at: number;
  not_sandwich_at: number;
}

export interface SandwichConfig {
  examples: string[];
  policy: SandwichPolicy;
}

export type SandwichLabel = "SANDWICH" | "NOT A SANDWICH" | "CONTESTED";

export interface SandwichVerdict {
  food: string;
  label: SandwichLabel;
  score: number;
  structural: number;
  pieces_factor: number;
  latency_ms: number;
  signals: Signal[];
}

export interface Level {
  level: number;
  description: string;
  probability: number;
}

export interface Dimension {
  id: string;
  instructions: string;
  score: number;
  max_level: number;
  confidence: number;
  levels: Level[];
}

export interface CultConfig {
  examples: string[];
  weights: Record<string, number>;
  tiers: { max: number; label: string }[];
}

export interface CultResult {
  group: string;
  dimensions: Dimension[];
  overall: Dimension;
  latency_ms: number;
}

export interface Option {
  id: string;
  label: string;
  description: string;
  probability: number;
}

export interface ChaosConfig {
  examples: string[];
  confidence_at: number;
  urgency_weight: number;
  anger_weight: number;
  priority_cuts: [number, number];
  urgency_legend: string[];
  queues: { id: string; label: string; description: string }[];
  questions: Record<string, string>;
}

export interface ChaosResult {
  message: string;
  options: Option[];
  choice: string;
  confidence: number;
  angry: number;
  urgency: number;
  urgency_max: number;
  latency_ms: number;
}

export class ApiError extends Error {
  readonly status: number;
  readonly kind?: string;

  constructor(status: number, message: string, kind?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    if (kind !== undefined) this.kind = kind;
  }
}

export async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const headers = new Headers();
  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
    const csrf = getCsrf();
    if (csrf) headers.set("X-CSRF-Token", csrf);
  }
  const res = await fetch(`/api${path}`, {
    credentials: "same-origin",
    headers,
    ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) {
    const payload = await res.json().then((value: { detail?: unknown; error?: unknown; kind?: unknown }) => value, () => undefined);
    const detail = typeof payload?.detail === "string" ? payload.detail : typeof payload?.error === "string" ? payload.error : res.statusText;
    const kind = typeof payload?.kind === "string" ? payload.kind : undefined;
    throw new ApiError(res.status, detail, kind);
  }
  return res.json() as Promise<T>;
}
