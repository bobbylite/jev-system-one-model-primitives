import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { getCsrf, setCsrf } from "./csrf";
import { onBlocked, onReauth } from "./signals";

export interface SessionUser {
  id: string;
  username: string;
  name: string;
  email: string;
}

export interface PilotState {
  gateEnabled: boolean;
  member: boolean;
  group: string;
}

interface SessionPayload {
  user: SessionUser | null;
  csrfToken: string | null;
  mock: boolean;
  pilot: PilotState;
}

interface Hints {
  username: string;
  password: string;
  mfaPassword: string;
  otp: string;
  registerUsername: string;
  registerEmail: string;
  registerPassword: string;
  verificationCode: string;
}

interface Device {
  id: string;
  type: string;
  label: string;
}

type LoginView =
  | { step: "username_password"; loginId: string; username?: string; message?: string; canRegister?: boolean }
  | { step: "verification"; loginId: string; email?: string; message?: string }
  | { step: "otp"; loginId: string; devices: Device[]; selectedDeviceId?: string; message?: string }
  | { step: "device_select"; loginId: string; devices: Device[]; message?: string }
  | { step: "push"; loginId: string; devices: Device[]; selectedDeviceId?: string; message?: string }
  | { step: "unsupported"; loginId: string; status: string; message: string }
  | { step: "authenticated"; user: SessionUser; csrfToken: string; mock: boolean; pilot: PilotState };

interface PingOneFault {
  status?: number;
  id?: string;
  code?: string;
  message?: string;
  target?: string;
  details?: Array<{ code?: string; target?: string; message?: string }>;
  correlationId?: string;
  requestId?: string;
}

interface Failure {
  message: string;
  kind?: string;
  requirements?: string[];
  pingone?: PingOneFault;
}

type Phase = "loading" | "signed-out" | "app" | "blocked" | "reauth";

interface ShellState {
  name: string;
  signOut: () => void;
}

const ShellContext = createContext<ShellState>({ name: "", signOut: () => {} });

export function useShell(): ShellState {
  return useContext(ShellContext);
}

