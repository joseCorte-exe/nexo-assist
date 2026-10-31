// Reading the server again and again, as the console and the chat of an employee with an analyst do (ARQUITETURA.md,
// section 4), without two reads at once and without an old answer drawing over a newer one.

type Poller = { start: () => void; stop: () => void; runNow: () => void };

/**
 * Runs the task every interval after the last run ended (slower while the tab is hidden), never two at once: asked to run
 * while a run is going (the tab came back, the screen changed something), it runs once more when that one ends.
 */
export function createPoller({
  task,
  intervalMs,
  hiddenIntervalMs = intervalMs,
  visible,
  runWhileHidden = hiddenIntervalMs !== intervalMs,
}: {
  task: () => Promise<void>;
  intervalMs: number;
  hiddenIntervalMs?: number;
  visible: () => boolean;
  /** A hidden tab reads too, slower; otherwise it skips the task until it is visible again. */
  runWhileHidden?: boolean;
}): Poller {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let again = false;
  let stopped = true;

  const schedule = () => {
    clearTimeout(timer);
    if (!stopped) timer = setTimeout(run, visible() ? intervalMs : hiddenIntervalMs);
  };

  async function run() {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    clearTimeout(timer);
    running = true;
    try {
      if (visible() || runWhileHidden) await task();
    } finally {
      running = false;
    }
    if (again) {
      again = false;
      return run();
    }
    schedule();
  }

  return {
    start: () => {
      stopped = false;
      schedule();
    },
    stop: () => {
      stopped = true;
      clearTimeout(timer);
    },
    runNow: () => void run(),
  };
}

/**
 * Keeps only the newest answer: each request takes a number when it starts, and an answer is drawn only if nothing newer
 * was drawn since, nor changed by the screen itself (an action or a message the analyst sent) after it started.
 */
export function latestOnly() {
  let next = 0;
  let floor = 0;
  return {
    begin: () => ++next,
    take: (ticket: number) => {
      if (ticket < floor) return false;
      floor = ticket;
      return true;
    },
    changed: () => {
      floor = ++next;
    },
  };
}
