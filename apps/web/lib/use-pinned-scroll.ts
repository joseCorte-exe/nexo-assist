"use client";

import { type DependencyList, type UIEvent, useLayoutEffect, useRef } from "react";

/** Closer than this to the bottom, new messages keep the view pinned; farther up, the reader is reading and is left alone. */
const PIN_DISTANCE_PX = 80;

/**
 * Keeps a scrolling history at its bottom as messages arrive, unless the reader scrolled up. Checked before paint after
 * every render, or only when the deps change.
 */
export function usePinnedScroll<Element extends HTMLElement>(deps?: DependencyList) {
  const ref = useRef<Element>(null);
  const pinned = useRef(true);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element && pinned.current) element.scrollTop = element.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  const onScroll = (event: UIEvent<Element>) => {
    const element = event.currentTarget;
    pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < PIN_DISTANCE_PX;
  };
  return { ref, onScroll };
}
