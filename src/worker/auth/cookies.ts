/** Merge PingOne `Set-Cookie` headers into a Cookie request header value. */
export function mergeCookies(current: string, setCookies: string[]): string {
  const jar = new Map<string, string>();
  addCookieHeader(jar, current);
  for (const header of setCookies) {
    const pair = header.split(";")[0] ?? "";
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!name) continue;
    jar.set(name, value);
  }
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

export function readSetCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

function addCookieHeader(jar: Map<string, string>, header: string) {
  if (!header.trim()) return;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) jar.set(name, value);
  }
}

export function serializeSessionCookie(
  id: string,
  options: { secure: boolean; maxAge: number; clear?: boolean },
): string {
  const parts = [
    `meridian_session=${options.clear ? "" : id}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${options.clear ? 0 : options.maxAge}`,
  ];
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

export function readSessionId(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    if (name !== "meridian_session") continue;
    const value = part.slice(eq + 1).trim();
    return value || null;
  }
  return null;
}

/** Constant-time compare for CSRF tokens of equal length. */
export function csrfMatches(expected: string, presented: string | undefined): boolean {
  if (!presented || presented.length !== expected.length) return false;
  let diff = 0;
  for (let index = 0; index < expected.length; index += 1) {
    diff |= expected.charCodeAt(index) ^ presented.charCodeAt(index);
  }
  return diff === 0;
}
