"use client";

import {
  analystSchema,
  type ConsoleDetail,
  type ConsoleFilter,
  type ConsoleListResponse,
  type ConsoleMessage,
  consoleDetail,
  consoleListResponse,
  consoleMessage,
  type EmployeeTicketsPanel,
  employeeTicketsPanel,
} from "@nexo/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { callApi } from "@/lib/api-client";

/** The console reads the list and the open conversation every 3 s, as the chat does (ARQUITETURA.md, section 4). */
const POLL_MS = 3_000;
/** The tickets change rarely: on every action of the console, and then every 30 s. */
const PANEL_POLL_MS = 30_000;
/** The search waits for a short pause in the typing. */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * Runs the task now and then every interval after it ends, never two at once, while the tab is visible. A tab that
 * comes back runs it at once: what was missed meanwhile shows up without a wait.
 */
function usePolling(task: () => Promise<void>, intervalMs: number, key: unknown) {
  const latest = useRef(task);
  latest.current = task;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const run = async () => {
      clearTimeout(timer);
      if (document.visibilityState === "visible") await latest.current();
      if (!stopped) timer = setTimeout(run, intervalMs);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };
    timer = setTimeout(run, intervalMs);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs, key]);
}

/** A message the analyst sent that the server did not take yet, or refused. */
export type PendingMessage = { id: string; text: string; failed: boolean };

export type ConsoleState = ReturnType<typeof useConsole>;

type Initial = {
  list: ConsoleListResponse | null;
  filter: ConsoleFilter;
  selectedId: string | null;
  detail: ConsoleDetail | null;
  available: boolean;
};

/** Keeps the address in step with what is open, without a navigation: a reload opens the same conversation. */
function writeAddress(filter: ConsoleFilter, selectedId: string | null) {
  const params = new URLSearchParams();
  if (filter !== "for_you") params.set("f", filter);
  if (selectedId) params.set("c", selectedId);
  const query = params.toString();
  window.history.replaceState(window.history.state, "", query ? `/console?${query}` : "/console");
}

