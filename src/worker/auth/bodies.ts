import { HttpError } from "../http";

/** Request bodies for the PingOne BFF. Messages match the estimator's form copy. */

export async function readPasswordBody(request: Request): Promise<{ loginId: string; username: string; password: string }> {
  const body = await readObject(request);
  return {
    loginId: loginId(body),
    username: trimmed(body, "username", 1, 200, "Enter a username"),
    password: raw(body, "password", 1, 200, "Enter a password"),
  };
}

export async function readOtpBody(request: Request): Promise<{ loginId: string; otp: string }> {
  const body = await readObject(request);
  return { loginId: loginId(body), otp: trimmed(body, "otp", 4, 12, "Enter the code") };
}

export async function readDeviceBody(request: Request): Promise<{ loginId: string; deviceId: string }> {
  const body = await readObject(request);
  return { loginId: loginId(body), deviceId: trimmed(body, "deviceId", 1, 80, "Choose a device to continue.") };
}

export async function readLoginIdBody(request: Request): Promise<{ loginId: string }> {
  return { loginId: loginId(await readObject(request)) };
}

export async function readRegisterBody(
  request: Request,
): Promise<{ loginId: string; username: string; email: string; password: string }> {
  const body = await readObject(request);
  const email = trimmed(body, "email", 1, 200, "Enter a valid email");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Enter a valid email");
  return {
    loginId: loginId(body),
    username: trimmed(body, "username", 1, 200, "Enter a username"),
    email,
    password: raw(body, "password", 1, 200, "Enter a password"),
  };
}

export async function readVerificationBody(request: Request): Promise<{ loginId: string; verificationCode: string }> {
  const body = await readObject(request);
  return {
    loginId: loginId(body),
    verificationCode: trimmed(body, "verificationCode", 4, 32, "Enter the verification code"),
  };
}

export async function readPilotToggle(request: Request): Promise<{ member: boolean }> {
  const body = await readObject(request);
  if (typeof body.member !== "boolean") throw new HttpError(400, "Invalid request.");
  return { member: body.member };
}

async function readObject(request: Request): Promise<Record<string, unknown>> {
  let data: unknown;
  try {
    data = await request.json();
  } catch {
    throw new HttpError(400, "Expected JSON.");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new HttpError(400, "Expected JSON.");
  return data as Record<string, unknown>;
}

function loginId(body: Record<string, unknown>): string {
  return raw(body, "loginId", 8, 200, "Invalid request.");
}

function trimmed(body: Record<string, unknown>, key: string, min: number, max: number, message: string): string {
  const value = body[key];
  if (typeof value !== "string") throw new HttpError(400, message);
  return bounded(value.trim(), min, max, message);
}

function raw(body: Record<string, unknown>, key: string, min: number, max: number, message: string): string {
  const value = body[key];
  if (typeof value !== "string") throw new HttpError(400, message);
  return bounded(value, min, max, message);
}

function bounded(value: string, min: number, max: number, message: string): string {
  if (value.length < min || value.length > max) throw new HttpError(400, message);
  return value;
}
