import { describe, expect, it } from "vitest";
import { getEmployee, me, resetPassword } from "./me";
import { createSession } from "./session";
import { ana, fakeTicketService, NOW, rafael, request, sessionCookieFor, testDeps } from "./test-deps";

const anaCookie = () => sessionCookieFor({ role: "employee", ...ana });
const rafaelCookie = () => sessionCookieFor({ role: "analyst", ...rafael });

describe("GET /api/me", () => {
  it("returns the employee, read again from the ticket-service", async () => {
    const response = await me(request("/api/me", { cookie: await anaCookie() }), await testDeps());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ role: "employee", ...ana });
  });

  it("returns the analyst", async () => {
    const response = await me(request("/api/me", { cookie: await rafaelCookie() }), await testDeps());
    expect(await response.json()).toEqual({ role: "analyst", ...rafael });
  });

  it("answers 401 without a valid session", async () => {
    const deps = await testDeps();
    expect((await me(request("/api/me"), deps)).status).toBe(401);
    expect((await me(request("/api/me", { cookie: "nexo_session=forged.token" }), deps)).status).toBe(401);
  });

  it("answers 401 when the person in the session no longer exists", async () => {
    const cookie = await sessionCookieFor({
      role: "employee",
      id: "emp-gone",
      name: "Gone",
      email: "gone@nexo.com.br",
    });
    expect((await me(request("/api/me", { cookie }), await testDeps())).status).toBe(401);
  });

  it("answers 503 when the ticket-service is down", async () => {
    const deps = await testDeps({ ticketService: fakeTicketService({ down: true }) });
    expect((await me(request("/api/me", { cookie: await anaCookie() }), deps)).status).toBe(503);
  });
});

describe("POST /api/me/reset-password", () => {
  const post = (body: unknown) => request("/api/me/reset-password", { method: "POST", body });

  it("answers the notice for the e-mail it gets", async () => {
    const response = await resetPassword(post({ email: "Ana.Souza@nexo.com.br " }), await testDeps());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ notice: "Enviamos um link de redefinição para ana.souza@nexo.com.br." });
  });

  it("gives the same notice for any e-mail, without saying whether it exists", async () => {
    const response = await resetPassword(post({ email: "ninguem@nexo.com.br" }), await testDeps());
    expect(await response.json()).toEqual({ notice: "Enviamos um link de redefinição para ninguem@nexo.com.br." });
  });

  it("asks for the e-mail when there is none", async () => {
    const response = await resetPassword(post({}), await testDeps());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "invalid_body", message: "Digite seu e-mail corporativo para receber o link." },
    });
  });
});

describe("getEmployee", () => {
  it("gives the profile page an employee, never an analyst", async () => {
    const { ticketService } = await testDeps();
    const session = createSession({ role: "employee", ...ana }, { remember: false, now: NOW });
    expect(await getEmployee(session, ticketService)).toEqual({ ok: true, employee: ana });
  });

  it("says not found when the e-mail of the session now belongs to someone else", async () => {
    const { ticketService } = await testDeps();
    const session = createSession({ role: "employee", ...ana, id: "emp-old" }, { remember: false, now: NOW });
    expect(await getEmployee(session, ticketService)).toEqual({ ok: false, reason: "not_found" });
  });
});
