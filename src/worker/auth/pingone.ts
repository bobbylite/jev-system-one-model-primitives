import { mergeCookies, readSetCookies } from "./cookies";
import { isPingOneFailure, throwPingOne } from "./fault";
import { basicAuthorization } from "./pkce";
import {
  AuthFlowError,
  type AuthProvider,
  type DeviceInfo,
  type FlowCtx,
  type FlowOutcome,
  type PingOneConfig,
  type Profile,
  type TokenSet,
} from "./types";

/**
 * PingOne OIDC client for the redirectionless `pi.flow` response mode.
 *
 * Shapes follow the current PingOne platform docs:
 * - Authorize: GET /{envId}/as/authorize?response_type=code&response_mode=pi.flow
 *   returns 200 JSON (a flow), and redirect_uri is not required.
 * - Username/password: POST /{envId}/flows/{flowId}
 *   Content-Type: application/vnd.pingidentity.usernamePassword.check+json
 *   body: { username, password }
 * - Device select: application/vnd.pingidentity.device.select+json
 *   body: { device: { id } }
 * - OTP: application/vnd.pingidentity.otp.check+json
 *   body: { otp }
 * - Session cookie (ST) returned by PingOne is stored and replayed by the BFF.
 * - COMPLETED flows expose authorizeResponse.code directly, or the code is
 *   collected from GET resumeUrl (200 JSON or 302 Location).
 * - Token: POST /{envId}/as/token with Authorization: Basic (client secret)
 *   grant_type=authorization_code, plus code_verifier when PKCE was used.
 * - Userinfo: GET /{envId}/as/userinfo
 * - Sign-off: GET /{envId}/as/signoff?id_token_hint=
 */

const USERNAME_PASSWORD = "application/vnd.pingidentity.usernamePassword.check+json";
const OTP_CHECK = "application/vnd.pingidentity.otp.check+json";
const DEVICE_SELECT = "application/vnd.pingidentity.device.select+json";
const USER_REGISTER = "application/vnd.pingidentity.user.register+json";
const USER_VERIFY = "application/vnd.pingidentity.user.verify+json";
const USER_RESEND = "application/vnd.pingidentity.user.sendVerificationCode+json";

interface FlowJson {
  id?: string;
  status?: string;
  resumeUrl?: string;
  message?: string;
  authorizeResponse?: { code?: string; state?: string };
  selectedDevice?: { id?: string };
  _links?: Record<string, { href?: string } | undefined>;
  _embedded?: {
    user?: { username?: string; id?: string };
    devices?: Array<Record<string, unknown>>;
  };
  error?: { message?: string };
  details?: Array<{ message?: string }>;
  email?: string;
}

export interface PingOneDeps {
  fetch: typeof fetch;
  config: PingOneConfig;
}

