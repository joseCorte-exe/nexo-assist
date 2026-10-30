/** The shortcut that confirms a draft: the label of the chip on Confirmar and the keys for aria-keyshortcuts. */
export type Shortcut = { label: string; keys: "Meta+Enter" | "Control+Enter" };

const APPLE = /mac ?os|iphone|ipad|ipod/i;

/**
 * ⌘↵ on Apple systems, as nexo.pen draws it; Ctrl ↵ elsewhere, where most of the employees are. Decided on the
 * server from the request (the Sec-CH-UA-Platform hint first, then the user agent), so the chip never flashes.
 */
export function confirmShortcut({ platform, userAgent }: { platform: string | null; userAgent: string | null }): Shortcut {
  const apple = platform ? APPLE.test(platform) : APPLE.test(userAgent ?? "");
  return apple ? { label: "⌘↵", keys: "Meta+Enter" } : { label: "Ctrl ↵", keys: "Control+Enter" };
}
