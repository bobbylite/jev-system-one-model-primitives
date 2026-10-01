/** Wire types. These mirror the Pydantic models in app.py. */

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

export async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...(body === undefined
      ? {}
      : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) {
    const detail = await res.json().then((j: { detail?: unknown }) => j.detail, () => undefined);
    throw new Error(typeof detail === "string" ? detail : res.statusText);
  }
  return res.json() as Promise<T>;
}
