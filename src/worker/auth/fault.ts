import { AuthFlowError, type PingOneFault } from "./types";

/**
 * PingOne error documents, from the platform error-codes reference:
 * `{ id, code, message, target?, details?: [{ code, target, message }] }`.
 * `id` is the value PingOne stores in its logs.
 * OAuth token failures use `{ error, error_description }` instead.
 * Flow actions sometimes keep a status and attach `error: { code, message }`.
 */

const SECRET_KEYS = ["password", "secret", "token", "cookie", "authorization", "verifier"];

export function isPingOneFailure(status: number, json: unknown): boolean {
  if (status >= 400) return true;
  const record = asRecord(json);
  if (!record) return false;
  const flowStatus = typeof record.status === "string" ? record.status : "";
  if (flowStatus === "COMPLETED" || flowStatus === "COMPLETED_ACCEPTED") return false;
  if (typeof record.code === "string" && record.code && !flowStatus) return true;
  if (typeof record.error === "string" && record.error) return true;
  const embedded = asRecord(record.error);
  if (embedded && (nonEmpty(embedded.code) || nonEmpty(embedded.message))) return true;
  if (Array.isArray(record.details) && record.details.some((item) => asRecord(item))) return true;
  if (flowStatus === "FAILED") return true;
  return false;
}

export function readPingOneFault(status: number, json: unknown, headers?: Headers): PingOneFault {
  const fault: PingOneFault = { status };
  const correlationId = headerValue(headers, ["correlation-id", "x-correlation-id"]);
  const requestId = headerValue(headers, ["x-request-id", "request-id", "x-ping-request-id"]);
  if (correlationId) fault.correlationId = clip(correlationId, 200);
  if (requestId) fault.requestId = clip(requestId, 200);

  const record = asRecord(json);
  if (!record) return fault;

  const id = nonEmpty(record.id);
  const code = nonEmpty(record.code);
  const message = nonEmpty(record.message);
  const target = nonEmpty(record.target);
  if (id) fault.id = clip(id, 200);
  if (code) fault.code = clip(code, 80);
  if (message) fault.message = clip(message, 500);
  if (target) fault.target = clip(target, 120);

  const details = readDetails(record.details);
  if (details.length) fault.details = details;

  const oauthError = nonEmpty(record.error);
  const oauthDescription = nonEmpty(record.error_description);
  if (oauthError) {
    fault.code ??= clip(oauthError, 80);
    if (oauthDescription) fault.message = clip(oauthDescription, 500);
  } else {
    const embedded = asRecord(record.error);
    const embeddedCode = embedded ? nonEmpty(embedded.code) : undefined;
    const embeddedMessage = embedded ? nonEmpty(embedded.message) : undefined;
    if (embeddedCode) fault.code ??= clip(embeddedCode, 80);
    if (embeddedMessage && !fault.message) fault.message = clip(embeddedMessage, 500);
  }

  return fault;
}

export function publicPingOneMessage(fault: PingOneFault, status: number): string {
  const details = fault.details?.map((detail) => detail.message).filter((message): message is string => Boolean(message));
  if (details && details.length) return details.join(" ");
  if (fault.message) return fault.message;
  if (fault.code) return fault.code;
  if (status === 400 || status === 401) return "The username or password was not accepted.";
  return "PingOne could not complete that step.";
}

export function throwPingOne(response: Response, json: unknown): never {
  const status = response.status >= 400 && response.status <= 599 ? response.status : 400;
  const fault = readPingOneFault(response.status, json, response.headers);
  const error = new AuthFlowError(status, publicPingOneMessage(fault, status), fault);
  logPingOneFailure(error);
  throw error;
}

