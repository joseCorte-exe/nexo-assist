import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPoller, latestOnly } from "./poller";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** A task that takes 1 s and counts how many run at once. */
function slowTask() {
  const state = { runs: 0, running: 0, most: 0 };
  const task = async () => {
    state.runs++;
    state.running++;
    state.most = Math.max(state.most, state.running);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    state.running--;
  };
  return { state, task };
}

describe("createPoller", () => {
  it("runs the task every interval after the last one ended", async () => {
    const { state, task } = slowTask();
    const poller = createPoller({ task, intervalMs: 3_000, visible: () => true });
    poller.start();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(state.runs).toBe(1);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(state.runs).toBe(2);
    poller.stop();
  });

  it("never runs two at once: asked again mid-run, it runs once more when the run ends", async () => {
    const { state, task } = slowTask();
    const poller = createPoller({ task, intervalMs: 3_000, visible: () => true });
    poller.start();
    await vi.advanceTimersByTimeAsync(3_200);
    poller.runNow();
    poller.runNow();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(state.most).toBe(1);
    // One chain: a run every 4 s (1 s running, 3 s waiting), plus the one asked for, and no more.
    expect(state.runs).toBe(6);
    poller.stop();
  });

  it("waits longer while the tab is hidden, and skips the task when told to", async () => {
    let visible = false;
    const { state, task } = slowTask();
    const poller = createPoller({ task, intervalMs: 3_000, hiddenIntervalMs: 15_000, visible: () => visible });
    poller.start();
    await vi.advanceTimersByTimeAsync(14_000);
    expect(state.runs).toBe(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(state.runs).toBe(1);
    visible = true;
    poller.stop();
  });

  it("stops for good", async () => {
    const { state, task } = slowTask();
    const poller = createPoller({ task, intervalMs: 3_000, visible: () => true });
    poller.start();
    poller.stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(state.runs).toBe(0);
  });
});

describe("latestOnly", () => {
  it("takes an answer only if nothing newer was taken since it was asked", () => {
    const latest = latestOnly();
    const first = latest.begin();
    const second = latest.begin();
    expect(latest.take(second)).toBe(true);
    expect(latest.take(first)).toBe(false);
  });

  it("drops what was asked before a change the screen made itself", () => {
    const latest = latestOnly();
    const before = latest.begin();
    latest.changed();
    expect(latest.take(before)).toBe(false);
    expect(latest.take(latest.begin())).toBe(true);
  });
});
