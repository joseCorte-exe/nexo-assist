import { describe, expect, it } from "vitest";
import { guardRoute, homeOf } from "./route-guard";

describe("guardRoute", () => {
  it("sends anyone without a session to the login", () => {
    expect(guardRoute("/", null)).toBe("/login");
    expect(guardRoute("/profile", null)).toBe("/login");
    expect(guardRoute("/console", null)).toBe("/login");
  });

  it("lets anyone without a session see the login", () => {
    expect(guardRoute("/login", null)).toBeNull();
  });

  it("sends a signed-in user away from the login to the page of their role", () => {
    expect(guardRoute("/login", "employee")).toBe("/");
    expect(guardRoute("/login", "analyst")).toBe("/console");
  });

  it("keeps employees out of the console and analysts out of the employee pages", () => {
    expect(guardRoute("/console", "employee")).toBe("/");
    expect(guardRoute("/console/conversations/x", "employee")).toBe("/");
    expect(guardRoute("/", "analyst")).toBe("/console");
    expect(guardRoute("/profile", "analyst")).toBe("/console");
  });

  it("lets each role through to its own pages", () => {
    expect(guardRoute("/", "employee")).toBeNull();
    expect(guardRoute("/profile", "employee")).toBeNull();
    expect(guardRoute("/console", "analyst")).toBeNull();
  });

  it("does not treat a path that only starts with the same letters as the console", () => {
    expect(guardRoute("/consoles", "employee")).toBeNull();
  });
});

describe("homeOf", () => {
  it("is the chat for employees and the console for analysts", () => {
    expect(homeOf("employee")).toBe("/");
    expect(homeOf("analyst")).toBe("/console");
  });
});
