import { describe, expect, it, vi } from "vitest";
import {
  applyPilotToggle,
  authorizeAiCall,
  DEFAULT_CALLS_PER_HOUR,
  DEFAULT_TOKENS_PER_DAY,
  PILOT_MAX_AGE_MS,
  PILOT_REQUIRED,
  REAUTH_REQUIRED,
  pilotSettings,
  stampPilot,
  aiGateCovers,
  type PilotSettings,
  type RefreshedPilot,
} from "../src/worker/ai/access";
import { consumeAiBudget } from "../src/worker/ai/budget";
import {
  decodeJwtPayload,
  encodeUnsignedJwt,
  isPilotMember,
  memberFromIdToken,
  readGroupsClaim,
} from "../src/worker/ai/claims";
import type { RateKv } from "../src/worker/auth/rate-limit";
import {
  createMockPingOne,
  MOCK_PASSWORD,
  MOCK_REGISTER_EMAIL,
  MOCK_REGISTER_PASSWORD,
  MOCK_REGISTER_USERNAME,
  MOCK_USERNAME,
  MOCK_VERIFICATION_CODE,
} from "../src/worker/auth/mock";
import { advanceLogin, beginLogin, establishSession, refreshSession } from "../src/worker/auth/orchestrate";
import type { Profile, SessionRecord } from "../src/worker/auth/types";
import { HttpError } from "../src/worker/http";

const GROUP = "jev-pilot-program";
const settingsOn: PilotSettings = {
  gateEnabled: true,
  group: GROUP,
  groupsClaim: "groups",
  callsPerHour: 30,
  tokensPerDay: 100_000,
  dailyBudgetUsd: 5,
};

