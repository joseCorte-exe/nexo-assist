"use client";

import {
  type Affected,
  type Category,
  CATEGORY_LABEL,
  type DraftRejection,
  type DraftView,
  draftLabel,
  draftView,
  PRIORITY_LABEL,
} from "@nexo/shared";
import { ChevronDown, CircleAlert, LoaderCircle } from "lucide-react";
import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { CheckIcon } from "@/components/design-icons";
import { WholePixel } from "@/components/whole-pixel";
import { callApi } from "@/lib/api-client";
import { formatDueTime } from "@/lib/format";
import type { Shortcut } from "@/lib/shortcut";
import { PRIORITY_DOT } from "@/lib/ticket-look";

// The "Confirmation Card" of nexo.pen. The design draws the draft waiting for confirmation; the other states keep the
// same card and change only the state at the top and the bar at the bottom (decided with the design-engineer).

const AFFECTED_LABEL: Record<Affected, string> = {
  only_me: "Somente você",
  my_team: "Sua equipe",
  company: "Toda a empresa",
};

const CATEGORIES = Object.entries(CATEGORY_LABEL) as Array<[Category, string]>;

const REJECTED_LINE: Record<DraftRejection, (ticketId: string | null) => string> = {
  ticket_not_found: () => "Não encontrei esse chamado entre os seus.",
  ticket_resolved: (id) => `O ${id} foi resolvido e não recebe mais complementos.`,
  ticket_not_resolved: (id) => `O ${id} não está mais resolvido.`,
  reopen_window_closed: (id) => `O ${id} foi resolvido há mais de 7 dias e não pode mais ser reaberto.`,
};

const dot = "size-1.5 shrink-0 rounded-full";
const TITLE_MAX = 90;
const DESCRIPTION_MAX = 1000;

type Props = {
  draft: DraftView;
  /** The agent is answering: the buttons stay, so focus is not lost, but take no click yet. */
  busy: boolean;
  shortcut: Shortcut;
  /** A new state from an action of the card. */
  onChange: (draft: DraftView) => void;
  /** The card is done with the focus: confirmed or discarded, the next step is the composer. */
  onDone: () => void;
};

type Pending = null | "confirm" | "cancel" | "save";
type Problem = { message: string; retry: boolean } | null;

