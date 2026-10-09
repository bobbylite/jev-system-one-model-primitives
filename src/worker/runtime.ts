import type { Env } from "./env";

/**
 * `JEV_MOCK=true` is an explicit local opt-in (.dev.vars, wrangler dev).
 * It is ignored on the edge: Cloudflare sets `cf-ray` before the Worker runs,
 * and a client cannot strip it. `request.cf` is not a signal — wrangler dev
 * fills that object too, including `colo`.
 */
export class Runtime {
  private constructor() {}

  static useMock(env: Env, request: Request): boolean {
    return Runtime.allowLocalFlag(env.JEV_MOCK, request);
  }

  /** `PINGONE_MOCK=true` is local only. An edge `cf-ray` keeps the real client. */
  static usePingMock(env: Env, request: Request): boolean {
    return Runtime.allowLocalFlag(env.PINGONE_MOCK, request);
  }

  private static allowLocalFlag(flag: string | undefined, request: Request): boolean {
    if (flag !== "true") return false;
    return Runtime.localRequest(request);
  }

  static localRequest(request: Request): boolean {
    return request.headers.get("cf-ray") == null;
  }
}
