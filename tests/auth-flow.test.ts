import { describe, expect, it, vi } from "vitest";
import { createMockPingOne, MOCK_MFA_PASSWORD, MOCK_OTP, MOCK_PASSWORD, MOCK_USERNAME } from "../src/worker/auth/mock";
import { advanceLogin, beginLogin, establishSession, refreshSession, viewForOutcome } from "../src/worker/auth/orchestrate";
import { authFailureBody } from "../src/worker/auth/fault";
import { createPingOneClient, requirePingConfig, type PingOneDeps } from "../src/worker/auth/pingone";
import { AuthFlowError, type FlowOutcome } from "../src/worker/auth/types";

const config = {
  authHost: "https://auth.pingone.com",
  envId: "env-1",
  clientId: "client-1",
  clientSecret: "super-secret",
  scopes: "openid profile email offline_access",
};

function jsonResponse(
  body: unknown,
  status = 200,
  cookies: string[] = [],
  extra: Record<string, string> = {},
): Response {
  const headers = new Headers({ "content-type": "application/json", ...extra });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(JSON.stringify(body), { status, headers });
}

describe("PingOne pi.flow client", () => {
  it("starts authorize with response_mode=pi.flow and posts username/password with the session cookie", async () => {
    const calls: Array<{ url: string; init?: RequestInit | undefined }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes("/as/authorize")) {
        return jsonResponse(
          {
            id: "flow-1",
            status: "USERNAME_PASSWORD_REQUIRED",
            _links: { "usernamePassword.check": { href: "https://auth.pingone.com/env-1/flows/flow-1" } },
          },
          200,
          ["ST=session-1; Path=/env-1; HttpOnly"],
        );
      }
      const body = init?.body instanceof Uint8Array ? new TextDecoder().decode(init.body) : "";
      expect(body).toBe(JSON.stringify({ username: "ada", password: "correct" }));
      return jsonResponse({
        id: "flow-1",
        status: "COMPLETED",
        resumeUrl: "https://auth.pingone.com/env-1/as/resume?flowId=flow-1",
        authorizeResponse: { code: "auth-code", state: "state-1" },
      });
    };
    const client = createPingOneClient({ fetch: fetchImpl, config } satisfies PingOneDeps);
    const started = await client.begin({ state: "state-1", nonce: "nonce-1", codeChallenge: "challenge-1" });
    expect(started.status).toBe("USERNAME_PASSWORD_REQUIRED");
    const authorize = new URL(calls[0]?.url ?? "");
    expect(authorize.pathname).toBe("/env-1/as/authorize");
    expect(authorize.searchParams.get("response_type")).toBe("code");
    expect(authorize.searchParams.get("response_mode")).toBe("pi.flow");
    expect(authorize.searchParams.get("client_id")).toBe("client-1");
    expect(authorize.searchParams.get("scope")).toBe("openid profile email offline_access");
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize.searchParams.get("code_challenge")).toBe("challenge-1");
    expect(authorize.searchParams.get("redirect_uri")).toBeNull();
    expect(authorize.search).not.toContain("super-secret");

    const completed = await client.checkPassword(
      { flowId: started.flowId, cookies: started.cookies, state: "state-1" },
      "ada",
      "correct",
    );
    const passwordCall = calls[1];
    const headers = new Headers(passwordCall?.init?.headers);
    expect(passwordCall?.url).toBe("https://auth.pingone.com/env-1/flows/flow-1");
    expect(headers.get("content-type")).toBe("application/vnd.pingidentity.usernamePassword.check+json");
    expect(headers.get("cookie")).toBe("ST=session-1");
    expect(completed.code).toBe("auth-code");
    expect(calls.some((call) => call.url.includes("/as/resume"))).toBe(false);
  });

  it("resumes a completed flow when the code is not inline, then exchanges it with the client secret", async () => {
    const calls: Array<{ url: string; init?: RequestInit | undefined }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes("/flows/")) {
        return jsonResponse({
          id: "flow-1",
          status: "COMPLETED",
          resumeUrl: "https://auth.pingone.com/env-1/as/resume?flowId=flow-1",
        });
      }
      if (url.includes("/as/resume")) {
        return jsonResponse({
          id: "flow-1",
          status: "COMPLETED",
          authorizeResponse: { code: "from-resume", state: "state-1" },
        });
      }
      if (url.includes("/as/token")) {
        return jsonResponse({
          access_token: "access-1",
          refresh_token: "refresh-1",
          id_token: "id-1",
          expires_in: 3600,
          token_type: "Bearer",
        });
      }
      return jsonResponse({ sub: "user-1", name: "Ada Lovelace", email: "ada@example.com", preferred_username: "ada" });
    };
    const client = createPingOneClient({ fetch: fetchImpl, config: { ...config, redirectUri: "https://estimator.example/callback" } });
    const outcome = await client.checkPassword({ flowId: "flow-1", cookies: "ST=session-1", state: "state-1" }, "ada", "pw");
    expect(outcome.code).toBe("from-resume");
    expect(calls.some((call) => call.url.startsWith("https://auth.pingone.com/env-1/as/resume"))).toBe(true);

    const tokens = await client.exchangeCode({ code: outcome.code ?? "", codeVerifier: "verifier-1" });
    const tokenCall = calls.find((call) => call.url.endsWith("/as/token"));
    const headers = new Headers(tokenCall?.init?.headers);
    const body = String(tokenCall?.init?.body);
    expect(headers.get("authorization")).toMatch(/^Basic /);
    expect(body).toContain("grant_type=authorization_code");
    expect(body).toContain("code=from-resume");
    expect(body).toContain("code_verifier=verifier-1");
    expect(body).toContain("redirect_uri=https%3A%2F%2Festimator.example%2Fcallback");
    expect(body).not.toContain("super-secret");
    expect(tokenCall?.url).not.toContain("super-secret");
    expect(tokens.accessToken).toBe("access-1");
    const profile = await client.userInfo(tokens.accessToken);
    expect(profile).toEqual({ id: "user-1", username: "ada", name: "Ada Lovelace", email: "ada@example.com" });
  });

  it("reads an authorization code from a resume redirect and rejects a state mismatch", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/flows/")) {
        return jsonResponse({
          id: "flow-1",
          status: "COMPLETED",
          resumeUrl: "https://auth.pingone.com/env-1/as/resume?flowId=flow-1",
        });
      }
      return new Response(null, {
        status: 302,
        headers: { location: "https://estimator.example/callback?code=redir-code&state=other-state" },
      });
    };
    const client = createPingOneClient({ fetch: fetchImpl, config });
    await expect(
      client.checkPassword({ flowId: "flow-1", cookies: "", state: "state-1" }, "ada", "pw"),
    ).rejects.toBeInstanceOf(AuthFlowError);
  });

  it("posts OTP and device selection with PingOne media types", async () => {
    const bodies: Array<{ type: string | null; json: string }> = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      const json = init?.body instanceof Uint8Array ? new TextDecoder().decode(init.body) : "";
      bodies.push({ type: new Headers(init?.headers).get("content-type"), json });
      return jsonResponse({
        id: "flow-1",
        status: "OTP_REQUIRED",
        selectedDevice: { id: "device-1" },
        _embedded: { devices: [{ id: "device-1", type: "SMS", phone: "*******01" }] },
      });
    };
    const client = createPingOneClient({ fetch: fetchImpl, config });
    const ctx = { flowId: "flow-1", cookies: "ST=1", state: "state-1" };
    const selected = await client.selectDevice(ctx, "device-1");
    await client.checkOtp(ctx, "123456");
    expect(bodies[0]).toEqual({
      type: "application/vnd.pingidentity.device.select+json",
      json: JSON.stringify({ device: { id: "device-1" } }),
    });
    expect(bodies[1]?.type).toBe("application/vnd.pingidentity.otp.check+json");
    expect(bodies[1]?.json).toBe(JSON.stringify({ otp: "123456" }));
    expect(selected.devices[0]?.label).toBe("SMS · *******01");
  });

  it("surfaces PingOne's code, message, details, and correlation id", async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse(
        {
          id: "6c796712-0f16-4062-815a-e0a92f4a2143",
          code: "INVALID_DATA",
          message: "The request could not be completed. One or more validation errors were in the request.",
          details: [
            {
              code: "INVALID_VALUE",
              target: "username",
              message: "Invalid username and/or password.",
            },
          ],
        },
        400,
        [],
        { "correlation-id": "corr-9", "x-request-id": "req-9" },
      );
    const client = createPingOneClient({ fetch: fetchImpl, config });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = await client
      .checkPassword({ flowId: "flow-1", cookies: "", state: "state-1" }, "ada", "nope")
      .then(() => {
        throw new Error("expected PingOne to reject the password");
      })
      .catch((reason: unknown) => reason);
    const logged = spy.mock.calls.map((call) => String(call[0])).join("\n");
    spy.mockRestore();
    expect(error).toBeInstanceOf(AuthFlowError);
    const failure = error as AuthFlowError;
    expect(failure.message).toBe("Invalid username and/or password.");
    expect(failure.pingone).toEqual({
      status: 400,
      id: "6c796712-0f16-4062-815a-e0a92f4a2143",
      code: "INVALID_DATA",
      message: "The request could not be completed. One or more validation errors were in the request.",
      details: [{ code: "INVALID_VALUE", target: "username", message: "Invalid username and/or password." }],
      correlationId: "corr-9",
      requestId: "req-9",
    });
    expect(JSON.stringify(authFailureBody(failure))).not.toContain("super-secret");
    expect(authFailureBody(failure).error).toBe("Invalid username and/or password.");
    expect(logged).toContain("pingone.auth.failed");
    expect(logged).toContain("INVALID_DATA");
    expect(logged).toContain("6c796712-0f16-4062-815a-e0a92f4a2143");
    expect(logged).not.toContain("super-secret");
    expect(logged).not.toContain("nope");
  });

  it("does not swallow a flow error object returned with the username step", async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({
        id: "flow-1",
        status: "USERNAME_PASSWORD_REQUIRED",
        error: { code: "INVALID_CREDENTIALS", message: "Invalid username and/or password." },
      });
    const client = createPingOneClient({ fetch: fetchImpl, config });
    const error = await client
      .checkPassword({ flowId: "flow-1", cookies: "", state: "state-1" }, "ada", "nope")
      .then(() => {
        throw new Error("expected the embedded flow error to fail the step");
      })
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(AuthFlowError);
    expect((error as AuthFlowError).pingone).toMatchObject({
      status: 200,
      id: "flow-1",
      code: "INVALID_CREDENTIALS",
      message: "Invalid username and/or password.",
    });
    expect((error as AuthFlowError).status).toBe(400);
  });

  it("keeps an OAuth token error code and description", async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({ error: "invalid_client", error_description: "Client authentication failed." }, 401);
    const client = createPingOneClient({ fetch: fetchImpl, config });
    const error = await client
      .exchangeCode({ code: "auth-code", codeVerifier: "verifier-1" })
      .then(() => {
        throw new Error("expected the token endpoint to fail");
      })
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(AuthFlowError);
    const failure = error as AuthFlowError;
    expect(failure.pingone).toMatchObject({
      status: 401,
      code: "invalid_client",
      message: "Client authentication failed.",
    });
    expect(failure.message).toBe("Client authentication failed.");
    expect(JSON.stringify(failure.pingone)).not.toContain("super-secret");
  });

  it("refuses a foreign resume host", async () => {
    const foreign: typeof fetch = async () =>
      jsonResponse({
        id: "flow-1",
        status: "COMPLETED",
        resumeUrl: "https://evil.example/as/resume?flowId=flow-1",
      });
    const guarded = createPingOneClient({ fetch: foreign, config });
    await expect(
      guarded.checkPassword({ flowId: "flow-1", cookies: "", state: "state-1" }, "ada", "pw"),
    ).rejects.toThrow(/unexpected host/);
  });

  it("refreshes with the refresh_token grant", async () => {
    let body = "";
    const fetchImpl: typeof fetch = async (_input, init) => {
      body = String(init?.body);
      return jsonResponse({ access_token: "next", refresh_token: "rotated", expires_in: 120, token_type: "Bearer" });
    };
    const client = createPingOneClient({ fetch: fetchImpl, config });
    const tokens = await client.refresh("refresh-1");
    expect(body).toContain("grant_type=refresh_token");
    expect(body).toContain("refresh_token=refresh-1");
    expect(tokens.refreshToken).toBe("rotated");
  });
});

