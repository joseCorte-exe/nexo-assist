import { describe, expect, it } from "vitest";
import { person } from "./people";
import { loginInput, resetPasswordInput } from "./web-api";

describe("loginInput", () => {
  it("trims and lowercases the e-mail", () => {
    const parsed = loginInput.parse({ email: "  Ana.Souza@Nexo.com.br ", password: "x", remember: true });
    expect(parsed.email).toBe("ana.souza@nexo.com.br");
  });

  it("rejects an empty e-mail, an invalid e-mail and an empty password", () => {
    expect(loginInput.safeParse({ email: "", password: "x", remember: false }).success).toBe(false);
    expect(loginInput.safeParse({ email: "ana", password: "x", remember: false }).success).toBe(false);
    expect(loginInput.safeParse({ email: "ana@nexo.com.br", password: "", remember: false }).success).toBe(false);
  });

  it("accepts any non-empty password", () => {
    expect(loginInput.safeParse({ email: "ana@nexo.com.br", password: " ", remember: false }).success).toBe(true);
  });
});

describe("resetPasswordInput", () => {
  it("needs the e-mail, and says what the link is for", () => {
    const parsed = resetPasswordInput.safeParse({ email: " " });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe("Digite seu e-mail corporativo para receber o link.");
    expect(resetPasswordInput.parse({ email: "Ana.Souza@nexo.com.br" })).toEqual({ email: "ana.souza@nexo.com.br" });
  });
});

describe("person", () => {
  it("tells employees and analysts apart by role", () => {
    const employee = person.parse({
      role: "employee",
      id: "emp-ana",
      name: "Ana Souza",
      email: "ana.souza@nexo.com.br",
      department: "Financeiro",
      passwordChangedAt: "2026-09-16T13:00:00.000Z",
    });
    expect(employee.role).toBe("employee");

    const analyst = person.safeParse({ role: "analyst", id: "a", name: "R", email: "r@nexo.com.br", department: "x" });
    expect(analyst.success).toBe(false);
  });
});
