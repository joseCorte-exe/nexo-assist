"use client";

import { useEffect, useRef } from "react";
import { createPoller } from "./poller";

/**
 * Runs the task every interval while enabled, never two at once; in a hidden tab, every hiddenIntervalMs if given, or not
 * at all. A tab that comes back runs it at once: what was missed meanwhile shows up without a wait. A new key starts over.
 */
export function usePolling(
  task: () => Promise<void>,
  { intervalMs, hiddenIntervalMs, enabled = true, key }: { intervalMs: number; hiddenIntervalMs?: number; enabled?: boolean; key?: unknown },
) {
  const latest = useRef(task);
  latest.current = task;
  useEffect(() => {
    if (!enabled) return;
    const poller = createPoller({
      task: () => latest.current(),
      intervalMs,
      hiddenIntervalMs,
      visible: () => document.visibilityState === "visible",
    });
    const onVisible = () => {
      if (document.visibilityState === "visible") poller.runNow();
    };
    poller.start();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      poller.stop();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, intervalMs, hiddenIntervalMs, key]);
}
