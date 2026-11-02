import type { EmployeeTicketsPanel, PanelTicket, Ticket } from "@nexo/shared";
import { type NextRequest, NextResponse } from "next/server";
import type { Deps } from "../deps";
import { jsonError, readAnalystSession, serviceUnavailable } from "../http";

/** The open ones first, newest first; then the resolved ones, the most recently resolved first. */
function byPanelOrder(a: Ticket, b: Ticket) {
  const resolved = (ticket: Ticket) => ticket.status === "resolved";
  if (resolved(a) !== resolved(b)) return resolved(a) ? 1 : -1;
  const when = (ticket: Ticket) => (resolved(ticket) ? (ticket.resolvedAt ?? ticket.createdAt) : ticket.createdAt);
  return when(b).localeCompare(when(a)) || b.id.localeCompare(a.id);
}

/**
 * GET /api/console/employees/:id/tickets. "Chamados da Ana": every ticket of the employee, for the panel and for "Ver
 * todos". Analysts read anybody's tickets; the employee's id comes from the conversation they opened.
 */
export async function ticketsPanelHandler(request: NextRequest, deps: Deps, employeeId: string) {
  const session = await readAnalystSession(request, deps);
  if (!session.ok) return session.response;
  const [tickets, employees, analysts] = await Promise.all([
    deps.ticketService.listEmployeeTickets(employeeId),
    deps.directory.employees([employeeId]),
    deps.directory.analysts(),
  ]);
  if (!tickets.ok) {
    return tickets.error.status === 404 ? jsonError(404, "employee_not_found", "Funcionário não encontrado.") : serviceUnavailable();
  }
  const employee = employees?.get(employeeId);
  if (!employee || !analysts) return serviceUnavailable();
  const shown = [...tickets.data].sort(byPanelOrder).map(
    (ticket): PanelTicket => ({
      id: ticket.id,
      title: ticket.title,
      description: ticket.description,
      status: ticket.status,
      category: ticket.category,
      subcategory: ticket.subcategory,
      priority: ticket.priority,
      createdAt: ticket.createdAt,
      resolvedAt: ticket.resolvedAt,
      assigneeName: ticket.assignedTo ? (analysts.get(ticket.assignedTo)?.name ?? null) : null,
    }),
  );
  const closed = shown.filter((ticket) => ticket.status === "resolved").length;
  return NextResponse.json<EmployeeTicketsPanel>(
    { employee: { id: employee.id, name: employee.name }, open: shown.length - closed, closed, tickets: shown },
    { headers: { "cache-control": "private, no-store" } },
  );
}
