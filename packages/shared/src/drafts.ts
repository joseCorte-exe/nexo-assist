import { z } from "zod";
import {
  type Affected,
  affected,
  type Category,
  category,
  draftOperation,
  draftRejection,
  draftStatus,
  type Impact,
  impact,
  priority,
  ticketType,
  type Urgency,
  urgency,
} from "./domain";
import { ticketId, ticketSummary } from "./tickets";

// The draft of a ticket (ARQUITETURA.md, sections 7 and 8): what the agent fills in draftTicket, the draft as the card
// draws it, and the edit the employee makes in the card. The ticket only exists after she confirms it.

/** The fields only a new ticket has. A follow-up and a reopening keep the classification of the ticket. */
const CREATE_ONLY = ["title", "category", "subcategory", "impact", "urgency", "affected", "notDuplicateReason"] as const;
const REQUIRED_TO_CREATE = ["title", "category", "impact", "urgency", "affected"] as const;
/** Fewer characters than this cannot tell an analyst what happens, since when and where. */
const MIN_CREATE_DESCRIPTION = 40;

/**
 * Input of draftTicket. Flat, so every provider takes its JSON schema; what each operation needs is checked here, and a
 * refused call comes back to the model with these messages, which say what to fix.
 */
export const draftTicketInput = z
  .object({
    operation: draftOperation.describe(
      "create: um chamado novo. update: acrescentar uma informação nova a um chamado aberto do funcionário. reopen: reabrir um chamado dele resolvido há até 7 dias.",
    ),
    ticketId: ticketId.optional().describe("O chamado que vai ser complementado ou reaberto. Só em update e reopen."),
    title: z
      .string()
      .trim()
      .min(5)
      .max(90)
      .optional()
      .describe("Só em create. Curto e específico, como \"VPN não conecta no notebook — erro 809\"."),
    description: z
      .string()
      .trim()
      .min(1)
      .max(1000)
      .describe(
        "create: o que acontece, desde quando, em qual equipamento ou sistema, a mensagem de erro, o que já foi tentado e o impacto no trabalho, para o analista não precisar perguntar de novo. update e reopen: só a informação nova.",
      ),
    category: category
      .optional()
      .describe("Só em create. access, network_vpn, hardware, software, email ou other."),
    subcategory: z.string().trim().min(1).max(40).nullable().optional().describe("Só em create, como \"VPN\" ou \"Notebook\"."),
    impact: impact
      .optional()
      .describe("Só em create. stopped: algo parou ou não funciona. degraded: atrapalha, mas há alternativa. request: é um pedido."),
    urgency: urgency.optional().describe("Só em create. same_day: há um compromisso hoje que depende disso. none: não há."),
    affected: affected.optional().describe("Só em create. Quem é afetado: only_me, my_team ou company."),
    notDuplicateReason: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .optional()
      .describe("Só em create, quando há chamados abertos parecidos: por que este é outro problema."),
  })
  .superRefine((input, context) => {
    const problem = (message: string) => context.addIssue({ code: "custom", message });
    if (input.operation === "create") {
      if (input.ticketId !== undefined) problem("Para criar, não mande ticketId.");
      for (const field of REQUIRED_TO_CREATE) if (input[field] === undefined) problem(`Para criar, falta ${field}.`);
      if (input.description.length < MIN_CREATE_DESCRIPTION) {
        problem("Para criar, a description precisa contar o que acontece, desde quando e em qual equipamento ou sistema.");
      }
      return;
    }
    if (input.ticketId === undefined) problem(`Para ${input.operation}, falta ticketId.`);
    if (CREATE_ONLY.some((field) => input[field] !== undefined)) {
      problem(`Em ${input.operation}, mande só ticketId e description: a classificação é a do chamado.`);
    }
  });
export type DraftTicketInput = z.infer<typeof draftTicketInput>;

/** A checked draftTicket input as its operation carries it: a new ticket whole, or the ticket and the new information. */
export type DraftRequest =
  | {
      operation: "create";
      title: string;
      description: string;
      category: Category;
      subcategory: string | null;
      impact: Impact;
      urgency: Urgency;
      affected: Affected;
      notDuplicateReason: string | null;
    }
  | { operation: "update" | "reopen"; ticketId: string; description: string };

/** The input after draftTicketInput checked it, typed by its operation. An input that skipped the schema throws. */
export function draftRequest(input: DraftTicketInput): DraftRequest {
  const { operation, ticketId, description } = input;
  if (operation !== "create") {
    if (ticketId === undefined) throw new Error(`draftTicket ${operation} without ticketId`);
    return { operation, ticketId, description };
  }
  const { title, category, impact, urgency, affected } = input;
  if (title === undefined || category === undefined || impact === undefined || urgency === undefined || affected === undefined) {
    throw new Error("draftTicket create without its classification");
  }
  return {
    operation,
    title,
    description,
    category,
    subcategory: input.subcategory ?? null,
    impact,
    urgency,
    affected,
    notDuplicateReason: input.notDuplicateReason ?? null,
  };
}

/** A draft as the card draws it, in its current state. For a follow-up or a reopening, ticketId is the ticket changed. */
export const draftView = z.object({
  id: z.string(),
  /** Shown as "Rascunho D-381". */
  number: z.number().int().positive(),
  operation: draftOperation,
  status: draftStatus,
  /** The ticket followed up or reopened, or the one created once a new ticket is confirmed. */
  ticketId: z.string().nullable(),
  type: ticketType,
  title: z.string(),
  /** A new ticket: its description. A follow-up or a reopening: the new information only. */
  description: z.string(),
  category,
  subcategory: z.string().nullable(),
  priority,
  affected,
  rejectedReason: draftRejection.nullable(),
  /** The deadline of the priority in words: "4 horas úteis". */
  deadline: z.string(),
  /** When the answer is due: as if created when drafted, then the real one once confirmed. */
  dueAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});
export type DraftView = z.infer<typeof draftView>;

export const draftLabel = (number: number) => `D-${number}`;

/** Why draftTicket drafted nothing: the refusals of the ticket-service, a possible duplicate, or the service down. */
export const draftFailure = z.enum([...draftRejection.options, "possible_duplicate", "unavailable"]);

export const draftTicketOutput = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    draft: draftView,
    /** The deadline for the model to say, already in words: "hoje, até 13:43". */
    dueText: z.string(),
  }),
  z.object({
    ok: z.literal(false),
    reason: draftFailure,
    message: z.string(),
    /** With possible_duplicate: the open tickets of the same category, for the model to judge. */
    candidates: z.array(ticketSummary).optional(),
  }),
]);
export type DraftTicketOutput = z.infer<typeof draftTicketOutput>;

// PATCH /api/drafts/:id. The priority is never here: it comes from RN-01.
export const editDraftInput = z
  .object({
    title: z
      .string({ error: "Escreva o título." })
      .trim()
      .min(1, "Escreva o título.")
      .max(90, "O título pode ter até 90 caracteres.")
      .optional(),
    description: z
      .string({ error: "Escreva a descrição." })
      .trim()
      .min(1, "Escreva a descrição.")
      .max(1000, "A descrição pode ter até 1.000 caracteres.")
      .optional(),
    category: category.optional(),
  })
  .refine((edit) => Object.values(edit).some((value) => value !== undefined), { message: "Nada para salvar." });
export type EditDraftInput = z.infer<typeof editDraftInput>;
