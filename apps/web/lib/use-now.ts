"use client";

import { useEffect, useState } from "react";

/**
 * The clock of the times and waits on screen: it ticks every 30 s, so "agora", "contato em 25 min" and a wait that runs
 * out move on their own. It starts at the time the server drew the page, when given, so the first paint matches it.
 */
export function useNow(renderedAt?: string) {
  const [now, setNow] = useState(() => (renderedAt ? new Date(renderedAt) : new Date()));
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
