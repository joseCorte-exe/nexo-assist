import { z } from "zod";
import { kbArticleSchema } from "./help-center";
import { analystSchema, employeeSchema, type Person } from "./people";
import type { Category } from "./domain";
import {
  type CreateTicketInput,
  type EmployeeTicketsStatus,
  type TicketFollowUpInput,
  type TicketDetail,
  ticketDetailSchema,
  ticketSchema,
} from "./tickets";

export const SERVICE_SECRET_HEADER = "x-service-secret";
export const ADMIN_KEY_HEADER = "x-admin-key";
export const IDEMPOTENCY_KEY_HEADER = "idempotency-key";

export type TicketServiceError = {
  code: "unavailable" | "timeout" | "http_error" | "invalid_response";
  status?: number;
  /** The code the service answered with a refusal, such as reopen_window_closed. */
  serviceCode?: string;
  message: string;
};

export type TicketServiceResult<T> = { ok: true; data: T } | { ok: false; error: TicketServiceError };

type Options = {
  baseUrl: string;
  secret: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Wait before each retry. Its length sets the number of retries. */
  backoffMs?: number[];
  sleep?: (ms: number) => Promise<void>;
};

type RequestOptions = { body?: unknown; idempotencyKey?: string };

/**
 * HTTP client for the ticket-service. Tries up to 3 times on network errors, timeouts and 5xx.
 * Writes are only retried when they carry an idempotency key.
 */
export function createTicketServiceClient(options: Options) {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 3000;
  const backoffMs = options.backoffMs ?? [300, 900];
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  async function request<T>(
    schema: z.ZodType<T>,
    method: string,
    path: string,
    { body, idempotencyKey }: RequestOptions = {},
  ): Promise<TicketServiceResult<T>> {
    const canRetry = method === "GET" || idempotencyKey !== undefined;
    const headers: Record<string, string> = { [SERVICE_SECRET_HEADER]: options.secret };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (idempotencyKey !== undefined) headers[IDEMPOTENCY_KEY_HEADER] = idempotencyKey;

    let lastError: TicketServiceError = { code: "unavailable", message: "Ticket service did not answer" };

    for (let attempt = 0; attempt <= backoffMs.length; attempt++) {
      if (attempt > 0) await sleep(backoffMs[attempt - 1] ?? 0);

      let response: Response;
      try {
        response = await doFetch(new URL(path, options.baseUrl), {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        const timedOut = error instanceof DOMException && error.name === "TimeoutError";
        lastError = timedOut
          ? { code: "timeout", message: `Ticket service took longer than ${timeoutMs} ms` }
          : { code: "unavailable", message: "Could not reach the ticket service" };
        if (!canRetry) return { ok: false, error: lastError };
        continue;
      }

      if (response.status >= 500) {
        lastError = { code: "unavailable", status: response.status, message: "Ticket service is unavailable" };
        if (!canRetry) return { ok: false, error: lastError };
        continue;
      }

      const json: unknown = await response.json().catch(() => undefined);

      if (!response.ok) {
        return { ok: false, error: { code: "http_error", status: response.status, ...serviceError(json) } };
      }

      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        return { ok: false, error: { code: "invalid_response", message: parsed.error.message } };
      }
      return { ok: true, data: parsed.data };
    }

    return { ok: false, error: lastError };
  }

  const listAnalysts = () => request(z.array(analystSchema), "GET", "/analysts");

  /**
   * Who signs in with the e-mail. Employees and analysts are looked up at the same time and an employee wins a tie.
   * It only answers "nobody" (null) when both lookups answered, so an outage never reads as a wrong e-mail.
   */
  async function findPersonByEmail(rawEmail: string): Promise<TicketServiceResult<Person | null>> {
    // Same normalization as corporateEmail, so both lookups compare the same text.
    const email = rawEmail.trim().toLowerCase();
    const [employees, analysts] = await Promise.all([
      request(z.array(employeeSchema), "GET", `/employees?${new URLSearchParams({ email })}`),
      listAnalysts(),
    ]);
    const employee = employees.ok ? employees.data[0] : undefined;
    if (employee) return { ok: true, data: { role: "employee", ...employee } };
    const analyst = analysts.ok ? analysts.data.find((candidate) => candidate.email === email) : undefined;
    if (analyst) return { ok: true, data: { role: "analyst", ...analyst } };
    if (!employees.ok) return employees;
    if (!analysts.ok) return analysts;
    return { ok: true, data: null };
  }

  /** The tickets of an employee, most recent first: the open ones, or every one without a status. */
  function listEmployeeTickets(employeeId: string, { status }: { status?: EmployeeTicketsStatus } = {}) {
    const query = status ? `?${new URLSearchParams({ status })}` : "";
    return request(z.array(ticketSchema), "GET", `/employees/${encodeURIComponent(employeeId)}/tickets${query}`);
  }

  /**
   * A ticket of the employee, with its updates. The service answers the same 404 for a ticket that does not exist and
   * for one of somebody else, and both come back as null: to the employee, it is not one of theirs.
   */
  async function getTicket(ticketId: string, employeeId: string): Promise<TicketServiceResult<TicketDetail | null>> {
    const path = `/tickets/${encodeURIComponent(ticketId)}?${new URLSearchParams({ employeeId })}`;
    const result = await request(ticketDetailSchema, "GET", path);
    if (!result.ok && result.error.status === 404) return { ok: true, data: null };
    return result;
  }

  return {
    request,
    listEmployeeTickets,
    getTicket,
    findPersonByEmail,
    listAnalysts,
    searchArticles: (query: string) =>
      request(z.array(kbArticleSchema), "GET", `/kb/search?${new URLSearchParams({ q: query })}`),
    createTicket: (input: CreateTicketInput, idempotencyKey: string) =>
      request(ticketSchema, "POST", "/tickets", { body: input, idempotencyKey }),
    /** The tickets of the employee in a category a new ticket could duplicate: the open ones and the ones resolved up to 7 days ago. */
    listCandidates: (employeeId: string, category: Category) =>
      request(
        z.array(ticketSchema),
        "GET",
        `/employees/${encodeURIComponent(employeeId)}/tickets/candidates?${new URLSearchParams({ category })}`,
      ),
    /** Adds a follow-up of the employee to an open ticket of hers. The key is the draft, so a retry adds it once. */
    addFollowUp: (ticketId: string, input: TicketFollowUpInput, idempotencyKey: string) =>
      request(ticketSchema, "PATCH", `/tickets/${encodeURIComponent(ticketId)}`, { body: input, idempotencyKey }),
    /** Reopens a ticket of hers resolved up to 7 days ago. The key is the draft, so a retry reopens it once. */
    reopenTicket: (ticketId: string, input: TicketFollowUpInput, idempotencyKey: string) =>
      request(ticketSchema, "POST", `/tickets/${encodeURIComponent(ticketId)}/reopen`, { body: input, idempotencyKey }),
  };
}

export type TicketServiceClient = ReturnType<typeof createTicketServiceClient>;

function serviceError(json: unknown): { serviceCode?: string; message: string } {
  const error = typeof json === "object" && json !== null && "error" in json ? (json as { error: unknown }).error : null;
  const { code, message } = (typeof error === "object" && error !== null ? error : {}) as { code?: unknown; message?: unknown };
  return {
    ...(typeof code === "string" ? { serviceCode: code } : {}),
    message: typeof message === "string" ? message : "Ticket service rejected the request",
  };
}