export function classifyFault(fault: PingOneFault | undefined): { kind?: string; requirements: string[] } {
  if (!fault) return { requirements: [] };
  const details = fault.details ?? [];
  const blob = [fault.code, fault.message, fault.target, ...details.flatMap((detail) => [detail.code, detail.target, detail.message])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const passwordDetails = details.filter((detail) => (detail.target ?? "").toLowerCase() === "password");
  const inner = unique(passwordDetails.flatMap((detail) => detail.requirements ?? []));
  const requirements = inner.length
    ? inner
    : unique(passwordDetails.flatMap((detail) => (detail.message ? [detail.message] : [])));
  if (
    fault.code === "UNIQUENESS_VIOLATION" ||
    details.some((detail) => detail.code === "UNIQUENESS_VIOLATION") ||
    blob.includes("already exists") ||
    blob.includes("already in use")
  ) {
    return { kind: "taken", requirements: [] };
  }
  if (passwordDetails.length || blob.includes("password policy")) {
    return { kind: "password_policy", requirements };
  }
  if (
    fault.code === "INVALID_OTP" ||
    details.some((detail) => (detail.target ?? "").toLowerCase().includes("verification")) ||
    blob.includes("verification code")
  ) {
    return { kind: "invalid_code", requirements: [] };
  }
  return { requirements: [] };
}

export function authFailureBody(error: AuthFlowError): {
  error: string;
  kind?: string;
  requirements?: string[];
  pingone?: PingOneFault;
} {
  const classified = classifyFault(error.pingone);
  const kind = error.kind ?? classified.kind;
  const requirements = error.requirements ?? classified.requirements;
  const summary =
    kind === "password_policy" && error.pingone?.message ? error.pingone.message : error.message;
  return {
    error: summary,
    ...(kind ? { kind } : {}),
    ...(requirements.length ? { requirements } : {}),
    ...(error.pingone ? { pingone: error.pingone } : {}),
  };
}

/** Worker log line. Request bodies, cookies, and tokens are not included. */
export function logPingOneFailure(error: AuthFlowError): void {
  if (!error.pingone) return;
  const fault = error.pingone;
  console.error(
    JSON.stringify({
      event: "pingone.auth.failed",
      summary: error.message,
      httpStatus: fault.status,
      id: fault.id,
      code: fault.code,
      message: fault.message,
      target: fault.target,
      details: fault.details,
      correlationId: fault.correlationId,
      requestId: fault.requestId,
    }),
  );
}

function readDetails(value: unknown): NonNullable<PingOneFault["details"]> {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).flatMap((item) => {
    const record = asRecord(item);
    if (!record) return [];
    const code = nonEmpty(record.code);
    const target = nonEmpty(record.target);
    const message = nonEmpty(record.message);
    const requirements = readRequirements(record.innerError);
    if (!code && !target && !message && !requirements.length) return [];
    return [
      {
        ...(code ? { code: clip(code, 80) } : {}),
        ...(target ? { target: clip(target, 120) } : {}),
        ...(message ? { message: clip(message, 500) } : {}),
        ...(requirements.length ? { requirements } : {}),
      },
    ];
  });
}

function readRequirements(value: unknown): string[] {
  const record = asRecord(value);
  if (!record) return [];
  const lines: string[] = [];
  for (const [key, item] of Object.entries(record)) {
    if (SECRET_KEYS.some((secret) => key.toLowerCase() === secret)) continue;
    if (typeof item === "string" && item.trim()) lines.push(clip(item.trim(), 240));
    if (!Array.isArray(item)) continue;
    for (const entry of item) {
      if (typeof entry === "string" && entry.trim()) lines.push(clip(entry.trim(), 240));
    }
  }
  return unique(lines).slice(0, 12);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function headerValue(headers: Headers | undefined, names: string[]): string | undefined {
  if (!headers) return undefined;
  for (const name of names) {
    const value = headers.get(name)?.trim();
    if (value) return value;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function nonEmpty(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const lower = trimmed.toLowerCase();
  if (SECRET_KEYS.some((key) => lower.includes(`${key}=`) || lower.includes(`"${key}"`))) return undefined;
  return trimmed;
}

function clip(value: string, max: number): string {
  const cleaned = value.replace(/[\r\n]+/g, " ").trim();
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned;
}
