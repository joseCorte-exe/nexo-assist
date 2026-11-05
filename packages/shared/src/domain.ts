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

/**
 * confirming: the confirmation reached for the ticket-service and its answer did not come back; it may have written,
 * so only confirming again is allowed. superseded: the agent drafted again in the same conversation. rejected: the
 * ticket-service refused the confirmation.
 */
export const draftStatus = z.enum(["pending", "confirming", "confirmed", "cancelled", "superseded", "rejected"]);
export type DraftStatus = z.infer<typeof draftStatus>;

/** A draft still waiting for her: nothing may end the conversation as if it were not there. */
export const WAITING_DRAFT: DraftStatus[] = ["pending", "confirming"];

/** message_limit: the code transferred it at the 30 messages, with something still pending (feature 6). */
export const transferReason = z.enum(["employee_request", "critical", "overdue", "agent_unsure", "message_limit"]);
export type TransferReason = z.infer<typeof transferReason>;

/** Why the ticket-service refused to confirm a draft: the ticket changed between the draft and the click. */
export const draftRejection = z.enum(["ticket_not_found", "ticket_resolved", "ticket_not_resolved", "reopen_window_closed"]);
export type DraftRejection = z.infer<typeof draftRejection>;

/** What happened in a conversation outside the messages, as the system notes tell it (feature 5). */
/** The longest summary a transfer keeps, from the model, the code or the ticket-service. */
export const MAX_TRANSFER_SUMMARY = 600;

export const conversationEvent = z.enum(["transferred", "assumed", "released", "closed", "resolved", "limit_reached"]);
export type ConversationEvent = z.infer<typeof conversationEvent>;
