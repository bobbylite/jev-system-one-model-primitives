import { HttpError } from "../http";

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateKv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<unknown>;
}

/** Fixed-window counter in KV. Enough for a public demo on the Workers free plan. */
export async function consumeRateLimit(
  kv: RateKv,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const now = Date.now();
  const raw = await kv.get(bucket);
  let state: Bucket | undefined;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<Bucket>;
      if (typeof parsed.count === "number" && typeof parsed.resetAt === "number") {
        state = { count: parsed.count, resetAt: parsed.resetAt };
      }
    } catch {
      state = undefined;
    }
  }
  if (!state || state.resetAt <= now) {
    await kv.put(bucket, JSON.stringify({ count: 1, resetAt: now + windowSeconds * 1000 }), {
      expirationTtl: Math.max(60, windowSeconds),
    });
    return;
  }
  if (state.count >= limit) {
    throw new HttpError(429, "Too many attempts from this network. Wait a few minutes and try again.", "rate_limited");
  }
  const ttl = Math.max(60, Math.ceil((state.resetAt - now) / 1000));
  await kv.put(bucket, JSON.stringify({ count: state.count + 1, resetAt: state.resetAt }), { expirationTtl: ttl });
}

export function clientAddress(header: (name: string) => string | undefined): string {
  const connecting = header("cf-connecting-ip")?.trim();
  if (connecting) return sanitizeAddress(connecting);
  const forwarded = header("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return sanitizeAddress(forwarded);
  return "local";
}

function sanitizeAddress(value: string): string {
  return value.replace(/[^a-zA-Z0-9.:]/g, "").slice(0, 80) || "unknown";
}
