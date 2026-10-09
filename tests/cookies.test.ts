import { describe, expect, it } from "vitest";
import { csrfMatches, mergeCookies, readSessionId, serializeSessionCookie } from "../src/worker/auth/cookies";
import { createPkce } from "../src/worker/auth/pkce";

describe("session cookies", () => {
  it("keeps the session cookie httpOnly and SameSite, and Secure only on https", () => {
    const secure = serializeSessionCookie("abc", { secure: true, maxAge: 60 });
    const local = serializeSessionCookie("abc", { secure: false, maxAge: 60 });
    expect(secure).toContain("HttpOnly");
    expect(secure).toContain("SameSite=Lax");
    expect(secure).toContain("Secure");
    expect(local).not.toContain("Secure");
    expect(readSessionId(`${secure}; other=1`)).toBe("abc");
    const cleared = serializeSessionCookie("abc", { secure: true, maxAge: 60, clear: true });
    expect(cleared).toContain("Max-Age=0");
    expect(readSessionId(cleared)).toBeNull();
  });

  it("replays PingOne Set-Cookie values and overwrites the session token", () => {
    const first = mergeCookies("", ["ST=first; Path=/env; HttpOnly", "theme=dark; Path=/"]);
    expect(first).toBe("ST=first; theme=dark");
    expect(mergeCookies(first, ["ST=next; Path=/"])).toBe("ST=next; theme=dark");
  });

  it("compares CSRF tokens without accepting a different length", () => {
    expect(csrfMatches("token-1", "token-1")).toBe(true);
    expect(csrfMatches("token-1", "token-2")).toBe(false);
    expect(csrfMatches("token-1", "token")).toBe(false);
    expect(csrfMatches("token-1", undefined)).toBe(false);
  });

  it("creates a base64url PKCE challenge", async () => {
    const pkce = await createPkce();
    expect(pkce.verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(pkce.challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(pkce.verifier.length).toBeGreaterThanOrEqual(43);
    expect(pkce.challenge).not.toBe(pkce.verifier);
  });
});
