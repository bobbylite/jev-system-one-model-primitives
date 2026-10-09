/** ID-token group claim parsing. The BFF decodes a token it received from PingOne. */

export const DEFAULT_PILOT_GROUP = "jev-pilot-program";
export const DEFAULT_GROUPS_CLAIM = "groups";

export function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeBase64Url(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Unsigned JWT used by mock mode. Real PingOne tokens are signed; only the payload is read. */
export function encodeUnsignedJwt(payload: Record<string, unknown>): string {
  const header = encodeBase64Url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const body = encodeBase64Url(JSON.stringify(payload));
  return `${header}.${body}.mock`;
}

export function decodeJwtPayload(token: string | undefined): Record<string, unknown> | undefined {
  if (!token) return undefined;
  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) return undefined;
  try {
    const parsed = JSON.parse(decodeBase64Url(parts[1])) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/**
 * Group claim shapes PingOne can emit: a JSON array, one string, or a comma-separated string.
 * A missing or undecodable claim is an empty list, which is not membership.
 */
export function readGroupsClaim(payload: Record<string, unknown> | undefined, claim: string): string[] {
  if (!payload || !claim) return [];
  const value = payload[claim];
  if (Array.isArray(value)) {
    return value.flatMap((item) => (typeof item === "string" ? splitGroupList(item) : []));
  }
  if (typeof value === "string") return splitGroupList(value);
  return [];
}

export function isPilotMember(groups: string[], pilotGroup: string): boolean {
  const needle = pilotGroup.trim().toLowerCase();
  if (!needle) return false;
  return groups.some((group) => group.trim().toLowerCase() === needle);
}

export function memberFromIdToken(
  idToken: string | undefined,
  groupsClaim: string,
  pilotGroup: string,
): boolean {
  const groups = readGroupsClaim(decodeJwtPayload(idToken), groupsClaim);
  return isPilotMember(groups, pilotGroup);
}

function splitGroupList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
