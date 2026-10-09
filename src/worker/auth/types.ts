export interface PingOneConfig {
  authHost: string;
  envId: string;
  clientId: string;
  clientSecret: string;
  redirectUri?: string | undefined;
  scopes: string;
}

export interface DeviceInfo {
  id: string;
  type: string;
  label: string;
}

export interface Profile {
  id: string;
  username: string;
  name: string;
  email: string;
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string | undefined;
  idToken?: string | undefined;
  expiresIn: number;
  tokenType: string;
}

export interface FlowCtx {
  flowId: string;
  cookies: string;
  state: string;
}

/**
 * Normalized PingOne flow result. Tokens never appear here — only an
 * authorization code once the flow reaches COMPLETED.
 */
export interface FlowOutcome {
  flowId: string;
  cookies: string;
  status: string;
  code?: string | undefined;
  devices: DeviceInfo[];
  selectedDeviceId?: string | undefined;
  username?: string | undefined;
  message?: string | undefined;
  /** True when the flow offered the `user.register` link. */
  canRegister?: boolean | undefined;
  /** Masked address PingOne returns on a verification step, such as `jo****@example.com`. */
  maskedEmail?: string | undefined;
}

export interface AuthProvider {
  readonly mode: "mock" | "pingone";
  begin(input: { state: string; nonce: string; codeChallenge: string }): Promise<FlowOutcome>;
  checkPassword(ctx: FlowCtx, username: string, password: string): Promise<FlowOutcome>;
  checkOtp(ctx: FlowCtx, otp: string): Promise<FlowOutcome>;
  selectDevice(ctx: FlowCtx, deviceId: string): Promise<FlowOutcome>;
  read(ctx: FlowCtx): Promise<FlowOutcome>;
  register(ctx: FlowCtx, input: { username: string; email: string; password: string }): Promise<FlowOutcome>;
  verifyRegistration(ctx: FlowCtx, verificationCode: string): Promise<FlowOutcome>;
  resendVerification(ctx: FlowCtx): Promise<FlowOutcome>;
  exchangeCode(input: { code: string; codeVerifier: string }): Promise<TokenSet>;
  refresh(refreshToken: string): Promise<TokenSet>;
  userInfo(accessToken: string): Promise<Profile>;
  endSession(input: { idToken?: string }): Promise<void>;
}

/** A PingOne error document, trimmed to fields that are safe to show and log. */
export interface PingOneFault {
  status: number;
  /** PingOne's `id`. On an error document this is the id stored in PingOne logs. */
  id?: string;
  code?: string;
  message?: string;
  target?: string;
  details?: Array<{ code?: string; target?: string; message?: string; requirements?: string[] }>;
  /** `Correlation-Id` response header, when PingOne sends one. */
  correlationId?: string;
  /** `X-Request-Id` or `Request-Id` response header, when present. */
  requestId?: string;
}

export class AuthFlowError extends Error {
  status: number;
  pingone?: PingOneFault | undefined;
  kind?: string | undefined;
  requirements?: string[] | undefined;

  constructor(
    status: number,
    message: string,
    pingone?: PingOneFault,
    extra?: { kind?: string; requirements?: string[] },
  ) {
    super(message);
    this.name = "AuthFlowError";
    this.status = status;
    this.pingone = pingone;
    this.kind = extra?.kind;
    this.requirements = extra?.requirements;
  }
}

export type LoginView =
  | { step: "username_password"; loginId: string; username?: string | undefined; message?: string | undefined; canRegister?: boolean | undefined }
  | { step: "verification"; loginId: string; email?: string | undefined; message?: string | undefined }
  | {
      step: "otp";
      loginId: string;
      devices: DeviceInfo[];
      selectedDeviceId?: string | undefined;
      message?: string | undefined;
    }
  | { step: "device_select"; loginId: string; devices: DeviceInfo[]; message?: string | undefined }
  | {
      step: "push";
      loginId: string;
      devices: DeviceInfo[];
      selectedDeviceId?: string | undefined;
      message?: string | undefined;
    }
  | { step: "unsupported"; loginId: string; status: string; message: string }
  | { step: "authenticated"; user: Profile; csrfToken: string };

export interface LoginRecord {
  id: string;
  flowId: string;
  cookies: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  status: string;
  canRegister: boolean;
  createdAt: number;
}

export interface SessionRecord {
  id: string;
  csrfToken: string;
  user: Profile;
  accessToken: string;
  refreshToken?: string | undefined;
  idToken?: string | undefined;
  accessExpiresAt: number;
  createdAt: number;
  absoluteExpiresAt: number;
  /** Decoded from the ID token. Missing means the check has not run. */
  pilotMember?: boolean | undefined;
  pilotCheckedAt?: number | undefined;
}
