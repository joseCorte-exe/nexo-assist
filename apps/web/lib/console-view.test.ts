import type { ConsoleConversation, ConsoleMessage, PanelTicket } from "@nexo/shared";
import { describe, expect, it } from "vitest";
import {
  AVATAR_TONES,
  avatarTone,
  conversationMeta,
  headerMode,
  historyItems,
  panelSections,
  takeoverBar,
  ticketEvent,
} from "./console-view";

// 2026-10-26 is a Monday. Times are São Paulo local (-03:00).
const at = (local: string) => new Date(`${local}-03:00`).toISOString();
const NOW = new Date(at("2026-10-26T10:15"));
const RAFAEL = { id: "analyst-rafael", name: "Rafael Lima", level: "N2" } as const;

const ana: ConsoleConversation = {
  id: "conv-ana",
  employee: { id: "emp-ana", name: "Ana Souza", department: "Financeiro" },
  state: "waiting_for_analyst",
  outcome: null,
  targetLevel: "N2",
  transferReason: "overdue",
  transferConfidence: null,
  ticketId: "INC-20311",
  waitUntil: at("2026-10-26T12:05"),
  transferredAt: at("2026-10-26T10:05"),
  assumedAt: null,
  analyst: null,
  lastActivityAt: at("2026-10-26T10:05"),
  preview: null,
  unread: 2,
  online: true,
  typing: false,
};

const message = (fields: Partial<ConsoleMessage> & Pick<ConsoleMessage, "id" | "author" | "at">): ConsoleMessage => ({
  text: "texto",
  analyst: null,
  decision: null,
  note: null,
  seen: false,
  draftId: null,
  ...fields,
});

describe("avatarTone", () => {
  it("gives the sample people the tones nexo.pen gives them", () => {
    const tones = ["emp-ana", "emp-carla", "emp-bruno", "emp-diego", "emp-elisa", "emp-fabio", "emp-gabriela"].map(avatarTone);
    expect(tones).toEqual(AVATAR_TONES);
  });

  it("gives anybody else one of the seven, the same every time", () => {
    expect(AVATAR_TONES).toContainEqual(avatarTone("emp-someone-new"));
    expect(avatarTone("emp-someone-new")).toEqual(avatarTone("emp-someone-new"));
  });
});

describe("conversationMeta", () => {
  it("says she is online, her department and the ticket while she waits", () => {
    expect(conversationMeta(ana)).toBe("online · Financeiro · INC-20311");
  });

  it("drops the ticket once an analyst has it, and online when she left", () => {
    expect(conversationMeta({ ...ana, state: "with_analyst", analyst: RAFAEL })).toBe("online · Financeiro");
    expect(conversationMeta({ ...ana, online: false, state: "with_agent", ticketId: null })).toBe("Financeiro");
  });
});

describe("headerMode", () => {
  it("shows the waiting pill, the agent pill, and the actions of whoever attends", () => {
    expect(headerMode(ana, RAFAEL.id)).toEqual({ kind: "pill", tone: "warning", text: "Aguardando atendente" });
    expect(headerMode({ ...ana, state: "with_agent" }, RAFAEL.id)).toEqual({ kind: "pill", tone: "success", text: "Agent atendendo" });
    expect(headerMode({ ...ana, state: "with_analyst", analyst: RAFAEL }, RAFAEL.id)).toEqual({ kind: "actions" });
    expect(headerMode({ ...ana, state: "with_analyst", analyst: RAFAEL }, "analyst-juliana")).toEqual({
      kind: "pill",
      tone: "primary",
      text: "Com Rafael Lima",
    });
    expect(headerMode({ ...ana, state: "closed" }, RAFAEL.id)).toEqual({ kind: "pill", tone: "muted", text: "Encerrada" });
  });
});

