import { Hono } from "hono";
import { csrfMatches, readSessionId, serializeSessionCookie } from "../auth/cookies";
import {
  createMockPingOne,
  MOCK_MFA_PASSWORD,
  MOCK_OTP,
  MOCK_PASSWORD,
  MOCK_REGISTER_EMAIL,
  MOCK_REGISTER_PASSWORD,
  MOCK_REGISTER_USERNAME,
  MOCK_USERNAME,
  MOCK_VERIFICATION_CODE,
} from "../auth/mock";
import {
  applyPilotToggle,
  authorizeAiCall,
  pilotSettings,
  publicPilot,
  requirePilotMember,
  stampPilot,
  type PilotSettings,
} from "../ai/access";
import {
  advanceLogin,
  beginLogin,
  establishSession,
  LOGIN_SECONDS,
  refreshSessionDetailed,
  SESSION_SECONDS,
  sessionExpired,
  sessionNeedsRefresh,
} from "../auth/orchestrate";
import { createPkce } from "../auth/pkce";
import { clientAddress, consumeRateLimit } from "../auth/rate-limit";
import { createPingOneClient, requirePingConfig } from "../auth/pingone";
import { AuthFlowError, type AuthProvider, type LoginRecord, type SessionRecord } from "../auth/types";
import {
  readDeviceBody,
  readLoginIdBody,
  readOtpBody,
  readPasswordBody,
  readPilotToggle,
  readRegisterBody,
  readVerificationBody,
} from "../auth/bodies";
import type { Env } from "../env";
import { HttpError } from "../http";
import { Runtime } from "../runtime";

export const authRoutes = new Hono<{ Bindings: Env }>();

authRoutes.get("/config", (c) => {
  const mock = isMock(c.env, c.req.raw);
  return c.json({
    mock,
    hints: mock
      ? {
          username: MOCK_USERNAME,
          password: MOCK_PASSWORD,
          mfaPassword: MOCK_MFA_PASSWORD,
          otp: MOCK_OTP,
          registerUsername: MOCK_REGISTER_USERNAME,
          registerEmail: MOCK_REGISTER_EMAIL,
          registerPassword: MOCK_REGISTER_PASSWORD,
          verificationCode: MOCK_VERIFICATION_CODE,
        }
      : null,
  });
});

authRoutes.get("/session", async (c) => {
  const session = await readSession(c.env, c.req.header("cookie"));
  if (!session) return c.json(sessionPayload(c.env, c.req.raw, null));
  const fresh = await maybeRefresh(c.env, session, c.req.raw);
  if (!fresh) {
    return clearSession(c, "Your session expired. Sign in again.", 200);
  }
  return c.json(sessionPayload(c.env, c.req.raw, fresh));
});

authRoutes.post("/login/start", async (c) => {
  assertOrigin(c);
  const provider = providerFor(c.env, c.req.raw);
  const pkce = await createPkce();
  const state = crypto.randomUUID();
  const nonce = crypto.randomUUID();
  const started = await beginLogin(provider, {
    state,
    nonce,
    codeChallenge: pkce.challenge,
    codeVerifier: pkce.verifier,
  });
  if (started.completed) return finish(c, provider, started.record, started.completed);
  await saveLogin(c.env, started.record);
  return c.json(started.view);
});

authRoutes.post("/login/password", async (c) => {
  assertOrigin(c);
  const body = await readPasswordBody(c.req.raw);
  const record = await loadLogin(c.env, body.loginId);
  assertStep(record, ["USERNAME_PASSWORD_REQUIRED", "PASSWORD_REQUIRED"]);
  const provider = providerFor(c.env, c.req.raw);
  const advanced = await advanceLogin(provider, record, {
    type: "password",
    username: body.username,
    password: body.password,
  });
  if (advanced.completed) return finish(c, provider, advanced.record, advanced.completed);
  await saveLogin(c.env, advanced.record);
  return c.json(advanced.view);
});