function memoryKv(): RateKv {
  const store = new Map<string, string>();
  return {
    async get(key) {
      return store.get(key) ?? null;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}

function profile(id: string, email: string): Profile {
  return { id, username: email, name: email.split("@")[0] ?? email, email };
}

function sessionFor(
  user: Profile,
  input: {
    idToken?: string;
    pilotMember?: boolean;
    pilotCheckedAt?: number;
    refreshToken?: string | null;
    accessExpiresAt?: number;
    accessToken?: string;
  } = {},
): SessionRecord {
  const now = Date.now();
  return {
    id: "sess-1",
    csrfToken: "csrf",
    user,
    accessToken: input.accessToken ?? "access",
    ...(input.refreshToken === null ? {} : { refreshToken: input.refreshToken ?? "refresh" }),
    idToken: input.idToken,
    accessExpiresAt: input.accessExpiresAt ?? now + 3_600_000,
    createdAt: now,
    absoluteExpiresAt: now + 43_200_000,
    pilotMember: input.pilotMember,
    pilotCheckedAt: input.pilotCheckedAt,
  };
}

function token(groups: unknown, claim = "groups"): string {
  return encodeUnsignedJwt({ sub: "user", [claim]: groups });
}

describe("ID token group claims", () => {
  it("reads an array, a single string, and a comma-separated string", () => {
    expect(readGroupsClaim({ groups: ["Meridian AI Pilot", "Estimators"] }, "groups")).toEqual([
      "Meridian AI Pilot",
      "Estimators",
    ]);
    expect(readGroupsClaim({ groups: "Meridian AI Pilot" }, "groups")).toEqual(["Meridian AI Pilot"]);
    expect(readGroupsClaim({ groups: "Meridian AI Pilot, Field Ops" }, "groups")).toEqual([
      "Meridian AI Pilot",
      "Field Ops",
    ]);
    expect(readGroupsClaim({ groups: ["Meridian AI Pilot, Field Ops"] }, "groups")).toEqual([
      "Meridian AI Pilot",
      "Field Ops",
    ]);
  });

  it("treats a missing or undecodable claim as no membership", () => {
    expect(readGroupsClaim(undefined, "groups")).toEqual([]);
    expect(readGroupsClaim({ email: "ada@meridian.test" }, "groups")).toEqual([]);
    expect(readGroupsClaim({ groups: 12 }, "groups")).toEqual([]);
    expect(decodeJwtPayload(undefined)).toBeUndefined();
    expect(decodeJwtPayload("not-a-jwt")).toBeUndefined();
    expect(decodeJwtPayload("aaa.!!!.ccc")).toBeUndefined();
    expect(memberFromIdToken(undefined, "groups", GROUP)).toBe(false);
    expect(memberFromIdToken("aaa.!!!.ccc", "groups", GROUP)).toBe(false);
    expect(memberFromIdToken(token(undefined), "groups", GROUP)).toBe(false);
  });

  it("matches a group name or id without matching a longer name", () => {
    expect(isPilotMember([GROUP.toLowerCase()], GROUP)).toBe(true);
    expect(isPilotMember([`  ${GROUP.toUpperCase()}  `], GROUP.toLowerCase())).toBe(true);
    expect(isPilotMember(["group-id-42"], "GROUP-ID-42")).toBe(true);
    expect(isPilotMember(["Meridian AI Pilot Extra"], GROUP)).toBe(false);
    expect(isPilotMember(["Estimators"], GROUP)).toBe(false);
    expect(isPilotMember([], GROUP)).toBe(false);
  });

  it("reads the configured claim name", () => {
    const idToken = token([GROUP], "pilot_groups");
    expect(memberFromIdToken(idToken, "pilot_groups", GROUP)).toBe(true);
    expect(memberFromIdToken(idToken, "groups", GROUP)).toBe(false);
  });
});

describe("pilot gate", () => {
  const ada = profile("user-ada", "ada@meridian.test");
  const now = 1_700_000_000_000;

  it("parses worker vars and leaves the gate off unless the value is true", () => {
    expect(pilotSettings({}).gateEnabled).toBe(false);
    expect(pilotSettings({ AI_PILOT_GATE_ENABLED: "false" }).gateEnabled).toBe(false);
    expect(pilotSettings({ AI_PILOT_GATE_ENABLED: "TRUE" }).gateEnabled).toBe(false);
    const parsed = pilotSettings({
      AI_PILOT_GATE_ENABLED: "true",
      AI_PILOT_GROUP: "Crew Leads",
      AI_PILOT_GROUPS_CLAIM: "pilot_groups",
      AI_USER_CALLS_PER_HOUR: "4",
      AI_USER_TOKENS_PER_DAY: "50",
    });
    expect(parsed).toMatchObject({
      gateEnabled: true,
      group: "Crew Leads",
      groupsClaim: "pilot_groups",
      callsPerHour: 4,
      tokensPerDay: 50,
      dailyBudgetUsd: 5,
    });
    expect(pilotSettings({ AI_USER_CALLS_PER_HOUR: "0" }).callsPerHour).toBe(DEFAULT_CALLS_PER_HOUR);
    expect(pilotSettings({ AI_USER_TOKENS_PER_DAY: "nope" }).tokensPerDay).toBe(DEFAULT_TOKENS_PER_DAY);
  });

  it("allows every signed-in user when the gate is off", async () => {
    const refresh = vi.fn();
    const session = sessionFor(ada, { pilotMember: false, pilotCheckedAt: 0 });
    const allowed = await authorizeAiCall({
      settings: { ...settingsOn, gateEnabled: false },
      session,
      kv: memoryKv(),
      now,
      refresh,
    });
    expect(allowed.user.id).toBe("user-ada");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refuses a non-member with pilot_required and leaves the session usable", async () => {
    const refresh = vi.fn();
    const session = sessionFor(ada, {
      idToken: token([]),
      pilotMember: false,
      pilotCheckedAt: now,
    });
    const error = await authorizeAiCall({
      settings: settingsOn,
      session,
      kv: memoryKv(),
      now,
      refresh,
    }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ status: 403, kind: "pilot_required" });
    expect(refresh).not.toHaveBeenCalled();
    expect(session.user.email).toBe("ada@meridian.test");
    expect(session.accessToken).toBe("access");
  });

  it("allows a member whose check is still fresh", async () => {
    const refresh = vi.fn();
    const session = sessionFor(profile("user-robert", MOCK_USERNAME), {
      idToken: token([GROUP]),
      pilotMember: true,
      pilotCheckedAt: now - PILOT_MAX_AGE_MS,
    });
    const allowed = await authorizeAiCall({
      settings: settingsOn,
      session,
      kv: memoryKv(),
      now,
      refresh,
    });
    expect(allowed.pilotMember).toBe(true);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("keeps config reads outside the gate and covers Jev calls", () => {
    expect(aiGateCovers("/api/config")).toBe(false);
    expect(aiGateCovers("/api/cult/config")).toBe(false);
    expect(aiGateCovers("/api/chaos/config")).toBe(false);
    expect(aiGateCovers("/api/auth/session")).toBe(false);
    expect(aiGateCovers("/api/classify")).toBe(true);
    expect(aiGateCovers("/api/cult/score")).toBe(true);
    expect(aiGateCovers("/api/chaos/route")).toBe(true);
  });

  it("refreshes a stale check from the new ID token", async () => {
    const saved: SessionRecord[] = [];
    const robert = profile("user-robert", MOCK_USERNAME);
    const stale = sessionFor(robert, {
      idToken: token([]),
      pilotMember: false,
      pilotCheckedAt: now - PILOT_MAX_AGE_MS - 1,
    });
    const refresh = vi.fn(async (): Promise<RefreshedPilot> => ({
      receivedIdToken: true,
      session: { ...stale, idToken: token([GROUP]) },
    }));
    const allowed = await authorizeAiCall({
      settings: settingsOn,
      session: stale,
      kv: memoryKv(),
      now,
      refresh,
      save: async (next) => {
        saved.push(next);
      },
    });
    expect(refresh).toHaveBeenCalledOnce();
    expect(allowed.pilotMember).toBe(true);
    expect(saved[0]?.pilotMember).toBe(true);
    expect(saved[0]?.pilotCheckedAt).toBe(now);

    const removed = vi.fn(async (): Promise<RefreshedPilot> => ({
      receivedIdToken: true,
      session: { ...stale, idToken: token([]), pilotMember: true },
    }));
    const denied = await authorizeAiCall({
      settings: settingsOn,
      session: { ...stale, pilotMember: true },
      kv: memoryKv(),
      now,
      refresh: removed,
    }).catch((reason: unknown) => reason);
    expect(denied).toMatchObject({ status: 403, kind: "pilot_required" });
  });

  it("allows a member with no refresh token until the access token expires", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const refresh = vi.fn();
    const session = sessionFor(ada, {
      idToken: token([GROUP]),
      pilotMember: true,
      pilotCheckedAt: now - PILOT_MAX_AGE_MS - 1,
      refreshToken: null,
      accessExpiresAt: now + 3_600_000,
      accessToken: "AT-SECRET",
    });
    try {
      const allowed = await authorizeAiCall({
        settings: settingsOn,
        session,
        kv: memoryKv(),
        now,
        refresh,
      });
      await authorizeAiCall({
        settings: settingsOn,
        session,
        kv: memoryKv(),
        now,
        refresh,
      });
      expect(allowed.pilotMember).toBe(true);
      expect(refresh).not.toHaveBeenCalled();
      const logged = JSON.stringify(warn.mock.calls.filter((call) => JSON.stringify(call).includes("pingone.refresh_token.missing")));
      expect(JSON.parse(logged)).toHaveLength(1);
      expect(logged).not.toContain("AT-SECRET");
      expect(logged).not.toContain("cookie");
    } finally {
      warn.mockRestore();
    }
  });

  it("requires a new sign-in when a session with no refresh token is past accessExpiresAt", async () => {
    const refresh = vi.fn();
    const session = sessionFor(ada, {
      pilotMember: true,
      pilotCheckedAt: now,
      refreshToken: null,
      accessExpiresAt: now - 1,
    });
    const error = await authorizeAiCall({
      settings: settingsOn,
      session,
      kv: memoryKv(),
      now,
      refresh,
    }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ status: 401, kind: "reauth_required", message: REAUTH_REQUIRED });
    expect(error).not.toMatchObject({ kind: "pilot_required" });
    expect(refresh).not.toHaveBeenCalled();
    expect(session.accessToken).toBe("access");

    const atExpiry = sessionFor(ada, {
      pilotMember: true,
      pilotCheckedAt: now,
      refreshToken: null,
      accessExpiresAt: now,
    });
    await expect(
      authorizeAiCall({ settings: settingsOn, session: atExpiry, kv: memoryKv(), now, refresh }),
    ).rejects.toMatchObject({ status: 401, kind: "reauth_required" });
  });

  it("refuses a non-member who has no refresh token without calling PingOne", async () => {
    const refresh = vi.fn(async () => {
      throw new Error("no refresh token");
    });
    const session = sessionFor(ada, {
      idToken: token([]),
      pilotMember: false,
      pilotCheckedAt: now - PILOT_MAX_AGE_MS - 1,
      refreshToken: null,
      accessExpiresAt: now + 3_600_000,
    });
    const error = await authorizeAiCall({
      settings: settingsOn,
      session,
      kv: memoryKv(),
      now,
      refresh,
    }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ status: 403, kind: "pilot_required", message: PILOT_REQUIRED });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("still refreshes a stale check after five minutes when a refresh token is present", async () => {
    const session = sessionFor(ada, {
      idToken: token([]),
      pilotMember: true,
      pilotCheckedAt: now - PILOT_MAX_AGE_MS - 1,
      refreshToken: "refresh",
      accessExpiresAt: now + 3_600_000,
    });
    const refresh = vi.fn(async (): Promise<RefreshedPilot> => ({
      receivedIdToken: true,
      session: { ...session, idToken: token([GROUP]) },
    }));
    const allowed = await authorizeAiCall({
      settings: settingsOn,
      session,
      kv: memoryKv(),
      now,
      refresh,
    });
    expect(refresh).toHaveBeenCalledOnce();
    expect(allowed.pilotMember).toBe(true);
    expect(allowed.pilotCheckedAt).toBe(now);
  });

  it("fails closed when a required refresh does not return an ID token", async () => {
    const session = sessionFor(ada, { pilotMember: true, pilotCheckedAt: now - PILOT_MAX_AGE_MS - 5 });
    await expect(
      authorizeAiCall({
        settings: settingsOn,
        session,
        kv: memoryKv(),
        now,
        refresh: async () => {
          throw new Error("PingOne unavailable");
        },
      }),
    ).rejects.toMatchObject({ status: 403, kind: "pilot_required" });

    await expect(
      authorizeAiCall({
        settings: settingsOn,
        session,
        kv: memoryKv(),
        now,
        refresh: async () => ({ receivedIdToken: false, session }),
      }),
    ).rejects.toMatchObject({ status: 403, kind: "pilot_required" });
    expect(session.accessToken).toBe("access");
  });
});

describe("mock pilot membership", () => {
  it("starts Robert in the group and a newly registered user outside it", async () => {
    const provider = createMockPingOne();
    const settings = pilotSettings({ AI_PILOT_GATE_ENABLED: "true" });
    const robertLogin = await beginLogin(provider, {
      state: "state",
      nonce: "nonce",
      codeChallenge: "challenge",
      codeVerifier: "verifier",
    });
    const robertDone = await advanceLogin(provider, robertLogin.record, {
      type: "password",
      username: MOCK_USERNAME,
      password: MOCK_PASSWORD,
    });
    const robert = stampPilot(await establishSession(provider, robertDone.record, robertDone.completed!), settings);
    expect(robert.pilotMember).toBe(true);
    expect(readGroupsClaim(decodeJwtPayload(robert.idToken), "groups")).toEqual([GROUP]);

    const adaLogin = await beginLogin(provider, {
      state: "state-2",
      nonce: "nonce-2",
      codeChallenge: "challenge",
      codeVerifier: "verifier",
    });
    const registered = await advanceLogin(provider, adaLogin.record, {
      type: "register",
      username: MOCK_REGISTER_USERNAME,
      email: MOCK_REGISTER_EMAIL,
      password: MOCK_REGISTER_PASSWORD,
    });
    const verified = await advanceLogin(provider, registered.record, {
      type: "verify",
      verificationCode: MOCK_VERIFICATION_CODE,
    });
    const ada = stampPilot(await establishSession(provider, verified.record, verified.completed!), settings);
    expect(ada.user.email).toBe(MOCK_REGISTER_EMAIL);
    expect(ada.pilotMember).toBe(false);
  });

  it("toggles the current mock session and keeps that choice across refresh", async () => {
    const provider = createMockPingOne({ pilotGroup: GROUP });
    const settings = pilotSettings({ AI_PILOT_GATE_ENABLED: "true", AI_PILOT_GROUP: GROUP });
    const started = await beginLogin(provider, {
      state: "state",
      nonce: "nonce",
      codeChallenge: "challenge",
      codeVerifier: "verifier",
    });
    const done = await advanceLogin(provider, started.record, {
      type: "password",
      username: MOCK_USERNAME,
      password: MOCK_PASSWORD,
    });
    const robert = stampPilot(await establishSession(provider, done.record, done.completed!), settings);
    const outside = applyPilotToggle(robert, false, settings, true);
    expect(outside.pilotMember).toBe(false);
    expect(memberFromIdToken(outside.idToken, "groups", GROUP)).toBe(false);

    const refreshed = stampPilot(await refreshSession(provider, outside), settings);
    expect(refreshed.pilotMember).toBe(false);

    const inside = applyPilotToggle(refreshed, true, settings, true);
    expect(inside.pilotMember).toBe(true);
    expect(memberFromIdToken(inside.idToken, settings.groupsClaim, settings.group)).toBe(true);
  });

  it("refuses the toggle outside mock mode", () => {
    const settings = pilotSettings({ AI_PILOT_GATE_ENABLED: "true" });
    const session = sessionFor(profile("user-robert", MOCK_USERNAME), { pilotMember: true, pilotCheckedAt: Date.now() });
    expect(() => applyPilotToggle(session, false, settings, false)).toThrow(HttpError);
    try {
      applyPilotToggle(session, false, settings, false);
    } catch (error) {
      expect(error).toMatchObject({ status: 404 });
    }
  });
});

describe("per-user AI budget", () => {
  const now = 1_700_000_000_000;

  it("limits calls per hour and tokens per day separately for each user", async () => {
    const kv = memoryKv();
    for (let call = 0; call < 2; call += 1) {
      await consumeAiBudget(kv, { userId: "user-robert", callsPerHour: 2, tokensPerDay: 100, tokens: 40, now });
    }
    const callLimited = await consumeAiBudget(kv, {
      userId: "user-robert",
      callsPerHour: 2,
      tokensPerDay: 100,
      now,
    }).catch((reason: unknown) => reason);
    expect(callLimited).toMatchObject({ status: 429, kind: "ai_call_limit" });

    const other = await consumeAiBudget(kv, { userId: "user-ada", callsPerHour: 2, tokensPerDay: 100, tokens: 10, now });
    expect(other.callsRemaining).toBe(1);

    const kvTokens = memoryKv();
    await consumeAiBudget(kvTokens, { userId: "user-robert", callsPerHour: 30, tokensPerDay: 100, tokens: 80, now });
    const tokenLimited = await consumeAiBudget(kvTokens, {
      userId: "user-robert",
      callsPerHour: 30,
      tokensPerDay: 100,
      tokens: 21,
      now,
    }).catch((reason: unknown) => reason);
    expect(tokenLimited).toMatchObject({ status: 429, kind: "ai_token_limit" });

    const adaStill = await consumeAiBudget(kvTokens, {
      userId: "user-ada",
      callsPerHour: 30,
      tokensPerDay: 100,
      tokens: 100,
      now,
    });
    expect(adaStill.tokensRemaining).toBe(0);
  });

  it("rejects the next call once the daily token budget is already spent", async () => {
    const kv = memoryKv();
    await consumeAiBudget(kv, { userId: "user-robert", callsPerHour: 30, tokensPerDay: 50, tokens: 50, now });
    await expect(
      authorizeAiCall({
        settings: { ...settingsOn, callsPerHour: 30, tokensPerDay: 50 },
        session: sessionFor(profile("user-robert", MOCK_USERNAME), {
          pilotMember: true,
          pilotCheckedAt: now,
          idToken: token([GROUP]),
        }),
        kv,
        now,
      }),
    ).rejects.toMatchObject({ status: 429, kind: "ai_token_limit" });
  });
});
