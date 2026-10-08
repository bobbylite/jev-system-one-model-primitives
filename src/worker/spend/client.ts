import { PublicCopy } from "../copy";
import type { Env } from "../env";
import { HttpError } from "../http";
import type { GateReason } from "./tables";

/** Talks to the single SpendLedger object. Any failure fails closed. */
export class SpendClient {
  private constructor() {}

  static async gate(env: Env, input: {
    budgetUsd: number;
    ipLimit: number;
    ip: string;
    now: number;
  }): Promise<void> {
    const body = await SpendClient.post(env, "/gate", input);
    if (body.allowed === true) return;
    const reason = body.reason;
    if (reason === "rate") throw new HttpError(429, PublicCopy.rateLimit);
    if (reason === "cap") throw new HttpError(503, PublicCopy.resting);
    if (reason === "busy") throw new HttpError(503, PublicCopy.busy);
    throw new HttpError(503, PublicCopy.unavailable);
  }

  static async record(env: Env, input: { usd: number; now: number }): Promise<void> {
    const body = await SpendClient.post(env, "/record", input);
    if (typeof body.spentUsd !== "number" || !Number.isFinite(body.spentUsd)) {
      throw new HttpError(503, PublicCopy.unavailable);
    }
  }

  /** Best effort. A failed release leaves the reservation in place, which closes the day. */
  static async release(env: Env, now = Date.now()): Promise<void> {
    try {
      await SpendClient.post(env, "/release", { now });
    } catch {
      // Fail closed for later calls: the hold stays at the cap.
    }
  }

  private static async post(env: Env, path: string, body: unknown): Promise<Record<string, unknown>> {
    const namespace = env.SPEND;
    if (!namespace) throw new HttpError(503, PublicCopy.unavailable);
    let response: Response;
    try {
      const stub = namespace.get(namespace.idFromName("global"));
      response = await stub.fetch(`https://spend.internal${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      throw new HttpError(503, PublicCopy.unavailable);
    }
    if (!response.ok) throw new HttpError(503, PublicCopy.unavailable);
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new HttpError(503, PublicCopy.unavailable);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new HttpError(503, PublicCopy.unavailable);
    }
    return parsed as Record<string, unknown> & { allowed?: boolean; reason?: GateReason; spentUsd?: number };
  }
}
