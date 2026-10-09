import { describe, expect, it } from "vitest";
import {
  createMockPingOne,
  MOCK_REGISTER_EMAIL,
  MOCK_REGISTER_PASSWORD,
  MOCK_REGISTER_USERNAME,
  MOCK_USERNAME,
  MOCK_VERIFICATION_CODE,
} from "../src/worker/auth/mock";
import { advanceLogin, beginLogin, establishSession, REGISTRATION_DISABLED } from "../src/worker/auth/orchestrate";
import { consumeRateLimit } from "../src/worker/auth/rate-limit";
import { createPingOneClient, type PingOneDeps } from "../src/worker/auth/pingone";
import { AuthFlowError, type AuthProvider, type FlowOutcome } from "../src/worker/auth/types";
import { HttpError } from "../src/worker/http";

const config = {
  authHost: "https://auth.pingone.com",
  envId: "env-1",
  clientId: "client-1",
  clientSecret: "super-secret",
  scopes: "openid profile email",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("PingOne registration actions", () => {
  it("posts user.register, user.verify, and an empty resend body", async () => {
    const calls: Array<{ type: string | null; json: string }> = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      const json = init?.body instanceof Uint8Array ? new TextDecoder().decode(init.body) : "";
      calls.push({ type: new Headers(init?.headers).get("content-type"), json });
      if (calls.length === 1) {
        return jsonResponse({
          id: "flow-1",
          status: "VERIFICATION_CODE_REQUIRED",
          email: "ad****@meridian.test",
          _links: {
            "user.verify": { href: "https://auth.pingone.com/env-1/flows/flow-1" },
            "user.sendVerificationCode": { href: "https://auth.pingone.com/env-1/flows/flow-1" },
          },
        });
      }
      if (calls.length === 2) {
        return jsonResponse({ id: "flow-1", status: "VERIFICATION_CODE_REQUIRED", email: "ad****@meridian.test" });
      }
      return jsonResponse({
        id: "flow-1",
        status: "COMPLETED",
        authorizeResponse: { code: "auth-code", state: "state-1" },
        _embedded: { user: { username: "ada@meridian.test" } },
      });
    };
    const client = createPingOneClient({ fetch: fetchImpl, config } satisfies PingOneDeps);
    const ctx = { flowId: "flow-1", cookies: "ST=1", state: "state-1" };
    const registered = await client.register(ctx, {
      username: "ada@meridian.test",
      email: "ada@meridian.test",
      password: "Stake-1847",
    });
    expect(registered.status).toBe("VERIFICATION_CODE_REQUIRED");
    expect(registered.maskedEmail).toBe("ad****@meridian.test");
    await client.resendVerification(ctx);
    const verified = await client.verifyRegistration(ctx, "18472639");
    expect(calls[0]).toEqual({
      type: "application/vnd.pingidentity.user.register+json",
      json: JSON.stringify({ username: "ada@meridian.test", email: "ada@meridian.test", password: "Stake-1847" }),
    });
    expect(calls[1]).toEqual({
      type: "application/vnd.pingidentity.user.sendVerificationCode+json",
      json: "{}",
    });
    expect(calls[2]).toEqual({
      type: "application/vnd.pingidentity.user.verify+json",
      json: JSON.stringify({ verificationCode: "18472639" }),
    });
    expect(verified.code).toBe("auth-code");
    expect(JSON.stringify(calls)).not.toContain("super-secret");
  });

  it("records whether the flow offered user.register", async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({
        id: "flow-1",
        status: "USERNAME_PASSWORD_REQUIRED",
        _links: { "usernamePassword.check": { href: "https://auth.pingone.com/env-1/flows/flow-1" } },
      });
    const client = createPingOneClient({ fetch: fetchImpl, config });
    const started = await client.begin({ state: "state-1", nonce: "nonce-1", codeChallenge: "challenge" });
    expect(started.canRegister).toBe(false);
  });
});

