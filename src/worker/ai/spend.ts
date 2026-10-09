import type { RateKv } from "../auth/rate-limit";
import { HttpError } from "../http";

/**
 * No official TypeSafe price is published in this repo.
 * These rates are an assumption, set high on purpose so the shared cap
 * trips before real spend reaches AI_DAILY_BUDGET_USD. Robert can tighten the cap.
 *
 * $15 per 1,000,000 input tokens and $60 per 1,000,000 output tokens.
 */
export const ASSUMED_INPUT_USD_PER_MILLION = 15;
export const ASSUMED_OUTPUT_USD_PER_MILLION = 60;
export const DEFAULT_DAILY_BUDGET_USD = 5;
export const RESTING_MESSAGE = "AI is resting for today.";

export function estimatedUsd(inputTokens: number, outputTokens: number): number {
  const input = Math.max(0, finite(inputTokens)) * ASSUMED_INPUT_USD_PER_MILLION / 1_000_000;
  const output = Math.max(0, finite(outputTokens)) * ASSUMED_OUTPUT_USD_PER_MILLION / 1_000_000;
  return round6(input + output);
}

export function utcDay(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Refuses the call when today's shared spend is already at the cap. Applies with the gate on or off. */
export async function assertDailyBudget(kv: RateKv, budgetUsd: number, now = Date.now()): Promise<void> {
  const spent = await readSpend(kv, now);
  if (spent >= budgetUsd) throw new HttpError(429, RESTING_MESSAGE, "ai_daily_budget");
}

/** Adds this call's estimated dollars to the global UTC-day ledger. */
export async function recordDailySpend(
  kv: RateKv,
  input: { inputTokens: number; outputTokens: number; now?: number },
): Promise<number> {
  const now = input.now ?? Date.now();
  const day = utcDay(now);
  const spent = await readSpend(kv, now);
  const next = round6(spent + estimatedUsd(input.inputTokens, input.outputTokens));
  await writeSpend(kv, day, next, now);
  return next;
}

/** Status read. A ledger that cannot be read is reported as resting so the UI does not offer a broken action. */
export async function dailyBudgetView(
  kv: RateKv,
  budgetUsd: number,
  now = Date.now(),
): Promise<{ resting: boolean; spentUsd: number; budgetUsd: number }> {
  try {
    const spentUsd = await readSpend(kv, now);
    return { resting: spentUsd >= budgetUsd, spentUsd, budgetUsd };
  } catch (error) {
    if (error instanceof HttpError && error.kind === "ai_budget_unavailable") {
      return { resting: true, spentUsd: budgetUsd, budgetUsd };
    }
    throw error;
  }
}

async function readSpend(kv: RateKv, now: number): Promise<number> {
  const day = utcDay(now);
  let raw: string | null;
  try {
    raw = await kv.get(spendKey(day));
  } catch {
    throw new HttpError(503, RESTING_MESSAGE, "ai_budget_unavailable");
  }
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw) as { usd?: unknown };
    if (typeof parsed.usd !== "number" || !Number.isFinite(parsed.usd) || parsed.usd < 0) {
      throw new Error("bad ledger");
    }
    return parsed.usd;
  } catch {
    throw new HttpError(503, RESTING_MESSAGE, "ai_budget_unavailable");
  }
}

async function writeSpend(kv: RateKv, day: string, usd: number, now: number): Promise<void> {
  const end = Date.parse(`${day}T00:00:00.000Z`) + 2 * 24 * 60 * 60 * 1000;
  const ttl = Math.max(60, Math.ceil((end - now) / 1000));
  try {
    await kv.put(spendKey(day), JSON.stringify({ usd, day }), { expirationTtl: ttl });
  } catch {
    throw new HttpError(503, RESTING_MESSAGE, "ai_budget_unavailable");
  }
}

function spendKey(day: string): string {
  return `ai:spend:${day}`;
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