describe("login orchestration", () => {
  it("maps further PingOne steps without treating them as success", () => {
    const base: FlowOutcome = { flowId: "f", cookies: "", status: "OTP_REQUIRED", devices: [] };
    expect(viewForOutcome("login", { ...base, status: "DEVICE_SELECTION_REQUIRED" }).step).toBe("device_select");
    expect(viewForOutcome("login", { ...base, status: "PUSH_CONFIRMATION_REQUIRED" }).step).toBe("push");
    expect(viewForOutcome("login", { ...base, status: "ASSERTION_REQUIRED" }).step).toBe("unsupported");
  });

  it("signs in through the mock provider and can require an OTP", async () => {
    const provider = createMockPingOne();
    const started = await beginLogin(provider, {
      state: "state",
      nonce: "nonce",
      codeChallenge: "challenge",
      codeVerifier: "verifier",
    });
    expect(started.view.step).toBe("username_password");
    await expect(
      advanceLogin(provider, started.record, { type: "password", username: MOCK_USERNAME, password: "nope" }),
    ).rejects.toThrow(/Invalid username/);

    const mfa = await advanceLogin(provider, started.record, {
      type: "password",
      username: MOCK_USERNAME,
      password: MOCK_MFA_PASSWORD,
    });
    expect(mfa.view.step).toBe("otp");
    const done = await advanceLogin(provider, mfa.record, { type: "otp", otp: MOCK_OTP });
    expect(done.completed?.code).toBeTruthy();
    const session = await establishSession(provider, done.record, done.completed!);
    expect(session.user.name).toBe("Robert");
    expect(session.accessToken.startsWith("mock-access.")).toBe(true);
    const refreshed = await refreshSession(provider, { ...session, accessExpiresAt: Date.now() - 1 });
    expect(refreshed.accessToken).not.toBe(session.accessToken);

    const direct = await advanceLogin(provider, started.record, {
      type: "password",
      username: MOCK_USERNAME,
      password: MOCK_PASSWORD,
    });
    expect(direct.completed?.status).toBe("COMPLETED");
  });
});

