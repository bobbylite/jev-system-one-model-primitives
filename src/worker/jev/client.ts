import type { Env } from "../env";
import { LocalJevMock } from "./mock";
import type { JevQuestion, SystemOneResult } from "./types";

/**
 * Direct call to the TypeSafe HTTP API, same shape as estimator-demo.
 * The official JS SDK would retry and pull extra code into a 10 ms Worker.
 */
export class JevClient {
  static readonly endpoint = "https://api.typesafe.ai/v1/systemone";
  static readonly model = "jev-latest";

  static async evaluate(input: {
    env: Env;
    fetchImpl: typeof fetch;
    state: unknown;
    questions: Record<string, JevQuestion>;
  }): Promise<SystemOneResult> {
    if (input.env.JEV_MOCK === "true") return LocalJevMock.respond(input.state, input.questions);
    const apiKey = input.env.TYPESAFE_API_KEY?.trim();
    if (!apiKey) throw new Error("TYPESAFE_API_KEY is not set");
    return JevClient.systemOne({
      fetchImpl: input.fetchImpl,
      apiKey,
      state: input.state,
      questions: input.questions,
    });
  }

  static async systemOne(input: {
    fetchImpl: typeof fetch;
    apiKey: string;
    state: unknown;
    questions: Record<string, JevQuestion>;
  }): Promise<SystemOneResult> {
    // workerd throws 'Illegal invocation' if fetch is called with the wrong `this`.
    const fetchImpl = input.fetchImpl.bind(globalThis);
    let response: Response;
    try {
      response = await fetchImpl(JevClient.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.apiKey}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          model: JevClient.model,
          state: input.state,
          questions: input.questions,
        }),
      });
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : String(error));
    }
    const text = await response.text();
    let json: unknown;
    try {
      json = text ? (JSON.parse(text) as unknown) : null;
    } catch {
      json = null;
    }
    if (!response.ok || !json || typeof json !== "object" || Array.isArray(json)) {
      const snippet = text ? `: ${text.slice(0, 300)}` : "";
      throw new Error(`HTTP ${response.status}${snippet}`);
    }
    const record = json as Record<string, unknown>;
    const answers = record.answers;
    if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
      throw new Error("Jev response did not include answers");
    }
    const usage = record.usage;
    const usageRecord = usage && typeof usage === "object" ? (usage as Record<string, unknown>) : {};
    return {
      model: typeof record.model === "string" ? record.model : JevClient.model,
      answers: answers as SystemOneResult["answers"],
      usage: {
        input_tokens: JevClient.tokens(usageRecord.input_tokens),
        output_tokens: JevClient.tokens(usageRecord.output_tokens),
      },
    };
  }

  private static tokens(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  }
}