export function createPingOneClient(deps: PingOneDeps): AuthProvider {
  const { config } = deps;
  const fetchImpl = deps.fetch;
  const base = `${trimSlash(config.authHost)}/${config.envId}`;

  async function send(
    url: string,
    init: RequestInit,
    cookies: string,
  ): Promise<{ response: Response; cookies: string; json: unknown }> {
    assertAllowedHost(url, config.authHost);
    const headers = new Headers(init.headers);
    if (cookies) headers.set("cookie", cookies);
    const response = await fetchImpl(url, { ...init, headers, redirect: "manual" });
    const nextCookies = mergeCookies(cookies, readSetCookies(response));
    const text = await response.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        json = null;
      }
    }
    return { response, cookies: nextCookies, json };
  }

  function outcomeFrom(
    flow: FlowJson,
    cookies: string,
    expectedState: string,
    response: Response,
  ): FlowOutcome {
    if (isPingOneFailure(response.status, flow)) throwPingOne(response, flow);
    if (response.status >= 300 && response.status < 400) {
      throw new AuthFlowError(
        502,
        "PingOne redirected from a flow call. response_mode=pi.flow should return JSON.",
      );
    }
    const status = flow.status ?? "";
    const flowId = flow.id ?? "";
    if (!status || !flowId) {
      throw new AuthFlowError(502, "PingOne returned a flow response without an id and status.");
    }
    const baseOutcome: FlowOutcome = {
      flowId,
      cookies,
      status,
      devices: readDevices(flow),
      selectedDeviceId: flow.selectedDevice?.id,
      username: flow._embedded?.user?.username,
      message: flow.error?.message,
      canRegister: Boolean(flow._links?.["user.register"]?.href),
      maskedEmail: typeof flow.email === "string" ? flow.email : undefined,
    };
    if (status !== "COMPLETED" && status !== "COMPLETED_ACCEPTED") return baseOutcome;
    const code = flow.authorizeResponse?.code;
    const returnedState = flow.authorizeResponse?.state;
    if (returnedState && returnedState !== expectedState) {
      throw new AuthFlowError(401, "PingOne returned a state that does not match this login.");
    }
    if (!code) return baseOutcome;
    return { ...baseOutcome, code };
  }

  async function resumeForCode(flow: FlowJson, cookies: string, expectedState: string) {
    if (!flow.resumeUrl) {
      throw new AuthFlowError(502, "PingOne completed sign-on without an authorization code.");
    }
    const resumed = await send(
      flow.resumeUrl,
      { method: "GET", headers: { accept: "application/json" } },
      cookies,
    );
    if (resumed.response.status >= 300 && resumed.response.status < 400) {
      const location = resumed.response.headers.get("location");
      if (!location) {
        throw new AuthFlowError(502, "PingOne resume redirected without a Location header.");
      }
      const target = new URL(location, flow.resumeUrl);
      const code = target.searchParams.get("code");
      const returnedState = target.searchParams.get("state");
      if (returnedState && returnedState !== expectedState) {
        throw new AuthFlowError(401, "PingOne returned a state that does not match this login.");
      }
      if (!code) throw new AuthFlowError(502, "PingOne resume redirect did not include a code.");
      return { code, cookies: resumed.cookies };
    }
    const body = (resumed.json ?? {}) as FlowJson;
    if (isPingOneFailure(resumed.response.status, resumed.json)) throwPingOne(resumed.response, resumed.json);
    const returnedState = body.authorizeResponse?.state;
    if (returnedState && returnedState !== expectedState) {
      throw new AuthFlowError(401, "PingOne returned a state that does not match this login.");
    }
    const code = body.authorizeResponse?.code;
    if (!code) throw new AuthFlowError(502, "PingOne resume response did not include a code.");
    return { code, cookies: resumed.cookies };
  }

  async function finish(flow: FlowJson, cookies: string, expectedState: string, response: Response) {
    const outcome = outcomeFrom(flow, cookies, expectedState, response);
    if (outcome.status !== "COMPLETED" && outcome.status !== "COMPLETED_ACCEPTED") return outcome;
    if (outcome.code) return outcome;
    const resumed = await resumeForCode(flow, outcome.cookies, expectedState);
    return { ...outcome, code: resumed.code, cookies: resumed.cookies };
  }

  async function postAction(
    ctx: FlowCtx,
    relation: string,
    mediaType: string,
    body: unknown,
  ): Promise<FlowOutcome> {
    const href = `${base}/flows/${ctx.flowId}`;
    const payload = new TextEncoder().encode(JSON.stringify(body));
    const result = await send(
      href,
      {
        method: "POST",
        headers: { accept: "application/json", "content-type": mediaType },
        body: payload,
      },
      ctx.cookies,
    );
    const flow = (result.json ?? {}) as FlowJson;
    const linked = flow._links?.[relation]?.href;
    if (linked) assertAllowedHost(linked, config.authHost);
    return finish(flow, result.cookies, ctx.state, result.response);
  }

  return {
    mode: "pingone",
    async begin(input) {
      const url = new URL(`${base}/as/authorize`);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("response_mode", "pi.flow");
      url.searchParams.set("client_id", config.clientId);
      url.searchParams.set("scope", config.scopes);
      url.searchParams.set("state", input.state);
      url.searchParams.set("nonce", input.nonce);
      url.searchParams.set("code_challenge", input.codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
      if (config.redirectUri) url.searchParams.set("redirect_uri", config.redirectUri);
      const result = await send(
        url.toString(),
        { method: "GET", headers: { accept: "application/json" } },
        "",
      );
      if (result.response.status >= 300 && result.response.status < 400) {
        throw new AuthFlowError(
          502,
          "PingOne redirected the authorize request. Confirm the app accepts response_mode=pi.flow.",
        );
      }
      const flow = (result.json ?? {}) as FlowJson;
      return finish(flow, result.cookies, input.state, result.response);
    },
    checkPassword(ctx, username, password) {
      return postAction(ctx, "usernamePassword.check", USERNAME_PASSWORD, { username, password });
    },
    checkOtp(ctx, otp) {
      return postAction(ctx, "otp.check", OTP_CHECK, { otp });
    },
    selectDevice(ctx, deviceId) {
      return postAction(ctx, "device.select", DEVICE_SELECT, { device: { id: deviceId } });
    },
    register(ctx, input) {
      return postAction(ctx, "user.register", USER_REGISTER, {
        username: input.username,
        email: input.email,
        password: input.password,
      });
    },
    verifyRegistration(ctx, verificationCode) {
      return postAction(ctx, "user.verify", USER_VERIFY, { verificationCode });
    },
    /**
     * Resend uses an empty JSON object. The flow docs page currently copies the
     * verify request model (`verificationCode`), but the action text is only
     * "send the user a new account verification email", and the management API
     * with this same media type has an empty body.
     */
    resendVerification(ctx) {
      return postAction(ctx, "user.sendVerificationCode", USER_RESEND, {});
    },
    async read(ctx) {
      const result = await send(
        `${base}/flows/${ctx.flowId}`,
        { method: "GET", headers: { accept: "application/json" } },
        ctx.cookies,
      );
      return finish((result.json ?? {}) as FlowJson, result.cookies, ctx.state, result.response);
    },
    async exchangeCode(input) {
      return tokenRequest(fetchImpl, config, {
        grant_type: "authorization_code",
        code: input.code,
        code_verifier: input.codeVerifier,
        ...(config.redirectUri ? { redirect_uri: config.redirectUri } : {}),
      });
    },
    refresh(refreshToken) {
      return tokenRequest(fetchImpl, config, {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      });
    },
    async userInfo(accessToken) {
      const result = await send(
        `${base}/as/userinfo`,
        { method: "GET", headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" } },
        "",
      );
      if (isPingOneFailure(result.response.status, result.json)) throwPingOne(result.response, result.json);
      const body = (result.json ?? {}) as Record<string, unknown>;
      const id = stringField(body, "sub");
      if (!id) throw new AuthFlowError(502, "PingOne userinfo response did not include a subject.");
      const email = stringField(body, "email") ?? "";
      const username = stringField(body, "preferred_username") ?? (email || id);
      const name = stringField(body, "name") ?? username;
      const profile: Profile = { id, username, name, email };
      return profile;
    },
    async endSession(input) {
      if (!input.idToken) return;
      const url = new URL(`${base}/as/signoff`);
      url.searchParams.set("id_token_hint", input.idToken);
      try {
        await send(url.toString(), { method: "GET", headers: { accept: "application/json" } }, "");
      } catch {
        // Local session removal still proceeds when PingOne sign-off is unreachable.
      }
    },
  };
}

async function tokenRequest(
  fetchImpl: typeof fetch,
  config: PingOneConfig,
  fields: Record<string, string>,
): Promise<TokenSet> {
  const body = new URLSearchParams(fields);
  const url = `${trimSlash(config.authHost)}/${config.envId}/as/token`;
  assertAllowedHost(url, config.authHost);
  const response = await fetchImpl(url, {
    method: "POST",
    redirect: "manual",
    headers: {
      authorization: basicAuthorization(config.clientId, config.clientSecret),
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: body.toString(),
  });
  const text = await response.text();
  let json: unknown;
  try {
    json = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    json = null;
  }
  if (!response.ok || isPingOneFailure(response.status, json)) throwPingOne(response, json);
  const record = (json ?? {}) as Record<string, unknown>;
  const accessToken = stringField(record, "access_token");
  if (!accessToken) throw new AuthFlowError(502, "PingOne token response did not include an access token.");
  const expiresIn = typeof record.expires_in === "number" ? record.expires_in : 3600;
  return {
    accessToken,
    refreshToken: stringField(record, "refresh_token"),
    idToken: stringField(record, "id_token"),
    expiresIn,
    tokenType: stringField(record, "token_type") ?? "Bearer",
  };
}

function readDevices(flow: FlowJson): DeviceInfo[] {
  const devices = flow._embedded?.devices;
  if (!Array.isArray(devices)) return [];
  return devices.flatMap((device) => {
    const id = typeof device.id === "string" ? device.id : "";
    if (!id) return [];
    const type = typeof device.type === "string" ? device.type : "DEVICE";
    return [{ id, type, label: deviceLabel(type, device) }];
  });
}

function deviceLabel(type: string, device: Record<string, unknown>): string {
  const nickname = typeof device.nickname === "string" ? device.nickname : "";
  const phone = typeof device.phone === "string" ? device.phone : "";
  const email = typeof device.email === "string" ? device.email : "";
  if (type === "EMAIL") return email ? `Email · ${email}` : "Email";
  if (type === "SMS" || type === "VOICE") return phone ? `${type} · ${phone}` : type;
  if (nickname) return nickname;
  return type;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value ? value : undefined;
}

export function assertAllowedHost(url: string, authHost: string) {
  const target = new URL(url);
  const allowed = new URL(authHost);
  if (target.origin !== allowed.origin) {
    throw new AuthFlowError(502, "Refusing to call a PingOne URL on an unexpected host.");
  }
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function requirePingConfig(env: {
  PINGONE_ENV_ID?: string;
  PINGONE_AUTH_HOST?: string;
  PINGONE_CLIENT_ID?: string;
  PINGONE_CLIENT_SECRET?: string;
  PINGONE_REDIRECT_URI?: string;
  PINGONE_SCOPES?: string;
}): PingOneConfig {
  const envId = env.PINGONE_ENV_ID?.trim();
  const clientId = env.PINGONE_CLIENT_ID?.trim();
  const clientSecret = env.PINGONE_CLIENT_SECRET?.trim();
  const authHost = (env.PINGONE_AUTH_HOST?.trim() || "https://auth.pingone.com").replace(/\/+$/, "");
  if (!envId || !clientId || !clientSecret) {
    throw new AuthFlowError(
      503,
      "PingOne is not configured. Set the environment id, client id, and client secret, or enable mock mode for a local demo.",
    );
  }
  return {
    authHost,
    envId,
    clientId,
    clientSecret,
    redirectUri: env.PINGONE_REDIRECT_URI?.trim() || undefined,
    scopes: env.PINGONE_SCOPES?.trim() || "openid profile email offline_access",
  };
}