describe("PingOne config", () => {
  it("requests openid profile email offline_access unless a scope list is set", () => {
    expect(requirePingConfig({
      PINGONE_ENV_ID: "env-1",
      PINGONE_CLIENT_ID: "client-1",
      PINGONE_CLIENT_SECRET: "super-secret",
    }).scopes).toBe("openid profile email offline_access");
    expect(requirePingConfig({
      PINGONE_ENV_ID: "env-1",
      PINGONE_CLIENT_ID: "client-1",
      PINGONE_CLIENT_SECRET: "super-secret",
      PINGONE_SCOPES: "openid profile email offline_access",
    }).scopes).toBe("openid profile email offline_access");
  });

  it("omits redirect_uri until one is configured, then uses that exact value", () => {
    const open = requirePingConfig({
      PINGONE_ENV_ID: "env-1",
      PINGONE_CLIENT_ID: "client-1",
      PINGONE_CLIENT_SECRET: "super-secret",
    });
    expect(open.redirectUri).toBeUndefined();
    const pinned = requirePingConfig({
      PINGONE_ENV_ID: "env-1",
      PINGONE_CLIENT_ID: "client-1",
      PINGONE_CLIENT_SECRET: "super-secret",
      PINGONE_REDIRECT_URI: "https://jev-primitives.bobbylite.workers.dev/oauth/callback",
    });
    expect(pinned.redirectUri).toBe("https://jev-primitives.bobbylite.workers.dev/oauth/callback");
  });
});
