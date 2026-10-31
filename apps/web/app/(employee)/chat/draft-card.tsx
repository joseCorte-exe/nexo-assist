"use client";

import {
  type Affected,
  type Category,
  CATEGORY_LABEL,
  DRAFT_COPY,
  DRAFT_DESCRIPTION_MAX,
  DRAFT_TITLE_MAX,
  type DraftView,
  draftLabel,
  draftView,
  editDraftInput,
  PRIORITY_LABEL,
  REJECTION_LABEL,
} from "@nexo/shared";
import { ChevronDown, CircleAlert, LoaderCircle } from "lucide-react";
import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { CheckIcon, CommandKeyIcon, ReturnKeyIcon } from "@/components/design-icons";
import { WholePixel } from "@/components/whole-pixel";
import { callApi } from "@/lib/api-client";
import { formatDueTime } from "@/lib/format";
import { useWholePixelWidth } from "@/lib/use-whole-pixel-width";
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

const dot = "size-1.5 shrink-0 rounded-full";

type Props = {
  draft: DraftView;
  /** The agent is answering: the buttons stay, so focus is not lost, but take no click yet. */
  busy: boolean;
  shortcut: Shortcut;
  /** A new state from an action of the card. */
  onChange: (draft: DraftView) => void;
  /** The card is done with the focus: confirmed or discarded, the next step is the composer. */
  onDone: () => void;
  /** The server says the draft is no longer what the card shows (another tab, a newer draft): load it again. */
  onStale: () => void;
};

type Pending = null | "confirm" | "cancel" | "save";
type Problem = string | null;

/** What the server answers when the draft changed elsewhere since the card last saw it. */
const STALE = new Set(["draft_not_pending", "draft_confirmed", "draft_confirming"]);