authRoutes.post("/login/register", async (c) => {
  assertOrigin(c);
  await limit(c, "register", 8);
  const body = await readRegisterBody(c.req.raw);
  const record = await loadLogin(c.env, body.loginId);
  assertStep(record, ["USERNAME_PASSWORD_REQUIRED"]);
  const provider = providerFor(c.env, c.req.raw);
  const advanced = await advanceLogin(provider, record, {
    type: "register",
    username: body.username,
    email: body.email,
    password: body.password,
  });
  if (advanced.completed) return finish(c, provider, advanced.record, advanced.completed);
  await saveLogin(c.env, advanced.record);
  return c.json(advanced.view);
});

authRoutes.post("/login/verify", async (c) => {
  assertOrigin(c);
  await limit(c, "verify", 12);
  const body = await readVerificationBody(c.req.raw);
  const record = await loadLogin(c.env, body.loginId);
  assertStep(record, ["VERIFICATION_CODE_REQUIRED", "VERIFICATION_REQUIRED"]);
  const provider = providerFor(c.env, c.req.raw);
  const advanced = await advanceLogin(provider, record, {
    type: "verify",
    verificationCode: body.verificationCode,
  });
  if (advanced.completed) return finish(c, provider, advanced.record, advanced.completed);
  await saveLogin(c.env, advanced.record);
  return c.json(advanced.view);
});

authRoutes.post("/login/resend", async (c) => {
  assertOrigin(c);
  await limit(c, "resend", 6);
  const body = await readLoginIdBody(c.req.raw);
  const record = await loadLogin(c.env, body.loginId);
  assertStep(record, ["VERIFICATION_CODE_REQUIRED", "VERIFICATION_REQUIRED"]);
  const provider = providerFor(c.env, c.req.raw);
  const advanced = await advanceLogin(provider, record, { type: "resend" });
  if (advanced.completed) return finish(c, provider, advanced.record, advanced.completed);
  await saveLogin(c.env, advanced.record);
  return c.json(advanced.view);
});

authRoutes.post("/login/otp", async (c) => {
  assertOrigin(c);
  const body = await readOtpBody(c.req.raw);
  const record = await loadLogin(c.env, body.loginId);
  assertStep(record, ["OTP_REQUIRED"]);
  const provider = providerFor(c.env, c.req.raw);
  const advanced = await advanceLogin(provider, record, { type: "otp", otp: body.otp });
  if (advanced.completed) return finish(c, provider, advanced.record, advanced.completed);
  await saveLogin(c.env, advanced.record);
  return c.json(advanced.view);
});

authRoutes.post("/login/device", async (c) => {
  assertOrigin(c);
  const body = await readDeviceBody(c.req.raw);
  const record = await loadLogin(c.env, body.loginId);
  assertStep(record, ["DEVICE_SELECTION_REQUIRED", "OTP_REQUIRED", "PUSH_CONFIRMATION_REQUIRED", "PUSH_CONFIRMATION_TIMED_OUT"]);
  const provider = providerFor(c.env, c.req.raw);
  const advanced = await advanceLogin(provider, record, { type: "device", deviceId: body.deviceId });
  if (advanced.completed) return finish(c, provider, advanced.record, advanced.completed);
  await saveLogin(c.env, advanced.record);
  return c.json(advanced.view);
});

authRoutes.post("/login/continue", async (c) => {
  assertOrigin(c);
  const body = await readLoginIdBody(c.req.raw);
  const record = await loadLogin(c.env, body.loginId);
  assertStep(record, ["PUSH_CONFIRMATION_REQUIRED", "PUSH_CONFIRMATION_TIMED_OUT"]);
  const provider = providerFor(c.env, c.req.raw);
  const advanced = await advanceLogin(provider, record, { type: "read" });
  if (advanced.completed) return finish(c, provider, advanced.record, advanced.completed);
  await saveLogin(c.env, advanced.record);
  return c.json(advanced.view);
});

authRoutes.post("/pilot", async (c) => {
  assertOrigin(c);
  if (!isMock(c.env, c.req.raw)) throw new HttpError(404, "Not found.");
  const session = await requireUser(c);
  const body = await readPilotToggle(c.req.raw);
  const settings = pilotSettings(c.env);
  const next = applyPilotToggle(session, body.member, settings, true);
  await saveSession(c.env, next);
  return c.json(sessionPayload(c.env, c.req.raw, next));
});

