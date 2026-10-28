import { describe, expect, it } from "vitest";
import { loginInput, meResponse, resetPasswordInput } from "./web-api";

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
  it("allows no body e-mail, for a logged-in user", () => {
    expect(resetPasswordInput.parse({})).toEqual({});
  });
});

describe("meResponse", () => {
  it("tells employees and analysts apart by role", () => {
    const employee = meResponse.parse({
      role: "employee",
      id: "emp-ana",
      name: "Ana Souza",
      email: "ana.souza@nexo.com.br",
      department: "Financeiro",
      passwordChangedAt: "2026-09-16T13:00:00.000Z",
    });
    expect(employee.role).toBe("employee");

    const analyst = meResponse.safeParse({ role: "analyst", id: "a", name: "R", email: "r@nexo.com.br", department: "x" });
    expect(analyst.success).toBe(false);
  });
});
