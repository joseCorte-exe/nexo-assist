import { describe, expect, it } from "vitest";
import { authenticate, login, logout } from "./auth";
import { SESSION_COOKIE, verifySession } from "./session";
import { fakeTicketService, NOW, request, SECRET, sessionCookieFor, testDeps } from "./test-deps";

describe("authenticate", () => {
  it("finds an employee", async () => {
    expect(await authenticate("ana.souza@nexo.com.br", fakeTicketService())).toEqual({
      ok: true,
      user: { role: "employee", id: "emp-ana", name: "Ana Souza", email: "ana.souza@nexo.com.br" },
    });
  });

  it("finds an analyst", async () => {
    expect(await authenticate("rafael.lima@nexo.com.br", fakeTicketService())).toEqual({
      ok: true,
      user: { role: "analyst", id: "analyst-rafael", name: "Rafael Lima", email: "rafael.lima@nexo.com.br" },
    });
  });

  it("says the e-mail was not found when nobody has it", async () => {
    expect(await authenticate("ninguem@nexo.com.br", fakeTicketService())).toEqual({
      ok: false,
      reason: "email_not_found",
    });
  });

  it("does not say the e-mail was not found when it could not look", async () => {
    expect(await authenticate("ninguem@nexo.com.br", fakeTicketService({ down: true }))).toEqual({
      ok: false,
      reason: "service_unavailable",
    });
  });

  it("still signs in an analyst when only the employee lookup fails", async () => {
    const service = fakeTicketService();
    const result = await authenticate("rafael.lima@nexo.com.br", {
      ...service,
      findEmployeeByEmail: fakeTicketService({ down: true }).findEmployeeByEmail,
    });
    expect(result.ok && result.user.role).toBe("analyst");
  });
});

describe("POST /api/auth/login", () => {
  const post = (body: unknown) => request("/api/auth/login", { method: "POST", body });

  it("returns the role and sets a signed session cookie for 30 days with remember", async () => {
    const response = await login(
      post({ email: " Ana.Souza@nexo.com.br", password: "qualquer", remember: true }),
      await testDeps(),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ role: "employee" });

    const cookie = response.cookies.get(SESSION_COOKIE);
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 30 * 24 * 60 * 60 });
    expect(await verifySession(cookie?.value ?? "", SECRET, NOW)).toMatchObject({ sub: "emp-ana", role: "employee" });
  });

  it("sets a browser-session cookie without remember", async () => {
    const response = await login(
      post({ email: "rafael.lima@nexo.com.br", password: "x", remember: false }),
      await testDeps(),
    );
    expect(await response.json()).toEqual({ role: "analyst" });
    expect(response.cookies.get(SESSION_COOKIE)?.maxAge).toBeUndefined();
  });

  it("answers 401 email_not_found for an e-mail outside the sample data", async () => {
    const response = await login(
      post({ email: "ninguem@nexo.com.br", password: "x", remember: false }),
      await testDeps(),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "email_not_found", message: "E-mail não encontrado." } });
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });

  it("answers 503 when the ticket-service is down", async () => {
    const deps = await testDeps({ ticketService: fakeTicketService({ down: true }) });
    const response = await login(post({ email: "ana.souza@nexo.com.br", password: "x", remember: false }), deps);
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("service_unavailable");
  });

  it("answers 400 with the first problem of an invalid body", async () => {
    const deps = await testDeps();
    const empty = await login(post({ email: "", password: "x", remember: false }), deps);
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: { code: "invalid_body", message: "Digite seu e-mail corporativo." } });

    expect((await login(post("not json"), deps)).status).toBe(400);
  });
});

describe("POST /api/auth/logout", () => {
  it("expires the session cookie", async () => {
    const response = await logout(
      request("/api/auth/logout", {
        method: "POST",
        cookie: await sessionCookieFor({
          role: "employee",
          id: "emp-ana",
          name: "Ana Souza",
          email: "ana.souza@nexo.com.br",
        }),
      }),
      await testDeps(),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toMatch(
      new RegExp(`^${SESSION_COOKIE}=;.*Expires=Thu, 01 Jan 1970`, "i"),
    );
  });
});
