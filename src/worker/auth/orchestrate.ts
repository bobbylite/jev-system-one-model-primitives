import type { AuthProvider, FlowOutcome, LoginRecord, LoginView, Profile, SessionRecord } from "./types";
import { AuthFlowError } from "./types";

export const REGISTRATION_DISABLED =
  "Registration is not enabled for this PingOne application. In the admin console, open the sign-on policy attached to the Jev app, add the Registration action, choose the population new users join, and turn on email verification if new accounts should enter a code.";

export type LoginAction =
  | { type: "password"; username: string; password: string }
  | { type: "otp"; otp: string }
  | { type: "device"; deviceId: string }
  | { type: "read" }
  | { type: "register"; username: string; email: string; password: string }
  | { type: "verify"; verificationCode: string }
  | { type: "resend" };

export const SESSION_SECONDS = 60 * 60 * 12;
export const LOGIN_SECONDS = 60 * 15;
const REFRESH_SKEW_MS = 60_000;

export function viewForOutcome(loginId: string, outcome: FlowOutcome): LoginView {
  switch (outcome.status) {
    case "USERNAME_PASSWORD_REQUIRED":
    case "PASSWORD_REQUIRED":
      return {
        step: "username_password",
        loginId,
        username: outcome.username,
        message: outcome.message,
        canRegister: outcome.canRegister,
      };
    case "VERIFICATION_CODE_REQUIRED":
    case "VERIFICATION_REQUIRED":
      return {
        step: "verification",
        loginId,
        email: outcome.maskedEmail,
        message: outcome.message ?? "Enter the 8-character verification code from your email.",
      };
    case "OTP_REQUIRED":
      return {
        step: "otp",
        loginId,
        devices: outcome.devices,
        selectedDeviceId: outcome.selectedDeviceId,
        message: outcome.message ?? "Enter the verification code from your device.",
      };
    case "DEVICE_SELECTION_REQUIRED":
      return {
        step: "device_select",
        loginId,
        devices: outcome.devices,
        message: outcome.message ?? "Choose a device to continue.",
      };
    case "PUSH_CONFIRMATION_REQUIRED":
      return {
        step: "push",
        loginId,
        devices: outcome.devices,
        selectedDeviceId: outcome.selectedDeviceId,
        message: outcome.message ?? "Confirm the sign-in on your device.",
      };
    case "PUSH_CONFIRMATION_TIMED_OUT":
      return {
        step: "push",
        loginId,
        devices: outcome.devices,
        selectedDeviceId: outcome.selectedDeviceId,
        message: "The push confirmation timed out. Try again, or choose another device.",
      };
    case "FAILED":
      throw new AuthFlowError(401, outcome.message ?? "Sign-in failed.");
    default:
      return {
        step: "unsupported",
        loginId,
        status: outcome.status,
        message: `PingOne asked for a step this demo does not collect yet (${outcome.status}).`,
      };
  }
}

export async function beginLogin(
  provider: AuthProvider,
  input: { state: string; nonce: string; codeChallenge: string; codeVerifier: string },
): Promise<{ record: LoginRecord; view: LoginView; completed?: FlowOutcome }> {
  const outcome = await provider.begin(input);
  const record = recordFrom(crypto.randomUUID(), input, outcome);
  if (isComplete(outcome)) return { record, view: placeholder(record.id), completed: outcome };
  return { record, view: viewForOutcome(record.id, outcome) };
}

export async function advanceLogin(
  provider: AuthProvider,
  record: LoginRecord,
  action: LoginAction,
): Promise<{ record: LoginRecord; view: LoginView; completed?: FlowOutcome }> {
  if (action.type === "register" && !record.canRegister) {
    throw new AuthFlowError(409, REGISTRATION_DISABLED, undefined, { kind: "registration_disabled" });
  }
  const ctx = { flowId: record.flowId, cookies: record.cookies, state: record.state };
  const outcome =
    action.type === "password"
      ? await provider.checkPassword(ctx, action.username, action.password)
      : action.type === "otp"
        ? await provider.checkOtp(ctx, action.otp)
        : action.type === "device"
          ? await provider.selectDevice(ctx, action.deviceId)
          : action.type === "register"
            ? await provider.register(ctx, action)
            : action.type === "verify"
              ? await provider.verifyRegistration(ctx, action.verificationCode)
              : action.type === "resend"
                ? await provider.resendVerification(ctx)
                : await provider.read(ctx);
  const next = recordFrom(record.id, record, outcome);
  if (isComplete(outcome)) return { record: next, view: placeholder(record.id), completed: outcome };
  return { record: next, view: viewForOutcome(record.id, outcome) };
}

export async function establishSession(
  provider: AuthProvider,
  record: LoginRecord,
  outcome: FlowOutcome,
): Promise<SessionRecord> {
  if (!outcome.code) throw new AuthFlowError(502, "PingOne completed sign-on without an authorization code.");
  const tokens = await provider.exchangeCode({ code: outcome.code, codeVerifier: record.codeVerifier });
  const user = await provider.userInfo(tokens.accessToken);
  return sessionFromTokens(user, tokens);
}

export async function refreshSession(provider: AuthProvider, session: SessionRecord): Promise<SessionRecord> {
  const detailed = await refreshSessionDetailed(provider, session);
  return detailed.session;
}

/** `receivedIdToken` is true only when this refresh grant returned a new ID token. */
export async function refreshSessionDetailed(
  provider: AuthProvider,
  session: SessionRecord,
): Promise<{ session: SessionRecord; receivedIdToken: boolean }> {
  if (!session.refreshToken) {
    throw new AuthFlowError(401, "The session expired. Sign in again.");
  }
  const tokens = await provider.refresh(session.refreshToken);
  const user = await provider.userInfo(tokens.accessToken).catch(() => session.user);
  const now = Date.now();
  return {
    receivedIdToken: Boolean(tokens.idToken),
    session: {
      ...session,
      user,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? session.refreshToken,
      idToken: tokens.idToken ?? session.idToken,
      accessExpiresAt: now + tokens.expiresIn * 1000,
    },
  };
}

export function sessionNeedsRefresh(session: SessionRecord, now = Date.now()): boolean {
  return session.accessExpiresAt - now <= REFRESH_SKEW_MS;
}

export function sessionExpired(session: SessionRecord, now = Date.now()): boolean {
  return now >= session.absoluteExpiresAt;
}

function sessionFromTokens(
  user: Profile,
  tokens: { accessToken: string; refreshToken?: string | undefined; idToken?: string | undefined; expiresIn: number },
): SessionRecord {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    csrfToken: crypto.randomUUID(),
    user,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    idToken: tokens.idToken,
    accessExpiresAt: now + tokens.expiresIn * 1000,
    createdAt: now,
    absoluteExpiresAt: now + SESSION_SECONDS * 1000,
  };
}

function recordFrom(
  id: string,
  prior: { state: string; nonce: string; codeVerifier: string; createdAt?: number; canRegister?: boolean },
  outcome: FlowOutcome,
): LoginRecord {
  return {
    id,
    flowId: outcome.flowId,
    cookies: outcome.cookies,
    state: prior.state,
    nonce: prior.nonce,
    codeVerifier: prior.codeVerifier,
    status: outcome.status,
    canRegister: outcome.canRegister || prior.canRegister || false,
    createdAt: prior.createdAt ?? Date.now(),
  };
}

function isComplete(outcome: FlowOutcome): boolean {
  return outcome.status === "COMPLETED" || outcome.status === "COMPLETED_ACCEPTED";
}

function placeholder(loginId: string): LoginView {
  return { step: "username_password", loginId };
}
