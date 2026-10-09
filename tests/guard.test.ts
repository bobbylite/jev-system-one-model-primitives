import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../src/worker/index";
import { PublicCopy } from "../src/worker/copy";
import type { Env } from "../src/worker/env";
import { Runtime } from "../src/worker/runtime";
import { SpendPolicy } from "../src/worker/spend/policy";
import { attachMember } from "./account";
import { ScriptedSpend } from "./fake-spend";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jevBody(usage = { input_tokens: 1_000_000, output_tokens: 0 }) {
  const answers: Record<string, unknown> = {};
  for (const id of ["bread", "filling", "two_pieces", "handheld", "sandwich_by_name"]) {
    answers[id] = { type: "noul", noul: 0.99 };
  }
  return { model: "jev-1.13.0", answers, usage };
}

async function post(path: string, body: unknown, env: Env, init: RequestInit = {}) {
  const account = await attachMember(env);
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  headers.set("cookie", account.cookie);
  headers.set("x-csrf-token", account.csrf);
  return app.request(path, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }, env);
}

describe("missing key", () => {
  it("returns 503 on every Jev POST and does not call Jev", async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    const paths = ["/api/classify", "/api/cult/score", "/api/chaos/route"];
    const bodies = [{ food: "BLT" }, { group: "CrossFit" }, { message: "hello" }];
    for (let i = 0; i < paths.length; i++) {
      const response = await post(paths[i]!, bodies[i], { JEV_MOCK: "true", JEV_DAILY_BUDGET_USD: "2" }, {
        headers: { "content-type": "application/json", "cf-ray": "edge" },
      });
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ detail: PublicCopy.switchedOff });
      expect(response.headers.get("x-jev-source")).toBeNull();
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    const config = await app.request("/api/config", {}, {});
    expect(config.status).toBe(200);
    const cult = await app.request("/api/cult/config", {}, {});
    expect(cult.status).toBe(200);
    const chaos = await app.request("/api/chaos/config", {}, {});
    expect(chaos.status).toBe(200);
  });

  it("still mocks locally when JEV_MOCK is set and the request is not from the edge", async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    const response = await post("/api/classify", { food: "BLT" }, { JEV_MOCK: "true" });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-jev-source")).toBe("local-mock");
    expect(fetchImpl).not.toHaveBeenCalled();
    const request = new Request("https://jev-primitives.bobbylite.workers.dev/api/classify");
    expect(Runtime.useMock({ JEV_MOCK: "true" }, request)).toBe(true);
    expect(Runtime.usePingMock({ PINGONE_MOCK: "true" }, request)).toBe(true);
    request.headers.set("cf-ray", "abc-SJC");
    expect(Runtime.useMock({ JEV_MOCK: "true" }, request)).toBe(false);
    expect(Runtime.usePingMock({ PINGONE_MOCK: "true" }, request)).toBe(false);
  });

  it("does not turn PingOne mock on for an edge request", async () => {
    const env = {
      PINGONE_MOCK: "true",
      PINGONE_ENV_ID: "c74a4945-1364-4966-9a68-abeaa3e7b767",
      PINGONE_CLIENT_ID: "55833d59-268f-4355-a46c-030fdf10c206",
    };
    const config = await app.request("/api/auth/config", { headers: { "cf-ray": "abc-SJC" } }, env);
    expect(await config.json()).toEqual({ mock: false, hints: null });
    const start = await app.request("/api/auth/login/start", {
      method: "POST",
      headers: { "cf-ray": "abc-SJC" },
    }, env);
    expect(start.status).toBe(503);
    const body = await start.json() as { detail?: string; step?: string };
    expect(body.step).toBeUndefined();
    expect(body.detail).toMatch(/PingOne is not configured/);
    const local = await app.request("/api/auth/config", {}, { PINGONE_MOCK: "true" });
    expect(await local.json()).toMatchObject({ mock: true, hints: { username: "robert@meridian.test" } });
    const wrangler = new Request("http://127.0.0.1:8787/api/auth/config");
    (wrangler as Request & { cf?: unknown }).cf = { colo: "PDX", clientAcceptEncoding: "" };
    expect(Runtime.usePingMock({ PINGONE_MOCK: "true" }, wrangler)).toBe(true);
    const edged = new Request("https://jev-primitives.bobbylite.workers.dev/api/auth/config");
    (edged as Request & { cf?: unknown }).cf = { colo: "SJC" };
    edged.headers.set("cf-ray", "abc-SJC");
    expect(Runtime.usePingMock({ PINGONE_MOCK: "true" }, edged)).toBe(false);
    expect(Runtime.useMock({ JEV_MOCK: "true" }, edged)).toBe(false);
  });
});