authRoutes.post("/logout", async (c) => {
  assertOrigin(c);
  const session = await readSession(c.env, c.req.header("cookie"));
  if (session) {
    requireCsrf(c, session);
    await sessions(c.env).delete(`session:${session.id}`);
    try {
      await providerFor(c.env, c.req.raw).endSession(session.idToken ? { idToken: session.idToken } : {});
    } catch {
      // The browser session is cleared even if PingOne sign-off fails.
    }
  }
  c.header("set-cookie", serializeSessionCookie("", { secure: isSecure(c), maxAge: 0, clear: true }));
  return c.json({ ok: true });
});

export async function requireUser(c: {
  env: Env;
  req: { header: (name: string) => string | undefined; method: string; url: string; raw: Request };
}): Promise<SessionRecord> {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    const origin = c.req.header("origin");
    if (origin && origin !== new URL(c.req.url).origin) {
      throw new HttpError(403, "Cross-origin request blocked.");
    }
  }
  const session = await readSession(c.env, c.req.header("cookie"));
  if (!session) throw new HttpError(401, "Sign in to continue.");
  const fresh = await maybeRefresh(c.env, session, c.req.raw);
  if (!fresh) throw new HttpError(401, "Your session expired. Sign in again.", "reauth_required");
  if (c.req.method !== "GET" && c.req.method !== "HEAD") requireCsrf(c, fresh);
  return fresh;
}

function providerFor(env: Env, request: Request): AuthProvider {
  if (isMock(env, request)) {
    const settings = pilotSettings(env);
    return createMockPingOne({ pilotGroup: settings.group, groupsClaim: settings.groupsClaim });
  }
  return createPingOneClient({ fetch, config: requirePingConfig(env) });
}

function pilotRefresh(env: Env, session: SessionRecord, request: Request) {
  return {
    settings: pilotSettings(env),
    refresh: () => refreshSessionDetailed(providerFor(env, request), session),
    save: (next: SessionRecord) => saveSession(env, next),
  };
}

/** Membership check for an AI route. A failed recheck does not end the estimate session. */
export async function enforcePilotMember(env: Env, session: SessionRecord, request: Request): Promise<SessionRecord> {
  const refresh = pilotRefresh(env, session, request);
  return requirePilotMember({ settings: refresh.settings, session, refresh: refresh.refresh, save: refresh.save });
}

/** Membership and the estimator's per-user budget. The Jev routes apply the $2 Durable Object cap first. */
export async function enforceAiAccess(env: Env, session: SessionRecord, request: Request, tokens = 0): Promise<SessionRecord> {
  const refresh = pilotRefresh(env, session, request);
  return authorizeAiCall({
    settings: refresh.settings,
    session,
    kv: sessions(env),
    tokens,
    refresh: refresh.refresh,
    save: refresh.save,
  });
}

function isMock(env: Env, request: Request): boolean {
  return Runtime.usePingMock(env, request);
}

function sessions(env: Env): KVNamespace {
  const kv = env.SESSIONS;
  if (!kv) throw new HttpError(503, "Sign-in is unavailable right now.");
  return kv;
}

async function finish(
  c: { env: Env; req: { url: string; raw: Request }; header: (name: string, value: string) => void; json: (body: unknown) => Response },
  provider: AuthProvider,
  record: LoginRecord,
  outcome: Parameters<typeof establishSession>[2],
) {
  const settings = pilotSettings(c.env);
  const session = stampPilot(await establishSession(provider, record, outcome), settings);
  await saveSession(c.env, session);
  await sessions(c.env).delete(`login:${record.id}`);
  c.header(
    "set-cookie",
    serializeSessionCookie(session.id, { secure: new URL(c.req.url).protocol === "https:", maxAge: SESSION_SECONDS }),
  );
  return c.json({
    step: "authenticated",
    user: session.user,
    csrfToken: session.csrfToken,
    mock: isMock(c.env, c.req.raw),
    pilot: publicPilot(settings, session),
  });
}

async function clearSession(
  c: { header: (name: string, value: string) => void; json: (body: unknown) => Response; req: { url: string; raw: Request }; env: Env },
  _message: string,
  _status: number,
) {
  c.header("set-cookie", serializeSessionCookie("", { secure: isSecure(c), maxAge: 0, clear: true }));
  return c.json(sessionPayload(c.env, c.req.raw, null));
}

