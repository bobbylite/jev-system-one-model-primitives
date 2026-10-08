import type { Context, Hono } from "hono";
import type { Env } from "../env";
import { HttpError, JsonRequest } from "../http";
import { JevClient } from "../jev/client";
import { LocalJevMock } from "../jev/mock";
import type { JevAnswer, JevQuestion } from "../jev/types";
import { Chaos } from "../policy/chaos";
import { Cult } from "../policy/cult";
import { Sandwich } from "../policy/sandwich";

type App = Hono<{ Bindings: Env }>;
type AppContext = Context<{ Bindings: Env }>;

/**
 * All `/api` routes live on one router so issue #2 can mount session
 * middleware in front of them (`api.use("*", ...)`) without moving paths.
 * Config reads can stay open by exempting them inside that middleware,
 * the way estimator-demo's `aiGateCovers` skips `/api/ai/status`.
 */
export class ApiRoutes {
  static mount(api: App): void {
    api.get("/config", (c) => c.json(Sandwich.config()));
    api.post("/classify", (c) => ApiRoutes.classify(c));
    api.get("/cult/config", (c) => c.json(Cult.config()));
    api.post("/cult/score", (c) => ApiRoutes.cultScore(c));
    api.get("/chaos/config", (c) => c.json(Chaos.config()));
    api.post("/chaos/route", (c) => ApiRoutes.chaosRoute(c));
  }

  static async classify(c: AppContext): Promise<Response> {
    const body = await JsonRequest.object(c.req.raw);
    const food = JsonRequest.boundedString(body, "food", 80).trim();
    ApiRoutes.markMock(c);
    return ApiRoutes.ask(c, { food }, Sandwich.questions, (answers, latencyMs) => {
      const probabilities = Sandwich.probabilities(answers);
      return {
        food,
        latency_ms: latencyMs,
        signals: Sandwich.signals(probabilities),
        ...Sandwich.explain(probabilities),
      };
    });
  }

  static async cultScore(c: AppContext): Promise<Response> {
    const body = await JsonRequest.object(c.req.raw);
    const group = JsonRequest.boundedString(body, "group", 80).trim();
    ApiRoutes.markMock(c);
    return ApiRoutes.ask(c, { group }, Cult.questions, (answers, latencyMs) => Cult.result(group, answers, latencyMs));
  }

  static async chaosRoute(c: AppContext): Promise<Response> {
    const body = await JsonRequest.object(c.req.raw);
    const message = JsonRequest.boundedString(body, "message", 1000).trim();
    ApiRoutes.markMock(c);
    return ApiRoutes.ask(c, { message }, Chaos.questions, (answers, latencyMs) => Chaos.result(message, answers, latencyMs));
  }

  private static markMock(c: AppContext): void {
    if (c.env.JEV_MOCK === "true") c.header("x-jev-source", LocalJevMock.source);
  }

  private static async ask<T>(
    c: AppContext,
    state: unknown,
    questions: Record<string, JevQuestion>,
    present: (answers: Record<string, JevAnswer>, latencyMs: number) => T,
  ): Promise<Response> {
    const start = Date.now();
    try {
      const result = await JevClient.evaluate({
        env: c.env,
        fetchImpl: fetch,
        state,
        questions,
      });
      return c.json(present(result.answers, Date.now() - start));
    } catch (error) {
      if (error instanceof HttpError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new HttpError(502, `Jev request failed: ${message}`);
    }
  }
}
