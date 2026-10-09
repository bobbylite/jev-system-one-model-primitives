import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../src/worker/index";
import { PublicCopy } from "../src/worker/copy";
import type { Env } from "../src/worker/env";
import { MemoryKv, attachMember, authHeaders, type SignedIn } from "./account";
import { ScriptedSpend } from "./fake-spend";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

class TracingKv extends MemoryKv {
  constructor(readonly events: string[]) {
    super();
  }

  override binding(): NonNullable<Env["SESSIONS"]> {
    const bound = super.binding();
    const put = bound.put.bind(bound);
    bound.put = (async (key: string, value: string, options?: { expirationTtl?: number }) => {
      this.events.push(`kv:${key}`);
      return put(key, value, options);
    }) as typeof bound.put;
    return bound;
  }
}

function jevBody() {
  const answers: Record<string, unknown> = {};
  for (const id of ["bread", "filling", "two_pieces", "handheld", "sandwich_by_name"]) {
    answers[id] = { type: "noul", noul: 0.99 };
  }
  return { model: "jev-1.13.0", answers, usage: { input_tokens: 20, output_tokens: 4 } };
}

function rateKeys(kv: MemoryKv): string[] {
  return kv.keys().filter((key) => key.startsWith("ai:") || key.startsWith("rate:"));
}

async function classify(account: SignedIn, extra?: HeadersInit) {
  return app.request("/api/classify", {
    method: "POST",
    headers: authHeaders(account, { "content-type": "application/json", ...Object.fromEntries(new Headers(extra).entries()) }),
    body: JSON.stringify({ food: "BLT" }),
  }, account.env);
}

describe("gate order", () => {
  it("rejects signed-out, non-member, and expired sessions before the spend ledger or rate counters", async () => {
    const spend = new ScriptedSpend();
    const kv = new MemoryKv();
    const env: Env = {
      TYPESAFE_API_KEY: "secret",
      JEV_DAILY_BUDGET_USD: "2",
      SPEND: spend.binding(),
      SESSIONS: kv.binding(),
      PINGONE_MOCK: "true",
      AI_PILOT_GATE_ENABLED: "true",
      AI_PILOT_GROUP: "jev-pilot-program",
    };

    const anonymous = await app.request("/api/classify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ food: "BLT" }),
    }, env);
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toMatchObject({ detail: "Sign in to continue." });
    expect(spend.requests).toEqual([]);
    expect(rateKeys(kv)).toEqual([]);

    const account = await attachMember(env, kv);
    const outsider = await app.request("/api/auth/pilot", {
      method: "POST",
      headers: authHeaders(account, { "content-type": "application/json" }),
      body: JSON.stringify({ member: false }),
    }, env);
    expect(outsider.status).toBe(200);
    spend.requests.length = 0;
    const blocked = await classify(account);
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toMatchObject({ detail: "You're not in the Jev pilot.", kind: "pilot_required" });
    expect(spend.requests).toEqual([]);
    expect(rateKeys(kv)).toEqual([]);

    const member = await attachMember({
      ...env,
      SPEND: spend.binding(),
    }, new MemoryKv());
    const id = member.cookie.slice("meridian_session=".length);
    const stored = member.kv.store.get(`session:${id}`);
    expect(stored).toBeTruthy();
    const session = JSON.parse(stored ?? "{}") as { refreshToken?: string; accessExpiresAt: number };
    delete session.refreshToken;
    session.accessExpiresAt = Date.now() - 1_000;
    member.kv.store.set(`session:${id}`, JSON.stringify(session));
    const expired = await classify(member);
    expect(expired.status).toBe(401);
    expect(await expired.json()).toMatchObject({
      detail: "Sign in again to keep using Jev.",
      kind: "reauth_required",
    });
    expect(spend.requests).toEqual([]);
    expect(rateKeys(member.kv)).toEqual([]);
  });

  it("checks the daily cap before per-user and per-IP limits, then calls Jev", async () => {
    const events: string[] = [];
    const kv = new TracingKv(events);
    const spend = new ScriptedSpend();
    const binding = spend.binding();
    const get = binding.get.bind(binding);
    binding.get = ((id: DurableObjectId) => {
      const stub = get(id);
      const inner = stub.fetch.bind(stub);
      return {
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          const request = new Request(input, init);
          events.push(`spend:${new URL(request.url).pathname}`);
          return inner(input, init);
        },
      };
    }) as typeof binding.get;
    const env: Env = {
      TYPESAFE_API_KEY: "secret",
      JEV_DAILY_BUDGET_USD: "2",
      JEV_IP_CALLS_PER_HOUR: "30",
      AI_USER_CALLS_PER_HOUR: "30",
      AI_PILOT_GATE_ENABLED: "true",
      AI_PILOT_GROUP: "jev-pilot-program",
      SPEND: binding,
    };
    const account = await attachMember(env, kv);
    events.length = 0;

    kv.store.set("ai:calls:user-robert", JSON.stringify({ amount: 30, resetAt: Date.now() + 3_600_000 }));
    spend.gateBody = { allowed: false, reason: "cap", spentUsd: 2 };
    const capped = await classify(account);
    expect(capped.status).toBe(503);
    expect(await capped.json()).toEqual({ detail: PublicCopy.resting });
    expect(events).toEqual(["spend:/gate"]);
    expect(events.join(" ")).not.toContain("kv:ai:");

    events.length = 0;
    spend.gateBody = { allowed: false, reason: "rate", spentUsd: 0 };
    const rated = await classify(account);
    expect(rated.status).toBe(429);
    expect(await rated.json()).toEqual({ detail: PublicCopy.rateLimit });
    expect(events).toEqual(["spend:/gate"]);

    events.length = 0;
    spend.gateBody = { allowed: true, spentUsd: 0 };
    const limited = await classify(account);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ kind: "ai_call_limit" });
    expect(events).toEqual(["spend:/gate", "spend:/release"]);

    events.length = 0;
    kv.store.delete("ai:calls:user-robert");
    const fetchImpl = vi.fn(async () => {
      events.push("jev");
      return Response.json(jevBody());
    });
    vi.stubGlobal("fetch", fetchImpl);
    const allowed = await classify(account);
    expect(allowed.status).toBe(200);
    const body = await allowed.json() as { label: string; food: string };
    expect(body).toMatchObject({ food: "BLT", label: "SANDWICH" });
    expect(events).toEqual([
      "spend:/gate",
      "kv:ai:calls:user-robert",
      "jev",
      "spend:/record",
      "kv:ai:tokens:user-robert",
    ]);
  });

  it("lets a pilot member through mock mode without touching the spend ledger", async () => {
    const spend = new ScriptedSpend();
    const account = await attachMember({
      JEV_MOCK: "true",
      AI_PILOT_GATE_ENABLED: "true",
      AI_PILOT_GROUP: "jev-pilot-program",
      SPEND: spend.binding(),
    });
    const response = await classify(account);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-jev-source")).toBe("local-mock");
    const body = await response.json() as { label: string; signals: unknown[] };
    expect(body.label).toBe("SANDWICH");
    expect(body.signals).toHaveLength(5);
    expect(spend.requests).toEqual([]);
  });

  it("keeps the three config reads public", async () => {
    for (const path of ["/api/config", "/api/cult/config", "/api/chaos/config"]) {
      const response = await app.request(path, {}, {});
      expect(response.status).toBe(200);
    }
  });
});
