import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createTicketServiceClient, IDEMPOTENCY_KEY_HEADER, SERVICE_SECRET_HEADER } from "./ticket-service-client";
import type { CreateTicketInput, Ticket } from "./tickets";

const ticket: Ticket = {
  id: "INC-20312",
  type: "INC",
  title: "VPN caiu",
  description: "Erro 809 desde cedo",
  category: "network_vpn",
  subcategory: null,
  priority: "high",
  affected: "only_me",
  status: "waiting_for_analyst",
  openedBy: "emp-ana",
  assignedTo: null,
  createdAt: "2026-10-26T13:00:00.000Z",
  updatedAt: "2026-10-26T13:00:00.000Z",
  lastItResponseAt: null,
  dueAt: "2026-10-26T17:00:00.000Z",
  resolvedAt: null,
};

const input: CreateTicketInput = {
  employeeId: "emp-ana",
  type: "INC",
  title: ticket.title,
  description: ticket.description,
  category: "network_vpn",
  subcategory: null,
  priority: "high",
  affected: "only_me",
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function clientWith(responses: Array<Response | Error>, timeoutMs?: number) {
  const fetch = vi.fn(async (_url: URL, _init: RequestInit) => {
    const next = responses.shift();
    if (next instanceof Error) throw next;
    if (!next) throw new Error("no more responses");
    return next;
  });
  const client = createTicketServiceClient({
    baseUrl: "http://tickets.test",
    secret: "s3cret",
    fetch: fetch as unknown as typeof globalThis.fetch,
    sleep: async () => {},
    timeoutMs,
  });
  return { client, fetch };
}

describe("people", () => {
  const ana = {
    id: "emp-ana",
    name: "Ana Souza",
    email: "ana.souza@nexo.com.br",
    department: "Financeiro",
    passwordChangedAt: "2026-09-14T13:00:00.000Z",
  };

  it("finds an employee by e-mail through the query string", async () => {
    const { client, fetch } = clientWith([json(200, [ana])]);
    const result = await client.findEmployeeByEmail("ana.souza@nexo.com.br");
    expect(result).toEqual({ ok: true, data: ana });
    expect(String(fetch.mock.calls[0]?.[0])).toBe("http://tickets.test/employees?email=ana.souza%40nexo.com.br");
  });

  it("returns null when no employee has the e-mail", async () => {
    const { client } = clientWith([json(200, [])]);
    expect(await client.findEmployeeByEmail("ninguem@nexo.com.br")).toEqual({ ok: true, data: null });
  });

  it("lists the analysts", async () => {
    const rafael = { id: "analyst-rafael", name: "Rafael Lima", email: "rafael.lima@nexo.com.br", level: "N2", available: true };
    const { client, fetch } = clientWith([json(200, [rafael])]);
    expect(await client.listAnalysts()).toEqual({ ok: true, data: [rafael] });
    expect(String(fetch.mock.calls[0]?.[0])).toBe("http://tickets.test/analysts");
  });
});

describe("ticket-service client", () => {
  it("sends the service secret", async () => {
    const { client, fetch } = clientWith([json(200, { ok: true })]);
    await client.request(z.object({ ok: z.boolean() }), "GET", "/ping");
    const init = fetch.mock.calls[0]?.[1];
    expect((init?.headers as Record<string, string>)[SERVICE_SECRET_HEADER]).toBe("s3cret");
  });

  it("retries a read on 503 and succeeds", async () => {
    const { client, fetch } = clientWith([json(503, {}), new TypeError("fetch failed"), json(200, { ok: true })]);
    const result = await client.request(z.object({ ok: z.boolean() }), "GET", "/ping");
    expect(result).toEqual({ ok: true, data: { ok: true } });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("gives up after 3 attempts with a structured error", async () => {
    const { client, fetch } = clientWith([json(503, {}), json(503, {}), json(503, {})]);
    const result = await client.request(z.object({}), "GET", "/ping");
    expect(result).toEqual({
      ok: false,
      error: { code: "unavailable", status: 503, message: "Ticket service is unavailable" },
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("does not retry a write without an idempotency key", async () => {
    const { client, fetch } = clientWith([json(503, {}), json(200, {})]);
    const result = await client.request(z.object({}), "POST", "/tickets", { body: {} });
    expect(result.ok).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retries ticket creation with the same idempotency key", async () => {
    const { client, fetch } = clientWith([json(503, {}), json(201, ticket)]);
    const result = await client.createTicket(input, "draft-1");
    expect(result).toEqual({ ok: true, data: ticket });
    for (const call of fetch.mock.calls) {
      const init = call[1];
      expect((init?.headers as Record<string, string>)[IDEMPOTENCY_KEY_HEADER]).toBe("draft-1");
    }
  });

  it("does not retry a 4xx and keeps the service message", async () => {
    const { client, fetch } = clientWith([json(400, { error: { code: "invalid_body", message: "title is required" } })]);
    const result = await client.createTicket(input, "draft-1");
    expect(result).toEqual({ ok: false, error: { code: "http_error", status: 400, message: "title is required" } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("reports a timeout when the service takes too long", async () => {
    const fetch = vi.fn(
      (_url: URL, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const client = createTicketServiceClient({
      baseUrl: "http://tickets.test",
      secret: "s3cret",
      fetch: fetch as unknown as typeof globalThis.fetch,
      sleep: async () => {},
      timeoutMs: 10,
    });
    const result = await client.request(z.object({}), "GET", "/slow");
    expect(result.ok === false && result.error.code).toBe("timeout");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("rejects a response that does not match the contract", async () => {
    const { client } = clientWith([json(201, { id: 42 })]);
    const result = await client.createTicket(input, "draft-1");
    expect(result.ok === false && result.error.code).toBe("invalid_response");
  });
});
