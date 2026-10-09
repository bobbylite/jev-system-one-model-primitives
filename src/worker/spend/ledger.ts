import type { Env } from "../env";
import { SpendTables, type GateResult } from "./tables";

/**
 * SQLite Durable Object. The migration in wrangler.jsonc creates it on deploy,
 * so CI does not need a pre-created KV or D1 id.
 */
export class SpendLedger {
  private readonly sql: DurableObjectStorage["sql"];

  constructor(ctx: DurableObjectState, env: Env) {
    void env;
    this.sql = ctx.storage.sql;
    void ctx.blockConcurrencyWhile(async () => {
      SpendTables.ensure(ctx.storage.sql);
    });
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const path = new URL(request.url).pathname;
      const body = await request.json() as unknown;
      if (path === "/gate") return Response.json(SpendTables.gate(this.sql, SpendLedger.gateInput(body)));
      if (path === "/record") {
        const input = SpendLedger.moneyInput(body);
        return Response.json({ spentUsd: SpendTables.record(this.sql, input.usd, input.now) });
      }
      if (path === "/release") {
        SpendTables.release(this.sql, SpendLedger.moneyInput(body).now);
        return Response.json({ ok: true });
      }
      return Response.json({ detail: "not found" }, { status: 404 });
    } catch (error) {
      console.error(error);
      return Response.json({ detail: "ledger" }, { status: 503 });
    }
  }

  private static gateInput(body: unknown): { budgetUsd: number; ipLimit: number; ip: string; now: number } {
    const record = SpendLedger.object(body);
    const budgetUsd = SpendLedger.finite(record.budgetUsd, "budgetUsd");
    const ipLimit = SpendLedger.finite(record.ipLimit, "ipLimit");
    const now = SpendLedger.finite(record.now, "now");
    const ip = typeof record.ip === "string" && record.ip ? record.ip : "unknown";
    return { budgetUsd, ipLimit, ip, now };
  }

  private static moneyInput(body: unknown): { usd: number; now: number } {
    const record = SpendLedger.object(body);
    return {
      usd: record.usd === undefined ? 0 : SpendLedger.finite(record.usd, "usd"),
      now: SpendLedger.finite(record.now, "now"),
    };
  }

  private static object(body: unknown): Record<string, unknown> {
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("bad ledger body");
    return body as Record<string, unknown>;
  }

  private static finite(value: unknown, name: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`bad ${name}`);
    return value;
  }
}

export type { GateResult };