export function DraftCard({ draft, busy, shortcut, onChange, onDone, onStale }: Props) {
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [problem, setProblem] = useState<Problem>(null);
  const [failures, setFailures] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const card = useRef<HTMLElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  // On whole pixels, as nexo.pen lays out the buttons of the bar.
  useWholePixelWidth(confirmButton, `${draft.status}:${pending}`);
  useWholePixelWidth(editButton, `${draft.status}:${pending}`);

  const open = draft.status === "pending";
  // The confirmation went out and its answer did not come back: confirming again is all that is left.
  const confirming = draft.status === "confirming";
  const blocked = busy || pending !== null;
  const isNew = draft.operation === "create";

  async function act(kind: "confirm" | "cancel") {
    if (blocked || !(open || (confirming && kind === "confirm"))) return;
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
    if (STALE.has(result.code)) return onStale();
    const tries = failures + 1;
    setFailures(tries);
    requestAnimationFrame(() => card.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
    // A confirmation without an answer may have written: the server keeps the draft confirming, and so does the card.
    if (kind === "confirm" && result.status !== 400 && result.status !== 404 && result.status !== 409) {
      onChange({ ...draft, status: "confirming" });
      return setProblem(null);
    }
    setProblem(result.message);
  }

  // ⌘↵ (Ctrl ↵ outside Apple systems) confirms the draft waiting, from inside the card, from an empty composer or
  // with the focus on nothing, as after a click on the text of the card. With text in the composer the keys send it.
  useEffect(() => {
    if (!(open || confirming) || editing) return;
    function onKeyDown(event: KeyboardEvent) {
      const modifier = shortcut.keys === "Meta+Enter" ? event.metaKey : event.ctrlKey;
      if (event.key !== "Enter" || !modifier || event.defaultPrevented) return;
      const focus = document.activeElement;
      const inCard = card.current?.contains(focus) ?? false;
      const emptyComposer = focus instanceof HTMLTextAreaElement && focus.id === "chat-message" && focus.value.trim() === "";
      const nowhere = focus === null || focus === document.body;
      if (!inCard && !emptyComposer && !nowhere) return;
      event.preventDefault();
      void act("confirm");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const copy = DRAFT_COPY[draft.operation];
  const kind = isNew && draft.status === "confirmed" ? "Chamado" : copy.kind;
  const reference = isNew ? (draft.status === "confirmed" ? draft.ticketId : `Rascunho ${draftLabel(draft.number)}`) : draft.ticketId;
  const overdue = draft.operation === "update" && new Date(draft.dueAt) < new Date(draft.createdAt);

  return (
    <section
      ref={card}
      aria-label={`${kind} · ${reference}`}
      aria-busy={pending !== null}
      className="@container relative mt-1.5 w-full overflow-hidden rounded-2xl bg-white shadow-card outline-1 -outline-offset-[0.5px] outline-card-line"
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
          onStale={() => {
            setEditing(false);
            onStale();
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
              <span className="mt-0.5 text-12.5 text-ink-3">{copy.description}</span>
            )}
            <p className="text-13.5 leading-5 text-pretty whitespace-pre-line text-ink-2">{draft.description}</p>
          </div>
          <Fields draft={draft} overdue={overdue} />
          {/* Above the bar, next to the button it is about: under it, the composer would cover it. */}
          {confirming || problem ? (
            <p role="alert" className="fade-enter flex items-start gap-2 border-t border-rule bg-desk px-[18px] py-3 text-13.5 leading-5 text-ink-2">
              <CircleAlert aria-hidden className="mt-[3px] size-3.5 shrink-0 text-danger-text" />
              {confirming
                ? `O serviço de chamados não respondeu. Tente de novo; o chamado não será duplicado.${failures > 1 ? " Se continuar, ligue no ramal 4000." : ""}`
                : problem}
            </p>
          ) : null}
          <div className={bar}>
            {open || confirming ? (
              <div key="actions" className="fade-enter flex h-full items-center gap-1.5 py-2 pr-3.5 pl-2">
                <button
                  ref={confirmButton}
                  type="button"
                  onClick={() => act("confirm")}
                  aria-disabled={blocked || undefined}
                  aria-keyshortcuts={shortcut.keys}
                  className={`${actionBase} gap-2 bg-cta pr-2.5 pl-3.5 font-semibold text-white hover:bg-cta-hover`}
                >
                  <Working active={pending === "confirm"} label={copy.working}>
                    {confirming ? "Tentar de novo" : "Confirmar"}
                  </Working>
                  <kbd
                    aria-hidden
                    className="rounded-md bg-white/14 px-[5px] py-px font-ui text-11.5 text-white/80 [@media(hover:none)_and_(pointer:coarse)]:hidden"
                  >
                    <ShortcutKeys shortcut={shortcut} />
                  </kbd>
                </button>
                {confirming ? null : (
                  <>
                <button
                  ref={editButton}
                  type="button"
                  onClick={() => {
                    if (blocked) return;
                    setProblem(null);
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
                  </>
                )}
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

/** The bar of the card: 52 px under a 1 px rule that nexo.pen centres on its top edge, half a pixel on each side. */
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
  confirming: { dot: "bg-warning", tone: "text-warning-text", label: () => "Confirmação pendente" },
  confirmed: {
    dot: "bg-success",
    tone: "text-success-text",
    label: (draft) => DRAFT_COPY[draft.operation].done,
  },
  cancelled: { dot: "bg-ink-faint", tone: "text-ink-3", label: () => "Descartado" },
  superseded: { dot: "bg-ink-faint", tone: "text-ink-3", label: () => "Substituído" },
  rejected: {
    dot: "bg-danger",
    tone: "text-danger-text",
    label: (draft) => DRAFT_COPY[draft.operation].notDone,
  },
};

function DraftState({ draft, editing = false }: { draft: DraftView; editing?: boolean }) {
  const look = editing ? { dot: "bg-primary", tone: "text-primary-text", label: () => "Editando" } : STATE[draft.status];
  // On whole pixels, as nexo.pen lays out text that hugs its content: against the right edge, a fractional width
  // would put it a fraction of a pixel off.
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
    confirming: "",
    confirmed: DRAFT_COPY[draft.operation].confirmed(draft.ticketId ?? ""),
    cancelled: "Rascunho descartado. Se mudar de ideia, é só pedir.",
    superseded: "Substituído pelo rascunho mais recente.",
    rejected: draft.rejectedReason ? REJECTION_LABEL[draft.rejectedReason](draft.ticketId) : "O serviço de chamados recusou.",
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
  if (draft.status === "rejected") return draft.rejectedReason ? REJECTION_LABEL[draft.rejectedReason](draft.ticketId) : "";
  if (draft.status !== "confirmed") return "";
  const confirmed = DRAFT_COPY[draft.operation].confirmed(draft.ticketId ?? "");
  return draft.operation === "create" ? `${confirmed} Resposta até ${formatDueTime(draft.dueAt, draft.createdAt)}.` : confirmed;
}

type EditorProps = {
  draft: DraftView;
  kind: string;
  reference: string | null;
  shortcut: Shortcut;
  busy: boolean;
  onSaved: (draft: DraftView) => void;
  onClose: () => void;
  onStale: () => void;
};

/** Editar: the title, the description and the category become fields where they are. Never the priority. */
function DraftEditor({ draft, kind, reference, shortcut, busy, onSaved, onClose, onStale }: EditorProps) {
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
    // The same check and words as the server's.
    const checked = editDraftInput.safeParse({ ...(isNew ? { title } : {}), description });
    if (!checked.success) {
      const found = Object.fromEntries(checked.error.issues.map((issue) => [issue.path[0], issue.message]));
      setErrors({ title: found.title, description: found.description });
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
    if (STALE.has(result.code)) return onStale();
    // The reasons the server gives (an empty field, a category with a possible duplicate) are said as they are.
    setProblem(result.status === 0 || result.status >= 500 ? "Não foi possível salvar. Tente de novo." : result.message);
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
          <EditField id={ids.title} label="Título" error={errors.title} count={title.length} max={DRAFT_TITLE_MAX} warnFrom={80}>
            <input
              id={ids.title}
              ref={titleRef}
              value={title}
              maxLength={DRAFT_TITLE_MAX}
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
          label={DRAFT_COPY[draft.operation].description}
          error={errors.description}
          count={description.length}
          max={DRAFT_DESCRIPTION_MAX}
          warnFrom={900}
        >
          <textarea
            id={ids.description}
            ref={descriptionRef}
            value={description}
            maxLength={DRAFT_DESCRIPTION_MAX}
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
                className={`${inputClass} min-w-0 appearance-none pr-9 font-normal`}
              >
                {CATEGORIES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <ChevronDown aria-hidden className="pointer-events-none absolute right-3 size-4 text-ink-3" />
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
            <ShortcutKeys shortcut={shortcut} />
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

/** The keys of the chip on Confirmar and Salvar: ⌘↵ drawn as nexo.pen draws them, or Ctrl and the same ↵ elsewhere. */
function ShortcutKeys({ shortcut }: { shortcut: Shortcut }) {
  return shortcut.keys === "Meta+Enter" ? (
    <>
      <CommandKeyIcon />
      <ReturnKeyIcon />
    </>
  ) : (
    <>
      Ctrl <ReturnKeyIcon />
    </>
  );
}