function assertOrigin(c: { req: { header: (name: string) => string | undefined; url: string } }) {
  const origin = c.req.header("origin");
  if (!origin) return;
  if (origin !== new URL(c.req.url).origin) throw new HttpError(403, "Cross-origin request blocked.");
}

function isSecure(c: { req: { url: string } }): boolean {
  return new URL(c.req.url).protocol === "https:";
}

function requireCsrf(
  c: { req: { header: (name: string) => string | undefined } },
  session: SessionRecord,
) {
  if (!csrfMatches(session.csrfToken, c.req.header("x-csrf-token"))) {
    throw new HttpError(403, "Missing or invalid CSRF token.");
  }
}

function assertStep(record: LoginRecord, allowed: string[]) {
  if (!allowed.includes(record.status)) {
    throw new HttpError(409, "That sign-in step is no longer active. Start again.");
  }
}

async function loadLogin(env: Env, id: string): Promise<LoginRecord> {
  const raw = await sessions(env).get(`login:${id}`);
  if (!raw) throw new HttpError(404, "That sign-in expired. Start again.");
  const record = JSON.parse(raw) as LoginRecord;
  if (Date.now() - record.createdAt > LOGIN_SECONDS * 1000) {
    await sessions(env).delete(`login:${id}`);
    throw new HttpError(404, "That sign-in expired. Start again.");
  }
  return record;
}

async function saveLogin(env: Env, record: LoginRecord) {
  const ttl = remainingSeconds(record.createdAt, LOGIN_SECONDS);
  if (ttl <= 0) throw new HttpError(404, "That sign-in expired. Start again.");
  await sessions(env).put(`login:${record.id}`, JSON.stringify(record), { expirationTtl: Math.max(60, ttl) });
}

async function saveSession(env: Env, session: SessionRecord) {
  const ttl = remainingSeconds(session.createdAt, SESSION_SECONDS);
  if (ttl <= 0) throw new HttpError(401, "Your session expired. Sign in again.");
  await sessions(env).put(`session:${session.id}`, JSON.stringify(session), { expirationTtl: Math.max(60, ttl) });
}

async function readSession(env: Env, cookieHeader: string | undefined): Promise<SessionRecord | null> {
  const id = readSessionId(cookieHeader);
  if (!id) return null;
  const raw = await sessions(env).get(`session:${id}`);
  if (!raw) return null;
  const session = JSON.parse(raw) as SessionRecord;
  if (sessionExpired(session)) {
    await sessions(env).delete(`session:${id}`);
    return null;
  }
  return session;
}

async function maybeRefresh(env: Env, session: SessionRecord, request: Request): Promise<SessionRecord | null> {
  if (!sessionNeedsRefresh(session)) return session;
  // No refresh grant: do not delete the session. The pilot gate trusts
  // the sign-in groups check until accessExpiresAt, then returns reauth_required.
  if (!session.refreshToken) return session;
  try {
    const detailed = await refreshSessionDetailed(providerFor(env, request), session);
    const settings = pilotSettings(env);
    const next = detailed.receivedIdToken ? stampPilot(detailed.session, settings) : detailed.session;
    await saveSession(env, next);
    return next;
  } catch (error) {
    if (error instanceof AuthFlowError && error.status < 500) {
      await sessions(env).delete(`session:${session.id}`);
      return null;
    }
    throw error;
  }
}

const RATE_WINDOW_SECONDS = 15 * 60;

async function limit(
  c: { env: Env; req: { header: (name: string) => string | undefined } },
  action: string,
  max: number,
) {
  const address = clientAddress((name) => c.req.header(name));
  await consumeRateLimit(sessions(c.env), `rate:${action}:${address}`, max, RATE_WINDOW_SECONDS);
}

function remainingSeconds(createdAt: number, lifetime: number): number {
  return Math.floor((createdAt + lifetime * 1000 - Date.now()) / 1000);
}

function sessionPayload(env: Env, request: Request, session: SessionRecord | null) {
  const settings: PilotSettings = pilotSettings(env);
  return {
    user: session?.user ?? null,
    csrfToken: session?.csrfToken ?? null,
    mock: isMock(env, request),
    pilot: publicPilot(settings, session),
  };
}
