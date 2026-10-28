import { z } from "zod";
import { affected, category, priority, ticketStatus, ticketType } from "./domain";

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
