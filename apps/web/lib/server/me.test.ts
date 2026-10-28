import { describe, expect, it } from "vitest";
import { me, resetPassword } from "./me";
import { ana, fakeTicketService, rafael, request, sessionCookieFor, testDeps } from "./test-deps";

const anaCookie = () => sessionCookieFor({ role: "employee", id: ana.id, name: ana.name, email: ana.email });
const rafaelCookie = () => sessionCookieFor({ role: "analyst", id: rafael.id, name: rafael.name, email: rafael.email });

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
    const cookie = await sessionCookieFor({ role: "employee", id: "emp-gone", name: "Gone", email: "gone@nexo.com.br" });
    expect((await me(request("/api/me", { cookie }), await testDeps())).status).toBe(401);
  });

  it("answers 503 when the ticket-service is down", async () => {
    const deps = await testDeps({ ticketService: fakeTicketService({ down: true }) });
    expect((await me(request("/api/me", { cookie: await anaCookie() }), deps)).status).toBe(503);
  });
});

describe("POST /api/me/reset-password", () => {
  const post = (body: unknown, cookie?: string) => request("/api/me/reset-password", { method: "POST", body, cookie });
  const notice = "Enviamos um link de redefinição para ana.souza@nexo.com.br.";

  it("uses the e-mail of the session when signed in, ignoring the body", async () => {
    const response = await resetPassword(post({ email: "outra@nexo.com.br" }, await anaCookie()), await testDeps());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ notice });
  });

  it("uses the e-mail typed on the login screen when signed out", async () => {
    const response = await resetPassword(post({ email: "Ana.Souza@nexo.com.br " }), await testDeps());
    expect(await response.json()).toEqual({ notice });
  });

  it("gives the same notice for any e-mail, without saying whether it exists", async () => {
    const response = await resetPassword(post({ email: "ninguem@nexo.com.br" }), await testDeps());
    expect(await response.json()).toEqual({ notice: "Enviamos um link de redefinição para ninguem@nexo.com.br." });
  });

  it("asks for the e-mail when signed out without one", async () => {
    const response = await resetPassword(post({}), await testDeps());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "email_required", message: "Digite seu e-mail corporativo para receber o link." },
    });
  });
});
