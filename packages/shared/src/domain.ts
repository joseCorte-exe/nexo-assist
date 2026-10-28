import { z } from "zod";

export const ticketType = z.enum(["INC", "REQ"]);
export type TicketType = z.infer<typeof ticketType>;

export const category = z.enum(["access", "network_vpn", "hardware", "software", "email", "other"]);
export type Category = z.infer<typeof category>;

export const priority = z.enum(["critical", "high", "medium", "low"]);
export type Priority = z.infer<typeof priority>;

export const ticketStatus = z.enum(["waiting_for_analyst", "assigned", "in_progress", "approved", "resolved"]);
export type TicketStatus = z.infer<typeof ticketStatus>;

/** Who is affected: the impact side of RN-01. */
export const affected = z.enum(["only_me", "my_team", "company"]);
export type Affected = z.infer<typeof affected>;

/** How badly the work is hit, as the model reads it from the conversation. */
export const impact = z.enum(["stopped", "degraded", "request"]);
export type Impact = z.infer<typeof impact>;

/** Whether a same-day commitment is at risk. */
export const urgency = z.enum(["same_day", "none"]);
export type Urgency = z.infer<typeof urgency>;

export const analystLevel = z.enum(["N1", "N2"]);
export type AnalystLevel = z.infer<typeof analystLevel>;

export const updateAuthor = z.enum(["employee", "agent", "analyst"]);
export type UpdateAuthor = z.infer<typeof updateAuthor>;

export const conversationState = z.enum(["with_agent", "waiting_for_analyst", "with_analyst", "closed"]);
export type ConversationState = z.infer<typeof conversationState>;

export const conversationOutcome = z.enum(["resolved_by_agent", "closed_by_analyst", "limit_reached"]);
export type ConversationOutcome = z.infer<typeof conversationOutcome>;

export const messageAuthor = z.enum(["employee", "agent", "analyst", "system"]);
export type MessageAuthor = z.infer<typeof messageAuthor>;

export const draftOperation = z.enum(["create", "update", "reopen"]);
export type DraftOperation = z.infer<typeof draftOperation>;

export const draftStatus = z.enum(["pending", "confirmed", "cancelled"]);
export type DraftStatus = z.infer<typeof draftStatus>;

export const transferReason = z.enum(["employee_request", "critical", "overdue", "agent_unsure"]);
export type TransferReason = z.infer<typeof transferReason>;
