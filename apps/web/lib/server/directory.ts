import type { Analyst, Employee, TicketServiceClient } from "@nexo/shared";

// The people the console names, from the ticket-service, which owns them. Names and departments rarely change, so they
// are kept for a short while: the list polls every 3 s and would otherwise ask for the same names every time.

const ANALYSTS_TTL_MS = 30_000;
const EMPLOYEES_TTL_MS = 5 * 60_000;

type Cached<T> = { value: T; until: number };

export type Directory = {
  /**
   * Every analyst, by id. The availability changes, so this lives shorter than the employees. In an outage the last ones
   * read still answer: a message of the console only needs the name and the level. Null with none read yet.
   */
  analysts: () => Promise<Map<string, Analyst> | null>;
  /** The employees with these ids, by id; null when the ticket-service did not answer. */
  employees: (ids: readonly string[]) => Promise<Map<string, Employee> | null>;
  /** Drops the analysts, after one of them changed. */
  forgetAnalysts: () => void;
};

export function createDirectory(
  ticketService: Pick<TicketServiceClient, "listAnalysts" | "listEmployeesByIds">,
  { now = () => new Date() }: { now?: () => Date } = {},
): Directory {
  let analysts: Cached<Map<string, Analyst>> | null = null;
  const employees = new Map<string, Cached<Employee>>();

  return {
    analysts: async () => {
      const at = now().getTime();
      if (analysts && analysts.until > at) return analysts.value;
      const result = await ticketService.listAnalysts();
      if (!result.ok) return analysts?.value ?? null;
      analysts = { value: new Map(result.data.map((analyst) => [analyst.id, analyst])), until: at + ANALYSTS_TTL_MS };
      return analysts.value;
    },
    employees: async (ids) => {
      const at = now().getTime();
      const missing = [...new Set(ids)].filter((id) => (employees.get(id)?.until ?? 0) <= at);
      if (missing.length > 0) {
        const result = await ticketService.listEmployeesByIds(missing);
        if (!result.ok) return null;
        for (const employee of result.data) employees.set(employee.id, { value: employee, until: at + EMPLOYEES_TTL_MS });
      }
      const found = new Map<string, Employee>();
      for (const id of ids) {
        const cached = employees.get(id);
        if (cached) found.set(id, cached.value);
      }
      return found;
    },
    forgetAnalysts: () => {
      analysts = null;
    },
  };
}