describe("daily cap", () => {
  it("calls Jev when the ledger is under the cap and records the estimated cost", async () => {
    const spend = new ScriptedSpend();
    const fetchImpl = vi.fn(async () => Response.json(jevBody()));
    vi.stubGlobal("fetch", fetchImpl);
    const response = await post("/api/classify", { food: "BLT" }, {
      TYPESAFE_API_KEY: "secret",
      JEV_DAILY_BUDGET_USD: "2",
      SPEND: spend.binding(),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { label: string };
    expect(body.label).toBe("SANDWICH");
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(spend.recordedUsd).toBe(SpendPolicy.estimatedUsd(1_000_000, 0));
    expect(spend.recordedUsd).toBe(15);
  });

  it("returns 503 at the cap and does not call Jev", async () => {
    for (const spentUsd of [2, 2.5]) {
      const spend = new ScriptedSpend();
      spend.gateBody = { allowed: false, reason: "cap", spentUsd };
      const fetchImpl = vi.fn();
      vi.stubGlobal("fetch", fetchImpl);
      const response = await post("/api/classify", { food: "BLT" }, {
        TYPESAFE_API_KEY: "secret",
        JEV_DAILY_BUDGET_USD: "2",
        SPEND: spend.binding(),
      });
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ detail: PublicCopy.resting });
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(spend.recordedUsd).toBeUndefined();
    }
  });

  it("fails closed when the counter cannot be read or written", async () => {
    const unread = new ScriptedSpend();
    unread.gateError = new Error("storage down");
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    const blocked = await post("/api/classify", { food: "BLT" }, {
      TYPESAFE_API_KEY: "secret",
      SPEND: unread.binding(),
    });
    expect(blocked.status).toBe(503);
    expect(await blocked.json()).toEqual({ detail: PublicCopy.unavailable });
    expect(fetchImpl).not.toHaveBeenCalled();

    const missing = await post("/api/cult/score", { group: "CrossFit" }, { TYPESAFE_API_KEY: "secret" });
    expect(missing.status).toBe(503);
    expect(await missing.json()).toEqual({ detail: PublicCopy.unavailable });

    const unwritten = new ScriptedSpend();
    unwritten.recordStatus = 503;
    fetchImpl.mockImplementation(async () => Response.json(jevBody({ input_tokens: 10, output_tokens: 1 })));
    const wrote = await post("/api/chaos/route", { message: "hello there" }, {
      TYPESAFE_API_KEY: "secret",
      SPEND: unwritten.binding(),
    });
    expect(wrote.status).toBe(503);
    expect(await wrote.json()).toEqual({ detail: PublicCopy.unavailable });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("fails closed when the budget var is not a number", async () => {
    const spend = new ScriptedSpend();
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    const response = await post("/api/classify", { food: "BLT" }, {
      TYPESAFE_API_KEY: "secret",
      JEV_DAILY_BUDGET_USD: "nope",
      SPEND: spend.binding(),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ detail: PublicCopy.unavailable });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("releases the reservation when Jev itself fails", async () => {
    const spend = new ScriptedSpend();
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }));
    const response = await post("/api/classify", { food: "BLT" }, {
      TYPESAFE_API_KEY: "secret",
      SPEND: spend.binding(),
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ detail: "Jev request failed: network down" });
    expect(spend.released).toBe(true);
    expect(spend.recordedUsd).toBeUndefined();
  });
});
