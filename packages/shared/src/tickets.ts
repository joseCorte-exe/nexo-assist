import { z } from "zod";
import { affected, analystLevel, category, MAX_TRANSFER_SUMMARY, priority, ticketStatus, ticketType, updateAuthor } from "./domain";

const TICKET_ID = /^(INC|REQ)-\d{5}$/;

/** A ticket number: INC or REQ and 5 digits, as the agent reads it in a message. Never free text in a path. */
export const ticketId = z.string().trim().toUpperCase().regex(TICKET_ID, "Número de chamado inválido.");

/** The ticket numbers written in a message, uppercased, in order and once each. */
export function findTicketIds(text: string): string[] {
  const found = text.match(/(?<![\w-])(?:INC|REQ)-\d{5}(?!\d)/gi) ?? [];
  return [...new Set(found.map((id) => id.toUpperCase()))];
}

export const ticketSchema = z.object({
  id: z.string(),
  type: ticketType,
  title: z.string(),
  description: z.string(),
  category,
  subcategory: z.string().nullable(),
  priority,
  affected,
  status: ticketStatus,
  openedBy: z.string(),
  assignedTo: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  lastItResponseAt: z.iso.datetime().nullable(),
  dueAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
});
export type Ticket = z.infer<typeof ticketSchema>;

/** Body of POST /tickets. The priority comes from RN-01, computed before the call. */
export const createTicketInput = z.object({
  employeeId: z.string().min(1),
  type: ticketType,
  title: z.string().min(1),
  description: z.string().min(1),
  category,
  subcategory: z.string().min(1).nullable(),
  priority,
  affected,
});
export type CreateTicketInput = z.infer<typeof createTicketInput>;

/** An update of a ticket: an answer of IT or a follow-up of the employee. */
export const ticketUpdateSchema = z.object({
  author: updateAuthor,
  text: z.string(),
  createdAt: z.iso.datetime(),
});
export type TicketUpdate = z.infer<typeof ticketUpdateSchema>;

/** GET /tickets/:id: the ticket, the name of the analyst who took it and its updates, oldest first. */
export const ticketDetailSchema = ticketSchema.extend({
  assigneeName: z.string().nullable(),
  updates: z.array(ticketUpdateSchema),
});
export type TicketDetail = z.infer<typeof ticketDetailSchema>;

/** Filter of GET /employees/:id/tickets. open leaves the resolved ones out; without it, every ticket comes. */
export const employeeTicketsStatus = z.enum(["open"]);
export type EmployeeTicketsStatus = z.infer<typeof employeeTicketsStatus>;

/** A ticket as a line of a list: what the employee needs to recognize it and whether it is late. */
export const ticketSummary = z.object({
  id: z.string(),
  title: z.string(),
  status: ticketStatus,
  createdAt: z.iso.datetime(),
  overdue: z.boolean(),
});
export type TicketSummary = z.infer<typeof ticketSummary>;

/** Body of PATCH /tickets/:id (a follow-up of the employee) and of POST /tickets/:id/reopen (what happened again). */
export const ticketFollowUpInput = z.object({
  employeeId: z.string().min(1),
  text: z.string().trim().min(1).max(2000),
});
export type TicketFollowUpInput = z.infer<typeof ticketFollowUpInput>;

/** Query of GET /employees/:id/tickets/candidates: the tickets that could be the same problem, open or resolved up to 7 days ago. */
export const candidatesQuery = z.object({ category });

/** Body of POST /tickets/:id/transfer: the agent passed the conversation about the ticket to an analyst of a level. */
export const ticketTransferInput = z.object({
  employeeId: z.string().min(1),
  level: analystLevel,
  summary: z.string().trim().min(1).max(MAX_TRANSFER_SUMMARY),
});
export type TicketTransferInput = z.infer<typeof ticketTransferInput>;

/** Body of POST /tickets/:id/assign: an analyst assumed the conversation about the ticket. */
export const ticketAssignInput = z.object({ employeeId: z.string().min(1), analystId: z.string().min(1) });
export type TicketAssignInput = z.infer<typeof ticketAssignInput>;

/** Body of POST /tickets/:id/answer: what an analyst wrote in the conversation about the ticket. Fits any message of the console. */
export const ticketAnswerInput = z.object({ employeeId: z.string().min(1), text: z.string().trim().min(1).max(2000) });
export type TicketAnswerInput = z.infer<typeof ticketAnswerInput>;

/** How many people the console asks for at once: the employees of a page of the list. */
export const MAX_EMPLOYEE_IDS = 200;
