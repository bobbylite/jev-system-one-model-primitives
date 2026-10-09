import type { RateKv } from "../auth/rate-limit";
import { HttpError } from "../http";

interface Bucket {
  amount: number;
  resetAt: number;
}

export interface AiBudget {
  callsUsed: number;
  callsRemaining: number;
  tokensUsed: number;
  tokensRemaining: number;
}

const CALL_WINDOW_SECONDS = 60 * 60;
const TOKEN_WINDOW_SECONDS = 60 * 60 * 24;

export async function readAiBudget(
  kv: RateKv,
  userId: string,
  limits: { callsPerHour: number; tokensPerDay: number },
  now = Date.now(),
): Promise<AiBudget> {
  const calls = await readBucket(kv, callKey(userId), now);
  const tokens = await readBucket(kv, tokenKey(userId), now);
  return {
    callsUsed: calls,
    callsRemaining: Math.max(0, limits.callsPerHour - calls),
    tokensUsed: tokens,
    tokensRemaining: Math.max(0, limits.tokensPerDay - tokens),
  };
}

/**
 * Counts one AI call and, when `tokens` is above zero, adds that usage.
 * Rejects before writing when the hour or the day is already exhausted.
 */
export async function consumeAiBudget(
  kv: RateKv,
  input: {
    userId: string;
    callsPerHour: number;
    tokensPerDay: number;
    tokens?: number;
    now?: number;
  },
): Promise<AiBudget> {
  const now = input.now ?? Date.now();
  const tokens = input.tokens ?? 0;
  const callState = await loadBucket(kv, callKey(input.userId), now, CALL_WINDOW_SECONDS);
  const tokenState = await loadBucket(kv, tokenKey(input.userId), now, TOKEN_WINDOW_SECONDS);
  if (callState.amount >= input.callsPerHour) {
    throw new HttpError(
      429,
      "This account has used its AI calls for the hour. Try again later.",
      "ai_call_limit",
    );
  }
  if (tokenState.amount >= input.tokensPerDay || (tokens > 0 && tokenState.amount + tokens > input.tokensPerDay)) {
    throw new HttpError(
      429,
      "This account has used its AI token budget for the day.",
      "ai_token_limit",
    );
  }
  const nextCalls = await writeBucket(kv, callKey(input.userId), callState, 1, now, CALL_WINDOW_SECONDS);
  const nextTokens =
    tokens > 0
      ? await writeBucket(kv, tokenKey(input.userId), tokenState, tokens, now, TOKEN_WINDOW_SECONDS)
      : tokenState.amount;
  return {
    callsUsed: nextCalls,
    callsRemaining: Math.max(0, input.callsPerHour - nextCalls),
    tokensUsed: nextTokens,
    tokensRemaining: Math.max(0, input.tokensPerDay - nextTokens),
  };
}

/**
 * Adds provider usage after a call that was already counted.
 * Clamps at the daily cap so a completed answer is not discarded.
 */
export async function recordAiTokens(
  kv: RateKv,
  input: { userId: string; tokens: number; tokensPerDay: number; now?: number },
): Promise<number> {
  if (input.tokens <= 0) return 0;
  const now = input.now ?? Date.now();
  const state = await loadBucket(kv, tokenKey(input.userId), now, TOKEN_WINDOW_SECONDS);
  const room = Math.max(0, input.tokensPerDay - state.amount);
  const added = Math.min(input.tokens, room);
  if (added <= 0) return state.amount;
  return writeBucket(kv, tokenKey(input.userId), state, added, now, TOKEN_WINDOW_SECONDS);
}

function callKey(userId: string): string {
  return `ai:calls:${safeUser(userId)}`;
}

function tokenKey(userId: string): string {
  return `ai:tokens:${safeUser(userId)}`;
}

function safeUser(userId: string): string {
  return userId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "unknown";
}

async function readBucket(kv: RateKv, key: string, now: number): Promise<number> {
  const state = await loadBucket(kv, key, now, CALL_WINDOW_SECONDS);
  return state.amount;
}

async function loadBucket(kv: RateKv, key: string, now: number, windowSeconds: number): Promise<Bucket> {
  const raw = await kv.get(key);
  if (!raw) return { amount: 0, resetAt: now + windowSeconds * 1000 };
  try {
    const parsed = JSON.parse(raw) as Partial<Bucket>;
    if (typeof parsed.amount === "number" && typeof parsed.resetAt === "number" && parsed.resetAt > now) {
      return { amount: parsed.amount, resetAt: parsed.resetAt };
    }
  } catch {
    return { amount: 0, resetAt: now + windowSeconds * 1000 };
  }
  return { amount: 0, resetAt: now + windowSeconds * 1000 };
}

async function writeBucket(
  kv: RateKv,
  key: string,
  state: Bucket,
  amount: number,
  now: number,
  windowSeconds: number,
): Promise<number> {
  const fresh = state.resetAt <= now;
  const next = {
    amount: (fresh ? 0 : state.amount) + amount,
    resetAt: fresh ? now + windowSeconds * 1000 : state.resetAt,
  };
  const ttl = Math.max(60, Math.ceil((next.resetAt - now) / 1000));
  await kv.put(key, JSON.stringify(next), { expirationTtl: ttl });
  return next.amount;
}
