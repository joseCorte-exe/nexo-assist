import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTypingSignal } from "./typing";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function signal() {
  const sent: boolean[] = [];
  return { sent, typing: createTypingSignal((typing) => sent.push(typing)) };
}

/** A keystroke every 250 ms for this long. */
async function keepTyping(typing: ReturnType<typeof createTypingSignal>, ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed += 250) {
    typing.typed("a");
    await vi.advanceTimersByTimeAsync(250);
  }
}

describe("createTypingSignal", () => {
  it("says she writes on the first keystroke, and that she stopped after a pause", async () => {
    const { sent, typing } = signal();
    typing.typed("O");
    typing.typed("Oi");
    expect(sent).toEqual([true]);
    expect(typing.writing()).toBe(true);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(sent).toEqual([true, false]);
    expect(typing.writing()).toBe(false);
  });

  it("says it again while she keeps writing, before the console forgets it", async () => {
    const { sent, typing } = signal();
    await keepTyping(typing, 10_000);
    // The console keeps "digitando…" for 6 s after the last word: one every 3 s keeps it on.
    expect(sent.filter(Boolean).length).toBeGreaterThanOrEqual(4);
    expect(sent).not.toContain(false);
  });

  it("says she stopped at once when the field is emptied or the message goes", () => {
    const { sent, typing } = signal();
    typing.typed("Oi");
    typing.typed("");
    expect(sent).toEqual([true, false]);
    typing.typed("");
    expect(sent).toEqual([true, false]);
  });

  it("stops without a word when the chat closes", async () => {
    const { sent, typing } = signal();
    typing.typed("Oi");
    typing.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sent).toEqual([true]);
  });
});
