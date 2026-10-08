import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../src/worker/index";
import type { Env } from "../src/worker/env";
import { JevClient } from "../src/worker/jev/client";

const mockEnv: Env = { JEV_MOCK: "true" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function post(path: string, body: unknown, env: Env = mockEnv, init: RequestInit = {}) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    ...init,
  }, env);
}

describe("config endpoints", () => {
  it("GET /api/config omits probabilities and keeps policy numbers", async () => {
    const response = await app.request("/api/config", {}, mockEnv);
    expect(response.status).toBe(200);
    const body = await response.json() as {
      examples: string[];
      policy: { structural_weight: number; name_weight: number; sandwich_at: number; not_sandwich_at: number };
      questions: { id: string; instructions: string; true_criterion: string | null; false_criterion: string | null; probability?: number }[];
    };
    expect(body.examples[0]).toBe("BLT");
    expect(body.policy).toEqual({
      structural_weight: 0.6,
      name_weight: 0.4,
      sandwich_at: 0.65,
      not_sandwich_at: 0.35,
    });
    expect(body.questions.map((question) => question.id)).toEqual([
      "bread", "filling", "two_pieces", "handheld", "sandwich_by_name",
    ]);
    expect(body.questions[0]?.true_criterion).toMatch(/sliced bread/);
    expect(body.questions[1]?.true_criterion).toBeNull();
    expect(body.questions[1]?.false_criterion).toBeNull();
    expect(body.questions.every((question) => question.probability === undefined)).toBe(true);
  });

  it("GET /api/cult/config and /api/chaos/config match the UI contract", async () => {
    const cult = await (await app.request("/api/cult/config", {}, mockEnv)).json() as {
      weights: Record<string, number>;
      tiers: { max: number; label: string }[];
      dimensions: { id: string; instructions: string }[];
    };
    expect(cult.weights.exit_cost).toBe(1.4);
    expect(cult.tiers[4]).toEqual({ max: 1.01, label: "Full cult" });
    expect(cult.dimensions).toHaveLength(6);
    expect(cult.dimensions.some((dimension) => dimension.id === "overall")).toBe(false);

    const chaos = await (await app.request("/api/chaos/config", {}, mockEnv)).json() as {
      confidence_at: number;
      priority_cuts: number[];
      urgency_legend: string[];
      queues: { id: string; label: string; description: string }[];
      questions: Record<string, string>;
    };
    expect(chaos.confidence_at).toBe(0.7);
    expect(chaos.priority_cuts).toEqual([0.6, 0.3]);
    expect(chaos.urgency_legend).toHaveLength(4);
    expect(chaos.queues[5]).toMatchObject({ id: "exorcist", label: "Needs an exorcist" });
    expect(chaos.questions.angry).toMatch(/angry or hostile/);
  });
});

describe("POST endpoints", () => {
  it("classifies a sandwich with the Python verdict shape", async () => {
    const response = await post("/api/classify", { food: "  BLT  ", ignored: true });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-jev-source")).toBe("local-mock");
    const body = await response.json() as {
      food: string;
      label: string;
      score: number;
      structural: number;
      pieces_factor: number;
      latency_ms: number;
      signals: { id: string; probability: number; true_criterion: string | null }[];
    };
    expect(body.food).toBe("BLT");
    expect(body.label).toBe("SANDWICH");
    expect(body.score).toBeGreaterThan(0.65);
    expect(body.structural).toBeGreaterThan(0);
    expect(body.pieces_factor).toBeGreaterThan(0.5);
    expect(body.latency_ms).toBeGreaterThanOrEqual(0);
    expect(body.signals.map((signal) => signal.id)).toEqual([
      "bread", "filling", "two_pieces", "handheld", "sandwich_by_name",
    ]);
    expect(body.signals[0]?.probability).toBe(0.99);
  });

  it("returns cult dimensions and a separate overall score", async () => {
    const response = await post("/api/cult/score", { group: "CrossFit" });
    const body = await response.json() as {
      group: string;
      dimensions: { id: string; max_level: number; levels: { level: number; probability: number; description: string }[]; score: number; confidence: number }[];
      overall: { id: string; max_level: number; levels: unknown[] };
      latency_ms: number;
    };
    expect(response.status).toBe(200);
    expect(body.group).toBe("CrossFit");
    expect(body.dimensions).toHaveLength(6);
    expect(body.dimensions[0]?.id).toBe("devotion");
    expect(body.dimensions[0]?.max_level).toBe(3);
    expect(body.dimensions[0]?.levels).toHaveLength(4);
    expect(body.dimensions[0]?.confidence).toBe(0.86);
    expect(body.overall.id).toBe("overall");
    expect(body.overall.max_level).toBe(4);
    expect(body.overall.levels).toHaveLength(5);
  });

  it("routes chaos and sorts options by probability", async () => {
    const response = await post("/api/chaos/route", {
      message: "My smart toaster has started whispering my passwords at 3am.",
    });
    const body = await response.json() as {
      message: string;
      choice: string;
      confidence: number;
      angry: number;
      urgency: number;
      urgency_max: number;
      options: { id: string; probability: number; label: string; description: string }[];
    };
    expect(body.choice).toBe("exorcist");
    expect(body.confidence).toBe(0.91);
    expect(body.angry).toBe(0.42);
    expect(body.urgency_max).toBe(3);
    expect(body.options[0]?.id).toBe("exorcist");
    expect(body.options).toHaveLength(8);
    const probabilities = body.options.map((option) => option.probability);
    expect([...probabilities].sort((a, b) => b - a)).toEqual(probabilities);
  });

  it("rejects invalid input with 422 and a string detail", async () => {
    const cases: [string, unknown][] = [
      ["/api/classify", {}],
      ["/api/classify", { food: "" }],
      ["/api/classify", { food: "x".repeat(81) }],
      ["/api/classify", { food: 1 }],
      ["/api/cult/score", { group: "" }],
      ["/api/cult/score", { group: "y".repeat(81) }],
      ["/api/chaos/route", { message: "" }],
      ["/api/chaos/route", { message: "z".repeat(1001) }],
    ];
    for (const [path, body] of cases) {
      const response = await post(path, body);
      expect(response.status).toBe(422);
      const payload = await response.json() as { detail?: unknown };
      expect(typeof payload.detail).toBe("string");
    }
    const invalid = await app.request("/api/classify", { method: "POST", body: "not-json" }, mockEnv);
    expect(invalid.status).toBe(422);
    const arrayBody = await app.request("/api/classify", { method: "POST", body: "[]" }, mockEnv);
    expect(arrayBody.status).toBe(422);
    const atLimit = await post("/api/classify", { food: "x".repeat(80) });
    expect(atLimit.status).toBe(200);
  });

  it("allows a whitespace-only value through, then strips it, as Pydantic did", async () => {
    const response = await post("/api/classify", { food: " " });
    expect(response.status).toBe(200);
    const body = await response.json() as { food: string };
    expect(body.food).toBe("");
  });
});