export function DraftCard({ draft, busy, shortcut, onChange, onDone }: Props) {
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [problem, setProblem] = useState<Problem>(null);
  const [failures, setFailures] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const card = useRef<HTMLElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);

  const open = draft.status === "pending";
  const blocked = busy || pending !== null;
  const isNew = draft.operation === "create";

  async function act(kind: "confirm" | "cancel") {
    if (blocked || !open) return;
    setPending(kind);
    setProblem(null);
    const result = await callApi("POST", `/api/drafts/${draft.id}/${kind}`, draftView);
    setPending(null);
    if (result.ok) {
      onChange(result.data);
      setFailures(0);
      setAnnouncement(announce(result.data));
      onDone();
      return;
    }
    if (result.code === "draft_not_pending") return onChange({ ...draft, status: "superseded" });
    const tries = failures + 1;
    setFailures(tries);
    const unavailable = result.code === "service_unavailable" || result.code === "network";
    requestAnimationFrame(() => card.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
    setProblem({
      message: unavailable
        ? `O serviço de chamados não respondeu. Tente de novo; o chamado não será duplicado.${tries > 1 ? " Se continuar, ligue no ramal 4000." : ""}`
        : result.message,
      retry: kind === "confirm" && unavailable,
    });
  }

  // ⌘↵ (Ctrl ↵ outside Apple systems) confirms the draft waiting, from inside the card or from an empty composer.
  // With text in the composer the keys send the text, as Enter does.
  useEffect(() => {
    if (!open || editing) return;
    function onKeyDown(event: KeyboardEvent) {
      const modifier = shortcut.keys === "Meta+Enter" ? event.metaKey : event.ctrlKey;
      if (event.key !== "Enter" || !modifier || event.defaultPrevented) return;
      const focus = document.activeElement;
      const inCard = card.current?.contains(focus) ?? false;
      const emptyComposer = focus instanceof HTMLTextAreaElement && focus.id === "chat-message" && focus.value.trim() === "";
      if (!inCard && !emptyComposer) return;
      event.preventDefault();
      void act("confirm");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const kind = isNew ? (draft.status === "confirmed" ? "Chamado" : "Novo chamado") : draft.operation === "update" ? "Complemento" : "Reabertura";
  const reference = isNew ? (draft.status === "confirmed" ? draft.ticketId : `Rascunho ${draftLabel(draft.number)}`) : draft.ticketId;
  const overdue = draft.operation === "update" && new Date(draft.dueAt) < new Date(draft.createdAt);

  return (
    <section
      ref={card}
      aria-label={`${kind} · ${reference}`}
      aria-busy={pending !== null}
      className="@container mt-1.5 w-full overflow-hidden rounded-2xl bg-white shadow-card outline-1 -outline-offset-[0.5px] outline-card-line"
    >
      {editing ? (
        <DraftEditor
          draft={draft}
          kind={kind}
          reference={reference}
          shortcut={shortcut}
          busy={busy}
          onSaved={(saved) => {
            onChange(saved);
            setEditing(false);
            requestAnimationFrame(() => confirmButton.current?.focus());
          }}
          onClose={() => {
            setEditing(false);
            requestAnimationFrame(() => editButton.current?.focus());
          }}
        />
      ) : (
        <>
          <div className="flex flex-col gap-1.5 px-[18px] pt-4 pb-3.5">
            <Eyebrow kind={kind} reference={reference}>
              <DraftState draft={draft} />
            </Eyebrow>
            <h3 className="text-18 font-semibold tracking-[-0.2px] text-balance text-ink">{draft.title}</h3>
            {isNew ? null : (
              <span className="mt-0.5 text-12.5 text-ink-3">{draft.operation === "update" ? "Informação nova" : "O que aconteceu de novo"}</span>
            )}
            <p className="text-13.5 leading-5 text-pretty whitespace-pre-line text-ink-2">{draft.description}</p>
          </div>
          <Fields draft={draft} overdue={overdue} />
          {/* Above the bar, next to the button it is about, and never under the composer. */}
          {problem ? (
            <p role="alert" className="fade-enter flex items-start gap-2 border-t border-rule bg-desk px-[18px] py-3 text-13.5 leading-5 text-ink-2">
              <CircleAlert aria-hidden className="mt-[3px] size-3.5 shrink-0 text-danger-text" />
              {problem.message}
            </p>
          ) : null}
          <div className={bar}>
            {open ? (
              <div key="actions" className="fade-enter flex h-full items-center gap-1.5 py-2 pr-3.5 pl-2">
                <button
                  ref={confirmButton}
                  type="button"
                  onClick={() => act("confirm")}
                  aria-disabled={blocked || undefined}
                  aria-keyshortcuts={shortcut.keys}
                  className={`${actionBase} gap-2 bg-cta pr-2.5 pl-3.5 font-semibold text-white hover:bg-cta-hover`}
                >
                  <Working active={pending === "confirm"} label={draft.operation === "create" ? "Criando…" : draft.operation === "update" ? "Enviando…" : "Reabrindo…"}>
                    {problem?.retry ? "Tentar de novo" : "Confirmar"}
                  </Working>
                  <kbd
                    aria-hidden
                    className="rounded-md bg-white/14 px-[5px] py-px font-ui text-11.5 text-white/80 [@media(hover:none)_and_(pointer:coarse)]:hidden"
                  >
                    {shortcut.label}
                  </kbd>
                </button>
                <button
                  ref={editButton}
                  type="button"
                  onClick={() => {
                    if (blocked) return;
                    setEditing(true);
                    // The fields make the card taller: keep its bar in sight, above the composer.
                    requestAnimationFrame(() => card.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
                  }}
                  aria-disabled={blocked || undefined}
                  className={`${actionBase} bg-white px-3.5 font-medium text-ink shadow-[0_1px_2px_#1b24310d] outline-1 -outline-offset-[0.5px] outline-field hover:bg-desk`}
                >
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => act("cancel")}
                  aria-disabled={blocked || undefined}
                  className={`${actionBase} px-3.5 font-medium text-ink-2 hover:bg-ink/5`}
                >
                  <Working active={pending === "cancel"} label="Descartando…">
                    Cancelar
                  </Working>
                </button>
              </div>
            ) : (
              <StatusLine key={draft.status} draft={draft} />
            )}
          </div>
        </>
      )}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </section>
  );
}

/**
 * The bar of the card: 52 px, its rule straddling the top edge as nexo.pen draws strokes, half a pixel on each side,
 * so the fields above it end where the design ends them.
 */
const bar =
  "relative h-[52px] bg-desk before:absolute before:inset-x-0 before:-top-[0.5px] before:h-px before:bg-rule";

/** The buttons of the bar: 36 px, reaching 44 px of hit area above and below. */
const actionBase =
  "relative flex h-9 shrink-0 items-center rounded-lg text-13.5 whitespace-nowrap transition-[background-color,scale] duration-150 ease-out after:absolute after:inset-x-0 after:-inset-y-1 active:scale-[0.96] aria-disabled:cursor-progress aria-disabled:active:scale-100";

/** A label that gives way to a spinner and the word of the action, if the action takes long enough to notice. */
function Working({ active, label, children }: { active: boolean; label: string; children: ReactNode }) {
  if (!active) return <span>{children}</span>;
  return (
    <span className="relative">
      <span className="invisible">{children}</span>
      <span className="delayed-appear absolute inset-y-0 left-0 flex items-center gap-1.5 whitespace-nowrap">
        <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
        {label}
      </span>
    </span>
  );
}

function Eyebrow({ kind, reference, children }: { kind: string; reference: string | null; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pb-0.5">
      <span className="text-12.5 font-medium whitespace-nowrap text-ink-3">{kind}</span>
      <span aria-hidden className="size-[3px] shrink-0 rounded-full bg-rule" />
      <span className="text-12.5 whitespace-nowrap text-ink-3">{reference}</span>
      <span className="flex-1" />
      {children}
    </div>
  );
}

const STATE: Record<DraftView["status"], { dot: string; tone: string; label: (draft: DraftView) => string }> = {
  pending: { dot: "bg-warning", tone: "text-warning-text", label: () => "Aguardando confirmação" },
  confirmed: {
    dot: "bg-success",
    tone: "text-success-text",
    label: (draft) => (draft.operation === "create" ? "Criado" : draft.operation === "update" ? "Enviado" : "Reaberto"),
  },
  cancelled: { dot: "bg-ink-faint", tone: "text-ink-3", label: () => "Descartado" },
  superseded: { dot: "bg-ink-faint", tone: "text-ink-3", label: () => "Substituído" },
  rejected: {
    dot: "bg-danger",
    tone: "text-danger-text",
    label: (draft) => (draft.operation === "reopen" ? "Não reaberto" : draft.operation === "update" ? "Não enviado" : "Não criado"),
  },
};

function DraftState({ draft, editing = false }: { draft: DraftView; editing?: boolean }) {
  const look = editing ? { dot: "bg-primary", tone: "text-primary-text", label: () => "Editando" } : STATE[draft.status];
  // Rounded up to a whole pixel, as nexo.pen lays out text that hugs its content: aligned against the right edge, a
  // fractional width would leave it a fraction of a pixel off.
  return (
    <WholePixel key={editing ? "editing" : draft.status} text={look.label(draft)} className="fade-enter flex items-center gap-1.5">
      <span aria-hidden className={`${dot} ${look.dot}`} />
      <span className={`text-12.5 font-medium whitespace-nowrap ${look.tone}`}>{look.label(draft)}</span>
    </WholePixel>
  );
}

/** Categoria, Prioridade with when the answer is due, and Afetados. Under 560 px, two columns, the priority last. */
function Fields({ draft, overdue, category }: { draft: DraftView; overdue: boolean; category?: ReactNode }) {
  const categoryText =
    draft.operation !== "create" && draft.subcategory
      ? `${CATEGORY_LABEL[draft.category]} › ${draft.subcategory}`
      : CATEGORY_LABEL[draft.category];
  return (
    <dl className="mx-[18px] -mt-[0.5px] mb-4 grid grid-cols-3 gap-x-6 gap-y-3 border-t border-rule pt-3 @max-[560px]:grid-cols-2">
      <Field label="Categoria">{category ?? categoryText}</Field>
      <Field label="Prioridade" className="@max-[560px]:order-last @max-[560px]:col-span-2">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className={`${dot} ${PRIORITY_DOT[draft.priority]}`} />
          {PRIORITY_LABEL[draft.priority]}
          {overdue ? (
            <span className="text-13.5 font-normal text-warning-text">· prazo vencido</span>
          ) : (
            <span className="text-13.5 font-normal text-ink-3">· resposta até {formatDueTime(draft.dueAt, draft.createdAt)}</span>
          )}
        </span>
      </Field>
      <Field label="Afetados">{AFFECTED_LABEL[draft.affected]}</Field>
    </dl>
  );
}

function Field({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <dt className="text-12.5 whitespace-nowrap text-ink-3">{label}</dt>
      <dd className="text-14.5 font-medium whitespace-nowrap text-ink">{children}</dd>
    </div>
  );
}

/** What replaces the bar once the draft is no longer waiting. */
function StatusLine({ draft }: { draft: DraftView }) {
  const lines: Record<DraftView["status"], string> = {
    pending: "",
    confirmed:
      draft.operation === "create"
        ? `Chamado ${draft.ticketId} criado.`
        : draft.operation === "update"
          ? `Complemento enviado ao ${draft.ticketId}.`
          : `${draft.ticketId} reaberto.`,
    cancelled: "Rascunho descartado. Se mudar de ideia, é só pedir.",
    superseded: "Substituído pelo rascunho mais recente.",
    rejected: draft.rejectedReason ? REJECTED_LINE[draft.rejectedReason](draft.ticketId) : "O serviço de chamados recusou.",
  };
  const icon =
    draft.status === "confirmed" ? (
      <CheckIcon aria-hidden className="size-3.5 shrink-0 text-success-text" />
    ) : draft.status === "rejected" ? (
      <CircleAlert aria-hidden className="size-3.5 shrink-0 text-danger-text" />
    ) : null;
  return (
    <p className="fade-enter flex h-full items-center gap-2 px-[18px] text-13.5 text-ink-2">
      {icon}
      {lines[draft.status]}
    </p>
  );
}

function announce(draft: DraftView) {
  if (draft.status === "cancelled") return "Rascunho descartado.";
  if (draft.status === "rejected") return draft.rejectedReason ? REJECTED_LINE[draft.rejectedReason](draft.ticketId) : "";
  if (draft.status !== "confirmed") return "";
  if (draft.operation === "update") return `Complemento enviado ao ${draft.ticketId}.`;
  if (draft.operation === "reopen") return `${draft.ticketId} reaberto.`;
  return `Chamado ${draft.ticketId} criado. Resposta até ${formatDueTime(draft.dueAt, draft.createdAt)}.`;
}

type EditorProps = {
  draft: DraftView;
  kind: string;
  reference: string | null;
  shortcut: Shortcut;
  busy: boolean;
  onSaved: (draft: DraftView) => void;
  onClose: () => void;
};

/** Editar: the title, the description and the category become fields where they are. Never the priority. */
function DraftEditor({ draft, kind, reference, shortcut, busy, onSaved, onClose }: EditorProps) {
  const isNew = draft.operation === "create";
  const [title, setTitle] = useState(draft.title);
  const [description, setDescription] = useState(draft.description);
  const [category, setCategory] = useState<Category>(draft.category);
  const [errors, setErrors] = useState<{ title?: string; description?: string }>({});
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const ids = { title: useId(), description: useId(), category: useId() };

  useEffect(() => {
    const field = isNew ? titleRef.current : descriptionRef.current;
    if (!field) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }, [isNew]);

  async function save() {
    if (saving || busy) return;
    const found = {
      title: isNew && !title.trim() ? "Escreva um título." : undefined,
      description: !description.trim() ? "Descreva o problema." : undefined,
    };
    if (found.title || found.description) {
      setErrors(found);
      (found.title ? titleRef.current : descriptionRef.current)?.focus();
      return;
    }
    const changes = {
      ...(isNew && title.trim() !== draft.title ? { title } : {}),
      ...(description.trim() !== draft.description ? { description } : {}),
      ...(isNew && category !== draft.category ? { category } : {}),
    };
    if (Object.keys(changes).length === 0) return onClose();
    setSaving(true);
    setProblem(null);
    const result = await callApi("PATCH", `/api/drafts/${draft.id}`, draftView, changes);
    setSaving(false);
    if (result.ok) return onSaved(result.data);
    if (result.code === "draft_not_pending") return onSaved({ ...draft, status: "superseded" });
    setProblem(result.code === "invalid_body" ? result.message : "Não foi possível salvar. Tente de novo.");
  }

  function onKeyDown(event: ReactKeyboardEvent) {
    const modifier = shortcut.keys === "Meta+Enter" ? event.metaKey : event.ctrlKey;
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "Enter" && modifier) {
      event.preventDefault();
      void save();
    }
  }

  return (
    <div onKeyDown={onKeyDown} className="fade-enter">
      <div className="flex flex-col gap-3 px-[18px] pt-4 pb-3.5">
        <Eyebrow kind={kind} reference={reference}>
          <DraftState draft={draft} editing />
        </Eyebrow>
        {isNew ? (
          <EditField id={ids.title} label="Título" error={errors.title} count={title.length} max={TITLE_MAX} warnFrom={80}>
            <input
              id={ids.title}
              ref={titleRef}
              value={title}
              maxLength={TITLE_MAX}
              enterKeyHint="next"
              readOnly={saving}
              aria-invalid={errors.title ? true : undefined}
              aria-describedby={errors.title ? `${ids.title}-error` : undefined}
              onChange={(event) => {
                setTitle(event.target.value);
                setErrors((current) => ({ ...current, title: undefined }));
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) {
                  event.preventDefault();
                  descriptionRef.current?.focus();
                }
              }}
              className={inputClass}
            />
          </EditField>
        ) : (
          <h3 className="text-18 font-semibold tracking-[-0.2px] text-balance text-ink">{draft.title}</h3>
        )}
        <EditField
          id={ids.description}
          label={isNew ? "Descrição" : draft.operation === "update" ? "Informação nova" : "O que aconteceu de novo"}
          error={errors.description}
          count={description.length}
          max={DESCRIPTION_MAX}
          warnFrom={900}
        >
          <textarea
            id={ids.description}
            ref={descriptionRef}
            value={description}
            maxLength={DESCRIPTION_MAX}
            readOnly={saving}
            aria-invalid={errors.description ? true : undefined}
            aria-describedby={errors.description ? `${ids.description}-error` : undefined}
            onChange={(event) => {
              setDescription(event.target.value);
              setErrors((current) => ({ ...current, description: undefined }));
            }}
            className={`${inputClass} min-h-[78px] max-h-[188px] resize-none py-2 leading-5 [field-sizing:content]`}
          />
        </EditField>
      </div>
      <Fields
        draft={draft}
        overdue={false}
        category={
          isNew ? (
            <span className="relative flex items-center">
              <label htmlFor={ids.category} className="sr-only">
                Categoria
              </label>
              <select
                id={ids.category}
                value={category}
                disabled={saving}
                onChange={(event) => setCategory(event.target.value as Category)}
                className="field -my-1 -ml-2 w-full min-w-0 appearance-none rounded-md bg-white py-1 pr-7 pl-2 text-14.5 font-medium text-ink outline-1 -outline-offset-[0.5px] outline-field max-md:text-16"
              >
                {CATEGORIES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <ChevronDown aria-hidden className="pointer-events-none absolute right-1.5 size-3.5 text-ink-3" />
            </span>
          ) : undefined
        }
      />
      {problem ? (
        <p role="alert" className="flex items-start gap-2 border-t border-rule bg-desk px-[18px] py-3 text-13.5 leading-5 text-ink-2">
          <CircleAlert aria-hidden className="mt-[3px] size-3.5 shrink-0 text-danger-text" />
          {problem}
        </p>
      ) : null}
      <div className={`${bar} flex items-center gap-1.5 py-2 pr-3.5 pl-2`}>
        <button
          type="button"
          onClick={save}
          aria-disabled={saving || busy || undefined}
          aria-keyshortcuts={shortcut.keys}
          className={`${actionBase} gap-2 bg-cta pr-2.5 pl-3.5 font-semibold text-white hover:bg-cta-hover`}
        >
          <Working active={saving} label="Salvando…">
            Salvar
          </Working>
          <kbd aria-hidden className="rounded-md bg-white/14 px-[5px] py-px font-ui text-11.5 text-white/80 [@media(hover:none)_and_(pointer:coarse)]:hidden">
            {shortcut.label}
          </kbd>
        </button>
        <button type="button" onClick={onClose} className={`${actionBase} px-3.5 font-medium text-ink-2 hover:bg-ink/5`}>
          Cancelar edição
        </button>
      </div>
    </div>
  );
}

const inputClass =
  "field w-full rounded-lg bg-white px-3 py-[7px] text-14.5 text-ink outline-1 -outline-offset-[0.5px] outline-field max-md:text-16 aria-invalid:outline-danger";

function EditField({
  id,
  label,
  error,
  count,
  max,
  warnFrom,
  children,
}: {
  id: string;
  label: string;
  error: string | undefined;
  count: number;
  max: number;
  warnFrom: number;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-12.5 text-ink-3">
          {label}
        </label>
        {count >= warnFrom ? (
          <span className={`text-12.5 tabular-nums ${count >= max ? "text-warning-text" : "text-ink-3"}`}>
            {count}/{max}
          </span>
        ) : null}
      </div>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-12.5 text-danger-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
