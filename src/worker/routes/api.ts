import type { Context, Hono } from "hono";
import { PublicCopy } from "../copy";
import type { Env } from "../env";
import { HttpError, JsonRequest } from "../http";
import { JevClient } from "../jev/client";
import { LocalJevMock } from "../jev/mock";
import type { JevAnswer, JevQuestion } from "../jev/types";
import { Chaos } from "../policy/chaos";
import { Cult } from "../policy/cult";
import { Sandwich } from "../policy/sandwich";
import { Runtime } from "../runtime";
import { SpendClient } from "../spend/client";
import { SpendPolicy } from "../spend/policy";

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
    return ApiRoutes.ask(c, { group }, Cult.questions, (answers, latencyMs) => Cult.result(group, answers, latencyMs));
  }

  static async chaosRoute(c: AppContext): Promise<Response> {
    const body = await JsonRequest.object(c.req.raw);
    const message = JsonRequest.boundedString(body, "message", 1000).trim();
    return ApiRoutes.ask(c, { message }, Chaos.questions, (answers, latencyMs) => Chaos.result(message, answers, latencyMs));
  }

  private static async ask<T>(
    c: AppContext,
    state: unknown,
    questions: Record<string, JevQuestion>,
    present: (answers: Record<string, JevAnswer>, latencyMs: number) => T,
  ): Promise<Response> {
    if (Runtime.useMock(c.env, c.req.raw)) {
      c.header("x-jev-source", LocalJevMock.source);
      const started = Date.now();
      return c.json(present(LocalJevMock.respond(state, questions).answers, Date.now() - started));
    }

    const apiKey = c.env.TYPESAFE_API_KEY?.trim() ?? "";
    if (!apiKey) throw new HttpError(503, PublicCopy.switchedOff);

    const budgetUsd = SpendPolicy.budgetUsd(c.env.JEV_DAILY_BUDGET_USD);
    const ipLimit = SpendPolicy.ipLimit(c.env.JEV_IP_CALLS_PER_HOUR);
    if (budgetUsd === null || ipLimit === null) throw new HttpError(503, PublicCopy.unavailable);

    await SpendClient.gate(c.env, {
      budgetUsd,
      ipLimit,
      ip: SpendPolicy.clientIp(c.req.header("cf-connecting-ip")),
      now: Date.now(),
    });

    const started = Date.now();
    let result;
    try {
      result = await JevClient.systemOne({ fetchImpl: fetch, apiKey, state, questions });
    } catch (error) {
      await SpendClient.release(c.env);
      const message = error instanceof Error ? error.message : String(error);
      throw new HttpError(502, `Jev request failed: ${message}`);
    }

    await SpendClient.record(c.env, {
      usd: SpendPolicy.estimatedUsd(result.usage.input_tokens, result.usage.output_tokens),
      now: Date.now(),
    });

    try {
      return c.json(present(result.answers, Date.now() - started));
    } catch (error) {
      if (error instanceof HttpError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new HttpError(502, `Jev request failed: ${message}`);
    }
  }
}