describe("Jev failures", () => {
  it("returns 502 with the Python message prefix when the key is missing", async () => {
    const response = await post("/api/classify", { food: "BLT" }, {});
    expect(response.status).toBe(502);
    const body = await response.json() as { detail: string };
    expect(body.detail).toBe("Jev request failed: TYPESAFE_API_KEY is not set");
    expect(response.headers.get("x-jev-source")).toBeNull();
  });

  it("returns 502 when the HTTP call fails and does not call Jev in mock mode", async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    const mocked = await post("/api/classify", { food: "BLT" }, mockEnv);
    expect(mocked.status).toBe(200);
    expect(fetchImpl).not.toHaveBeenCalled();

    fetchImpl.mockRejectedValue(new Error("network down"));
    const failed = await post("/api/classify", { food: "BLT" }, { TYPESAFE_API_KEY: "secret" });
    expect(failed.status).toBe(502);
    const body = await failed.json() as { detail: string };
    expect(body.detail).toBe("Jev request failed: network down");
  });

  it("returns 502 when Jev answers are the wrong shape", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      model: "jev-1.13.0",
      answers: { bread: { type: "choice", choice: "no", probabilities: {}, confidence: 0.2 } },
      usage: { input_tokens: 1, output_tokens: 1 },
    }), { status: 200, headers: { "content-type": "application/json" } })));
    const response = await post("/api/classify", { food: "BLT" }, { TYPESAFE_API_KEY: "secret" });
    expect(response.status).toBe(502);
    const body = await response.json() as { detail: string };
    expect(body.detail).toMatch(/^Jev request failed: Missing noul answer/);
  });

  it("returns 404 with detail for an unknown API path", async () => {
    const response = await app.request("/api/missing", {}, mockEnv);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ detail: "Not found" });
  });
});

describe("JevClient", () => {
  it("binds fetch to globalThis and posts the System One body", async () => {
    let receiver: unknown;
    const fetchImpl = vi.fn(function (this: unknown, url: string, init?: RequestInit) {
      receiver = this;
      expect(url).toBe("https://api.typesafe.ai/v1/systemone");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer secret");
      const payload = JSON.parse(String(init?.body)) as { model: string; state: { food: string }; questions: Record<string, { type: string }> };
      expect(payload.model).toBe("jev-latest");
      expect(payload.state).toEqual({ food: "BLT" });
      expect(payload.questions.bread?.type).toBe("noul");
      return Promise.resolve(new Response(JSON.stringify({
        model: "jev-1.13.0",
        answers: {
          bread: { type: "noul", noul: 0.5 },
        },
        usage: { input_tokens: 10, output_tokens: 2 },
      })));
    });
    const result = await JevClient.systemOne({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiKey: "secret",
      state: { food: "BLT" },
      questions: { bread: { type: "noul", instructions: "Does `food` contain bread?" } },
    });
    expect(receiver).toBe(globalThis);
    expect(result.model).toBe("jev-1.13.0");
    expect(result.usage).toEqual({ input_tokens: 10, output_tokens: 2 });
    expect(result.answers.bread).toEqual({ type: "noul", noul: 0.5 });
  });

  it("surfaces a non-2xx body in the error", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 401 }));
    await expect(JevClient.systemOne({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiKey: "secret",
      state: {},
      questions: {},
    })).rejects.toThrow("HTTP 401: nope");
  });
});