describe("registration orchestration", () => {
  it("registers through the mock provider, verifies, and signs in as that user", async () => {
    const provider = createMockPingOne();
    const started = await beginLogin(provider, {
      state: "state",
      nonce: "nonce",
      codeChallenge: "challenge",
      codeVerifier: "verifier",
    });
    expect(started.view.step).toBe("username_password");
    if (started.view.step === "username_password") expect(started.view.canRegister).toBe(true);

    const weak = await advanceLogin(provider, started.record, {
      type: "register",
      username: "new@meridian.test",
      email: "new@meridian.test",
      password: "short",
    }).catch((reason: unknown) => reason);
    expect(weak).toBeInstanceOf(AuthFlowError);
    const weakError = weak as AuthFlowError;
    expect(weakError.pingone?.details?.every((detail) => detail.target === "password")).toBe(true);
    expect(weakError.pingone?.details?.map((detail) => detail.message)).toEqual([
      "At least 8 characters.",
      "At least one number.",
    ]);

    await expect(
      advanceLogin(provider, started.record, {
        type: "register",
        username: MOCK_USERNAME,
        email: MOCK_USERNAME,
        password: MOCK_REGISTER_PASSWORD,
      }),
    ).rejects.toThrow(/already exists/);

    const registered = await advanceLogin(provider, started.record, {
      type: "register",
      username: MOCK_REGISTER_USERNAME,
      email: MOCK_REGISTER_EMAIL,
      password: MOCK_REGISTER_PASSWORD,
    });
    expect(registered.view.step).toBe("verification");
    if (registered.view.step === "verification") expect(registered.view.email).toBe("ad****@meridian.test");

    await expect(
      advanceLogin(provider, registered.record, { type: "verify", verificationCode: "00000000" }),
    ).rejects.toThrow(/verification code is invalid/i);

    const resent = await advanceLogin(provider, registered.record, { type: "resend" });
    expect(resent.view.step).toBe("verification");

    const done = await advanceLogin(provider, registered.record, {
      type: "verify",
      verificationCode: MOCK_VERIFICATION_CODE,
    });
    expect(done.completed?.code).toBeTruthy();
    const session = await establishSession(provider, done.record, done.completed!);
    expect(session.user.email).toBe(MOCK_REGISTER_EMAIL);
    expect(session.user.id).not.toBe("user-robert");
    expect(session.accessToken.startsWith("mock-access.")).toBe(true);

    const again = await beginLogin(provider, {
      state: "state-2",
      nonce: "nonce-2",
      codeChallenge: "challenge",
      codeVerifier: "verifier",
    });
    const signedIn = await advanceLogin(provider, again.record, {
      type: "password",
      username: MOCK_REGISTER_USERNAME,
      password: MOCK_REGISTER_PASSWORD,
    });
    const ada = await establishSession(provider, signedIn.record, signedIn.completed!);
    expect(ada.user.id).toBe(session.user.id);
  });

  it("refuses registration when the flow did not offer it", async () => {
    const outcome: FlowOutcome = {
      flowId: "flow-1",
      cookies: "",
      status: "USERNAME_PASSWORD_REQUIRED",
      devices: [],
      canRegister: false,
    };
    const provider: AuthProvider = {
      mode: "pingone",
      async begin() {
        return outcome;
      },
      async checkPassword() {
        return outcome;
      },
      async checkOtp() {
        return outcome;
      },
      async selectDevice() {
        return outcome;
      },
      async read() {
        return outcome;
      },
      async register() {
        throw new Error("register should not be called");
      },
      async verifyRegistration() {
        return outcome;
      },
      async resendVerification() {
        return outcome;
      },
      async exchangeCode() {
        throw new Error("unused");
      },
      async refresh() {
        throw new Error("unused");
      },
      async userInfo() {
        throw new Error("unused");
      },
      async endSession() {
        return;
      },
    };
    const started = await beginLogin(provider, {
      state: "state",
      nonce: "nonce",
      codeChallenge: "challenge",
      codeVerifier: "verifier",
    });
    const error = await advanceLogin(provider, started.record, {
      type: "register",
      username: "ada@meridian.test",
      email: "ada@meridian.test",
      password: "Stake-1847",
    }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(AuthFlowError);
    expect((error as AuthFlowError).kind).toBe("registration_disabled");
    expect((error as AuthFlowError).message).toBe(REGISTRATION_DISABLED);
  });
});

describe("sign-up rate limit", () => {
  it("blocks the next attempt after the window's limit", async () => {
    const store = new Map<string, string>();
    const kv = {
      async get(key: string) {
        return store.get(key) ?? null;
      },
      async put(key: string, value: string) {
        store.set(key, value);
      },
    };
    await consumeRateLimit(kv, "rate:register:203.0.113.8", 2, 60);
    await consumeRateLimit(kv, "rate:register:203.0.113.8", 2, 60);
    await expect(consumeRateLimit(kv, "rate:register:203.0.113.8", 2, 60)).rejects.toBeInstanceOf(HttpError);
    await consumeRateLimit(kv, "rate:register:203.0.113.9", 2, 60);
  });
});