export function useConsole(initial: Initial) {
  const [list, setList] = useState(initial.list);
  const [listFailed, setListFailed] = useState(initial.list === null);
  const [filter, setFilterState] = useState(initial.filter);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(initial.selectedId);
  const [detail, setDetail] = useState(initial.detail);
  const [detailFailed, setDetailFailed] = useState(false);
  const [panel, setPanel] = useState<EmployeeTicketsPanel | null>(null);
  const [panelFailed, setPanelFailed] = useState(false);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [acting, setActing] = useState<"assume" | "release" | "close" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [available, setAvailable] = useState(initial.available);

  // What the latest request was for: an answer that arrives after the analyst moved on is dropped.
  const listKey = `${filter}:${search}`;
  const listKeyRef = useRef(listKey);
  listKeyRef.current = listKey;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  const loadList = useCallback(async () => {
    const key = listKeyRef.current;
    const params = new URLSearchParams({ filter });
    if (search) params.set("search", search);
    const result = await callApi("GET", `/api/console/conversations?${params}`, consoleListResponse);
    if (key !== listKeyRef.current) return;
    setListFailed(!result.ok);
    if (result.ok) setList(result.data);
  }, [filter, search]);

  const loadDetail = useCallback(async () => {
    const id = selectedRef.current;
    if (!id) return;
    const result = await callApi("GET", `/api/console/conversations/${encodeURIComponent(id)}`, consoleDetail);
    if (id !== selectedRef.current) return;
    setDetailFailed(!result.ok);
    if (result.ok) setDetail(result.data);
  }, []);

  const employeeId = detail?.conversation.employee.id ?? null;
  const loadPanel = useCallback(async () => {
    if (!employeeId) return;
    const result = await callApi("GET", `/api/console/employees/${encodeURIComponent(employeeId)}/tickets`, employeeTicketsPanel);
    setPanelFailed(!result.ok);
    if (result.ok && result.data.employee.id === employeeId) setPanel(result.data);
  }, [employeeId]);

  // The search waits for a pause; the filter and the selection answer at once.
  useEffect(() => {
    const timer = setTimeout(() => void loadList(), search ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timer);
  }, [loadList, search]);
  usePolling(loadList, POLL_MS, listKey);
  usePolling(loadDetail, POLL_MS, selectedId);
  useEffect(() => {
    setPanel((current) => (current?.employee.id === employeeId ? current : null));
    void loadPanel();
  }, [loadPanel, employeeId]);
  usePolling(loadPanel, PANEL_POLL_MS, employeeId);

  // What she wrote is read once the conversation is open in front of the analyst.
  const unread = list?.conversations.find((conversation) => conversation.id === selectedId)?.unread ?? 0;
  const lastEmployeeMessage = detail?.messages.filter((message) => message.author === "employee").at(-1)?.id;
  useEffect(() => {
    if (!selectedId || detail?.conversation.id !== selectedId || document.visibilityState !== "visible") return;
    void fetch(`/api/console/conversations/${encodeURIComponent(selectedId)}/read`, { method: "POST" }).then((response) => {
      if (!response.ok) return;
      setList((current) =>
        current && {
          ...current,
          conversations: current.conversations.map((conversation) => (conversation.id === selectedId ? { ...conversation, unread: 0 } : conversation)),
        },
      );
    });
  }, [selectedId, detail?.conversation.id, lastEmployeeMessage, unread]);

  function select(id: string | null) {
    if (id === selectedId) return;
    setSelectedId(id);
    setDetail((current) => (current?.conversation.id === id ? current : null));
    setDetailFailed(false);
    setPending([]);
    setActionError(null);
    writeAddress(filter, id);
    selectedRef.current = id;
    void loadDetail();
  }

  function setFilter(next: ConsoleFilter) {
    setFilterState(next);
    writeAddress(next, selectedId);
  }

  async function act(action: "assume" | "release" | "close") {
    if (!selectedId || acting) return;
    setActing(action);
    setActionError(null);
    const result = await callApi("POST", `/api/console/conversations/${encodeURIComponent(selectedId)}/${action}`, consoleDetail);
    setActing(null);
    if (result.ok) {
      if (result.data.conversation.id === selectedRef.current) setDetail(result.data);
    } else {
      setActionError(result.message);
      void loadDetail();
    }
    void loadList();
    void loadPanel();
  }

  /** Shows the message at once; it leaves the pending ones when the server took it, or is marked to send again. */
  async function send(text: string, id = `msg-${crypto.randomUUID()}`) {
    const conversationId = selectedId;
    if (!conversationId) return;
    setPending((current) => [...current.filter((message) => message.id !== id), { id, text, failed: false }]);
    const result = await callApi("POST", `/api/console/conversations/${encodeURIComponent(conversationId)}/messages`, consoleMessage, { id, text });
    if (conversationId !== selectedRef.current) return;
    if (!result.ok) {
      setPending((current) => current.map((message) => (message.id === id ? { ...message, failed: true } : message)));
      return;
    }
    const saved: ConsoleMessage = result.data;
    setDetail((current) =>
      current && current.conversation.id === conversationId && !current.messages.some((message) => message.id === saved.id)
        ? { ...current, messages: [...current.messages, saved] }
        : current,
    );
    setPending((current) => current.filter((message) => message.id !== id));
    void loadList();
  }

  async function toggleAvailable() {
    const next = !available;
    setAvailable(next);
    const result = await callApi("PATCH", "/api/console/me", analystSchema, { available: next });
    if (!result.ok) setAvailable(!next);
  }

  return {
    list,
    listFailed,
    filter,
    setFilter,
    search,
    setSearch,
    selectedId,
    select,
    detail,
    detailFailed,
    panel,
    panelFailed,
    pending,
    send,
    act,
    acting,
    actionError,
    available,
    toggleAvailable,
    retryList: loadList,
    retryDetail: loadDetail,
    retryPanel: loadPanel,
  };
}
