import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSession, SESSION_COOKIE, signSession } from "@/lib/server/session";
import { request, SECRET } from "@/lib/server/test-deps";
import { config, proxy } from "./proxy";

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", SECRET);
});

async function cookieFor(role: "employee" | "analyst") {
  const session = createSession({ role, id: "x", name: "X", email: "x@nexo.com.br" }, { remember: false, now: new Date() });
  return `${SESSION_COOKIE}=${await signSession(session, SECRET)}`;
}

const location = (response: Response) => {
  const header = response.headers.get("location");
  return header ? new URL(header).pathname : null;
};

describe("proxy", () => {
  it("redirects a visitor without a session to the login", async () => {
    const response = await proxy(request("/profile"));
    expect(response.status).toBe(307);
    expect(location(response)).toBe("/login");
  });

  it("treats a forged cookie as no session and clears it", async () => {
    const response = await proxy(request("/", { cookie: `${SESSION_COOKIE}=forged.token` }));
    expect(location(response)).toBe("/login");
    expect(response.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=;`);
  });

  it("keeps each role on its own pages", async () => {
    expect(location(await proxy(request("/console", { cookie: await cookieFor("employee") })))).toBe("/");
    expect(location(await proxy(request("/profile", { cookie: await cookieFor("analyst") })))).toBe("/console");
    expect(location(await proxy(request("/login", { cookie: await cookieFor("analyst") })))).toBe("/console");
  });

  it("lets the request through when the page belongs to the role", async () => {
    const response = await proxy(request("/profile", { cookie: await cookieFor("employee") }));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("does not run on the API, Next assets or files", () => {
    expect(config.matcher).toEqual(["/((?!api/|_next/|.*\\..*).*)"]);
  });
});
