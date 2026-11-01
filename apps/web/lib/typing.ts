/** Without a keystroke for this long, she stopped writing. */
const IDLE_MS = 4_000;
/** The console keeps "digitando…" for 6 s after it last heard (`TYPING_MS`): while she writes, it hears every 3 s. */
const REPEAT_MS = 3_000;

/**
 * What the chat tells the console about her writing: that she writes on the first keystroke and again every 3 s while
 * she goes on, and that she stopped after a pause or once the field is empty.
 */
export function createTypingSignal(send: (typing: boolean) => void) {
  let idle: ReturnType<typeof setTimeout> | null = null;
  let sentAt = 0;

  const clear = () => {
    if (idle) clearTimeout(idle);
    idle = null;
  };

  return {
    typed(text: string) {
      const was = idle !== null;
      clear();
      if (!text.trim()) {
        if (was) send(false);
        return;
      }
      if (!was || Date.now() - sentAt >= REPEAT_MS) {
        sentAt = Date.now();
        send(true);
      }
      idle = setTimeout(() => {
        idle = null;
        send(false);
      }, IDLE_MS);
    },
    writing: () => idle !== null,
    stop: clear,
  };
}