describe("takeoverBar", () => {
  it("tells who waits and until when, with both buttons", () => {
    expect(takeoverBar(ana, RAFAEL.id, NOW)).toEqual({
      kind: "take",
      title: "Ana espera um atendente",
      body: "Agent pausado · até 12:05",
      release: true,
      placeholder: "Assuma o atendimento para responder",
    });
  });

  it("says the day of a wait that ends on another day", () => {
    expect(takeoverBar({ ...ana, waitUntil: at("2026-10-29T10:05") }, RAFAEL.id, NOW)).toMatchObject({ body: "Agent pausado · até 29 out, 10:05" });
  });

  it("offers to take a conversation the agent attends, without handing it back", () => {
    expect(takeoverBar({ ...ana, state: "with_agent", waitUntil: null }, RAFAEL.id, NOW)).toEqual({
      kind: "take",
      title: "Ana está com o agent",
      body: "Assuma para responder no lugar dele",
      release: false,
      placeholder: "Assuma o atendimento para responder",
    });
  });

  it("opens the composer for the analyst attending, and closes it for everybody else", () => {
    expect(takeoverBar({ ...ana, state: "with_analyst", analyst: RAFAEL }, RAFAEL.id, NOW)).toEqual({ kind: "compose", placeholder: "Responder a Ana…" });
    expect(takeoverBar({ ...ana, state: "with_analyst", analyst: RAFAEL }, "analyst-juliana", NOW)).toEqual({
      kind: "locked",
      text: "Rafael Lima está atendendo esta conversa",
    });
    expect(takeoverBar({ ...ana, state: "closed" }, RAFAEL.id, NOW)).toEqual({ kind: "locked", text: "Atendimento encerrado" });
  });
});

describe("historyItems", () => {
  it("opens each day with its pill, and groups her messages in a row", () => {
    const items = historyItems(
      [
        message({ id: "1", author: "employee", at: at("2026-10-25T17:00") }),
        message({ id: "2", author: "employee", at: at("2026-10-26T10:01") }),
        message({ id: "3", author: "agent", at: at("2026-10-26T10:01") }),
        message({ id: "4", author: "employee", at: at("2026-10-26T10:04") }),
        message({ id: "5", author: "employee", at: at("2026-10-26T10:04") }),
      ],
      NOW,
    );
    expect(items.map((item) => (item.kind === "day" ? `day:${item.label}` : `${item.message.id}:${item.grouped}`))).toEqual([
      "day:Ontem",
      "1:false",
      "day:Hoje",
      "2:false",
      "3:false",
      "4:false",
      "5:true",
    ]);
  });

  it("names an older day by its date", () => {
    const [day] = historyItems([message({ id: "1", author: "employee", at: at("2026-10-20T09:00") })], NOW);
    expect(day).toEqual({ kind: "day", key: "day-2026-10-20", label: "20 out" });
  });
});

const ticket = (fields: Partial<PanelTicket> & Pick<PanelTicket, "id" | "status">): PanelTicket => ({
  title: "Título",
  description: "Descrição.",
  category: "hardware",
  subcategory: null,
  priority: "medium",
  createdAt: at("2026-10-16T14:20"),
  resolvedAt: null,
  assigneeName: null,
  ...fields,
});

describe("panelSections", () => {
  const tickets = [
    ticket({ id: "INC-20311", status: "waiting_for_analyst" }),
    ticket({ id: "INC-20298", status: "in_progress" }),
    ticket({ id: "REQ-10442", status: "approved" }),
    ticket({ id: "INC-19877", status: "resolved" }),
    ticket({ id: "INC-19410", status: "resolved" }),
    ticket({ id: "INC-19001", status: "resolved" }),
  ];

  it("puts the ticket of the conversation apart and shows four others, the rest behind Ver todos", () => {
    const sections = panelSections(tickets, "INC-20311");
    expect(sections.current?.id).toBe("INC-20311");
    expect(sections.others.map((one) => one.id)).toEqual(["INC-20298", "REQ-10442", "INC-19877", "INC-19410"]);
    expect(sections.hidden).toBe(1);
  });

  it("has no current ticket when the conversation has none, or it is not hers", () => {
    expect(panelSections(tickets, null).current).toBeNull();
    expect(panelSections(tickets, "INC-99999").current).toBeNull();
  });
});

describe("ticketEvent", () => {
  it("says when it was transferred, and who assumed it", () => {
    expect(ticketEvent(ana)).toEqual({ icon: "transfer", text: "Transferido para um analista", at: ana.transferredAt });
    const assumed = { ...ana, state: "with_analyst" as const, analyst: RAFAEL, assumedAt: at("2026-10-26T10:12") };
    expect(ticketEvent(assumed)).toEqual({ icon: "analyst", text: "Assumido por Rafael Lima", at: assumed.assumedAt });
    expect(ticketEvent({ ...ana, transferredAt: null })).toBeNull();
  });
});
