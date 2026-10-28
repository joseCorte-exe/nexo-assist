import { describe, expect, it } from "vitest";
import { createSession, SESSION_COOKIE, sessionCookieOptions, signSession, verifySession } from "./session";

const SECRET = "test-session-secret-0123456789";
const now = new Date("2026-10-26T13:00:00Z");
const ana = { role: "employee", id: "emp-ana", name: "Ana Souza", email: "ana.souza@nexo.com.br" } as const;

const later = (ms: number) => new Date(now.getTime() + ms);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe("createSession", () => {
  it("lasts 30 days when the user asks to stay signed in", () => {
    expect(createSession(ana, { remember: true, now }).exp).toBe(later(30 * DAY).getTime() / 1000);
  });

  it("lasts 12 hours otherwise", () => {
    expect(createSession(ana, { remember: false, now }).exp).toBe(later(12 * HOUR).getTime() / 1000);
  });
});

describe("signSession and verifySession", () => {
  it("round-trips the session", async () => {
    const session = createSession(ana, { remember: true, now });
    const token = await signSession(session, SECRET);
    expect(await verifySession(token, SECRET, later(DAY))).toEqual(session);
  });

  it("rejects a token signed with another secret", async () => {
    const token = await signSession(createSession(ana, { remember: true, now }), SECRET);
    expect(await verifySession(token, "another-secret-0123456789", now)).toBeNull();
  });

  it("rejects a token whose payload was changed", async () => {
    const token = await signSession(createSession(ana, { remember: true, now }), SECRET);
    const [, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...ana, role: "analyst", sub: "emp-ana", exp: 9e9 })).toString("base64url");
    expect(await verifySession(`${forged}.${signature}`, SECRET, now)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const token = await signSession(createSession(ana, { remember: false, now }), SECRET);
    expect(await verifySession(token, SECRET, later(12 * HOUR + 1000))).toBeNull();
  });

  it("rejects garbage without throwing", async () => {
    for (const token of ["", "abc", "a.b.c", "....", "%%%.%%%"]) {
      expect(await verifySession(token, SECRET, now)).toBeNull();
    }
  });
});

describe("sessionCookieOptions", () => {
  it("is HttpOnly, Lax and scoped to the whole site", () => {
    expect(sessionCookieOptions({ remember: false, secure: true })).toMatchObject({
      name: SESSION_COOKIE,
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
    });
  });

  it("keeps the cookie for 30 days with remember, and only while the browser is open without it", () => {
    expect(sessionCookieOptions({ remember: true, secure: false }).maxAge).toBe(30 * 24 * 60 * 60);
    expect(sessionCookieOptions({ remember: false, secure: false })).not.toHaveProperty("maxAge");
  });
});
