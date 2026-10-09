import app from "../src/worker/index";
import { MOCK_PASSWORD, MOCK_USERNAME } from "../src/worker/auth/mock";
import type { Env } from "../src/worker/env";

/** In-test KV. `put` records keys so gate tests can see rate counters. */
export class MemoryKv {
  readonly store = new Map<string, string>();
  readonly writes: string[] = [];

  binding(): NonNullable<Env["SESSIONS"]> {
    const self = this;
    return {
      get: async (key: string) => self.store.get(key) ?? null,
      put: async (key: string, value: string) => {
        self.writes.push(key);
        self.store.set(key, value);
      },
      delete: async (key: string) => {
        self.store.delete(key);
      },
    } as unknown as NonNullable<Env["SESSIONS"]>;
  }

  keys(): string[] {
    return [...this.store.keys()];
  }
}

export interface SignedIn {
  env: Env;
  kv: MemoryKv;
  cookie: string;
  csrf: string;
}

/**
 * Signs in as the mock pilot member on `env`.
 * Replaces `SESSIONS` and turns on local PingOne mock. Does not send `cf-ray`.
 */
export async function attachMember(env: Env, kv = new MemoryKv()): Promise<SignedIn> {
  env.SESSIONS = kv.binding();
  env.PINGONE_MOCK = "true";
  env.AI_PILOT_GATE_ENABLED ??= "true";
  env.AI_PILOT_GROUP ??= "jev-pilot-program";
  env.AI_USER_CALLS_PER_HOUR ??= "1000";
  env.AI_USER_TOKENS_PER_DAY ??= "10000000";

  const start = await app.request("/api/auth/login/start", { method: "POST" }, env);
  if (start.status !== 200) throw new Error(`login start ${start.status}: ${await start.text()}`);
  const started = await start.json() as { loginId?: string; step?: string };
  if (!started.loginId) throw new Error("login start did not return a loginId");

  const password = await app.request("/api/auth/login/password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ loginId: started.loginId, username: MOCK_USERNAME, password: MOCK_PASSWORD }),
  }, env);
  if (password.status !== 200) throw new Error(`login password ${password.status}: ${await password.text()}`);
  const body = await password.json() as { csrfToken?: string; step?: string };
  const cookie = password.headers.get("set-cookie")?.split(";")[0] ?? "";
  if (!cookie.startsWith("meridian_session=") || !body.csrfToken || body.step !== "authenticated") {
    throw new Error("mock sign-in did not establish a session");
  }
  return { env, kv, cookie, csrf: body.csrfToken };
}

export function authHeaders(account: SignedIn, extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set("cookie", account.cookie);
  headers.set("x-csrf-token", account.csrf);
  return headers;
}