export function Gate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [failure, setFailure] = useState<string>("");

  useEffect(() => {
    let active = true;
    void authSend<SessionPayload>("/api/auth/session")
      .then((next) => {
        if (!active) return;
        applySession(next, setSession, setPhase);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setFailure(readFailure(reason).message);
        setPhase("signed-out");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => onReauth(() => setPhase("reauth")), []);
  useEffect(() => onBlocked(() => setPhase("blocked")), []);

  async function signOut() {
    try {
      await authSend("/api/auth/logout", {});
    } catch {
      // The cookie clear is best-effort. Local state still returns to the login page.
    }
    setCsrf(null);
    setSession(null);
    setPhase("signed-out");
  }

  if (phase === "loading") {
    return (
      <main className="gate">
        <p className="gate-wait">Checking your session…</p>
      </main>
    );
  }

  if (phase === "reauth") {
    return <Reauth onSignIn={() => void signOut()} />;
  }

  if (phase === "blocked" && session?.user) {
    return <Blocked group={session.pilot.group} name={session.user.name} onSignOut={() => void signOut()} />;
  }

  if (phase !== "app" || !session?.user) {
    return (
      <AuthPanel
        loadError={failure}
        onAuthenticated={(next) => applySession(next, setSession, setPhase)}
      />
    );
  }

  return (
    <ShellContext.Provider value={{ name: session.user.name, signOut: () => void signOut() }}>
      {children}
    </ShellContext.Provider>
  );
}

function applySession(
  next: SessionPayload,
  setSession: (session: SessionPayload) => void,
  setPhase: (phase: Phase) => void,
) {
  setCsrf(next.csrfToken);
  setSession(next);
  if (!next.user) {
    setPhase("signed-out");
    return;
  }
  setPhase(next.pilot.gateEnabled && !next.pilot.member ? "blocked" : "app");
}

function AuthPanel({ loadError, onAuthenticated }: {
  loadError: string;
  onAuthenticated: (session: SessionPayload) => void;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  return (
    <main className="gate">
      <section className="gate-story">
        <p className="eyebrow">System One · typed judgments</p>
        <h1>Jev <em>answers.</em><br />Code decides.</h1>
        <p className="lede">
          Three primitives, one sign-in. The browser never sees a token. PingOne stays on the server.
        </p>
        <ul className="gate-points">
          <li><b>Noul</b><span>Is it a sandwich?</span></li>
          <li><b>Score</b><span>How much of a cult is it?</span></li>
          <li><b>Choice</b><span>Route the chaos.</span></li>
        </ul>
      </section>
      <section className="gate-panel">
        {mode === "login" ? (
          <LoginCard
            loadError={loadError}
            onAuthenticated={onAuthenticated}
            onRegister={() => setMode("register")}
          />
        ) : (
          <RegisterCard onAuthenticated={onAuthenticated} onLogin={() => setMode("login")} />
        )}
      </section>
    </main>
  );
}

function LoginCard({ loadError, onAuthenticated, onRegister }: {
  loadError: string;
  onAuthenticated: (session: SessionPayload) => void;
  onRegister: () => void;
}) {
  const [hints, setHints] = useState<Hints | null>(null);
  const [mock, setMock] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [otp, setOtp] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [view, setView] = useState<LoginView | null>(null);
  const [failure, setFailure] = useState<Failure | null>(loadError ? { message: loadError } : null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    document.title = "Sign in — Jev";
    void authSend<{ mock: boolean; hints: Hints | null }>("/api/auth/config")
      .then((config) => {
        setMock(config.mock);
        setHints(config.hints);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (view?.step !== "push") return;
    const loginId = view.loginId;
    const timer = window.setInterval(() => {
      void authSend<LoginView>("/api/auth/login/continue", { loginId })
        .then((next) => void accept(next))
        .catch((reason: unknown) => setFailure(readFailure(reason)));
    }, 2000);
    return () => window.clearInterval(timer);
  }, [view]);

  async function accept(next: LoginView) {
    if (next.step === "authenticated") {
      onAuthenticated({ user: next.user, csrfToken: next.csrfToken, mock: next.mock, pilot: next.pilot });
      return;
    }
    setView(next);
    if (next.step === "device_select" && next.devices[0]) setDeviceId(next.devices[0].id);
    if (next.step === "otp") setOtp("");
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    setPending(true);
    try {
      if (!view || view.step === "username_password") {
        const started = await authSend<LoginView>("/api/auth/login/start", {});
        if (started.step === "authenticated") {
          await accept(started);
          return;
        }
        if (started.step !== "username_password") {
          await accept(started);
          return;
        }
        await accept(await authSend<LoginView>("/api/auth/login/password", {
          loginId: started.loginId,
          username,
          password,
        }));
        return;
      }
      if (view.step === "otp") {
        await accept(await authSend<LoginView>("/api/auth/login/otp", { loginId: view.loginId, otp }));
        return;
      }
      if (view.step === "device_select") {
        await accept(await authSend<LoginView>("/api/auth/login/device", { loginId: view.loginId, deviceId }));
      }
    } catch (reason) {
      setFailure(readFailure(reason));
    } finally {
      setPending(false);
    }
  }

  const title = view?.step === "otp"
    ? "Check your device"
    : view?.step === "device_select"
      ? "Choose a device"
      : view?.step === "push"
        ? "Confirm sign-in"
        : "Sign in";

  return (
    <div className="gate-card">
      <p className="eyebrow">Jev · Lab</p>
      <h2>{title}</h2>
      <p className="gate-sub">
        {view?.step === "otp"
          ? view.message ?? "Enter the one-time code PingOne sent."
          : view?.step === "push"
            ? view.message ?? "Approve the prompt, and this page will continue."
            : "Your password is posted to this app’s server. The browser never receives a token."}
      </p>
      {mock && hints && !view ? <MockLogin hints={hints} onFill={setUsername} onPassword={setPassword} /> : null}
      <form onSubmit={onSubmit} noValidate>
        {failure ? <FailureView failure={failure} /> : null}
        {!view || view.step === "username_password" ? (
          <>
            <label className="gate-field">
              <span>Username</span>
              <input name="username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required />
            </label>
            <label className="gate-field">
              <span>Password</span>
              <div className="gate-password">
                <input
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
                <button type="button" className="text-btn" onClick={() => setShowPassword((value) => !value)}>
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </label>
          </>
        ) : null}
        {view?.step === "otp" ? (
          <>
            {view.devices.length ? <p className="gate-sub">{view.devices.map((device) => device.label).join(" · ")}</p> : null}
            <label className="gate-field">
              <span>One-time code</span>
              <input inputMode="numeric" autoComplete="one-time-code" value={otp} onChange={(event) => setOtp(event.target.value)} required />
            </label>
            {mock && hints ? <p className="gate-fine">Fake PingOne code {hints.otp}</p> : null}
          </>
        ) : null}
        {view?.step === "device_select" ? (
          <div className="gate-devices" role="radiogroup" aria-label="Devices">
            {view.devices.map((device) => (
              <label className="gate-device" key={device.id}>
                <input type="radio" name="device" value={device.id} checked={deviceId === device.id} onChange={() => setDeviceId(device.id)} />
                <span>{device.label}<small>{device.type}</small></span>
              </label>
            ))}
          </div>
        ) : null}
        {view?.step === "unsupported" ? <p className="error">{view.message}</p> : null}
        {view?.step === "push" ? <p className="gate-sub">Waiting for the device…</p> : null}
        {view?.step !== "push" && view?.step !== "unsupported" ? (
          <button className="go gate-submit" type="submit" disabled={pending} aria-busy={pending}>
            {pending ? "Checking…" : view?.step === "otp" || view?.step === "device_select" ? "Continue" : "Sign in"}
          </button>
        ) : null}
        {view ? (
          <button type="button" className="text-btn gate-again" onClick={() => { setView(null); setFailure(null); setOtp(""); }}>
            Start over
          </button>
        ) : null}
      </form>
      <p className="gate-fine">Session cookie is httpOnly. Sign-out, expiry, and refresh stay on the server.</p>
      <p className="gate-switch">New here? <button type="button" className="text-btn" onClick={onRegister}>Create account</button></p>
    </div>
  );
}

function MockLogin({ hints, onFill, onPassword }: {
  hints: Hints;
  onFill: (username: string) => void;
  onPassword: (password: string) => void;
}) {
  return (
    <div className="mock-banner">
      <p className="eyebrow">Fake PingOne</p>
      <p>Local mock. PingOne is not contacted. This is not the production tenant.</p>
      <div className="mock-actions">
        <button type="button" className="text-btn" onClick={() => { onFill(hints.username); onPassword(hints.password); }}>
          Pilot member
        </button>
        <button type="button" className="text-btn" onClick={() => { onFill(hints.username); onPassword(hints.mfaPassword); }}>
          MFA step
        </button>
      </div>
    </div>
  );
}

function RegisterCard({ onAuthenticated, onLogin }: {
  onAuthenticated: (session: SessionPayload) => void;
  onLogin: () => void;
}) {
  const [hints, setHints] = useState<Hints | null>(null);
  const [mock, setMock] = useState(false);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState("");
  const [view, setView] = useState<LoginView | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [starting, setStarting] = useState(true);
  const onAuthenticatedRef = useRef(onAuthenticated);
  onAuthenticatedRef.current = onAuthenticated;

  useEffect(() => {
    document.title = "Create account — Jev";
    void authSend<{ mock: boolean; hints: Hints | null }>("/api/auth/config")
      .then((config) => {
        setMock(config.mock);
        setHints(config.hints);
      })
      .catch(() => {});
    let active = true;
    void authSend<LoginView>("/api/auth/login/start", {})
      .then((next) => {
        if (!active) return;
        if (next.step === "authenticated") {
          onAuthenticatedRef.current({ user: next.user, csrfToken: next.csrfToken, mock: next.mock, pilot: next.pilot });
          return;
        }
        setView(next);
      })
      .catch((reason: unknown) => {
        if (active) setFailure(readFailure(reason));
      })
      .finally(() => {
        if (active) setStarting(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const verifying = view?.step === "verification";
  const disabled = view?.step === "username_password" && view.canRegister === false;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!view || view.step === "unsupported" || view.step === "authenticated") return;
    if (view.step === "username_password" && view.canRegister === false) return;
    setFailure(null);
    setNotice("");
    if (view.step !== "verification" && password !== confirm) {
      setFailure({ message: "Those passwords don’t match." });
      return;
    }
    setPending(true);
    try {
      const next = view.step === "verification"
        ? await authSend<LoginView>("/api/auth/login/verify", { loginId: view.loginId, verificationCode: code })
        : await authSend<LoginView>("/api/auth/login/register", { loginId: view.loginId, username, email, password });
      if (next.step === "authenticated") {
        onAuthenticated({ user: next.user, csrfToken: next.csrfToken, mock: next.mock, pilot: next.pilot });
        return;
      }
      setView(next);
      if (next.step === "verification") setCode("");
    } catch (reason) {
      setFailure(readFailure(reason));
    } finally {
      setPending(false);
    }
  }

  async function resend() {
    if (view?.step !== "verification") return;
    setPending(true);
    setFailure(null);
    try {
      const next = await authSend<LoginView>("/api/auth/login/resend", { loginId: view.loginId });
      if (next.step === "authenticated") {
        onAuthenticated({ user: next.user, csrfToken: next.csrfToken, mock: next.mock, pilot: next.pilot });
        return;
      }
      setView(next);
      setNotice(next.step === "verification" ? next.message ?? "A new code was sent." : "");
    } catch (reason) {
      setFailure(readFailure(reason));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="gate-card">
      <p className="eyebrow">{verifying ? "Verify" : "Create account"}</p>
      <h2>{disabled ? "Registration is off" : verifying ? "Check your email" : "Join the lab"}</h2>
      <p className="gate-sub">
        {disabled
          ? "This PingOne application’s sign-on policy is not offering registration."
          : verifying
            ? view.message ?? "Enter the code PingOne emailed you. This page does not leave Jev."
            : "Your password is posted to this app’s server. The browser never receives a token."}
      </p>
      {verifying && view.email ? <p className="gate-fine">Sent to {view.email}</p> : null}
      {mock && hints && !disabled ? (
        <div className="mock-banner">
          <p className="eyebrow">Fake PingOne</p>
          <p>
            {verifying
              ? `Local mock. The verification code is ${hints.verificationCode}.`
              : "Local mock. PingOne is not contacted. A new account is outside the pilot group."}
          </p>
          {!verifying ? (
            <div className="mock-actions">
              <button
                type="button"
                className="text-btn"
                onClick={() => {
                  setUsername(hints.registerUsername);
                  setEmail(hints.registerEmail);
                  setPassword(hints.registerPassword);
                  setConfirm(hints.registerPassword);
                }}
              >
                Sample account
              </button>
            </div>
          ) : (
            <div className="mock-actions">
              <button type="button" className="text-btn" onClick={() => setCode(hints.verificationCode)}>Fill code</button>
            </div>
          )}
        </div>
      ) : null}
      {starting ? <p className="gate-sub">Opening a sign-up session…</p> : null}
      {failure ? <FailureView failure={failure} /> : null}
      {notice ? <p className="gate-note" role="status">{notice}</p> : null}
      {!starting && view && !disabled && view.step !== "unsupported" ? (
        <form onSubmit={onSubmit} noValidate>
          {verifying ? (
            <label className="gate-field">
              <span>Verification code</span>
              <input name="verification-code" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} required />
            </label>
          ) : (
            <>
              <label className="gate-field">
                <span>Username</span>
                <input name="username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required />
              </label>
              <label className="gate-field">
                <span>Email</span>
                <input name="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
              </label>
              <label className="gate-field">
                <span>Password</span>
                <div className="gate-password">
                  <input
                    name="new-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                  />
                  <button type="button" className="text-btn" onClick={() => setShowPassword((value) => !value)}>
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </label>
              <label className="gate-field">
                <span>Confirm password</span>
                <input
                  name="confirm-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  required
                />
              </label>
            </>
          )}
          <button className="go gate-submit" type="submit" disabled={pending} aria-busy={pending}>
            {pending ? "Checking…" : verifying ? "Verify and sign in" : "Create account"}
          </button>
          {verifying ? (
            <button type="button" className="text-btn gate-again" onClick={() => void resend()} disabled={pending}>Resend code</button>
          ) : null}
        </form>
      ) : null}
      {view?.step === "unsupported" ? <p className="error">{view.message}</p> : null}
      <p className="gate-switch">Already have an account? <button type="button" className="text-btn" onClick={onLogin}>Sign in</button></p>
    </div>
  );
}

function Blocked({ group, name, onSignOut }: { group: string; name: string; onSignOut: () => void }) {
  useEffect(() => {
    document.title = "Not in the pilot — Jev";
  }, []);
  return (
    <main className="gate">
      <section className="gate-story">
        <p className="eyebrow">Signed in as {name}</p>
        <h1>You’re not in the <em>Jev pilot.</em></h1>
        <p className="lede">
          The lab is open only to members of <span className="mono">{group}</span>. An admin adds people to that group in PingOne.
        </p>
      </section>
      <section className="gate-panel">
        <div className="gate-card">
          <p className="eyebrow">Pilot gate</p>
          <h2>You’re not in the Jev pilot</h2>
          <p className="gate-sub">
            Signing in worked. Membership did not. Jev stays closed until your account is in {group}.
          </p>
          <button className="go gate-submit" type="button" onClick={onSignOut}>Sign out</button>
        </div>
      </section>
    </main>
  );
}

function Reauth({ onSignIn }: { onSignIn: () => void }) {
  useEffect(() => {
    document.title = "Sign in again — Jev";
  }, []);
  return (
    <main className="gate">
      <section className="gate-story">
        <p className="eyebrow">Session</p>
        <h1>Sign in <em>again.</em></h1>
        <p className="lede">The groups check from your last sign-in has expired. Jev will not run until you sign in again.</p>
      </section>
      <section className="gate-panel">
        <div className="gate-card">
          <p className="eyebrow">Sign in again</p>
          <h2>Sign in again</h2>
          <p className="gate-sub">Sign in again to keep using Jev.</p>
          <button className="go gate-submit" type="button" onClick={onSignIn}>Sign in again</button>
        </div>
      </section>
    </main>
  );
}

function FailureView({ failure }: { failure: Failure }) {
  const message = failure.kind === "taken"
    ? "That username or email is already registered. Sign in, or choose another."
    : failure.message;
  return (
    <div className="error" role="alert">
      <p>{message}</p>
      {failure.kind === "password_policy" && failure.requirements?.length ? (
        <ul className="gate-reqs">
          {failure.requirements.map((requirement) => <li key={requirement}>{requirement}</li>)}
        </ul>
      ) : null}
      {failure.pingone ? <FaultView fault={failure.pingone} /> : null}
    </div>
  );
}

function FaultView({ fault }: { fault: PingOneFault }) {
  const rows: Array<[string, string]> = [];
  if (fault.code) rows.push(["code", fault.code]);
  if (fault.message) rows.push(["message", fault.message]);
  if (fault.target) rows.push(["target", fault.target]);
  for (const detail of fault.details ?? []) {
    const label = detail.target ? `${detail.code ?? "detail"} · ${detail.target}` : (detail.code ?? "detail");
    if (detail.message) rows.push([label, detail.message]);
  }
  if (fault.id) rows.push(["id", fault.id]);
  if (fault.correlationId) rows.push(["correlationId", fault.correlationId]);
  if (fault.requestId) rows.push(["requestId", fault.requestId]);
  if (!rows.length) return null;
  return (
    <dl className="gate-fault">
      {rows.map(([label, value], index) => (
        <div key={`${label}-${index}`}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

class AuthClientError extends Error {
  readonly kind?: string;
  readonly requirements?: string[];
  readonly pingone?: PingOneFault;

  constructor(message: string, extra: { kind?: string; requirements?: string[]; pingone?: PingOneFault }) {
    super(message);
    this.name = "AuthClientError";
    if (extra.kind !== undefined) this.kind = extra.kind;
    if (extra.requirements !== undefined) this.requirements = extra.requirements;
    if (extra.pingone !== undefined) this.pingone = extra.pingone;
  }
}

async function authSend<T>(path: string, body?: unknown): Promise<T> {
  const headers = new Headers({ accept: "application/json" });
  if (body !== undefined) {
    headers.set("content-type", "application/json");
    const csrf = getCsrf();
    if (csrf) headers.set("x-csrf-token", csrf);
  }
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers,
    credentials: "same-origin",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
    } catch {
      data = {};
    }
  }
  if (!response.ok) {
    const message = typeof data.detail === "string" ? data.detail : typeof data.error === "string" ? data.error : "Request failed.";
    const requirements = Array.isArray(data.requirements)
      ? data.requirements.filter((item): item is string => typeof item === "string")
      : undefined;
    const pingone = readFault(data.pingone);
    throw new AuthClientError(message, {
      ...(typeof data.kind === "string" ? { kind: data.kind } : {}),
      ...(requirements?.length ? { requirements } : {}),
      ...(pingone ? { pingone } : {}),
    });
  }
  return data as T;
}

function readFailure(reason: unknown): Failure {
  if (reason instanceof AuthClientError) {
    return {
      message: reason.message,
      ...(reason.kind ? { kind: reason.kind } : {}),
      ...(reason.requirements ? { requirements: reason.requirements } : {}),
      ...(reason.pingone ? { pingone: reason.pingone } : {}),
    };
  }
  if (reason instanceof Error) return { message: reason.message };
  return { message: "Sign-in failed." };
}

function readFault(value: unknown): PingOneFault | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const details = Array.isArray(record.details)
    ? record.details.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const detail = item as Record<string, unknown>;
        return [{
          ...(typeof detail.code === "string" ? { code: detail.code } : {}),
          ...(typeof detail.target === "string" ? { target: detail.target } : {}),
          ...(typeof detail.message === "string" ? { message: detail.message } : {}),
        }];
      })
    : undefined;
  const fault: PingOneFault = {
    ...(typeof record.status === "number" ? { status: record.status } : {}),
    ...(typeof record.id === "string" ? { id: record.id } : {}),
    ...(typeof record.code === "string" ? { code: record.code } : {}),
    ...(typeof record.message === "string" ? { message: record.message } : {}),
    ...(typeof record.target === "string" ? { target: record.target } : {}),
    ...(details?.length ? { details } : {}),
    ...(typeof record.correlationId === "string" ? { correlationId: record.correlationId } : {}),
    ...(typeof record.requestId === "string" ? { requestId: record.requestId } : {}),
  };
  return Object.keys(fault).length ? fault : undefined;
}
