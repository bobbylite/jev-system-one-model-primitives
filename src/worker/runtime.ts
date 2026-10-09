import type { Env } from "./env";

/**
 * `JEV_MOCK=true` is an explicit local opt-in (.dev.vars, wrangler dev).
 * It is ignored on the edge: Cloudflare sets `cf-ray` and `request.cf`
 * before the Worker runs, and a client cannot strip them.
 */
export class Runtime {
  private constructor() {}

  static useMock(env: Env, request: Request): boolean {
    if (env.JEV_MOCK !== "true") return false;
    return Runtime.localRequest(request);
  }

  static localRequest(request: Request): boolean {
    if (request.headers.get("cf-ray")) return false;
    const cf = (request as Request & { cf?: unknown }).cf;
    return cf == null;
  }
}
